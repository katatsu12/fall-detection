/**
 * Home ("You're covered") — design 2A.
 *
 * Runs the accelerometer in the foreground (Zepp OS forbids it in background
 * services — README §1.2), keeps the page alive, feeds samples to the
 * detector and hands off to page/alert when a fall is confirmed.
 *
 * Interaction (the design keeps the screen to a ring and three facts):
 *   tap the ring         → pause / resume monitoring
 *   long-press the ring  → replay a synthetic fall (DEBUG only)
 *   swipe up             → sensitivity settings
 *
 * Navigation to/from the alert flow uses replace(), so each page starts
 * fresh and monitoring restarts via AUTO_START when the flow returns here.
 */
import { Accelerometer, Wear, Battery, FREQ_MODE_NORMAL } from '@zos/sensor'
import { connectStatus } from '@zos/ble'
import {
  setPageBrightTime,
  resetPageBrightTime,
  pauseDropWristScreenOff,
  resetDropWristScreenOff,
  setWakeUpRelaunch,
} from '@zos/display'
import { replace, push } from '@zos/router'
import { onGesture, GESTURE_UP } from '@zos/interaction'
import { createWidget, widget, prop, align, event } from '@zos/ui'
import { getText } from '@zos/i18n'
import { BasePage } from '@zeppos/zml/base-page'
import * as L from 'zosLoader:./index.[pf].layout.js'
import { COLOR } from '../utils/theme'
import { createFallDetector, replay, magnitudeG } from '../utils/fall-detector'
import { detectorOptions, applyRemotePrefs } from '../utils/prefs'
import { DEMO_FALL } from '../utils/demo-trace'

const AUTO_START = true // start monitoring as soon as the page opens
const DEBUG = true // long-press the ring to simulate a fall; log sample rate
const FREQ_MODE = FREQ_MODE_NORMAL // README §8: measure the real Hz per mode and revisit
const KEEP_BRIGHT_MS = 2147483000 // max accepted by setPageBrightTime
const UI_REFRESH_MS = 1000
const RATE_LOG_MS = 5000
const COVERAGE_BUCKET_MS = 5000 // ring = share of 5-second buckets with samples while worn
const COVERAGE_BUCKETS = 60 // …over the last five minutes
const PREFS_SYNC_TIMEOUT_MS = 5000

const WEAR_NOT_WORN = 0

Page(
  BasePage({
    name: 'index',
    state: {
      running: false,
      worn: true,
      accel: null,
      wear: null,
      battery: null,
      detector: null,
      uiTimer: null,
      lastSampleAt: 0,
      samplesSinceLog: 0,
      lastLogAt: 0,
      bucket: { startedAt: 0, samples: 0, worn: true },
      buckets: [],
      widgets: {},
    },

    onInit() {
      // Come back to this page instead of the watch face when the screen wakes.
      setWakeUpRelaunch({ relaunch: true })

      const detector = createFallDetector(detectorOptions())
      detector.onCandidate((c) => console.log('[fall-candidate]', JSON.stringify(c)))
      detector.onFall((evt) => this.onFallDetected(evt))
      this.state.detector = detector
      this.state.battery = new Battery()
      this.syncPrefs()
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

      createWidget(widget.ARC, { ...L.RING, end_angle: L.RING_FULL, color: COLOR.track })
      w.ring = createWidget(widget.ARC, { ...L.RING, end_angle: L.RING_FULL, color: COLOR.green })
      w.disc = createWidget(widget.BUTTON, {
        ...L.DISC,
        normal_color: COLOR.bg,
        press_color: COLOR.card,
        click_func: () => this.toggle(),
        longpress_func: () => DEBUG && this.simulateFall(),
      })
      w.shield = createWidget(widget.IMG, { ...L.SHIELD, auto_scale: true })
      w.shield.addEventListener(event.CLICK_UP, () => this.toggle())

      w.title = createWidget(widget.TEXT, {
        ...L.TITLE,
        text: getText('home.paused'),
        color: COLOR.text,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })

      const labels = ['home.last_check', 'home.battery', 'home.phone']
      w.rows = L.ROWS.map((row, i) => {
        createWidget(widget.FILL_RECT, { ...row.rect, color: COLOR.card })
        createWidget(widget.TEXT, {
          ...row.label,
          text: getText(labels[i]),
          color: COLOR.muted,
          align_h: align.LEFT,
          align_v: align.CENTER_V,
        })
        return createWidget(widget.TEXT, {
          ...row.value,
          text: '',
          color: COLOR.textSoft,
          align_h: align.RIGHT,
          align_v: align.CENTER_V,
        })
      })

      onGesture((g) => {
        if (g === GESTURE_UP) {
          push({ url: 'page/settings' })
          return true
        }
        return false
      })

      if (AUTO_START) this.startMonitoring()
      this.render()
    },

    toggle() {
      if (this.state.running) this.stopMonitoring()
      else this.startMonitoring()
    },

    startMonitoring() {
      if (this.state.running) return
      const s = this.state

      s.wear = new Wear()
      s.worn = s.wear.getStatus() !== WEAR_NOT_WORN
      s.wear.onChange(() => {
        s.worn = s.wear.getStatus() !== WEAR_NOT_WORN
        if (!s.worn) s.detector.reset() // don't carry a half-seen fall across a wear gap
        this.render()
      })

      s.accel = new Accelerometer()
      s.accel.onChange(() => this.onSample())
      s.accel.setFreqMode(FREQ_MODE)
      s.accel.start()

      // Keep the page (and therefore the sensor callback) alive.
      setPageBrightTime({ brightTime: KEEP_BRIGHT_MS })
      pauseDropWristScreenOff({ duration: 0 })

      const now = Date.now()
      s.running = true
      s.lastSampleAt = 0
      s.samplesSinceLog = 0
      s.lastLogAt = now
      s.buckets = []
      s.bucket = { startedAt: now, samples: 0, worn: s.worn }
      s.uiTimer = setInterval(() => this.tick(), UI_REFRESH_MS)
      this.render()
    },

    stopMonitoring() {
      const s = this.state
      if (s.accel) {
        s.accel.offChange()
        s.accel.stop()
        s.accel = null
      }
      if (s.wear) {
        s.wear.offChange()
        s.wear = null
      }
      if (s.uiTimer) {
        clearInterval(s.uiTimer)
        s.uiTimer = null
      }
      if (s.running) {
        resetPageBrightTime()
        resetDropWristScreenOff()
      }
      s.running = false
      s.detector.reset()
      this.render()
    },

    onSample() {
      const s = this.state
      const { x, y, z } = s.accel.getCurrent()
      const now = Date.now()
      s.lastSampleAt = now
      s.samplesSinceLog++
      s.bucket.samples++
      if (!s.worn) {
        s.bucket.worn = false
        return
      }
      if (DEBUG && s.samplesSinceLog === 1) console.log('[g]', magnitudeG(x, y, z).toFixed(2))
      s.detector.push(now, x, y, z)
    },

    /** Once a second: roll the coverage bucket, log the sample rate, refresh the rows. */
    tick() {
      const s = this.state
      const now = Date.now()
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
      this.render()
    },

    coverage() {
      const s = this.state
      if (!s.running) return 0
      if (!s.buckets.length) return s.worn ? 1 : 0
      return s.buckets.filter(Boolean).length / s.buckets.length
    },

    render() {
      const s = this.state
      const w = s.widgets
      if (!w.title) return

      let title = 'home.paused'
      let ringColor = COLOR.track
      if (s.running) {
        title = s.worn ? 'home.covered' : 'home.not_worn'
        ringColor = s.worn ? COLOR.green : COLOR.redSoft
      }
      w.title.setProperty(prop.TEXT, getText(title))
      w.ring.setProperty(prop.MORE, {
        ...L.RING,
        color: ringColor,
        end_angle: L.RING.start_angle + Math.max(1, 360 * this.coverage()),
      })

      // Last check
      let last = getText('home.paused')
      if (s.running && s.lastSampleAt) {
        const age = Date.now() - s.lastSampleAt
        last = age < 60000 ? getText('home.just_now') : getText('home.min_ago').replace('{n}', Math.floor(age / 60000))
      }
      w.rows[0].setProperty(prop.TEXT, last)
      // Battery
      w.rows[1].setProperty(prop.TEXT, `${s.battery.getCurrent()}%`)
      // Phone link
      const linked = connectStatus()
      w.rows[2].setProperty(prop.MORE, {
        ...L.ROWS[2].value,
        text: getText(linked ? 'home.connected' : 'home.disconnected'),
        color: linked ? COLOR.green : COLOR.redSoft,
      })
    },

    onFallDetected(evt) {
      console.log('[fall]', JSON.stringify(evt))
      this.stopMonitoring()
      this.state.widgets.title.setProperty(prop.TEXT, getText('home.fall'))
      replace({ url: 'page/alert', params: JSON.stringify(evt) })
    },

    /** Debug: replay the synthetic forward fall through the detector, bypassing the sensor. */
    simulateFall() {
      if (!this.state.running) this.startMonitoring()
      const events = replay(this.state.detector, DEMO_FALL, Date.now())
      console.log('[simulate] events:', events.length)
    },

    onDestroy() {
      this.stopMonitoring()
    },
  }),
)
