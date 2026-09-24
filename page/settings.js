/**
 * Sensitivity — "How careful?" (design 2A). Reached by swiping up on Home.
 * Three levels named by behaviour, plus the siren toggle (hidden until sound
 * exists, see SIREN_READY). Persists via utils/prefs; Home (still alive
 * underneath, since this page is pushed) polls the stored value in its tick
 * and rebuilds its detector when it changes.
 */
import { createWidget, widget, prop, align, event } from '@zos/ui'
import { getText } from '@zos/i18n'
import { BasePage } from '@zeppos/zml/base-page'
import * as L from 'zosLoader:./settings.[pf].layout.js'
import { COLOR } from '../utils/theme'
import { getPref, setPref, SENSITIVITY } from '../utils/prefs'
import { keepAwake } from '../utils/monitor-mode'

const AWAKE_MS = 20000 // Home is alive underneath and dims when nobody interacts — keep it lit while here
const SIREN_READY = false // no alert sound exists yet (README §2b), so the switch would promise nothing

const LEVELS = [
  { id: SENSITIVITY.RELAXED, label: 'settings.relaxed', sub: 'settings.relaxed_sub' },
  { id: SENSITIVITY.BALANCED, label: 'settings.balanced', sub: 'settings.balanced_sub' },
  { id: SENSITIVITY.WATCHFUL, label: 'settings.watchful', sub: 'settings.watchful_sub' },
]

Page(
  BasePage({
    name: 'settings',
    state: { sensitivity: SENSITIVITY.BALANCED, siren: true, rows: [], toggle: {} },

    onInit() {
      this.state.sensitivity = getPref('sensitivity')
      this.state.siren = !!getPref('siren')
    },

    build() {
      keepAwake(AWAKE_MS)
      createWidget(widget.TEXT, {
        ...L.TITLE,
        text: getText('settings.title'),
        color: COLOR.text,
        align_h: align.CENTER_H,
        align_v: align.CENTER_V,
      })

      // Each row pre-creates both visual states and toggles VISIBLE, which
      // avoids relying on per-widget colour updates.
      this.state.rows = LEVELS.map((level, i) => {
        const g = L.ROWS[i]
        const pick = () => this.select(level.id)
        const on = (w) => (w.addEventListener(event.CLICK_UP, pick), w)

        const rect = on(createWidget(widget.FILL_RECT, { ...g.rect, color: COLOR.card }))
        const border = createWidget(widget.STROKE_RECT, { ...g.border, color: COLOR.red })
        // off: 3 px grey ring (outer grey disc + inner card-coloured disc)
        const radioOffOuter = on(createWidget(widget.CIRCLE, { ...g.radio, color: COLOR.radioOff }))
        const radioOffInner = on(createWidget(widget.CIRCLE, { ...g.radioInner, color: COLOR.card }))
        // on: red disc with a black dot
        const radioOn = on(createWidget(widget.CIRCLE, { ...g.radio, color: COLOR.red }))
        const radioDot = on(createWidget(widget.CIRCLE, { ...g.radioDot, color: COLOR.bg }))
        const label = on(createWidget(widget.TEXT, { ...g.label, text: getText(level.label), color: COLOR.textSoft, align_h: align.LEFT, align_v: align.CENTER_V }))
        const sub = on(createWidget(widget.TEXT, { ...g.sub, text: getText(level.sub), color: COLOR.dim, align_h: align.LEFT, align_v: align.CENTER_V }))
        return { id: level.id, rect, border, radioOffOuter, radioOffInner, radioOn, radioDot, label, sub, g }
      })

      if (SIREN_READY) {
        const t = L.TOGGLE
        const flip = () => this.setSiren(!this.state.siren)
        const on = (w) => (w.addEventListener(event.CLICK_UP, flip), w)
        on(createWidget(widget.FILL_RECT, { ...t.rect, color: COLOR.card }))
        on(createWidget(widget.TEXT, { ...t.label, text: getText('settings.siren'), color: COLOR.textSoft, align_h: align.LEFT, align_v: align.CENTER_V }))
        this.state.toggle = {
          track: on(createWidget(widget.FILL_RECT, { ...t.track, color: COLOR.green })),
          knobOn: on(createWidget(widget.CIRCLE, { ...t.knobOn, color: COLOR.white })),
          knobOff: on(createWidget(widget.CIRCLE, { ...t.knobOff, color: COLOR.white })),
        }
      }

      this.render()
    },

    select(id) {
      keepAwake(AWAKE_MS)
      this.state.sensitivity = id
      setPref('sensitivity', id)
      this.render()
    },

    setSiren(v) {
      keepAwake(AWAKE_MS)
      this.state.siren = v
      setPref('siren', v)
      this.render()
    },

    render() {
      const s = this.state
      for (const r of s.rows) {
        const sel = r.id === s.sensitivity
        r.rect.setProperty(prop.MORE, { ...r.g.rect, color: sel ? COLOR.redCard : COLOR.card })
        r.border.setProperty(prop.VISIBLE, sel)
        r.radioOffOuter.setProperty(prop.VISIBLE, !sel)
        r.radioOffInner.setProperty(prop.MORE, { ...r.g.radioInner, color: sel ? COLOR.redCard : COLOR.card })
        r.radioOffInner.setProperty(prop.VISIBLE, !sel)
        r.radioOn.setProperty(prop.VISIBLE, sel)
        r.radioDot.setProperty(prop.VISIBLE, sel)
        r.label.setProperty(prop.MORE, { ...r.g.label, color: sel ? COLOR.text : COLOR.textSoft })
        r.sub.setProperty(prop.MORE, { ...r.g.sub, color: sel ? COLOR.caption : COLOR.dim })
      }
      const t = s.toggle
      if (!t.track) return
      t.track.setProperty(prop.MORE, { ...L.TOGGLE.track, color: s.siren ? COLOR.green : COLOR.radioOff })
      t.knobOn.setProperty(prop.VISIBLE, s.siren)
      t.knobOff.setProperty(prop.VISIBLE, !s.siren)
    },
  }),
)
