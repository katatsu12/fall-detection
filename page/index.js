/**
 * Home — a single detector ring in the middle of the screen.
 *
 * Runs the accelerometer in the foreground (Zepp OS forbids it in background
 * services — README §1.2), keeps the page alive, feeds samples to the
 * detector and hands off to page/alert when a fall is confirmed.
 *
 * Monitor mode (README §10.5) makes staying in the foreground liveable:
 * after AWAKE_MS without interaction the widgets are hidden and the
 * brightness dropped — a black OLED costs almost nothing. A tap anywhere or
 * raising the wrist (utils/raise-detector, fed from our own samples) wakes
 * it. A one-shot @zos/alarm is re-armed every REARM_MS so that leaving the
 * app, or the OS killing it, brings Home back within RELAUNCH_S; only an
 * explicit pause disarms it.
 *
 * Monitor mode is All-day mode, the Pro feature (utils/pro.js), switched on
 * and off on the phone settings page. Without it Home is an ordinary page:
 * the system turns the screen off on its own timer and closes the app about
 * 10 s later, so detection runs only while it is open. The title says so, and
 * when it isn't paid for, on a day without alerts, the line under it offers
 * All-day mode. syncAllDay() re-checks the licence and the switch every tick,
 * so a purchase made while page/pro is on top takes effect without a restart.
 *
 * While the wearer is covered and the screen is awake, a thin ring "beeps"
 * out of the coverage ring every PULSE_PERIOD_MS (utils/pulse.js). Its timer
 * only runs then, so a dimmed screen pays nothing for it.
 *
 * Interaction:
 *   tap anywhere         → wake the screen
 *   tap the ring (awake) → pause / resume monitoring
 *   long-press the ring  → replay a synthetic fall (DEBUG only)
 *   swipe up             → sensitivity settings
 *   tap "Get All-day mode" (free) → page/pro
 *
 * Navigation to/from the alert flow uses replace(), so each page starts
 * fresh and monitoring restarts via AUTO_START when the flow returns here.
 * Settings is push()ed on top instead, so this page stays alive underneath
 * and re-reads the stored sensitivity in its 1 s tick (API 3.0 pages have
 * no onResume to hook).
 */
import { Accelerometer, Wear, Time, FREQ_MODE_NORMAL, TIME_HOUR_FORMAT_12 } from '@zos/sensor'
import { localStorage } from '@zos/storage'
import {
  setPageBrightTime,
  resetPageBrightTime,
  pauseDropWristScreenOff,
  resetDropWristScreenOff,
  setWakeUpRelaunch,
} from '@zos/display'
import { replace, push } from '@zos/router'
import { onGesture, offGesture, GESTURE_UP } from '@zos/interaction'
import { createWidget, widget, prop, align, event } from '@zos/ui'
import { getText } from '@zos/i18n'
import { BasePage } from '@zeppos/zml/base-page'
import * as L from 'zosLoader:./index.[pf].layout.js'
import { COLOR, hideStatusBar } from '../utils/theme'
import { createFallDetector, replay, magnitudeG, STATE } from '../utils/fall-detector'
import { createRaiseDetector } from '../utils/raise-detector'
import { getPref, detectorOptions } from '../utils/prefs'
import {
  keepAwake,
  isAwake,
  dim,
  undim,
  isDimmed,
  restoreDisplay,
  armRelaunch,
  disarmRelaunch,
  REARM_MS,
} from '../utils/monitor-mode'
import { DEMO_FALL } from '../utils/demo-trace'
import { addAlert, summarizeAlerts, formatTime } from '../utils/alert-log'
import { createDiagnostics, diagText } from '../utils/fall-diagnostics'
import { pulseFrames, PULSE_FRAME_MS, PULSE_FRAMES, PULSE_PERIOD_MS } from '../utils/pulse'
import { formatDate } from '../utils/date-text'
import { DEBUG } from '../utils/debug'
import { licensed, allDayWanted, openPro } from '../utils/pro'

const AUTO_START = true // start monitoring as soon as the page opens
const FREQ_MODE = FREQ_MODE_NORMAL // README §8: measure the real Hz per mode and revisit
const KEEP_BRIGHT_MS = 2147483000 // max accepted by setPageBrightTime
const UI_REFRESH_MS = 1000
const RATE_LOG_MS = 5000
const COVERAGE_BUCKET_MS = 5000 // ring = share of 5-second buckets with samples while worn
const COVERAGE_BUCKETS = 60 // …over the last five minutes
const AWAKE_MS = 20000 // screen stays visible this long after an interaction

const WEAR_NOT_WORN = 0
const HOME_URL = 'page/index'
const ALERTS_KEY = 'alerts' // utils/alert-log.js list, kept across relaunches

function loadAlerts() {
  try {
    const v = localStorage.getItem(ALERTS_KEY, '[]')
    const list = typeof v === 'string' ? JSON.parse(v) : v
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

Page(
  BasePage({
    name: 'index',
    state: {
      running: false,
      worn: true,
      accel: null,
      wear: null,
      accelCb: null, // the exact functions passed to onChange, needed again for offChange
      wearCb: null,
      clock: null,
      detector: null,
      raise: null,
      sensitivity: '', // the stored sensitivity the detector was built for
      uiTimer: null,
      lastArmAt: 0,
      samplesSinceLog: 0,
      lastLogAt: 0,
      bucket: { startedAt: 0, samples: 0, worn: true },
      buckets: [],
      alerts: [], // utils/alert-log.js: every real detection, for the "N alerts today" line
      alertsShown: '', // text currently on that line
      clockShown: '', // …and on the clock and date lines, so they're only redrawn when they change
      dateShown: '',
      dateNames: null, // { weekdays, months } from page/i18n, for utils/date-text.js
      diag: null, // DEBUG: utils/fall-diagnostics.js — logs why each jolt did or didn't alert ([diag])
      simulating: false,
      alerting: false, // a fall was detected; the alert page opens on the next timer tick
      pulse: [], // utils/pulse.js: the ARC frames of one beep around the ring
      pulseTimer: null,
      pulseStep: 0,
      allDay: null, // All-day mode as last applied by syncAllDay(); null until onInit
      licensed: false, // …and whether it is paid for (switched off on the phone otherwise)
      upsell: false, // the line under the title offers All-day mode (unlicensed, no alerts today)
      widgets: {},
    },

    onInit() {
      this.syncAllDay()
      restoreDisplay() // a previous run may have died while dimmed
      keepAwake(AWAKE_MS)
      this.state.clock = new Time()
      this.state.dateNames = { weekdays: getText('home.weekdays').split(','), months: getText('home.months').split(',') }
      this.state.raise = createRaiseDetector()
      this.state.alerts = loadAlerts()
      if (DEBUG) this.state.diag = createDiagnostics({}, (a) => console.log('[diag]', diagText(a)))
      this.buildDetector()
    },

    /** (Re)create the detector from the stored sensitivity and log every candidate for tuning. */
    buildDetector() {
      const s = this.state
      s.sensitivity = getPref('sensitivity')
      s.detector = createFallDetector(detectorOptions())
      s.detector.onCandidate((c) => {
        console.log('[fall-candidate]', JSON.stringify(c))
        if (s.diag) s.diag.noteCandidate(c)
      })
      s.detector.onFall((evt) => this.onFallDetected(evt))
    },

    /**
     * Pick up a sensitivity change made on page/settings. That page is pushed
     * on top of this one, so there is no fresh onInit to rebuild the detector;
     * instead this runs whenever monitoring (re)starts and on every tick. An
     * evaluation already in progress is left to finish first.
     */
    syncDetector() {
      const s = this.state
      if (getPref('sensitivity') === s.sensitivity) return
      if (s.detector.getState() !== STATE.IDLE) return
      this.buildDetector()
      console.log('[detector] rebuilt for sensitivity', s.sensitivity)
    },

    build() {
      hideStatusBar()
      const w = this.state.widgets

      // Bottom of the stack: a black full-screen rect so a tap anywhere wakes a dimmed screen.
      createWidget(widget.FILL_RECT, { ...L.SCREEN, color: COLOR.bg }).addEventListener(event.CLICK_UP, () => this.wake())
      // The beep, under everything else so it grows out from behind the ring; hidden until setPulse() runs it.
      this.state.pulse = pulseFrames(L.RING, { ...L.PULSE, color: COLOR.green })
      w.pulse = createWidget(widget.ARC, this.state.pulse[0])
      w.pulse.setProperty(prop.VISIBLE, false)

      w.clock = createWidget(widget.TEXT, {
        ...L.CLOCK,
        text: '',
        color: COLOR.text,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })
      w.track = createWidget(widget.ARC, { ...L.RING, end_angle: L.RING_FULL, color: COLOR.track })
      w.ring = createWidget(widget.ARC, { ...L.RING, end_angle: L.RING_FULL, color: COLOR.green })
      w.disc = createWidget(widget.BUTTON, {
        ...L.DISC,
        normal_color: COLOR.bg,
        press_color: COLOR.card,
        click_func: () => this.onTap(),
        longpress_func: () => DEBUG && this.simulateFall(),
      })
      w.shield = createWidget(widget.IMG, { ...L.SHIELD, auto_scale: true })
      w.shield.addEventListener(event.CLICK_UP, () => this.onTap())

      w.date = createWidget(widget.TEXT, {
        ...L.DATE,
        text: '',
        color: COLOR.muted,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })
      w.title = createWidget(widget.TEXT, {
        ...L.TITLE,
        text: getText('home.paused'),
        color: COLOR.text,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })
      w.alerts = createWidget(widget.TEXT, {
        ...L.ALERTS,
        text: '',
        color: COLOR.muted,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })
      w.alerts.addEventListener(event.CLICK_UP, () => this.onAlertsLine())

      onGesture((g) => {
        keepAwake(AWAKE_MS)
        if (g === GESTURE_UP) {
          push({ url: 'page/settings' })
          return true
        }
        return false
      })

      if (AUTO_START) this.startMonitoring()
      this.render()
    },

    /** A tap on the ring: wakes a dimmed screen, otherwise pauses/resumes. */
    onTap() {
      const wasDimmed = isDimmed()
      this.wake()
      if (wasDimmed) return
      if (this.state.running) this.pause()
      else this.startMonitoring()
    },

    wake() {
      keepAwake(AWAKE_MS)
      if (isDimmed()) {
        undim()
        this.render()
      }
    },

    /** The line under the title: alerts today, or (free) the way to All-day mode. */
    onAlertsLine() {
      this.wake()
      if (this.state.upsell) openPro()
    },

    /**
     * Apply All-day mode (utils/pro.js) whenever it changes: at init, on every start
     * and every tick — a purchase, a refund or the phone's switch takes effect without a
     * restart. Off, Home gives the screen back to the system, which closes the app about
     * 10 s after the screen goes off; nothing reopens it.
     */
    syncAllDay() {
      const s = this.state
      s.licensed = licensed()
      const on = s.licensed && allDayWanted()
      if (on === s.allDay) return
      s.allDay = on
      // Come back to this page instead of the watch face when the screen wakes.
      setWakeUpRelaunch({ relaunch: on })
      if (!on) disarmRelaunch() // incl. an alarm a licensed run left pending
      if (!s.running) return // startMonitoring() applies the rest
      this.keepAlive(on)
      if (on) this.rearm(true)
      else undim()
    },

    /** All-day mode: keep the page (and therefore the sensor callback) alive — or give that back. */
    keepAlive(on) {
      if (on) {
        keepAwake(AWAKE_MS) // don't go dark the moment it starts
        setPageBrightTime({ brightTime: KEEP_BRIGHT_MS })
        pauseDropWristScreenOff({ duration: 0 })
      } else {
        resetPageBrightTime()
        resetDropWristScreenOff()
      }
    },

    startMonitoring() {
      if (this.state.running) return
      const s = this.state
      this.syncDetector()
      this.syncAllDay() // a purchase may have landed while paused, when no tick runs
      s.raise.reset()

      s.wear = new Wear()
      s.worn = s.wear.getStatus() !== WEAR_NOT_WORN
      s.wearCb = () => {
        if (!s.wear) return // a callback queued before stopMonitoring()
        s.worn = s.wear.getStatus() !== WEAR_NOT_WORN
        if (!s.worn) s.detector.reset() // don't carry a half-seen fall across a wear gap
        this.render()
      }
      s.wear.onChange(s.wearCb)

      s.accel = new Accelerometer()
      s.accelCb = () => this.onSample()
      s.accel.onChange(s.accelCb)
      s.accel.setFreqMode(FREQ_MODE)
      s.accel.start()

      if (s.allDay) this.keepAlive(true)

      const now = Date.now()
      s.running = true
      s.samplesSinceLog = 0
      s.lastLogAt = now
      s.buckets = []
      s.bucket = { startedAt: now, samples: 0, worn: s.worn }
      s.uiTimer = setInterval(() => this.tick(), UI_REFRESH_MS)
      if (s.allDay) this.rearm(true)
      this.render()
    },

    /**
     * Stop the sensors and restore the screen. The relaunch alarm is left alone — see pause().
     * `refresh` is false when the page is going away: onDestroy must not touch widgets.
     */
    stopMonitoring(refresh = true) {
      const s = this.state
      this.setPulse(false, refresh)
      if (s.accel) {
        s.accel.offChange(s.accelCb)
        s.accel.stop()
        s.accel = null
        s.accelCb = null
      }
      if (s.wear) {
        s.wear.offChange(s.wearCb)
        s.wear = null
        s.wearCb = null
      }
      if (s.uiTimer) {
        clearInterval(s.uiTimer)
        s.uiTimer = null
      }
      if (s.running) this.keepAlive(false)
      undim()
      s.running = false
      s.detector.reset()
      if (refresh) this.render()
    },

    /** The wearer's explicit stop: the only thing that also cancels the relaunch alarm. */
    pause() {
      this.stopMonitoring()
      disarmRelaunch()
    },

    /** Push the dead-man's alarm out again; `force` ignores the REARM_MS cadence. */
    rearm(force) {
      const s = this.state
      const now = Date.now()
      if (!force && now - s.lastArmAt < REARM_MS) return
      s.lastArmAt = now // also on failure, so a missing permission is retried at the same cadence
      armRelaunch(HOME_URL)
    },

    onSample() {
      const s = this.state
      // A callback queued before stopMonitoring(), or after a fall while the alert is opening.
      if (!s.accel || s.alerting) return
      const { x, y, z } = s.accel.getCurrent()
      const now = Date.now()
      s.samplesSinceLog++
      s.bucket.samples++
      if (s.raise.push(now, x, y, z) && isDimmed()) this.wake()
      const g = magnitudeG(x, y, z)
      if (!s.worn) {
        s.bucket.worn = false
        if (s.diag) s.diag.push(now, g, 'OFF', 'OFF') // logs "off wrist" for jolts while detection is paused
        return
      }
      if (DEBUG && s.samplesSinceLog === 1) console.log('[g]', g.toFixed(2))
      const before = s.detector.getState()
      s.detector.push(now, x, y, z)
      if (s.diag) s.diag.push(now, g, before, s.detector.getState())
    },

    /** Once a second: coverage bucket, sample-rate log, settings and licence pickup, dimming, relaunch alarm, ring. */
    tick() {
      const s = this.state
      if (s.alerting) return
      const now = Date.now()
      this.syncDetector()
      if (now - s.bucket.startedAt >= COVERAGE_BUCKET_MS) {
        s.buckets.push(s.bucket.samples > 0 && s.bucket.worn)
        if (s.buckets.length > COVERAGE_BUCKETS) s.buckets.shift()
        s.bucket = { startedAt: now, samples: 0, worn: s.worn }
      }
      if (DEBUG && now - s.lastLogAt >= RATE_LOG_MS) {
        console.log('[rate]', Math.round((s.samplesSinceLog * 1000) / (now - s.lastLogAt)), 'Hz')
        s.samplesSinceLog = 0
        s.lastLogAt = now
      }
      this.syncAllDay()
      if (s.allDay) {
        if (isDimmed() && isAwake()) undim() // Settings (pushed on top) asked for the screen
        else if (!isDimmed() && !isAwake()) dim()
        this.rearm(false)
      }
      this.render()
    },

    coverage() {
      const s = this.state
      if (!s.running) return 0
      if (!s.buckets.length) return s.worn ? 1 : 0
      return s.buckets.filter(Boolean).length / s.buckets.length
    },

    clockText() {
      const c = this.state.clock
      const m = c.getMinutes()
      return `${c.getFormatHour()}:${m < 10 ? '0' : ''}${m}`
    },

    /** "Sat, Sep 26", in the order and names page/i18n gives. */
    dateText() {
      const c = this.state.clock
      const { weekdays, months } = this.state.dateNames
      return formatDate(getText('home.date'), weekdays, months, { weekday: c.getDay(), day: c.getDate(), month: c.getMonth() })
    },

    /** "2 alerts today · last 14:32" — the MVP test's false-alarm tally; empty on a day without alerts. */
    alertsLine() {
      const { today, last } = summarizeAlerts(this.state.alerts, Date.now())
      if (!today) return { text: '', color: COLOR.redSoft }
      const time = formatTime(last.t, this.state.clock.getHourFormat() === TIME_HOUR_FORMAT_12)
      const key = today === 1 ? 'home.alerts_one' : 'home.alerts_many'
      return { text: getText(key).replace('{n}', today).replace('{time}', time), color: COLOR.redSoft }
    },

    /** Count a real detection (not the long-press demo) and keep it across relaunches. */
    logAlert(evt) {
      const s = this.state
      s.alerts = addAlert(s.alerts, evt, Date.now())
      try {
        localStorage.setItem(ALERTS_KEY, JSON.stringify(s.alerts))
      } catch (e) {
        console.log('[alerts] save failed', e)
      }
      console.log('[alerts]', this.alertsLine().text)
    },

    render() {
      const s = this.state
      const w = s.widgets
      if (!w.title) return

      const visible = !isDimmed()
      for (const k of ['clock', 'track', 'ring', 'disc', 'shield', 'date', 'title', 'alerts']) w[k].setProperty(prop.VISIBLE, visible)
      this.setPulse(visible && s.running && s.worn) // "covered", and someone can see it
      if (!visible) return

      let title = 'home.paused'
      let ringColor = COLOR.track
      if (s.running) {
        // Free: covered only until the system closes the app, and the title must not promise more.
        title = s.worn ? (s.allDay ? 'home.covered' : 'home.covered_open') : 'home.not_worn'
        ringColor = s.worn ? COLOR.green : COLOR.redSoft
      }
      const clock = this.clockText()
      if (clock !== s.clockShown) {
        s.clockShown = clock
        w.clock.setProperty(prop.TEXT, clock)
      }
      const date = this.dateText()
      if (date !== s.dateShown) {
        s.dateShown = date
        w.date.setProperty(prop.TEXT, date)
      }
      w.title.setProperty(prop.TEXT, getText(title))
      let line = this.alertsLine()
      // Unlicensed, and no alerts today: the line offers All-day mode instead (tap → page/pro).
      // Licensed but switched off on the phone: the title alone says so.
      s.upsell = !s.licensed && !line.text
      if (s.upsell) line = { text: getText('home.all_day'), color: COLOR.green }
      if (line.text !== s.alertsShown) {
        // setProperty(MORE) redraws the widget, so only when the line changes (a new alert, or midnight)
        s.alertsShown = line.text
        w.alerts.setProperty(prop.MORE, { ...L.ALERTS, ...line })
      }
      w.ring.setProperty(prop.MORE, {
        ...L.RING,
        color: ringColor,
        end_angle: L.RING.start_angle + Math.max(1, 360 * this.coverage()),
      })
    },

    /**
     * Start or stop the beep. `refresh` is false when the page is going away:
     * then only the timer stops and the widget is left alone.
     */
    setPulse(on, refresh = true) {
      const s = this.state
      if (on) {
        if (!s.pulseTimer) {
          s.pulseStep = 0
          s.pulseTimer = setInterval(() => this.pulseFrame(), PULSE_FRAME_MS)
        }
        return
      }
      if (!s.pulseTimer) return
      clearInterval(s.pulseTimer)
      s.pulseTimer = null
      if (refresh) s.widgets.pulse.setProperty(prop.VISIBLE, false)
    },

    /** One PULSE_FRAME_MS step: PULSE_FRAMES frames of the ring, then hidden until the next beep. */
    pulseFrame() {
      const s = this.state
      const w = s.widgets.pulse
      const i = s.pulseStep
      s.pulseStep = (i + 1) % Math.round(PULSE_PERIOD_MS / PULSE_FRAME_MS)
      if (i < PULSE_FRAMES) {
        w.setProperty(prop.MORE, s.pulse[i]) // precomputed: no maths or allocation per frame
        if (i === 0) w.setProperty(prop.VISIBLE, true)
      } else if (i === PULSE_FRAMES) {
        w.setProperty(prop.VISIBLE, false)
      }
    },

    /**
     * The detector calls this from inside the accelerometer's onChange callback
     * (or the long-press handler, for the demo). Stopping that sensor and
     * replacing the page from inside its own callback destroys both while the
     * callback still runs — the likely cause of a freeze and reboot on an
     * Amazfit Active (2026-09-24). So only note the fall here; openAlert()
     * does the teardown on a fresh tick.
     */
    onFallDetected(evt) {
      const s = this.state
      if (s.alerting) return
      s.alerting = true // onSample and tick ignore everything from now on
      console.log('[fall]', JSON.stringify(evt))
      const simulated = s.simulating
      setTimeout(() => this.openAlert(evt, simulated), 0)
    },

    openAlert(evt, simulated) {
      if (!simulated) {
        try {
          this.logAlert(evt)
        } catch (e) {
          console.log('[alerts] log failed', e) // bookkeeping must never block the alert
        }
      }
      try {
        disarmRelaunch() // the alert flow comes back here by itself
        this.stopMonitoring(false) // no widget updates: the page is about to go
        replace({ url: 'page/alert', params: JSON.stringify(evt) })
      } catch (e) {
        // Never leave Home stopped: keep monitoring even if the alert page could not open.
        console.log('[fall] alert page failed', e)
        this.state.alerting = false
        this.startMonitoring()
      }
    },

    /** Debug: replay the synthetic forward fall through the detector, bypassing the sensor. Not counted as an alert. */
    simulateFall() {
      this.wake()
      if (!this.state.running) this.startMonitoring()
      this.state.simulating = true
      const events = replay(this.state.detector, DEMO_FALL, Date.now())
      this.state.simulating = false
      console.log('[simulate] events:', events.length)
    },

    // Leaving the page while monitoring (side button, OS kill, replace) keeps the alarm armed:
    // that is the dead-man's switch. pause() is the only path that disarms it.
    onDestroy() {
      this.stopMonitoring(false) // widgets may already be gone
      offGesture()
    },
  }),
)
