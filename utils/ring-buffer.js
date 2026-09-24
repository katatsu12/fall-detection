/**
 * Ring buffer of timestamped samples on typed arrays — pure JavaScript, no
 * Zepp OS imports, shared by the candidate recorder (phase 1) and detector
 * v2 (phase 2).
 *
 * Times are stored as Uint32 millisecond offsets from the first sample: a
 * Float32 cannot hold a Date.now() value, and 2^32 ms is 49 days. Each sample
 * carries `channels` Float32 values (up to 4). When the buffer is full but
 * holds less than `spanMs` of history, capacity doubles (up to
 * `maxCapacity`), so a higher sample rate than expected never shortens the
 * window.
 */

export function createRingBuffer({ channels, spanMs, capacity = 256, maxCapacity = 8192 }) {
  if (!(channels >= 1 && channels <= 4)) throw new Error('channels must be 1–4')
  let cap = capacity
  let times = new Uint32Array(cap)
  let values = new Float32Array(cap * channels)
  let start = 0 // physical index of the oldest sample
  let count = 0
  let base = 0 // absolute ms of offset 0
  let newest = -Infinity

  const phys = (i) => (start + i) % cap // i-th oldest → physical index
  const timeAt = (i) => base + times[phys(i)]

  function grow() {
    const next = Math.min(cap * 2, maxCapacity)
    const t = new Uint32Array(next)
    const v = new Float32Array(next * channels)
    for (let i = 0; i < count; i++) {
      const p = phys(i)
      t[i] = times[p]
      for (let c = 0; c < channels; c++) v[i * channels + c] = values[p * channels + c]
    }
    times = t
    values = v
    cap = next
    start = 0
  }

  /** Logical index of the first sample with time >= t (or > t when `after`); count if none. */
  function bound(t, after) {
    let lo = 0
    let hi = count
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const tm = timeAt(mid)
      if (tm < t || (after && tm === t)) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  function clear() {
    start = 0
    count = 0
    base = 0
    newest = -Infinity
  }

  /** Append one sample. Returns false, storing nothing, if t is older than the newest sample. */
  function push(t, v0, v1, v2, v3) {
    if (!(t >= newest)) return false
    if (count && t - base > 0xfffffff0) clear() // 49 days in one buffer: start over rather than wrap the offsets
    if (count === 0) base = Math.floor(t)
    if (count === cap && t - timeAt(0) < spanMs && cap < maxCapacity) grow()
    let p
    if (count < cap) {
      p = phys(count)
      count++
    } else {
      p = start
      start = (start + 1) % cap
    }
    times[p] = Math.round(t - base)
    const o = p * channels
    values[o] = v0
    if (channels > 1) values[o + 1] = v1
    if (channels > 2) values[o + 2] = v2
    if (channels > 3) values[o + 3] = v3
    newest = t
    return true
  }

  /**
   * Call fn(t, row) for every sample with t0 <= t <= t1, oldest first.
   * `row` is reused between calls — copy it to keep it.
   */
  function forEach(t0, t1, fn) {
    const row = new Array(channels)
    for (let i = bound(t0, false); i < count; i++) {
      const p = phys(i)
      const t = base + times[p]
      if (t > t1) break
      for (let c = 0; c < channels; c++) row[c] = values[p * channels + c]
      fn(t, row)
    }
  }

  /** Samples with t0 <= t <= t1 as [t, v0, v1, …] arrays, oldest first. */
  function slice(t0, t1) {
    const out = []
    forEach(t0, t1, (t, row) => out.push([t, ...row]))
    return out
  }

  /** Number of samples with t0 <= t <= t1. */
  function countIn(t0, t1) {
    return Math.max(0, bound(t1, true) - bound(t0, false))
  }

  return {
    push,
    forEach,
    slice,
    countIn,
    clear,
    size: () => count,
    capacity: () => cap,
    oldestTime: () => (count ? timeAt(0) : NaN),
    newestTime: () => (count ? newest : NaN),
  }
}
