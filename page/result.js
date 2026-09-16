/**
 * Result page after an alert.
 *   type 'ok'  — "Glad you're OK": says plainly nobody was called, closes in 3 s.
 *   type 'sos' — "Contacting": sends the alert through the phone (zml request →
 *                app-side fetch), shows the outcome, Done / auto-return.
 */
import { replace } from '@zos/router'
import { setPageBrightTime } from '@zos/display'
import { createWidget, widget, prop, align } from '@zos/ui'
import { getText } from '@zos/i18n'
import { BasePage } from '@zeppos/zml/base-page'
import * as L from 'zosLoader:./result.[pf].layout.js'
import { COLOR } from '../utils/theme'
import { getPref, initials } from '../utils/prefs'

const HOME = 'page/index'
const OK_CLOSE_S = 3
const SOS_TIMEOUT_MS = 15000
const SOS_RETURN_MS = 20000

Page(
  BasePage({
    name: 'result',
    state: { type: 'ok', source: '', event: {}, timer: null, remaining: OK_CLOSE_S, widgets: {} },

    onInit(params) {
      try {
        const p = params ? JSON.parse(params) : {}
        this.state.type = p.type === 'sos' ? 'sos' : 'ok'
        this.state.source = p.source || ''
        this.state.event = p.event || {}
      } catch (e) {
        /* defaults */
      }
    },

    build() {
      setPageBrightTime({ brightTime: 60000 })
      if (this.state.type === 'sos') this.buildSos()
      else this.buildOk()
    },

    // ---------- Glad you're OK ----------
    buildOk() {
      const w = this.state.widgets
      createWidget(widget.CIRCLE, { ...L.OK_DISC, color: COLOR.greenDeep })
      createWidget(widget.IMG, { ...L.OK_CHECK, auto_scale: true })
      createWidget(widget.TEXT, { ...L.OK_TITLE, text: getText('result.ok_title'), color: COLOR.text, align_h: align.CENTER_H, align_v: align.CENTER_V })
      createWidget(widget.TEXT, { ...L.OK_LINE1, text: getText('result.ok_line1'), color: COLOR.muted, align_h: align.CENTER_H, align_v: align.CENTER_V })
      createWidget(widget.TEXT, { ...L.OK_LINE2, text: getText('result.ok_line2'), color: COLOR.muted, align_h: align.CENTER_H, align_v: align.CENTER_V })
      w.closing = createWidget(widget.TEXT, { ...L.OK_CLOSING, text: this.closingText(), color: COLOR.faint, align_h: align.CENTER_H, align_v: align.CENTER_V })

      this.state.timer = setInterval(() => {
        this.state.remaining -= 1
        if (this.state.remaining <= 0) return this.goHome()
        w.closing.setProperty(prop.TEXT, this.closingText())
      }, 1000)
    },

    closingText() {
      return getText('result.closing').replace('{n}', this.state.remaining)
    },

    // ---------- Contacting ----------
    buildSos() {
      const w = this.state.widgets
      const name = getPref('contactName')
      createWidget(widget.TEXT, { ...L.SOS_HEADER, text: getText('result.contacting'), color: COLOR.redSoft, align_h: align.CENTER_H, align_v: align.CENTER_V })
      createWidget(widget.CIRCLE, { ...L.SOS_AVATAR, color: COLOR.avatar })
      createWidget(widget.TEXT, { ...L.SOS_INITIALS, text: initials(name) || '!', color: COLOR.textSoft, align_h: align.CENTER_H, align_v: align.CENTER_V })
      createWidget(widget.TEXT, { ...L.SOS_NAME, text: name || getText('result.your_contact'), color: COLOR.text, align_h: align.CENTER_H, align_v: align.CENTER_V })
      w.status = createWidget(widget.TEXT, { ...L.SOS_STATUS, text: getText('result.sending'), color: COLOR.dim, align_h: align.CENTER_H, align_v: align.CENTER_V })
      createWidget(widget.BUTTON, {
        ...L.SOS_DONE,
        text: getText('result.done'),
        color: COLOR.redSoft,
        normal_color: COLOR.card,
        press_color: COLOR.cardPress,
        click_func: () => this.goHome(),
      })

      this.request(
        { method: 'sos.send', params: { ...this.state.event, source: this.state.source, ts: Date.now() } },
        { timeout: SOS_TIMEOUT_MS },
      )
        .then((r) => this.setStatus(r && r.ok ? 'result.sent' : 'result.failed', r && r.ok ? COLOR.green : COLOR.redSoft))
        .catch((e) => {
          console.error('[sos] request failed', e)
          this.setStatus('result.no_phone', COLOR.redSoft)
        })

      this.state.timer = setTimeout(() => this.goHome(), SOS_RETURN_MS)
    },

    setStatus(key, color) {
      const w = this.state.widgets
      if (!w.status) return
      w.status.setProperty(prop.MORE, { ...L.SOS_STATUS, text: getText(key), color })
    },

    goHome() {
      this.clearTimer()
      replace({ url: HOME })
    },

    clearTimer() {
      if (this.state.timer) {
        clearInterval(this.state.timer)
        clearTimeout(this.state.timer)
        this.state.timer = null
      }
    },

    onDestroy() {
      this.clearTimer()
    },
  }),
)
