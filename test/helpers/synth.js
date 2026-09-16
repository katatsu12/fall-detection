/**
 * Deterministic synthetic accelerometer traces in the same `{ dt, x, y, z }`
 * (ms, cm/s²) format we record from real devices, so fixtures and synthetic
 * data are interchangeable.
 */
import { G_CMS2 } from '../../utils/fall-detector.js'

function lcg(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x100000000 - 0.5 // [-0.5, 0.5)
  }
}

export const UP = [0, 0, 1] // watch face up (gravity along +z)
export const SIDE = [1, 0, 0] // lying on the side (gravity along +x)

/** Build a trace at `hz` samples/second. Every method appends and returns the builder. */
export function trace({ hz = 50, seed = 1 } = {}) {
  const dt = 1000 / hz
  const rnd = lcg(seed)
  const samples = []

  function pushG(gVec, noise) {
    samples.push({
      dt,
      x: (gVec[0] + rnd() * noise) * G_CMS2,
      y: (gVec[1] + rnd() * noise) * G_CMS2,
      z: (gVec[2] + rnd() * noise) * G_CMS2,
    })
  }
  function scale(dir, g) {
    const n = Math.hypot(dir[0], dir[1], dir[2]) || 1
    return [(dir[0] / n) * g, (dir[1] / n) * g, (dir[2] / n) * g]
  }
  const count = (ms) => Math.max(1, Math.round(ms / dt))

  const b = {
    samples,
    /** Steady 1 g along `dir` with small noise (standing / sitting / lying). */
    rest(ms, { dir = UP, noise = 0.03 } = {}) {
      for (let i = 0; i < count(ms); i++) pushG(scale(dir, 1), noise)
      return b
    },
    /** Near-weightless phase. */
    freefall(ms, { g = 0.25, dir = UP } = {}) {
      for (let i = 0; i < count(ms); i++) pushG(scale(dir, g), 0.05)
      return b
    },
    /** Short high-magnitude shock. */
    impact(ms, { g = 3.5, dir = SIDE } = {}) {
      for (let i = 0; i < count(ms); i++) pushG(scale(dir, g), 0.2)
      return b
    },
    /** Oscillating magnitude between min and max g (walking, running, flailing). */
    motion(ms, { min = 0.4, max = 2.2, periodMs = 400, dir = UP } = {}) {
      const n = count(ms)
      for (let i = 0; i < n; i++) {
        const phase = ((i * dt) / periodMs) * 2 * Math.PI
        const g = min + ((max - min) * (1 + Math.sin(phase))) / 2
        pushG(scale(dir, g), 0.05)
      }
      return b
    },
    /** One-sample spike (a clap or a knock on the table). */
    spike(g = 3.0, dir = SIDE) {
      pushG(scale(dir, g), 0)
      return b
    },
  }
  return b
}

/** A canonical forward fall: standing → drop → hit → thrash → lie still. */
export function forwardFall(opts = {}) {
  return trace(opts)
    .rest(2000)
    .freefall(300)
    .impact(80, { g: 3.2 })
    .motion(500, { min: 0.6, max: 1.8, periodMs: 150 }) // flailing inside stillDelayMs
    .rest(3000, { dir: SIDE })
}
