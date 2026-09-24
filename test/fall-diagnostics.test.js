import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDiagnostics, diagText } from '../utils/fall-diagnostics.js'
import { createFallDetector, magnitudeG, PRESETS } from '../utils/fall-detector.js'
import { trace, SIDE } from './helpers/synth.js'

/** Feed a synth trace through a real detector and the diagnostics, as Home does. */
function run(samples, { preset = PRESETS.normal, worn = true } = {}) {
  const det = createFallDetector(preset)
  const done = []
  const diag = createDiagnostics({}, (a) => done.push({ ...a }))
  det.onCandidate((c) => diag.noteCandidate(c))
  let t = 0
  for (const s of samples) {
    t += s.dt
    const g = magnitudeG(s.x, s.y, s.z)
    if (!worn) {
      diag.push(t, g, 'OFF', 'OFF')
      continue
    }
    const before = det.getState()
    det.push(t, s.x, s.y, s.z)
    diag.push(t, g, before, det.getState())
  }
  return { latest: diag.latest(t), done, end: t, diag }
}

test('a fall v1 alerts on reads as ALERT with its hit and drop', () => {
  const { latest } = run(trace().rest(2000).freefall(300, { g: 0.25 }).impact(80, { g: 3.2 }).rest(4000, { dir: SIDE }).samples)
  assert.equal(latest.verdict, 'fall')
  assert.ok(latest.peakG > 3 && latest.peakG < 3.5, `peak ${latest.peakG}`)
  assert.ok(latest.dipG < 0.35, `drop ${latest.dipG}`)
  assert.match(diagText(latest), /^hit 3\.\d g · drop 0\.\d\d g · ALERT$/)
})

test('getting up within the stillness window reads as "moved"', () => {
  const { latest } = run(
    trace().rest(2000).freefall(300).impact(80).rest(800, { dir: SIDE }).motion(3000, { min: 0.7, max: 1.6 }).samples,
  )
  assert.equal(latest.verdict, 'not_still')
  assert.match(diagText(latest), /· moved$/)
})

test('a hit with no free fall before it reads as "no drop"', () => {
  const { latest } = run(trace().rest(2000).spike(3.5).rest(3000).samples)
  assert.equal(latest.verdict, 'no_drop')
  assert.ok(latest.dipG > 0.9)
})

test('a free fall followed by a soft hit reads as "no hit"', () => {
  const { latest } = run(trace().rest(2000).freefall(300, { g: 0.3 }).impact(80, { g: 1.8 }).rest(4000).samples, {
    preset: PRESETS.high, // Watchful still needs 2.0 g
  })
  assert.equal(latest.verdict, 'no_hit')
  assert.ok(latest.peakG < 2)
})

test('jolts while the watch is off the wrist read as "off wrist"', () => {
  const { latest } = run(trace().rest(1000).freefall(300).impact(80).rest(3000).samples, { worn: false })
  assert.equal(latest.verdict, 'off_wrist')
})

test('the strongest attempt of the last 30 s wins, then it expires', () => {
  const { diag, end } = run(trace().rest(1000).spike(1.6).rest(2000).spike(2.9).rest(2000).spike(1.7).rest(1000).samples)
  assert.equal(diag.latest(end).peakG.toFixed(1), '2.9')
  assert.equal(diag.latest(end + 31000), null)
})

test('finished attempts are reported once, pending ones when v1 decides', () => {
  const { done } = run(trace().rest(2000).spike(3.0).rest(1500).freefall(300).impact(80, { g: 3.2 }).rest(4000, { dir: SIDE }).samples)
  assert.deepEqual(
    done.map((a) => a.verdict),
    ['no_drop', 'fall'],
  )
})
