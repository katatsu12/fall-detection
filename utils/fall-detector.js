/**
 * Fall detector — pure JavaScript, no Zepp OS imports, so the same file runs
 * on the watch and under Node for tests.
 *
 * Feed accelerometer samples with push(t, x, y, z): t is a millisecond
 * timestamp, x/y/z are in cm/s² (what @zos/sensor Accelerometer returns).
 * The detector looks for the classic fall signature:
 *
 *   IDLE ──|a| < freefallG──► FREEFALL ──|a| > impactG within impactWindowMs──► IMPACT
 *     ▲                          │ timeout                                        │ wait stillDelayMs
 *     │                          ▼                                                ▼
 *     └────────────────────── IDLE                                     STILL: collect stillWindowMs
 *                                                                          │
 *                                        std(|a|) < stillStdG (+ optional angle / gyro checks)
 *                                                                          ▼
 *                                                          'fall' event, then cooldownMs of silence
 *
 * Thresholds are in g; windows are in ms so the logic does not depend on the
 * (undocumented) sensor rate.
 */

export const G_CMS2 = 980.665 // cm/s² per g

export const STATE = Object.freeze({
  IDLE: 'IDLE',
  FREEFALL: 'FREEFALL',
  IMPACT: 'IMPACT',
  STILL: 'STILL',
})

export const DEFAULTS = Object.freeze({
  freefallG: 0.6, // |a| below this ⇒ possible free fall
  impactG: 2.5, // |a| above this ⇒ impact
  impactWindowMs: 600, // impact must follow free-fall onset within this
  stillDelayMs: 1000, // ignore bounce / flailing right after impact
  stillWindowMs: 2000, // window for the stillness test
  stillStdG: 0.15, // std-dev of |a| over the still window must stay below this
  minStillSamples: 4, // fewer samples than this ⇒ cannot judge stillness
  useAngle: false, // require an orientation change between pre-fall and post-fall
  angleDeg: 60, // minimum angle between the two gravity vectors
  preWindowMs: 1500, // how much history to keep for the pre-fall gravity vector
  minGyroDps: 0, // >0 ⇒ require this peak angular rate (via pushGyro) during the event
  cooldownMs: 10000, // suppress re-triggers after an event
})

/** Sensitivity presets for the settings page — spread over DEFAULTS. */
export const PRESETS = Object.freeze({
  low: { freefallG: 0.5, impactG: 3.0, stillStdG: 0.12 },
  normal: {},
  high: { freefallG: 0.7, impactG: 2.0, stillStdG: 0.2 },
})

export function magnitudeG(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z) / G_CMS2
}

function stddev(values) {
  const n = values.length
  if (!n) return Infinity
  const mean = values.reduce((a, v) => a + v, 0) / n
  return Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / n)
}

function meanVector(samples) {
  const n = samples.length
  const v = [0, 0, 0]
  for (const s of samples) {
    v[0] += s.x / n
    v[1] += s.y / n
    v[2] += s.z / n
  }
  return v
}

function angleBetweenDeg(a, b) {
  const na = Math.hypot(a[0], a[1], a[2])
  const nb = Math.hypot(b[0], b[1], b[2])
  if (!na || !nb) return 0
  const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb)
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
}

/**
 * @param {Partial<typeof DEFAULTS>} [options]
 */
export function createFallDetector(options = {}) {
  const cfg = { ...DEFAULTS, ...options }
  const fallListeners = new Set()
  const candidateListeners = new Set()

  let state = STATE.IDLE
  let pre = [] // rolling window of recent samples: {t, x, y, z, g}
  let post = [] // samples collected during STILL
  let preGravity = null // mean acceleration vector before free-fall onset
  let tFreefall = 0
  let tImpact = 0
  let tLast = -Infinity
  let cooldownUntil = -Infinity
  let peakG = 0
  let gyroPeakDps = 0

  function emit(listeners, payload) {
    for (const cb of listeners) cb(payload)
  }

  function toIdle() {
    state = STATE.IDLE
    post = []
  }

  function evaluate(t) {
    const stillStd = stddev(post.map((s) => s.g))
    const angle =
      cfg.useAngle && preGravity && post.length ? angleBetweenDeg(preGravity, meanVector(post)) : null

    const reasons = []
    if (post.length < cfg.minStillSamples) reasons.push('too_few_samples')
    if (stillStd >= cfg.stillStdG) reasons.push('not_still')
    if (cfg.useAngle && (angle === null || angle < cfg.angleDeg)) reasons.push('no_orientation_change')
    if (cfg.minGyroDps > 0 && gyroPeakDps < cfg.minGyroDps) reasons.push('no_rotation')

    const candidate = {
      t: tImpact,
      freefallMs: tImpact - tFreefall,
      peakG,
      stillStd,
      angleDeg: angle,
      gyroPeakDps,
      samples: post.length,
      fall: reasons.length === 0,
      reasons,
    }
    emit(candidateListeners, candidate)
    if (candidate.fall) {
      cooldownUntil = t + cfg.cooldownMs
      emit(fallListeners, candidate)
    }
    toIdle()
    return candidate.fall ? candidate : null
  }

  return {
    /**
     * Feed one accelerometer sample. Returns the fall event when this sample
     * completes a detection, otherwise null. Out-of-order samples are ignored.
     */
    push(t, x, y, z) {
      if (!(t >= tLast)) return null
      tLast = t
      const g = magnitudeG(x, y, z)
      const s = { t, x, y, z, g }

      pre.push(s)
      while (pre.length && t - pre[0].t > cfg.preWindowMs) pre.shift()

      switch (state) {
        case STATE.IDLE:
          if (t < cooldownUntil) return null
          if (g < cfg.freefallG) {
            state = STATE.FREEFALL
            tFreefall = t
            peakG = 0
            gyroPeakDps = 0
            const before = pre.filter((p) => p.t < t)
            preGravity = before.length ? meanVector(before) : null
          }
          return null

        case STATE.FREEFALL:
          if (g > cfg.impactG) {
            state = STATE.IMPACT
            tImpact = t
            peakG = g
          } else if (t - tFreefall > cfg.impactWindowMs) {
            toIdle()
          }
          return null

        case STATE.IMPACT:
          if (g > peakG) peakG = g
          if (t - tImpact >= cfg.stillDelayMs) {
            state = STATE.STILL
            post = [s]
          }
          return null

        case STATE.STILL:
          post.push(s)
          if (t - tImpact - cfg.stillDelayMs >= cfg.stillWindowMs) return evaluate(t)
          return null
      }
      return null
    },

    /** Optional gyroscope sample in degrees/second; only used when minGyroDps > 0. */
    pushGyro(t, x, y, z) {
      const dps = Math.hypot(x, y, z)
      if (state !== STATE.IDLE && dps > gyroPeakDps) gyroPeakDps = dps
    },

    /** Called with the event payload when a fall is confirmed. Returns an unsubscribe function. */
    onFall(cb) {
      fallListeners.add(cb)
      return () => fallListeners.delete(cb)
    },

    /**
     * Called for every completed evaluation, confirmed or rejected, with
     * `fall` and `reasons` set. Useful for tuning thresholds on real data.
     */
    onCandidate(cb) {
      candidateListeners.add(cb)
      return () => candidateListeners.delete(cb)
    },

    getState() {
      return state
    },

    getConfig() {
      return { ...cfg }
    },

    reset() {
      toIdle()
      pre = []
      preGravity = null
      tLast = -Infinity
      cooldownUntil = -Infinity
      peakG = 0
      gyroPeakDps = 0
    },
  }
}

/**
 * Replay a recorded trace of `{ dt, x, y, z }` samples (dt = ms since the
 * previous sample) into a detector. Returns the fall events that fired.
 * Used by tests and by the on-device debug button.
 */
export function replay(detector, samples, t0 = 0) {
  const events = []
  const off = detector.onFall((e) => events.push(e))
  let t = t0
  for (const s of samples) {
    t += s.dt
    detector.push(t, s.x, s.y, s.z)
  }
  off()
  return events
}
