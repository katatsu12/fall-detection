/**
 * Candidate recorder — phase 1 of the detector v2 plan. Pure JavaScript, no
 * Zepp OS imports, so it runs under Node for tests.
 *
 * It runs the v2 impact trigger (utils/impact-trigger.js) over its own accel
 * and gyro ring buffers, beside the v1 detector and without changing it.
 * When a candidate's post window fills, it decides whether to keep the raw
 * window (preMs before t0 to postMs after):
 *
 *   v1 raised an alert for this impact      → keep 'v1_fall'
 *   v1 evaluated it and said no             → keep 'v1_rejected' (a near-miss)
 *   the watch came off during the window    → keep 'wear_off'
 *   anything else                           → keep a random `sampleRate` share,
 *                                             'sampled' with weight 1 / sampleRate
 *
 * Every candidate, kept or not, also produces a summary line, which gives the
 * candidate rate and lets evaluation count everyday false alarms from the
 * weighted sample. A v1 alert replaces the page that feeds the recorder, so
 * flush() writes pending candidates early, marked truncated.
 */
import { createRingBuffer } from './ring-buffer.js'
import { createImpactTrigger } from './impact-trigger.js'
import { magnitudeG } from './fall-detector.js'

export const RECORDER_DEFAULTS = Object.freeze({
  triggerG: 1.8,
  mergeMs: 1000,
  preMs: 3000,
  postMs: 10000,
  spanMs: 18000, // ring history: covers pre + merge + post, and a 15 s staged capture read up to 1 s late
  sampleRate: 0.1, // share of plain candidates whose raw window is kept
  minTruncatedPostMs: 2000, // flush() drops candidates with less data than this after t0
  v1MatchMs: 1000, // a v1 candidate belongs to the pending candidate whose t0 is this close
})

export const KEEP = Object.freeze({
  V1_FALL: 'v1_fall',
  V1_REJECTED: 'v1_rejected',
  WEAR_OFF: 'wear_off',
  SAMPLED: 'sampled',
})

export const RECORDING_VERSION = 1

const round = (v, digits) => {
  const f = 10 ** digits
  return Math.round(v * f) / f
}

/**
 * @param {Partial<typeof RECORDER_DEFAULTS>} [options]
 * @param {{ random?: () => number, onRecording?: (rec: object) => void, onSummary?: (line: object) => void }} [hooks]
 */
export function createCandidateRecorder(options = {}, hooks = {}) {
  const cfg = { ...RECORDER_DEFAULTS, ...options }
  const random = hooks.random || Math.random
  const onRecording = hooks.onRecording || (() => {})
  const onSummary = hooks.onSummary || (() => {})

  const accel = createRingBuffer({ channels: 3, spanMs: cfg.spanMs })
  const gyro = createRingBuffer({ channels: 3, spanMs: cfg.spanMs })
  const trigger = createImpactTrigger({ triggerG: cfg.triggerG, mergeMs: cfg.mergeMs })

  let pending = [] // { t0, peakG, v1, wornOffAt }, oldest first
  let worn = true
  let enabled = true
  const counters = { candidates: 0, kept: 0, v1Falls: 0, v1Rejected: 0, v1Unmatched: 0 }

  function rows(buf, from, to, t0, digits) {
    const out = []
    buf.forEach(from, to, (t, r) => out.push([Math.round(t - t0), round(r[0], digits), round(r[1], digits), round(r[2], digits)]))
    return out
  }

  function addPending(c) {
    pending.push({ t0: c.t0, peakG: c.peakG, v1: null, wornOffAt: null })
    counters.candidates++
  }

  function finish(p, truncated, tEnd) {
    let keep = null
    let weight = 1
    if (p.v1 && p.v1.fall) keep = KEEP.V1_FALL
    else if (p.v1) keep = KEEP.V1_REJECTED
    else if (p.wornOffAt !== null) keep = KEEP.WEAR_OFF
    else if (random() < cfg.sampleRate) {
      keep = KEEP.SAMPLED
      weight = Math.round(1 / cfg.sampleRate)
    }

    let id = null
    if (keep) {
      const to = truncated ? tEnd : p.t0 + cfg.postMs
      id = `c-${Math.round(p.t0).toString(36)}`
      counters.kept++
      onRecording({
        v: RECORDING_VERSION,
        id,
        kind: 'candidate',
        t0: Math.round(p.t0),
        peakG: round(p.peakG, 3),
        triggerG: cfg.triggerG,
        keep,
        weight,
        truncated,
        preMs: cfg.preMs,
        postMs: Math.round(to - p.t0),
        wornOffAt: p.wornOffAt,
        v1: p.v1,
        accel: rows(accel, p.t0 - cfg.preMs, to, p.t0, 0),
        gyro: rows(gyro, p.t0 - cfg.preMs, to, p.t0, 1),
      })
    }
    onSummary({
      t0: Math.round(p.t0),
      peakG: round(p.peakG, 2),
      v1: p.v1 ? (p.v1.fall ? 'fall' : 'rejected') : null,
      keep,
      weight: keep ? weight : 0,
      truncated,
    })
    return id ? { id, keep, t0: Math.round(p.t0) } : null
  }

  function completeDue(t) {
    while (pending.length && t - pending[0].t0 >= cfg.postMs) finish(pending.shift(), false, t)
  }

  return {
    /** Accelerometer sample in cm/s², as @zos/sensor delivers it. */
    pushAccel(t, x, y, z) {
      if (!accel.push(t, x, y, z)) return
      if (!enabled) return
      if (worn) {
        const c = trigger.push(t, magnitudeG(x, y, z))
        if (c) addPending(c)
      }
      completeDue(t)
    },

    /** Gyroscope sample in degrees per second. */
    pushGyro(t, x, y, z) {
      gyro.push(t, x, y, z)
    },

    /**
     * Attach a v1 onCandidate payload to the pending candidate for the same
     * impact. v1 decides about 3 s after impact, well inside the post window.
     */
    noteV1(c) {
      if (!c || !enabled) return false
      let best = null
      for (const p of pending) {
        const d = Math.abs(p.t0 - c.t)
        if (d <= cfg.v1MatchMs && (!best || d < Math.abs(best.t0 - c.t))) best = p
      }
      if (!best) {
        counters.v1Unmatched++
        return false
      }
      best.v1 = {
        fall: !!c.fall,
        reasons: c.reasons || [],
        t: Math.round(c.t),
        peakG: round(c.peakG || 0, 3),
        stillStd: round(c.stillStd || 0, 4),
        freefallMs: Math.round(c.freefallMs || 0),
      }
      if (c.fall) counters.v1Falls++
      else counters.v1Rejected++
      return true
    },

    /** Wear state from @zos/sensor Wear. Taking the watch off marks every pending candidate. */
    setWorn(isWorn, t) {
      if (worn && !isWorn) {
        const c = trigger.flush()
        if (c) addPending(c)
        for (const p of pending) if (p.wornOffAt === null) p.wornOffAt = Math.round(t - p.t0)
      }
      worn = !!isWorn
    },

    /** Switch everyday candidates off during a staged session; pending ones are dropped unrecorded. */
    setCandidates(on) {
      enabled = !!on
      if (!enabled) {
        trigger.reset()
        pending = []
      }
    },

    /**
     * The page is going away (v1 alert, pause, destroy): write every pending
     * candidate with at least minTruncatedPostMs of data, marked truncated,
     * and drop the rest. Returns { id, keep, t0 } for each recording written.
     */
    flush() {
      const c = trigger.flush()
      if (c) addPending(c)
      const tEnd = accel.newestTime()
      const written = []
      for (const p of pending) {
        if (!(tEnd - p.t0 >= cfg.minTruncatedPostMs)) continue
        const r = finish(p, true, tEnd)
        if (r) written.push(r)
      }
      pending = []
      return written
    },

    /** A staged-protocol window [tStart, tEnd] with its label, as a recording. */
    capture(tStart, tEnd, meta = {}) {
      return {
        v: RECORDING_VERSION,
        id: `s-${Math.round(tStart).toString(36)}`,
        kind: 'staged',
        ...meta,
        t0: Math.round(tStart),
        weight: 1,
        preMs: 0,
        postMs: Math.round(tEnd - tStart),
        accel: rows(accel, tStart, tEnd, tStart, 0),
        gyro: rows(gyro, tStart, tEnd, tStart, 1),
      }
    },

    stats() {
      return { ...counters, pending: pending.length }
    },

    getConfig() {
      return { ...cfg }
    },
  }
}
