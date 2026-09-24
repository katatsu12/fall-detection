/**
 * Sample-rate meter for phase 0 — how many callbacks per second a sensor
 * really delivers and how regular they are. Pure JavaScript.
 *
 *   const m = createRateMeter(Date.now())
 *   m.push(t)           // in every onChange callback
 *   m.read(Date.now())  // → { hz, n, dtMedian, dtP95, dtMax } since the last read
 */

export function createRateMeter(t0 = NaN) {
  let periodStart = t0
  let last = NaN
  let count = 0
  let dts = []

  return {
    push(t) {
      if (!Number.isNaN(last)) dts.push(t - last)
      else if (Number.isNaN(periodStart)) periodStart = t
      last = t
      count++
    },

    /** Stats for the period since the previous read(), then start a new period at `now`. */
    read(now) {
      const span = now - periodStart
      const sorted = dts.slice().sort((a, b) => a - b)
      const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0)
      const out = {
        hz: span > 0 ? (count * 1000) / span : 0,
        n: count,
        dtMedian: q(0.5),
        dtP95: q(0.95),
        dtMax: sorted.length ? sorted[sorted.length - 1] : 0,
      }
      periodStart = now
      count = 0
      dts = []
      return out
    },
  }
}
