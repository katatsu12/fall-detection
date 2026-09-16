import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createFallDetector,
  replay,
  magnitudeG,
  G_CMS2,
  PRESETS,
  STATE,
} from '../utils/fall-detector.js'
import { trace, forwardFall, SIDE, UP } from './helpers/synth.js'

test('magnitudeG converts cm/s² to g', () => {
  assert.equal(magnitudeG(0, 0, G_CMS2), 1)
  assert.ok(Math.abs(magnitudeG(G_CMS2, G_CMS2, 0) - Math.SQRT2) < 1e-9)
})

test('detects a forward fall exactly once with a sensible payload', () => {
  const d = createFallDetector()
  const events = replay(d, forwardFall().samples)
  assert.equal(events.length, 1)
  const [e] = events
  assert.ok(e.fall)
  assert.deepEqual(e.reasons, [])
  assert.ok(e.peakG >= 3.0 && e.peakG <= 3.6, `peakG ${e.peakG}`)
  assert.ok(e.freefallMs >= 250 && e.freefallMs <= 350, `freefallMs ${e.freefallMs}`)
  assert.ok(e.stillStd < 0.15, `stillStd ${e.stillStd}`)
  assert.equal(d.getState(), STATE.IDLE)
})

test('works at a lower sample rate (25 Hz)', () => {
  const events = replay(createFallDetector(), forwardFall({ hz: 25 }).samples)
  assert.equal(events.length, 1)
})

test('cooldown suppresses a second event, but not one after the cooldown', () => {
  const d = createFallDetector({ cooldownMs: 10000 })
  const twoQuick = forwardFall().freefall(300).impact(80).rest(3000, { dir: SIDE }).samples
  assert.equal(replay(d, twoQuick).length, 1)

  d.reset()
  const twoSpaced = forwardFall().rest(12000, { dir: SIDE }).freefall(300).impact(80).rest(3000).samples
  assert.equal(replay(d, twoSpaced).length, 2)
})

test('a clap (impact with no free fall) never leaves IDLE', () => {
  const d = createFallDetector()
  const states = new Set()
  const t = trace().rest(1000).spike(3.5).spike(3.0).rest(3000)
  let time = 0
  for (const s of t.samples) {
    time += s.dt
    d.push(time, s.x, s.y, s.z)
    states.add(d.getState())
  }
  assert.deepEqual([...states], [STATE.IDLE])
})

test('sitting down hard (shallow dip, moderate bump) is ignored', () => {
  const samples = trace()
    .rest(1000)
    .freefall(200, { g: 0.75 }) // above freefallG
    .impact(80, { g: 2.0 })
    .rest(3000)
    .samples
  assert.equal(replay(createFallDetector(), samples).length, 0)
})

test('running: free fall + hard strike followed by continued motion is rejected as not_still', () => {
  const d = createFallDetector()
  const candidates = []
  d.onCandidate((c) => candidates.push(c))
  const samples = trace()
    .motion(1000, { min: 0.4, max: 2.0 })
    .freefall(100, { g: 0.4 })
    .impact(40, { g: 2.8 })
    .motion(4000, { min: 0.4, max: 2.0 })
    .samples
  assert.equal(replay(d, samples).length, 0)
  assert.ok(candidates.length >= 1)
  assert.ok(candidates.every((c) => !c.fall && c.reasons.includes('not_still')))
})

test('a fall followed by getting up within the still window is not reported', () => {
  const samples = trace()
    .rest(1000)
    .freefall(300)
    .impact(80)
    .rest(800, { dir: SIDE }) // starts to lie still…
    .motion(3000, { min: 0.7, max: 1.6 }) // …then gets up
    .samples
  assert.equal(replay(createFallDetector(), samples).length, 0)
})

test('free fall with no impact times out back to IDLE', () => {
  const d = createFallDetector({ impactWindowMs: 600 })
  const samples = trace().rest(500).freefall(900, { g: 0.3 }).rest(1000).samples
  assert.equal(replay(d, samples).length, 0)
  assert.equal(d.getState(), STATE.IDLE)
})

test('useAngle requires an orientation change between before and after', () => {
  const rotated = forwardFall().samples // UP before, SIDE after
  assert.equal(replay(createFallDetector({ useAngle: true }), rotated).length, 1)

  const notRotated = trace().rest(2000).freefall(300).impact(80).rest(3000, { dir: UP }).samples
  const d = createFallDetector({ useAngle: true })
  const candidates = []
  d.onCandidate((c) => candidates.push(c))
  assert.equal(replay(d, notRotated).length, 0)
  assert.equal(candidates.length, 1)
  assert.ok(candidates[0].reasons.includes('no_orientation_change'))
  assert.ok(candidates[0].angleDeg < 60)
})

test('minGyroDps requires rotation reported via pushGyro', () => {
  const samples = forwardFall().samples

  const noGyro = createFallDetector({ minGyroDps: 200 })
  const rejected = []
  noGyro.onCandidate((c) => rejected.push(c))
  assert.equal(replay(noGyro, samples).length, 0)
  assert.ok(rejected[0].reasons.includes('no_rotation'))

  const withGyro = createFallDetector({ minGyroDps: 200 })
  const events = []
  withGyro.onFall((e) => events.push(e))
  let t = 0
  for (const s of samples) {
    t += s.dt
    withGyro.push(t, s.x, s.y, s.z)
    if (withGyro.getState() === STATE.FREEFALL) withGyro.pushGyro(t, 250, 100, 50)
  }
  assert.equal(events.length, 1)
  assert.ok(events[0].gyroPeakDps > 200)
})

test('presets shift the impact threshold', () => {
  const softHit = trace().rest(1000).freefall(300).impact(80, { g: 2.7 }).rest(3000, { dir: SIDE }).samples
  assert.equal(replay(createFallDetector(PRESETS.normal), softHit).length, 1)
  assert.equal(replay(createFallDetector(PRESETS.low), softHit).length, 0) // impactG 3.0
  assert.equal(replay(createFallDetector(PRESETS.high), softHit).length, 1)
})

test('out-of-order or NaN timestamps are ignored', () => {
  const d = createFallDetector()
  d.push(1000, 0, 0, G_CMS2)
  assert.equal(d.push(500, 0, 0, 0), null) // would be free fall if accepted
  assert.equal(d.getState(), STATE.IDLE)
  assert.equal(d.push(NaN, 0, 0, 0), null)
  assert.equal(d.getState(), STATE.IDLE)
})

test('reset() abandons an in-progress detection', () => {
  const d = createFallDetector()
  let t = 0
  for (const s of trace().rest(500).freefall(200).impact(50).samples) {
    t += s.dt
    d.push(t, s.x, s.y, s.z)
  }
  assert.equal(d.getState(), STATE.IMPACT)
  d.reset()
  assert.equal(d.getState(), STATE.IDLE)
  assert.equal(replay(d, trace().rest(3000, { dir: SIDE }).samples).length, 0)
})

test('onFall / onCandidate return working unsubscribe functions', () => {
  const d = createFallDetector()
  let falls = 0
  let candidates = 0
  const offFall = d.onFall(() => falls++)
  const offCand = d.onCandidate(() => candidates++)
  replay(d, forwardFall().samples)
  assert.equal(falls, 1)
  assert.equal(candidates, 1)
  offFall()
  offCand()
  d.reset()
  replay(d, forwardFall().samples)
  assert.equal(falls, 1)
  assert.equal(candidates, 1)
})
