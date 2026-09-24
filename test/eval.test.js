import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  traceFromFixture,
  traceFromRecording,
  evaluate,
  isHit,
  wilson,
  wornHoursFrom,
  detectorFactory,
} from '../tools/eval-lib.js'
import { createCandidateRecorder } from '../utils/candidate-recorder.js'
import { trace, SIDE } from './helpers/synth.js'

const v1 = detectorFactory('v1', 'normal')

/** A real recorder window around a synthetic fall that v1 detects, as the watch would upload it. */
function recordedFall({ keep = 'sampled' } = {}) {
  const out = []
  const rec = createCandidateRecorder({}, { random: () => 0, onRecording: (r) => out.push(r) })
  const samples = trace().rest(4000).freefall(300).impact(80, { g: 3.2 }).rest(12000, { dir: SIDE }).samples
  let t = 1_758_000_000_000
  for (const s of samples) rec.pushAccel((t += s.dt), s.x, s.y, s.z)
  assert.equal(out.length, 1)
  return { ...out[0], keep }
}

test('fixtures become traces labelled by file name, with cumulative times', () => {
  const tr = traceFromFixture('fall_x.json', [
    { dt: 20, x: 1, y: 2, z: 3 },
    { dt: 20, x: 4, y: 5, z: 6 },
  ])
  assert.equal(tr.label, 'fall')
  assert.deepEqual(tr.samples.map((s) => s.t), [20, 40])
  assert.equal(traceFromFixture('adl_clap.json', []).label, 'adl')
})

test('recordings map to labels: staged by activity, everyday by the wearer\'s answer', () => {
  const staged = traceFromRecording({ kind: 'staged', id: 's1', t0: 1000, fall: true, activity: 'fall_forward', accel: [[0, 1, 2, 3], [20, 4, 5, 6]] })
  assert.equal(staged.label, 'fall')
  assert.equal(staged.impactT, null)
  assert.deepEqual(staged.samples.map((s) => s.t), [1000, 1020])

  const everyday = traceFromRecording({ kind: 'candidate', id: 'c1', t0: 5000, keep: 'sampled', weight: 10, accel: [], label: null })
  assert.equal(everyday.label, 'everyday')
  assert.equal(everyday.weight, 10)
  assert.equal(everyday.impactT, 5000)

  const confirmed = traceFromRecording({ kind: 'candidate', id: 'c2', t0: 5000, accel: [], label: { outcome: 'ok', fell: true } })
  assert.equal(confirmed.label, 'fall')

  assert.equal(traceFromRecording({ kind: 'candidate', t0: 0, accel: [], label: { simulated: true } }), null)
  assert.equal(traceFromRecording({ kind: 'summary', date: '20260924' }), null)
})

test('v1 on the synthetic fixtures: every fall found, no false alarms', () => {
  const dir = join(process.cwd(), 'test', 'fixtures')
  const traces = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => traceFromFixture(f, JSON.parse(readFileSync(join(dir, f), 'utf8'))))
  const r = evaluate(traces, v1)
  assert.equal(r.falls.recall, 1)
  assert.equal(r.adl.specificity, 1)
  assert.equal(r.everyday.falseAlarmsPerDay, null) // no worn hours without day summaries
})

test('everyday alarms are weighted by the sampling weight and scaled to 16 waking hours', () => {
  const tr = traceFromRecording(recordedFall())
  const r = evaluate([tr], v1, { wornHours: 16 })
  assert.equal(r.everyday.alarms, 1)
  assert.equal(r.everyday.weightedAlarms, 10)
  assert.equal(r.everyday.falseAlarmsPerDay, 10)
})

test('an alarm for a neighbouring impact is not counted in this window', () => {
  const rec = recordedFall()
  const neighbour = traceFromRecording({ ...rec, t0: rec.t0 - 2000, accel: rec.accel.map(([dt, ...v]) => [dt + 2000, ...v]) })
  assert.equal(evaluate([neighbour], v1, { wornHours: 16 }).everyday.alarms, 0)
})

test('a confirmed real fall is detected with its latency', () => {
  const tr = traceFromRecording({ ...recordedFall(), label: { fell: true } })
  const r = evaluate([tr], v1)
  assert.equal(r.falls.detected, 1)
  assert.ok(r.latencyMs.median >= 2900 && r.latencyMs.median <= 3500, `latency ${r.latencyMs.median}`)
})

test('hit windows depend on the alert kind', () => {
  const tr = { impactT: 1000 }
  assert.equal(isHit(tr, { at: 4000, kind: 'impact' }), true)
  assert.equal(isHit(tr, { at: 20000, kind: 'impact' }), false)
  assert.equal(isHit(tr, { at: 30000, kind: 'long_lie' }), true)
  assert.equal(isHit({ impactT: null }, { at: 99999 }), true)
})

test('Wilson interval, worn hours and detector names', () => {
  const [lo, hi] = wilson(5, 10)
  assert.ok(Math.abs(lo - 0.2366) < 1e-3 && Math.abs(hi - 0.7634) < 1e-3)
  assert.deepEqual(wilson(0, 0), [0, 1])
  assert.equal(wilson(10, 10)[1], 1)
  assert.equal(
    wornHoursFrom([
      { date: 'a', wornMs: 3600000 },
      { date: 'a', wornMs: 7200000 },
      { date: 'b', wornMs: 3600000 },
    ]),
    3,
  )
  assert.throws(() => detectorFactory('v2', 'normal'), /only v1/)
  assert.throws(() => detectorFactory('v1', 'max'), /unknown preset/)
})
