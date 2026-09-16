/**
 * Fall detected — "Are you alright?" (design 2A).
 *
 * Vibrates and counts down. "I'm fine" → page/result?type=ok. Timeout or
 * "Get help now" → page/result?type=sos, which sends the alert through the
 * phone. Navigation uses replace() both ways so every page starts fresh.
 */
import { Vibrator, VIBRATOR_SCENE_CALL } from '@zos/sensor'
import { replace } from '@zos/router'
import { setPageBrightTime, pauseDropWristScreenOff, resetDropWristScreenOff } from '@zos/display'
import { onGesture } from '@zos/interaction'
import { createWidget, widget, prop, align } from '@zos/ui'
import { getText } from '@zos/i18n'
import { BasePage } from '@zeppos/zml/base-page'
import * as L from 'zosLoader:./alert.[pf].layout.js'
import { COLOR } from '../utils/theme'
import { getPref, firstName } from '../utils/prefs'

const COUNTDOWN_S = 30 // seconds the wearer has to cancel

Page(
  BasePage({
    name: 'alert',
    state: { remaining: COUNTDOWN_S, done: false, event: {}, timer: null, vib: null, widgets: {} },

    onInit(params) {
      try {
        this.state.event = params ? JSON.parse(params) : {}
      } catch (e) {
        this.state.event = {}
      }
    },

    build() {
      const w = this.state.widgets

      setPageBrightTime({ brightTime: (COUNTDOWN_S + 30) * 1000 })
      pauseDropWristScreenOff({ duration: 0 })
      // Swallow swipes so an accidental gesture can't dismiss the alert.
      onGesture(() => true)

      this.state.vib = new Vibrator()
      this.state.vib.start({ mode: VIBRATOR_SCENE_CALL }) // repeats until stop()

      for (const g of L.GLOW) createWidget(widget.CIRCLE, { ...g, color: COLOR.red })

      createWidget(widget.TEXT, {
        ...L.TITLE,
        text: getText('alert.title'),
        color: COLOR.text,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })
      createWidget(widget.ARC, { ...L.RING, end_angle: 270, color: COLOR.track })
      w.ring = createWidget(widget.ARC, { ...L.RING, end_angle: 270, color: COLOR.red })
      w.seconds = createWidget(widget.TEXT, {
        ...L.SECONDS,
        text: String(COUNTDOWN_S),
        color: COLOR.text,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })

      const name = firstName(getPref('contactName')) || getText('alert.fallback_contact')
      createWidget(widget.TEXT, {
        ...L.CAPTION1,
        text: getText('alert.call_line').replace('{name}', name),
        color: COLOR.caption,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })
      createWidget(widget.TEXT, {
        ...L.CAPTION2,
        text: getText('alert.then_line'),
        color: COLOR.redSoft,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })

      // The only white element on the screen: dismiss is the most likely intent.
      createWidget(widget.BUTTON, {
        ...L.FINE_BTN,
        text: getText('alert.fine'),
        color: COLOR.ink,
        normal_color: COLOR.white,
        press_color: COLOR.textSoft,
        click_func: () => this.finish('ok', 'manual'),
      })
      createWidget(widget.BUTTON, {
        ...L.HELP_BTN,
        text: getText('alert.help'),
        color: COLOR.redSoft,
        normal_color: COLOR.bg,
        press_color: COLOR.card,
        click_func: () => this.finish('sos', 'manual'),
      })

      this.state.timer = setInterval(() => this.tick(), 1000)
    },

    tick() {
      const s = this.state
      s.remaining -= 1
      if (s.remaining <= 0) return this.finish('sos', 'timeout')
      s.widgets.seconds.setProperty(prop.TEXT, String(s.remaining))
      s.widgets.ring.setProperty(prop.MORE, {
        ...L.RING,
        color: COLOR.red,
        end_angle: L.RING.start_angle + (360 * s.remaining) / COUNTDOWN_S,
      })
    },

    /** Leave to the result page: type 'ok' (nobody called) or 'sos' (send the alert). */
    finish(type, source) {
      const s = this.state
      if (s.done) return
      s.done = true
      this.cleanup()
      replace({ url: 'page/result', params: JSON.stringify({ type, source, event: s.event }) })
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
      resetDropWristScreenOff()
    },
  }),
)
