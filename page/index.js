/**
 * Monitoring page.
 *
 * Runs the accelerometer in the foreground (Zepp OS forbids it in background
 * services — README §1.2), keeps the page alive, feeds samples to the
 * detector and hands off to page/alert when a fall is confirmed.
 */
import { Accelerometer, Wear, FREQ_MODE_NORMAL } from '@zos/sensor'
import {
  setPageBrightTime,
  resetPageBrightTime,
  pauseDropWristScreenOff,
  resetDropWristScreenOff,
  setWakeUpRelaunch,
} from '@zos/display'
import { push } from '@zos/router'
import { createWidget, widget, prop, align } from '@zos/ui'
import { getText } from '@zos/i18n'
import { BasePage } from '@zeppos/zml/base-page'
import * as L from 'zosLoader:./index.[pf].layout.js'
import { createFallDetector, replay, magnitudeG } from '../utils/fall-detector'
import { DEMO_FALL } from '../utils/demo-trace'

const AUTO_START = true // start monitoring as soon as the page opens
const DEBUG = true // show the "Simulate fall" button (mirror app.json "debug")
const FREQ_MODE = FREQ_MODE_NORMAL // README §8: measure the real Hz per mode and revisit
const KEEP_BRIGHT_MS = 2147483000 // max accepted by setPageBrightTime
const UI_REFRESH_MS = 250 // live readout refresh; never touch widgets per sample

const WEAR_NOT_WORN = 0

Page(
  BasePage({
    name: 'index',
    state: {
      running: false,
      worn: true,
      accel: null,
      wear: null,
      detector: null,
      uiTimer: null,
      lastG: 1,
      // sample-rate estimate: samples counted since the previous UI tick
      samplesSinceTick: 0,
      lastTickAt: 0,
      hz: 0,
      widgets: {},
    },

    onInit() {
      // Come back to this page instead of the watch face when the screen wakes.
      setWakeUpRelaunch({ relaunch: true })

      const detector = createFallDetector()
      detector.onCandidate((c) => console.log('[fall-candidate]', JSON.stringify(c)))
      detector.onFall((evt) => this.onFallDetected(evt))
      this.state.detector = detector
    },

    build() {
      const w = this.state.widgets

      createWidget(widget.TEXT, {
        ...L.TITLE,
        text: getText('title'),
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })
      w.statusDot = createWidget(widget.FILL_RECT, { ...L.STATUS_DOT, color: L.COLOR.muted })
      w.status = createWidget(widget.TEXT, {
        ...L.STATUS,
        text: getText('status.stopped'),
        color: L.COLOR.text,
        align_h: align.LEFT,
        align_v: align.CENTER_V,
      })
      w.readout = createWidget(widget.TEXT, {
        ...L.READOUT,
        text: '',
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })
      w.toggle = createWidget(widget.BUTTON, {
        ...L.TOGGLE_BTN,
        text: getText('btn.start'),
        click_func: () => (this.state.running ? this.stopMonitoring() : this.startMonitoring()),
      })
      if (DEBUG) {
        createWidget(widget.BUTTON, {
          ...L.SIMULATE_BTN,
          text: getText('btn.simulate'),
          click_func: () => this.simulateFall(),
        })
      }

      if (AUTO_START) this.startMonitoring()
    },

    startMonitoring() {
      if (this.state.running) return
      const s = this.state

      s.wear = new Wear()
      s.worn = s.wear.getStatus() !== WEAR_NOT_WORN
      s.wear.onChange(() => {
        s.worn = s.wear.getStatus() !== WEAR_NOT_WORN
        if (!s.worn) s.detector.reset() // don't carry a half-seen fall across a wear gap
        this.renderStatus()
      })

      s.accel = new Accelerometer()
      s.accel.onChange(() => this.onSample())
      s.accel.setFreqMode(FREQ_MODE)
      s.accel.start()

      // Keep the page (and therefore the sensor callback) alive.
      setPageBrightTime({ brightTime: KEEP_BRIGHT_MS })
      pauseDropWristScreenOff({ duration: 0 })

      s.running = true
      s.samplesSinceTick = 0
      s.lastTickAt = Date.now()
      s.uiTimer = setInterval(() => this.renderReadout(), UI_REFRESH_MS)
      this.renderStatus()
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
      s.hz = 0
      s.detector.reset()
      this.renderStatus()
      this.renderReadout()
    },

    onSample() {
      const s = this.state
      const { x, y, z } = s.accel.getCurrent()
      s.samplesSinceTick++
      s.lastG = magnitudeG(x, y, z)
      if (!s.worn) return
      s.detector.push(Date.now(), x, y, z)
    },

    onFallDetected(evt) {
      console.log('[fall]', JSON.stringify(evt))
      this.stopMonitoring()
      this.setStatus(getText('status.fall'), L.COLOR.danger)
      try {
        push({ url: 'page/alert', params: JSON.stringify(evt) })
      } catch (e) {
        // page/alert is README Step 5; until it exists the status line above is the alert.
        console.error('[fall] push page/alert failed', e)
      }
    },

    /** Debug: replay the synthetic forward fall through the detector, bypassing the sensor. */
    simulateFall() {
      if (!this.state.running) this.startMonitoring()
      const events = replay(this.state.detector, DEMO_FALL, Date.now())
      console.log('[simulate] events:', events.length)
    },

    setStatus(text, color) {
      const w = this.state.widgets
      if (!w.status) return
      w.status.setProperty(prop.TEXT, text)
      w.statusDot.setProperty(prop.COLOR, color)
    },

    renderStatus() {
      const s = this.state
      const w = s.widgets
      if (!w.toggle) return
      if (!s.running) this.setStatus(getText('status.stopped'), L.COLOR.muted)
      else if (!s.worn) this.setStatus(getText('status.not_worn'), L.COLOR.warn)
      else this.setStatus(getText('status.monitoring'), L.COLOR.ok)
      w.toggle.setProperty(prop.TEXT, getText(s.running ? 'btn.stop' : 'btn.start'))
    },

    renderReadout() {
      const s = this.state
      const w = s.widgets
      if (!w.readout) return
      if (!s.running) {
        w.readout.setProperty(prop.TEXT, '')
        return
      }
      const now = Date.now()
      const elapsed = now - s.lastTickAt
      if (elapsed >= 1000) {
        s.hz = Math.round((s.samplesSinceTick * 1000) / elapsed)
        s.samplesSinceTick = 0
        s.lastTickAt = now
      }
      w.readout.setProperty(prop.TEXT, `${s.lastG.toFixed(2)} g  ·  ${s.hz} Hz  ·  ${s.detector.getState()}`)
    },

    onDestroy() {
      this.stopMonitoring()
    },
  }),
)
