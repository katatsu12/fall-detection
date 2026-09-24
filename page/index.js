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
 * Interaction:
 *   tap anywhere         → wake the screen
 *   tap the ring (awake) → pause / resume monitoring
 *   long-press the ring  → replay a synthetic fall (DEBUG only)
 *   swipe up             → sensitivity settings
 *   swipe down           → background probe (DEBUG only, README §10)
 *
 * Navigation to/from the alert flow uses replace(), so each page starts
 * fresh and monitoring restarts via AUTO_START when the flow returns here.
 * Settings is push()ed on top instead, so this page stays alive underneath
 * and re-reads the stored sensitivity in its 1 s tick (API 3.0 pages have
 * no onResume to hook).
 */
import { Accelerometer, Wear, Time, FREQ_MODE_NORMAL } from '@zos/sensor'
import {
  setPageBrightTime,
  resetPageBrightTime,
  pauseDropWristScreenOff,
  resetDropWristScreenOff,
  setWakeUpRelaunch,
} from '@zos/display'
import { replace, push } from '@zos/router'
import { onGesture, offGesture, GESTURE_UP, GESTURE_DOWN } from '@zos/interaction'
import { createWidget, widget, prop, align, event } from '@zos/ui'
import { getText } from '@zos/i18n'
import { BasePage } from '@zeppos/zml/base-page'
import * as L from 'zosLoader:./index.[pf].layout.js'
import { COLOR } from '../utils/theme'
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

const AUTO_START = true // start monitoring as soon as the page opens
const DEBUG = true // long-press the ring to simulate a fall; log sample rate
const FREQ_MODE = FREQ_MODE_NORMAL // README §8: measure the real Hz per mode and revisit
const KEEP_BRIGHT_MS = 2147483000 // max accepted by setPageBrightTime
const UI_REFRESH_MS = 1000
const RATE_LOG_MS = 5000
const COVERAGE_BUCKET_MS = 5000 // ring = share of 5-second buckets with samples while worn
const COVERAGE_BUCKETS = 60 // …over the last five minutes
const AWAKE_MS = 20000 // screen stays visible this long after an interaction

const WEAR_NOT_WORN = 0
const HOME_URL = 'page/index'

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
      widgets: {},
    },

    onInit() {
      // Come back to this page instead of the watch face when the screen wakes.
      setWakeUpRelaunch({ relaunch: true })
      restoreDisplay() // a previous run may have died while dimmed
      keepAwake(AWAKE_MS)
      this.state.clock = new Time()
      this.state.raise = createRaiseDetector()
      this.buildDetector()
    },

    /** (Re)create the detector from the stored sensitivity and log every candidate for tuning. */
    buildDetector() {
      const s = this.state
      s.sensitivity = getPref('sensitivity')
      s.detector = createFallDetector(detectorOptions())
      s.detector.onCandidate((c) => console.log('[fall-candidate]', JSON.stringify(c)))
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
      const w = this.state.widgets

      // Bottom of the stack: a black full-screen rect so a tap anywhere wakes a dimmed screen.
      createWidget(widget.FILL_RECT, { ...L.SCREEN, color: COLOR.bg }).addEventListener(event.CLICK_UP, () => this.wake())

      w.clock = createWidget(widget.TEXT, {
        ...L.CLOCK,
        text: this.clockText(),
        color: COLOR.muted,
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

      w.title = createWidget(widget.TEXT, {
        ...L.TITLE,
        text: getText('home.paused'),
        color: COLOR.text,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })

      onGesture((g) => {
        keepAwake(AWAKE_MS)
        if (g === GESTURE_UP) {
          push({ url: 'page/settings' })
          return true
        }
        if (DEBUG && g === GESTURE_DOWN) {
          push({ url: 'page/probe' })
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

    startMonitoring() {
      if (this.state.running) return
      const s = this.state
      this.syncDetector()
      s.raise.reset()

      s.wear = new Wear()
      s.worn = s.wear.getStatus() !== WEAR_NOT_WORN
      s.wearCb = () => {
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

      // Keep the page (and therefore the sensor callback) alive.
      setPageBrightTime({ brightTime: KEEP_BRIGHT_MS })
      pauseDropWristScreenOff({ duration: 0 })

      const now = Date.now()
      s.running = true
      s.samplesSinceLog = 0
      s.lastLogAt = now
      s.buckets = []
      s.bucket = { startedAt: now, samples: 0, worn: s.worn }
      s.uiTimer = setInterval(() => this.tick(), UI_REFRESH_MS)
      this.rearm(true)
      this.render()
    },

    /** Stop the sensors and restore the screen. The relaunch alarm is left alone — see pause(). */
    stopMonitoring() {
      const s = this.state
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
      if (s.running) {
        resetPageBrightTime()
        resetDropWristScreenOff()
      }
      undim()
      s.running = false
      s.detector.reset()
      this.render()
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
      const { x, y, z } = s.accel.getCurrent()
      const now = Date.now()
      s.samplesSinceLog++
      s.bucket.samples++
      if (s.raise.push(now, x, y, z) && isDimmed()) this.wake()
      if (!s.worn) {
        s.bucket.worn = false
        return
      }
      if (DEBUG && s.samplesSinceLog === 1) console.log('[g]', magnitudeG(x, y, z).toFixed(2))
      s.detector.push(now, x, y, z)
    },

    /** Once a second: coverage bucket, sample-rate log, settings pickup, dimming, relaunch alarm, ring. */
    tick() {
      const s = this.state
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
      if (isDimmed() && isAwake()) undim() // Settings (pushed on top) asked for the screen
      else if (!isDimmed() && !isAwake()) dim()
      this.rearm(false)
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

    render() {
      const s = this.state
      const w = s.widgets
      if (!w.title) return

      const visible = !isDimmed()
      for (const k of ['clock', 'track', 'ring', 'disc', 'shield', 'title']) w[k].setProperty(prop.VISIBLE, visible)
      if (!visible) return

      let title = 'home.paused'
      let ringColor = COLOR.track
      if (s.running) {
        title = s.worn ? 'home.covered' : 'home.not_worn'
        ringColor = s.worn ? COLOR.green : COLOR.redSoft
      }
      w.clock.setProperty(prop.TEXT, this.clockText())
      w.title.setProperty(prop.TEXT, getText(title))
      w.ring.setProperty(prop.MORE, {
        ...L.RING,
        color: ringColor,
        end_angle: L.RING.start_angle + Math.max(1, 360 * this.coverage()),
      })
    },

    onFallDetected(evt) {
      console.log('[fall]', JSON.stringify(evt))
      disarmRelaunch() // the alert flow comes back here by itself
      this.wake()
      this.stopMonitoring()
      this.state.widgets.title.setProperty(prop.TEXT, getText('home.fall'))
      replace({ url: 'page/alert', params: JSON.stringify(evt) })
    },

    /** Debug: replay the synthetic forward fall through the detector, bypassing the sensor. */
    simulateFall() {
      this.wake()
      if (!this.state.running) this.startMonitoring()
      const events = replay(this.state.detector, DEMO_FALL, Date.now())
      console.log('[simulate] events:', events.length)
    },

    // Leaving the page while monitoring (side button, OS kill, replace) keeps the alarm armed:
    // that is the dead-man's switch. pause() is the only path that disarms it.
    onDestroy() {
      this.stopMonitoring()
      offGesture()
    },
  }),
)
