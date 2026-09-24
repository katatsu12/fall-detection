/**
 * Background probe — developer screen (README §10). Reached by swiping down
 * on Home while DEBUG is on. Starts/stops app-service/probe.js and shows what
 * it recorded, refreshed once a second. Diagnostic text is deliberately not
 * localised.
 *
 * Protocol: Start → leave the app → let the screen sleep for a few minutes
 * → come back here. The first three minute-beats buzz, so a buzz with the
 * app closed is itself a result.
 */
import { queryPermission, requestPermission } from '@zos/app'
import { start, stop, getAllAppServices } from '@zos/app-service'
import { createWidget, widget, prop, align, text_style } from '@zos/ui'
import { getText } from '@zos/i18n'
import { BasePage } from '@zeppos/zml/base-page'
import * as L from 'zosLoader:./probe.[pf].layout.js'
import { COLOR, hideStatusBar } from '../utils/theme'
import { PROBE_SERVICE, loadProbe, clearProbe } from '../utils/probe-store'

const PERMISSION = 'device:os.bg_service'
const GRANTED = 2 // queryPermission / requestPermission result code
const REFRESH_MS = 1000

const ago = (t, now) => (t ? `${Math.max(0, Math.round((now - t) / 1000))}s ago` : 'never')
const mins = (t, now) => `${Math.max(0, Math.round((now - t) / 60000))} min`

Page(
  BasePage({
    name: 'probe',
    state: { rows: [], timer: null, message: '' },

    build() {
      hideStatusBar()
      createWidget(widget.TEXT, {
        ...L.TITLE,
        text: getText('probe.title'),
        color: COLOR.text,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })
      this.state.rows = L.ROWS.map((r) =>
        createWidget(widget.TEXT, {
          ...r,
          text: '',
          color: COLOR.textSoft,
          align_h: align.LEFT,
          align_v: align.CENTER_V,
          text_style: text_style.ELLIPSIS,
        }),
      )
      createWidget(widget.BUTTON, {
        ...L.START_BTN,
        text: getText('probe.start'),
        color: COLOR.ink,
        normal_color: COLOR.green,
        press_color: COLOR.textSoft,
        click_func: () => this.startProbe(),
      })
      createWidget(widget.BUTTON, {
        ...L.STOP_BTN,
        text: getText('probe.stop'),
        color: COLOR.text,
        normal_color: COLOR.card,
        press_color: COLOR.cardPress,
        click_func: () => this.stopProbe(),
      })
      this.state.message = getText('probe.hint')
      this.render()
      this.state.timer = setInterval(() => this.render(), REFRESH_MS)
    },

    isRunning() {
      try {
        return getAllAppServices().some((f) => String(f).indexOf('probe') >= 0)
      } catch (e) {
        return false
      }
    },

    startProbe() {
      let status = 0
      try {
        status = queryPermission({ permissions: [PERMISSION] })[0]
      } catch (e) {
        this.say(`queryPermission: ${e.message || e}`)
        return
      }
      if (status === GRANTED) return this.launch()
      this.say('asking for permission…')
      const r = requestPermission({
        permissions: [PERMISSION],
        callback: (result) => {
          if (result && result[0] === GRANTED) this.launch()
          else this.say(`permission denied (${result && result[0]})`)
        },
      })
      if (r === GRANTED) this.launch() // already authorised, no dialog
      else if (r !== 0) this.say(`permission request failed (${r})`)
    },

    launch() {
      clearProbe()
      const code = start({
        file: PROBE_SERVICE,
        complete_func: ({ result }) => this.say(result ? 'service started' : 'service failed to start'),
      })
      if (code !== 0 && code !== true) this.say(`start() returned ${code}`)
      else this.say('starting…')
    },

    stopProbe() {
      const code = stop({
        file: PROBE_SERVICE,
        complete_func: ({ result }) => this.say(result ? 'service stopped' : 'stop failed'),
      })
      if (code !== 0 && code !== true) this.say(`stop() returned ${code}`)
    },

    say(msg) {
      console.log('[probe-page]', msg)
      this.state.message = msg
      this.render()
    },

    lines() {
      const now = Date.now()
      const p = loadProbe()
      const running = this.isRunning()
      if (!p) return [running ? 'service running, nothing recorded yet' : 'no probe data yet', '', '', '', '', '', '', this.state.message]
      const a = p.accel
      const accel = a.ctor !== 'ok' ? `accel: ${a.ctor || 'untried'}` : a.start !== 'ok' ? `accel start: ${a.start}` : `accel: ${a.samples} samples, ${a.perMinute}/min, ${a.lastG} g`
      return [
        running ? `service: running ${mins(p.startedAt, now)}` : `service: stopped${p.stoppedAt ? ' ' + ago(p.stoppedAt, now) : ''}`,
        `beats: ${p.beats}, last ${ago(p.lastBeatAt, now)}`,
        accel,
        `screen: ${p.screen.status === 2 ? 'off' : 'on'}, off ${p.screen.offCount}x, ${a.sinceScreenOff} samples since off`,
        `wear: ${p.wear.status} (${p.wear.changes} changes), hr: ${p.hr.last} (${p.hr.samples})`,
        `vibrate: ${p.vib || 'untried'}, notify: ${p.notify || 'untried'}`,
        `falls: ${p.detector.falls}, candidates: ${p.detector.candidates}, store: ${p.store}` + (p.errors.length ? `, ${p.errors.length} errors` : ''),
        p.errors.length ? p.errors[p.errors.length - 1] : this.state.message,
      ]
    },

    render() {
      const texts = this.lines()
      this.state.rows.forEach((w, i) => w.setProperty(prop.TEXT, texts[i] || ''))
    },

    onDestroy() {
      if (this.state.timer) clearInterval(this.state.timer)
    },
  }),
)
