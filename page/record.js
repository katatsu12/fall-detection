/**
 * Staged recordings — developer screen (README §12). Swipe left on Home
 * while DEBUG is on.
 *
 * Runs the staged protocol from the detector v2 plan: shows the next
 * activity, counts down with short buzzes, records 15 s from Home's sensor
 * stream (Home keeps sampling underneath this pushed page) and saves the
 * window with its label. While this page is open Home feeds neither v1 nor
 * everyday candidates, so no alert interrupts the session and no staged fall
 * is ever filed as everyday activity.
 *
 * It is also the phase 0 readout: live sensor rates, the frequency-mode
 * switch, and the recorder's files. Diagnostic text is deliberately not
 * localised.
 */
import { Vibrator, VIBRATOR_SCENE_SHORT_LIGHT, VIBRATOR_SCENE_SHORT_STRONG } from '@zos/sensor'
import { createWidget, widget, prop, align, text_style, event } from '@zos/ui'
import { localStorage } from '@zos/storage'
import { BasePage } from '@zeppos/zml/base-page'
import * as L from 'zosLoader:./record.[pf].layout.js'
import { COLOR } from '../utils/theme'
import { keepAwake } from '../utils/monitor-mode'
import { isRecording, setRecording, cycleFreqMode, freqModeName } from '../utils/debug'
import { getSession } from '../utils/recorder-session'
import { saveRecording, storeStats } from '../utils/recording-store'

const AWAKE_MS = 20000 // Home dims underneath unless this page keeps bumping the deadline
const TICK_MS = 250
const STATS_MS = 5000
const COUNTDOWN_S = 3
const SETTLE_MS = 300 // start the window after the "go" buzz, not during it
const CAPTURE_MS = 15000
const MIN_HZ = 5 // fewer samples than this per second: the stream stalled, don't save
const REPEATS = 10
const PROGRESS_KEY = 'rec.protocol'

// The staged protocol (plan: Data collection) — on a mattress, usual wrist.
const PROTOCOL = [
  { id: 'fall_forward', name: 'Fall forward', fall: true },
  { id: 'fall_backward', name: 'Fall backward', fall: true },
  { id: 'fall_sideways', name: 'Fall sideways', fall: true },
  { id: 'fall_slide_chair', name: 'Slide off a chair', fall: true },
  { id: 'fall_trip_walking', name: 'Trip while walking', fall: true },
  { id: 'fall_get_up', name: 'Fall, try to get up', fall: true },
  { id: 'fall_lie_still', name: 'Fall, lie still', fall: true },
  { id: 'adl_bed_flop', name: 'Flop onto a bed', fall: false },
  { id: 'adl_sofa_sit', name: 'Sit hard on a sofa', fall: false },
  { id: 'adl_table_slam', name: 'Slam hand on table', fall: false },
  { id: 'adl_clap', name: 'Clap', fall: false },
  { id: 'adl_jump', name: 'Jump', fall: false },
  { id: 'adl_jog', name: 'Jog', fall: false },
  { id: 'adl_stairs', name: 'Climb stairs', fall: false },
  { id: 'adl_watch_off', name: 'Watch off, onto table', fall: false },
]

function sessionId(t) {
  const d = new Date(t)
  const two = (n) => (n < 10 ? '0' : '') + n
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}`
}

Page(
  BasePage({
    name: 'record',
    state: {
      idx: 0,
      trial: 1,
      sessionId: '',
      phase: 'idle', // 'idle' | 'countdown' | 'recording'
      goAt: 0,
      lastLeft: 0,
      tStart: 0,
      tEnd: 0,
      message: '',
      files: null, // storeStats(), refreshed every STATS_MS
      lastStatsAt: 0,
      timer: null,
      vib: null,
      widgets: {},
    },

    onInit() {
      const s = this.state
      s.sessionId = sessionId(Date.now())
      try {
        const p = JSON.parse(localStorage.getItem(PROGRESS_KEY, '{}'))
        s.idx = Math.max(0, Math.min(PROTOCOL.length, p.idx | 0))
        s.trial = Math.max(1, Math.min(REPEATS, p.trial | 0))
      } catch (e) {
        /* start at the top */
      }
    },

    build() {
      keepAwake(AWAKE_MS)
      const w = this.state.widgets
      const text = (geo, color) =>
        createWidget(widget.TEXT, { ...geo, text: '', color, align_h: align.CENTER_H, align_v: align.CENTER_V, text_style: text_style.ELLIPSIS })

      w.title = text(L.TITLE, COLOR.muted)
      w.title.setProperty(prop.TEXT, 'Record tests')
      w.activity = text(L.ACTIVITY, COLOR.text)
      w.lines = L.LINES.map((g) => text(g, COLOR.textSoft))
      w.record = createWidget(widget.BUTTON, {
        ...L.RECORD_BTN,
        text: 'Record',
        color: COLOR.ink,
        normal_color: COLOR.green,
        press_color: COLOR.textSoft,
        click_func: () => this.startTrial(),
      })
      w.skip = createWidget(widget.BUTTON, {
        ...L.SKIP_BTN,
        text: 'Skip',
        color: COLOR.text,
        normal_color: COLOR.card,
        press_color: COLOR.cardPress,
        click_func: () => this.skip(),
      })
      w.mode = createWidget(widget.BUTTON, {
        ...L.MODE_BTN,
        text: freqModeName(),
        color: COLOR.text,
        normal_color: COLOR.card,
        press_color: COLOR.cardPress,
        click_func: () => this.switchMode(),
      })
      w.toggle = text(L.TOGGLE, COLOR.dim)
      w.toggle.addEventListener(event.CLICK_UP, () => this.toggleRecorder())

      // Home stops feeding v1 and everyday candidates while this page is open.
      const session = getSession()
      session.staged = true
      if (session.recorder) session.recorder.setCandidates(false)

      this.render(Date.now())
      this.state.timer = setInterval(() => this.tick(), TICK_MS)
    },

    ready() {
      const session = getSession()
      if (!isRecording()) return 'Recorder is off'
      if (!session.homeRunning || !session.recorder) return 'Home is paused'
      if (this.state.idx >= PROTOCOL.length) return 'Protocol complete'
      return ''
    },

    startTrial() {
      keepAwake(AWAKE_MS)
      const s = this.state
      if (s.phase !== 'idle') return
      const why = this.ready()
      if (why) {
        s.message = why
        return this.render(Date.now())
      }
      s.phase = 'countdown'
      s.goAt = Date.now() + COUNTDOWN_S * 1000
      s.lastLeft = 0
      s.message = ''
      this.render(Date.now())
    },

    tick() {
      keepAwake(AWAKE_MS)
      const s = this.state
      const now = Date.now()
      if (s.phase === 'countdown') {
        const left = Math.ceil((s.goAt - now) / 1000)
        if (now >= s.goAt) {
          this.buzz(VIBRATOR_SCENE_SHORT_STRONG)
          s.phase = 'recording'
          s.tStart = now + SETTLE_MS
          s.tEnd = s.tStart + CAPTURE_MS
        } else if (left !== s.lastLeft) {
          s.lastLeft = left
          this.buzz(VIBRATOR_SCENE_SHORT_LIGHT)
        }
      } else if (s.phase === 'recording' && now >= s.tEnd + 200) {
        this.finishTrial()
      }
      this.render(now)
    },

    finishTrial() {
      const s = this.state
      const a = PROTOCOL[s.idx]
      const session = getSession()
      s.phase = 'idle'
      if (!session.recorder || !session.homeRunning) {
        s.message = 'Home stopped: not saved'
        return
      }
      const rec = session.recorder.capture(s.tStart, s.tEnd, {
        activity: a.id,
        fall: a.fall,
        trial: s.trial,
        session: s.sessionId,
        mode: freqModeName(),
      })
      if (rec.accel.length < (CAPTURE_MS / 1000) * MIN_HZ) {
        s.message = `only ${rec.accel.length} samples: not saved`
        return
      }
      const ok = saveRecording(rec)
      this.buzz(VIBRATOR_SCENE_SHORT_STRONG)
      s.message = ok ? `saved #${s.trial}: ${rec.accel.length} + ${rec.gyro.length} rows` : 'save failed'
      s.lastStatsAt = 0
      if (ok) this.advance(false)
    },

    advance(skip) {
      const s = this.state
      if (skip || s.trial >= REPEATS) {
        s.idx = Math.min(PROTOCOL.length, s.idx + 1)
        s.trial = 1
      } else s.trial++
      localStorage.setItem(PROGRESS_KEY, JSON.stringify({ idx: s.idx, trial: s.trial }))
    },

    skip() {
      keepAwake(AWAKE_MS)
      const s = this.state
      if (s.phase !== 'idle') {
        s.phase = 'idle' // cancel the countdown or recording in progress
        s.message = 'cancelled'
      } else if (s.idx >= PROTOCOL.length) {
        s.idx = 0 // protocol complete: Skip starts over
        s.trial = 1
        localStorage.setItem(PROGRESS_KEY, JSON.stringify({ idx: 0, trial: 1 }))
      } else this.advance(true)
      this.render(Date.now())
    },

    switchMode() {
      keepAwake(AWAKE_MS)
      if (this.state.phase !== 'idle') return
      const mode = cycleFreqMode() // Home restarts its sensors in this mode within a second
      this.state.widgets.mode.setProperty(prop.TEXT, mode)
      this.state.message = `mode ${mode}: rates settle in ~5 s`
    },

    toggleRecorder() {
      keepAwake(AWAKE_MS)
      if (this.state.phase !== 'idle') return
      setRecording(!isRecording()) // Home restarts monitoring with or without the recorder
      this.state.message = ''
    },

    buzz(mode) {
      try {
        if (!this.state.vib) this.state.vib = new Vibrator()
        this.state.vib.stop()
        this.state.vib.start({ mode })
      } catch (e) {
        console.log('[record] vibrate failed', e)
      }
    },

    statusLine(now) {
      const s = this.state
      if (s.phase === 'countdown') return `get ready… ${Math.max(1, Math.ceil((s.goAt - now) / 1000))}`
      if (s.phase === 'recording') return `RECORDING ${Math.max(0, Math.ceil((s.tEnd - now) / 1000))} s`
      if (s.message) return s.message
      if (s.idx >= PROTOCOL.length) return 'Skip starts over'
      return `${PROTOCOL[s.idx].fall ? 'fall' : 'not a fall'} · trial ${s.trial}/${REPEATS}`
    },

    ratesLine() {
      const r = getSession().stats
      if (!r) return 'rates: waiting for Home'
      const hz = (m) => (m ? `${Math.round(m.hz)} Hz` : '–')
      return `${r.mode} · acc ${hz(r.accel)} · gyr ${hz(r.gyro)}`
    },

    filesLine(now) {
      const s = this.state
      if (now - s.lastStatsAt >= STATS_MS) {
        s.lastStatsAt = now
        s.files = storeStats()
      }
      const f = s.files
      const cands = getSession().recorder ? getSession().recorder.stats().candidates : 0
      return f ? `${f.count} files · ${Math.round(f.bytes / 1024)} KB · ${cands} cand.` : ''
    },

    render(now) {
      const s = this.state
      const w = s.widgets
      if (!w.activity) return
      w.activity.setProperty(prop.TEXT, s.idx < PROTOCOL.length ? PROTOCOL[s.idx].name : 'Protocol complete')
      const lines = [this.statusLine(now), this.ratesLine(), this.filesLine(now)]
      w.lines.forEach((t, i) => t.setProperty(prop.TEXT, lines[i]))
      w.toggle.setProperty(prop.TEXT, `recorder ${isRecording() ? 'on' : 'off'} · tap to switch`)
    },

    onDestroy() {
      const s = this.state
      if (s.timer) clearInterval(s.timer)
      if (s.vib) s.vib.stop()
      const session = getSession()
      session.staged = false
      if (session.recorder) session.recorder.setCandidates(true)
    },
  }),
)
