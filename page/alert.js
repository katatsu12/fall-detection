/**
 * Fall detected — the MVP alert (README "MVP scope").
 *
 * Vibrates until the wearer taps OK, or for MAX_S at most, then goes back to
 * Home, where AUTO_START resumes monitoring. It shows when the fall was
 * detected and what the detector saw (peak g, free-fall ms), so a real
 * detection can be told from a false one while testing. Nothing leaves the
 * watch; the SOS flow comes back in a later version.
 *
 * Navigation is replace() both ways (index → alert → index), so every page
 * starts fresh.
 */
import { Vibrator, VIBRATOR_SCENE_CALL, Time } from '@zos/sensor'
import { replace } from '@zos/router'
import { setPageBrightTime, pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { onGesture, offGesture } from '@zos/interaction'
import { createWidget, widget, prop, align } from '@zos/ui'
import { getText } from '@zos/i18n'
import { BasePage } from '@zeppos/zml/base-page'
import * as L from 'zosLoader:./alert.[pf].layout.js'
import { COLOR, hideStatusBar } from '../utils/theme'

const MAX_S = 30 // stop vibrating and return to monitoring after this long without OK
const HOME = 'page/index'

Page(
  BasePage({
    name: 'alert',
    state: { remaining: MAX_S, done: false, event: {}, timer: null, vib: null, widgets: {} },

    onInit(params) {
      try {
        this.state.event = params ? JSON.parse(params) : {}
      } catch (e) {
        this.state.event = {}
      }
    },

    build() {
      hideStatusBar()
      const w = this.state.widgets

      setPageBrightTime({ brightTime: (MAX_S + 10) * 1000 })
      pauseDropWristScreenOff({ duration: 0 })
      // Swallow swipes so an accidental gesture can't dismiss the alert; only OK does.
      onGesture(() => true)

      this.state.vib = new Vibrator()
      this.state.vib.start({ mode: VIBRATOR_SCENE_CALL }) // repeats until stop()

      for (const g of L.GLOW) createWidget(widget.CIRCLE, { ...g, color: COLOR.red })
      const text = (geo, value, color) =>
        createWidget(widget.TEXT, { ...geo, text: value, color, align_h: align.CENTER_H, align_v: align.CENTER_V })
      text(L.TITLE, getText('alert.title'), COLOR.text)
      text(L.TIME, this.timeText(), COLOR.text)
      text(L.DETAILS, this.detailsText(), COLOR.caption)
      w.stops = text(L.STOPS, this.stopsText(), COLOR.faint)

      // The only white element on the screen: dismissing is the likely intent.
      createWidget(widget.BUTTON, {
        ...L.OK_BTN,
        text: getText('alert.ok'),
        color: COLOR.ink,
        normal_color: COLOR.white,
        press_color: COLOR.textSoft,
        click_func: () => this.finish(),
      })

      this.state.timer = setInterval(() => this.tick(), 1000)
    },

    /** The alert opens about 3 s after the impact, so the current minute is the detection time. */
    timeText() {
      const c = new Time()
      const m = c.getMinutes()
      return `${c.getFormatHour()}:${m < 10 ? '0' : ''}${m}`
    },

    /** What the detector saw, e.g. "peak 3.4 g · 290 ms free fall". */
    detailsText() {
      const e = this.state.event
      if (!(e.peakG > 0)) return ''
      return getText('alert.details')
        .replace('{g}', e.peakG.toFixed(1))
        .replace('{ms}', String(Math.round(e.freefallMs || 0)))
    },

    stopsText() {
      return getText('alert.stops').replace('{n}', this.state.remaining)
    },

    tick() {
      const s = this.state
      s.remaining -= 1
      if (s.remaining <= 0) return this.finish()
      s.widgets.stops.setProperty(prop.TEXT, this.stopsText())
    },

    /** OK, or MAX_S without an answer: stop vibrating and go back to monitoring. */
    finish() {
      const s = this.state
      if (s.done) return
      s.done = true
      this.cleanup()
      // Leave from a fresh tick rather than from inside the OK button's (or the timer's) own callback.
      setTimeout(() => replace({ url: HOME }), 0)
    },

    cleanup() {
      const s = this.state
      if (s.timer) {
        clearInterval(s.timer)
        s.timer = null
      }
      if (s.vib) s.vib.stop()
    },

    onDestroy() {
      this.cleanup()
      offGesture()
      resetDropWristScreenOff()
    },
  }),
)
