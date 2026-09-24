/**
 * Evaluation core for `npm run eval` (tools/eval.js) — pure functions,
 * tested in test/eval.test.js. A trace is one labelled stream of
 * accelerometer samples; the detector under test replays it from a fresh
 * state, and its alerts are matched against the label.
 *
 * Labels:
 *   fall      fall_* fixtures, staged falls, and everyday alerts the wearer
 *             confirmed with "Did you fall? Yes"
 *   adl       adl_* fixtures and staged non-falls: any alert is a false alarm
 *   everyday  candidate windows from normal wear: alerts, weighted by the
 *             recording's sampling weight, count toward false alarms per day
 */
import { createFallDetector, PRESETS } from '../utils/fall-detector.js'

/** When an alert counts as a hit, relative to the labelled impact. */
export const HIT_WINDOW_MS = Object.freeze({ impact: [-1000, 15000], long_lie: [20000, 75000] })
/** An everyday window owns the alerts for its own impact; neighbouring windows overlap. */
export const OWN_IMPACT_MS = 1000
export const WAKING_HOURS = 16

/** test/fixtures/*.json: [{ dt, x, y, z }], labelled by the file name (fall_* / adl_*). */
export function traceFromFixture(name, rows) {
  let t = 0
  const samples = rows.map((r) => ({ t: (t += r.dt), x: r.x, y: r.y, z: r.z }))
  const id = name.replace(/\.json$/, '')
  return { id, source: 'fixture', label: id.startsWith('fall_') ? 'fall' : 'adl', activity: id, impactT: null, weight: 1, samples }
}

/** A recording from the watch (utils/candidate-recorder.js). Null for summaries and simulated alerts. */
export function traceFromRecording(rec) {
  if (!rec || rec.kind === 'summary' || !Array.isArray(rec.accel)) return null
  const label = rec.label || {}
  if (label.simulated) return null
  const samples = rec.accel.map(([dt, x, y, z]) => ({ t: rec.t0 + dt, x, y, z }))
  const base = { id: rec.id, weight: 1, samples }
  if (rec.kind === 'staged') {
    return { ...base, source: 'staged', label: rec.fall ? 'fall' : 'adl', activity: rec.activity || 'unknown', impactT: null }
  }
  if (label.fell === true) return { ...base, source: 'everyday', label: 'fall', activity: 'real_fall', impactT: rec.t0 }
  return { ...base, source: 'everyday', label: 'everyday', activity: rec.keep || 'candidate', impactT: rec.t0, weight: rec.weight || 1 }
}

/** Replay a trace through a fresh detector. Each alert carries the sample time it fired at. */
export function replayTrace(trace, makeDetector) {
  const det = makeDetector()
  const events = []
  let now = 0
  det.onFall((e) => events.push({ at: now, impactT: e.t, kind: e.kind || 'impact' }))
  for (const s of trace.samples) {
    now = s.t
    det.push(s.t, s.x, s.y, s.z)
  }
  return events
}

/** Does this alert detect the trace's fall? Windows without an impact time accept any alert. */
export function isHit(trace, ev) {
  if (trace.impactT === null) return true
  const [lo, hi] = HIT_WINDOW_MS[ev.kind] || HIT_WINDOW_MS.impact
  const d = ev.at - trace.impactT
  return d >= lo && d <= hi
}

/** Wilson score interval for k successes in n at 95%. */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1]
  const p = k / n
  const d = 1 + (z * z) / n
  const c = p + (z * z) / (2 * n)
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, (c - r) / d), Math.min(1, (c + r) / d)]
}

function quantile(xs, q) {
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}

/** Score one detector on labelled traces. `wornHours` comes from the day summaries. */
export function evaluate(traces, makeDetector, { wornHours = 0 } = {}) {
  const falls = { total: 0, detected: 0, byActivity: {} }
  const adl = { total: 0, clean: 0, byActivity: {} }
  const everyday = { windows: 0, alarms: 0, weightedAlarms: 0 }
  const latencies = []
  const tally = (map, key, flagged) => {
    const m = (map[key] = map[key] || { total: 0, flagged: 0 })
    m.total++
    if (flagged) m.flagged++
  }

  for (const tr of traces) {
    const events = replayTrace(tr, makeDetector)
    if (tr.label === 'fall') {
      const hit = events.find((e) => isHit(tr, e))
      falls.total++
      if (hit) {
        falls.detected++
        if (tr.impactT !== null) latencies.push(hit.at - tr.impactT)
      }
      tally(falls.byActivity, tr.activity, !!hit) // flagged = detected
    } else if (tr.label === 'adl') {
      adl.total++
      if (!events.length) adl.clean++
      tally(adl.byActivity, tr.activity, events.length > 0) // flagged = false alarm
    } else {
      const own = events.filter((e) => Math.abs(e.impactT - tr.impactT) <= OWN_IMPACT_MS)
      everyday.windows++
      everyday.alarms += own.length
      everyday.weightedAlarms += own.length * tr.weight
    }
  }

  return {
    falls: { ...falls, recall: falls.total ? falls.detected / falls.total : null, ci95: wilson(falls.detected, falls.total) },
    adl: { ...adl, specificity: adl.total ? adl.clean / adl.total : null },
    everyday: {
      ...everyday,
      wornHours,
      falseAlarmsPerDay: wornHours > 0 ? (everyday.weightedAlarms / wornHours) * WAKING_HOURS : null,
    },
    latencyMs: latencies.length ? { median: quantile(latencies, 0.5), p95: quantile(latencies, 0.95) } : null,
  }
}

/** Hours worn, from day summaries; a day uploaded several times counts once (the most worn copy). */
export function wornHoursFrom(summaries) {
  const byDate = new Map()
  for (const s of summaries) byDate.set(s.date, Math.max(byDate.get(s.date) || 0, s.wornMs || 0))
  let ms = 0
  for (const v of byDate.values()) ms += v
  return ms / 3600000
}

/** The detector under test, by name. v2 joins in phase 2 (utils/fall-detector-v1.js becomes 'v1'). */
export function detectorFactory(name, preset) {
  if (name !== 'v1') throw new Error(`unknown detector "${name}" (only v1 until phase 2)`)
  const opts = PRESETS[preset]
  if (!opts) throw new Error(`unknown preset "${preset}" (low, normal, high)`)
  return () => createFallDetector(opts)
}
