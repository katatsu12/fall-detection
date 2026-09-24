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
 * Debug builds also run the phase 1 recorder (README §12): the gyroscope,
 * a candidate recorder beside the v1 detector, sample-rate stats, and
 * uploads of the recordings through the phone.
 *
 * Interaction:
 *   tap anywhere         → wake the screen
 *   tap the ring (awake) → pause / resume monitoring
 *   long-press the ring  → replay a synthetic fall (DEBUG only)
 *   swipe up             → sensitivity settings
 *   swipe down           → background probe (DEBUG only, README §10)
 *   swipe left           → staged recordings (DEBUG only, README §12)
 *
 * Navigation to/from the alert flow uses replace(), so each page starts
 * fresh and monitoring restarts via AUTO_START when the flow returns here.
 * Settings is push()ed on top instead, so this page stays alive underneath
 * and re-reads the stored sensitivity in its 1 s tick (API 3.0 pages have
 * no onResume to hook).
 */
import { Accelerometer, Gyroscope, Wear, Time, Battery } from '@zos/sensor'
import {
  setPageBrightTime,
  resetPageBrightTime,
  pauseDropWristScreenOff,
  resetDropWristScreenOff,
  setWakeUpRelaunch,
} from '@zos/display'
import { replace, push } from '@zos/router'
import { onGesture, offGesture, GESTURE_UP, GESTURE_DOWN, GESTURE_LEFT } from '@zos/interaction'
import { createWidget, widget, prop, align, event } from '@zos/ui'
import { getText } from '@zos/i18n'
import { BasePage } from '@zeppos/zml/base-page'
import * as L from 'zosLoader:./index.[pf].layout.js'
import { COLOR } from '../utils/theme'
import { createFallDetector, replay, magnitudeG, STATE } from '../utils/fall-detector'
import { createRaiseDetector } from '../utils/raise-detector'
import { getPref, detectorOptions, applyRemotePrefs } from '../utils/prefs'
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
import { DEBUG, isRecording, freqMode, freqModeName } from '../utils/debug'
import { createRateMeter } from '../utils/rate-meter'
import { createCandidateRecorder, KEEP } from '../utils/candidate-recorder'
import { getSession, persist } from '../utils/recorder-session'
import * as recStore from '../utils/recording-store'
import { createUploader } from '../utils/uploader'

const AUTO_START = true // start monitoring as soon as the page opens
const KEEP_BRIGHT_MS = 2147483000 // max accepted by setPageBrightTime
const UI_REFRESH_MS = 1000
const RATE_LOG_MS = 5000
const SAMPLE_NOTE_MS = 10 * 60 * 1000 // battery + rates into the day summary (phase 0)
const DAY_SAVE_MS = 60 * 1000
const UPLOAD_CHECK_MS = 10 * 60 * 1000 // ask the phone for a Recordings URL at most this often
const COVERAGE_BUCKET_MS = 5000 // ring = share of 5-second buckets with samples while worn
const COVERAGE_BUCKETS = 60 // …over the last five minutes
const PREFS_SYNC_TIMEOUT_MS = 5000
const AWAKE_MS = 20000 // screen stays visible this long after an interaction

const WEAR_NOT_WORN = 0
const HOME_URL = 'page/index'

const meterText = (name, r) => `${name} ${r.hz.toFixed(1)} Hz dt ${r.dtMedian}/${r.dtP95}/${r.dtMax} ms`
/** `[rate]` log line: mode, then rate and callback interval median / p95 / max per sensor. */
const rateText = (r) => `${r.mode} ${meterText('accel', r.accel)}` + (r.gyro ? `, ${meterText('gyro', r.gyro)}` : '')

Page(
  BasePage({
    name: 'index',
    state: {
      running: false,
      worn: true,
      accel: null,
      gyro: null,
      wear: null,
      accelCb: null, // the exact functions passed to onChange, needed again for offChange
      gyroCb: null,
      wearCb: null,
      clock: null,
      detector: null,
      raise: null,
      sensitivity: '', // the stored sensitivity the detector was built for
      mode: '', // frequency mode applied to the sensors (utils/debug.js)
      uiTimer: null,
      lastArmAt: 0,
      samplesSinceLog: 0,
      lastLogAt: 0,
      lastTickAt: 0,
      accelMeter: null,
      gyroMeter: null,
      rates: null, // latest { accel, gyro } reading of the meters
      rec: false, // phase 1 recorder running (debug builds)
      session: null, // utils/recorder-session.js
      uploader: null,
      uploadReady: false, // the phone has a Recordings URL (app-side rec.ready)
      lastUploadCheckAt: 0,
      lastNoteAt: 0,
      lastDaySaveAt: 0,
      battery: null,
      wasStaged: false,
      simulating: false,
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
      this.syncPrefs()
    },

    /** (Re)create the detector from the stored sensitivity and log every candidate for tuning. */
    buildDetector() {
      const s = this.state
      s.sensitivity = getPref('sensitivity')
      s.detector = createFallDetector(detectorOptions())
      s.detector.onCandidate((c) => {
        console.log('[fall-candidate]', JSON.stringify(c))
        if (s.rec) s.session.recorder.noteV1(c) // runs before onFall, so the recording knows v1 alerted
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

    /** Pull the contact name from the phone; keep stored values if it's out of range. */
    syncPrefs() {
      this.request({ method: 'prefs.get' }, { timeout: PREFS_SYNC_TIMEOUT_MS })
        .then((p) => applyRemotePrefs(p))
        .catch(() => {})
    },

    /** Pushed by the app-side when the phone settings page changes. */
    onCall(data) {
      if (data && data.method === 'prefs.update') applyRemotePrefs(data.params)
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
        if (DEBUG && g === GESTURE_LEFT) {
          push({ url: 'page/record' })
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
        if (s.rec) s.session.recorder.setWorn(s.worn, Date.now())
        this.render()
      }
      s.wear.onChange(s.wearCb)

      const now = Date.now()
      s.mode = freqModeName()
      s.rec = isRecording()
      if (s.rec) this.startRecorder(now)
      s.accelMeter = createRateMeter(now)
      s.gyroMeter = createRateMeter(now)

      s.accel = new Accelerometer()
      s.accelCb = () => this.onSample()
      s.accel.onChange(s.accelCb)
      s.accel.setFreqMode(freqMode())
      s.accel.start()
      if (s.rec) this.startGyro()

      // Keep the page (and therefore the sensor callback) alive.
      setPageBrightTime({ brightTime: KEEP_BRIGHT_MS })
      pauseDropWristScreenOff({ duration: 0 })

      s.running = true
      s.samplesSinceLog = 0
      s.lastLogAt = now
      s.lastTickAt = now
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
      this.stopGyro()
      if (s.rec) this.stopRecorder()
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
      s.accelMeter.push(now)
      if (s.raise.push(now, x, y, z) && isDimmed()) this.wake()
      if (s.rec) s.session.recorder.pushAccel(now, x, y, z) // worn or not: a removal is data too
      if (!s.worn) {
        s.bucket.worn = false
        return
      }
      if (s.rec && s.session.staged) {
        // page/record is running the staged protocol: no alert may interrupt it,
        // and v1 must not resume afterwards with state from before the session.
        if (!s.wasStaged) s.detector.reset()
        s.wasStaged = true
        return
      }
      s.wasStaged = false
      if (DEBUG && s.samplesSinceLog === 1) console.log('[g]', magnitudeG(x, y, z).toFixed(2))
      s.detector.push(now, x, y, z)
    },

    onGyro() {
      const s = this.state
      const { x, y, z } = s.gyro.getCurrent()
      const now = Date.now()
      s.gyroMeter.push(now)
      if (s.rec) s.session.recorder.pushGyro(now, x, y, z)
      if (s.worn && !(s.rec && s.session.staged)) s.detector.pushGyro(now, x, y, z)
    },

    /** Recording only (phase 1): v1 ignores the gyroscope at its default settings. */
    startGyro() {
      const s = this.state
      try {
        s.gyro = new Gyroscope()
        s.gyroCb = () => this.onGyro()
        s.gyro.onChange(s.gyroCb)
        s.gyro.setFreqMode(freqMode())
        s.gyro.start()
      } catch (e) {
        console.log('[gyro] unavailable', e)
        s.gyro = null
        s.gyroCb = null
      }
    },

    stopGyro() {
      const s = this.state
      if (!s.gyro) return
      try {
        s.gyro.offChange(s.gyroCb)
        s.gyro.stop()
      } catch (e) {
        console.log('[gyro] stop failed', e)
      }
      s.gyro = null
      s.gyroCb = null
    },

    /** Phase 1: a fresh candidate recorder beside v1, shared with page/record, and its uploader. */
    startRecorder(now) {
      const s = this.state
      const session = getSession()
      session.recorder = createCandidateRecorder(
        {},
        {
          onRecording: (r) => session.queue.push(r),
          onSummary: (line) => recStore.noteCandidate(session, line, Date.now()),
        },
      )
      session.recorder.setWorn(s.worn, now)
      if (session.staged) session.recorder.setCandidates(false) // restarted under page/record
      session.homeRunning = true
      s.session = session
      s.uploader = createUploader({
        request: (data, opts) => this.request(data, opts),
        next: (t) => recStore.nextUpload(t),
        done: (item, t) => recStore.markUploaded(item, t),
        log: (...a) => console.log(...a),
        onFail: (why) => {
          if (why === 'no_record_url') s.uploadReady = false // cleared on the phone: stop sending
        },
      })
      s.uploadReady = false
      s.lastUploadCheckAt = 0
      s.lastNoteAt = now - SAMPLE_NOTE_MS + 10000 // first battery/rate sample once the meters have a reading
      s.lastDaySaveAt = now
    },

    /**
     * Uploads wait until the phone has a Recordings URL: without this check
     * every retry would push ~20 KB over BLE just to hear "no URL".
     */
    checkUploadTarget(now) {
      const s = this.state
      if (s.uploadReady || now - s.lastUploadCheckAt < UPLOAD_CHECK_MS) return
      s.lastUploadCheckAt = now
      try {
        this.request({ method: 'rec.ready' }, { timeout: 5000 })
          .then((r) => {
            s.uploadReady = !!(r && r.ok)
            if (!s.uploadReady) console.log('[upload] no Recordings URL set on the phone')
          })
          .catch(() => {})
      } catch (e) {
        /* BLE down: try again later */
      }
    },

    /**
     * Write out everything the recorder holds (pending candidates, truncated)
     * before the sensors stop or the page goes. Returns what flush() wrote.
     */
    stopRecorder() {
      const s = this.state
      const session = s.session
      s.rec = false
      if (!session || !session.recorder) return []
      const written = session.recorder.flush()
      persist(session, true)
      recStore.saveDay(session)
      session.homeRunning = false
      return written
    },

    /** Phase 1 bookkeeping, once a second: worn time, one queued write, battery and rates, uploads. */
    recTick(now, dt) {
      const s = this.state
      const session = s.session
      recStore.addTime(session, s.worn ? dt : 0, dt, now)
      persist(session, false)
      if (s.rates && now - s.lastNoteAt >= SAMPLE_NOTE_MS) {
        s.lastNoteAt = now
        const hz = (r) => (r ? Math.round(r.hz * 10) / 10 : null)
        recStore.noteSample(session, { battery: this.battery(), accelHz: hz(s.rates.accel), gyroHz: hz(s.rates.gyro), mode: s.mode }, now)
      }
      if (now - s.lastDaySaveAt >= DAY_SAVE_MS) {
        s.lastDaySaveAt = now
        recStore.saveDay(session)
      }
      this.checkUploadTarget(now)
      if (s.uploadReady) s.uploader.tick(now)
    },

    battery() {
      try {
        if (!this.state.battery) this.state.battery = new Battery()
        return this.state.battery.getCurrent()
      } catch (e) {
        return null
      }
    },

    /** Once a second: coverage bucket, sample-rate log, settings pickup, dimming, relaunch alarm, ring. */
    tick() {
      const s = this.state
      const now = Date.now()
      const dt = now - s.lastTickAt
      s.lastTickAt = now
      this.syncDetector()
      if (now - s.bucket.startedAt >= COVERAGE_BUCKET_MS) {
        s.buckets.push(s.bucket.samples > 0 && s.bucket.worn)
        if (s.buckets.length > COVERAGE_BUCKETS) s.buckets.shift()
        s.bucket = { startedAt: now, samples: 0, worn: s.worn }
      }
      if (now - s.lastLogAt >= RATE_LOG_MS) {
        s.rates = { accel: s.accelMeter.read(now), gyro: s.gyro ? s.gyroMeter.read(now) : null, mode: s.mode }
        if (s.rec) s.session.stats = s.rates
        if (DEBUG) console.log('[rate]', rateText(s.rates))
        s.samplesSinceLog = 0
        s.lastLogAt = now
      }
      if (DEBUG && (s.mode !== freqModeName() || s.rec !== isRecording())) {
        // Switched on page/record: restart so the sensors and the recorder start in the new setup.
        this.stopMonitoring()
        this.startMonitoring()
        return
      }
      if (s.rec) this.recTick(now, dt)
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
      if (this.state.rec) this.linkRecording(evt)
      this.stopMonitoring()
      this.state.widgets.title.setProperty(prop.TEXT, getText('home.fall'))
      replace({ url: 'page/alert', params: JSON.stringify(evt) })
    },

    /**
     * Phase 1: write the recorder out now — the alert page vibrates, which
     * would pollute the rest of the window — and pass the alert's recording
     * id along so page/result can ask "Did you fall?" and label it.
     */
    linkRecording(evt) {
      const own = this.stopRecorder().find((r) => r.keep === KEEP.V1_FALL)
      if (!own) return
      evt.recordingId = own.id
      if (this.state.simulating) recStore.labelRecording(own.id, { simulated: true })
    },

    /** Debug: replay the synthetic forward fall through the detector, bypassing the sensor. */
    simulateFall() {
      const s = this.state
      this.wake()
      if (!s.running) this.startMonitoring()
      const t0 = Date.now()
      if (s.rec) {
        // The recorder gets the trace too, so the simulator runs recording → label → upload end to end.
        let t = t0
        for (const smp of DEMO_FALL) {
          t += smp.dt
          s.session.recorder.pushAccel(t, smp.x, smp.y, smp.z)
        }
      }
      s.simulating = true
      const events = replay(s.detector, DEMO_FALL, t0)
      s.simulating = false
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
