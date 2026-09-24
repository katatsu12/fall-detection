/**
 * "Why didn't it alert?" — a debug readout for testing the v1 detector on a
 * real wrist (README "If a test fall doesn't alert"). Pure JavaScript, tested
 * in Node.
 *
 * It watches the same |a| stream as the detector, plus the detector's state
 * before and after each sample. Every jolt over `joltG` becomes an attempt
 * with its peak |a| (the hit), the lowest |a| in the second before the peak
 * (the drop), and how far the v1 chain got:
 *
 *   'off_wrist'      the watch reported not worn, so detection was paused
 *   'no_drop'        |a| never fell under freefallG before the jolt
 *   'no_hit'         it did, but no sample passed impactG in time
 *   'checking'       impact seen; v1 is waiting for stillness
 *   v1's reasons     v1 evaluated and rejected it, e.g. 'not_still'
 *   'fall'           v1 raised the alert
 *
 * latest(now) returns the strongest attempt of the last `windowMs`, which is
 * what Home shows while you get up after a test fall.
 */
import { STATE } from './fall-detector.js'

export const DIAG_DEFAULTS = Object.freeze({
  joltG: 1.4, // weaker than any preset's impact threshold, so near-misses show up
  windowMs: 30000,
  lookbackMs: 1000, // the drop is the lowest |a| this long before the peak
  quietMs: 1000, // an attempt ends after this long without a jolt
})

// How far each verdict got along the chain; an attempt only moves forward.
const RANK = { off_wrist: 0, no_drop: 1, no_hit: 2, checking: 3 }
const rank = (v) => (v in RANK ? RANK[v] : 4) // evaluated: v1's reasons or 'fall'

export function createDiagnostics(options = {}, onDone = () => {}) {
  const cfg = { ...DIAG_DEFAULTS, ...options }
  let history = [] // { t, g } for the last lookbackMs
  let open = null // attempt still collecting jolt samples
  let attempts = [] // finished or pending attempts, oldest first

  function dipBefore(t) {
    let dip = Infinity
    for (const h of history) if (h.t >= t - cfg.lookbackMs && h.t <= t && h.g < dip) dip = h.g
    return dip
  }

  function close() {
    if (open.verdict !== 'checking') onDone(open)
    open = null
  }

  function verdictFor(before, after) {
    if (before === 'OFF') return 'off_wrist'
    if (before === STATE.FREEFALL && after === STATE.IMPACT) return 'checking'
    if (before === STATE.FREEFALL) return 'no_hit'
    if (before === STATE.IMPACT || before === STATE.STILL) return 'checking' // after-shocks of a counted impact
    return 'no_drop'
  }

  return {
    /**
     * One sample: |a| in g, the detector state before and after pushing it
     * (both 'OFF' while the watch is off the wrist and the detector is not fed).
     */
    push(t, g, before, after) {
      history.push({ t, g })
      while (history.length && t - history[0].t > cfg.lookbackMs) history.shift()
      if (open && t - open.lastJoltT > cfg.quietMs) close()
      attempts = attempts.filter((a) => t - a.t <= cfg.windowMs)
      if (!(g > cfg.joltG)) return

      const verdict = verdictFor(before, after)
      if (!open) {
        open = { t, lastJoltT: t, peakG: g, dipG: dipBefore(t), verdict }
        attempts.push(open)
        return
      }
      open.lastJoltT = t
      if (g > open.peakG) {
        open.peakG = g
        open.dipG = dipBefore(t)
      }
      if (rank(verdict) > rank(open.verdict)) open.verdict = verdict
    },

    /** v1's onCandidate payload: its verdict for the attempt that holds the impact. */
    noteCandidate(c) {
      if (!c) return
      const a = attempts.find((x) => c.t >= x.t - cfg.lookbackMs && c.t <= x.lastJoltT + cfg.quietMs)
      if (!a) return
      a.verdict = c.fall ? 'fall' : (c.reasons && c.reasons[0]) || 'rejected'
      if (a !== open) onDone(a)
    },

    /** The strongest attempt of the last windowMs, or null. */
    latest(now) {
      let best = null
      for (const a of attempts) if (now - a.t <= cfg.windowMs && (!best || a.peakG > best.peakG)) best = a
      return best
    },

    reset() {
      history = []
      open = null
      attempts = []
    },
  }
}

const SHORT = {
  fall: 'ALERT',
  checking: 'wait…',
  not_still: 'moved',
  too_few_samples: 'gaps',
  no_hit: 'no hit',
  no_drop: 'no drop',
  off_wrist: 'off wrist',
}

/** Home's debug line, e.g. "hit 3.1 g · drop 0.42 g · moved". */
export function diagText(a) {
  const drop = Number.isFinite(a.dipG) ? a.dipG.toFixed(2) : '–'
  return `hit ${a.peakG.toFixed(1)} g · drop ${drop} g · ${SHORT[a.verdict] || a.verdict}`
}
