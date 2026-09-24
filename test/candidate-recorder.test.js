import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createCandidateRecorder, KEEP } from '../utils/candidate-recorder.js'
import { createFallDetector } from '../utils/fall-detector.js'
import { trace, forwardFall, SIDE } from './helpers/synth.js'

const T0 = 1_758_000_000_000

/** Recorder with collected output; `random` defaults to "never sample". */
function setup(options = {}, random = () => 0.99) {
  const recordings = []
  const summaries = []
  const rec = createCandidateRecorder(options, {
    random,
    onRecording: (r) => recordings.push(r),
    onSummary: (s) => summaries.push(s),
  })
  return { rec, recordings, summaries }
}

/** forwardFall() with 4 s of standing first, so a full 3 s pre-window exists, and `after` ms lying still. */
const longFall = (after) =>
  trace()
    .rest(4000)
    .freefall(300)
    .impact(80, { g: 3.2 })
    .motion(500, { min: 0.6, max: 1.8, periodMs: 150 })
    .rest(after, { dir: SIDE })

/** Feed a synth trace; optionally run the real v1 detector alongside, as Home does. */
function feed(rec, samples, { v1 = false, t0 = T0, gyro = false } = {}) {
  const det = v1 ? createFallDetector() : null
  if (det) det.onCandidate((c) => rec.noteV1(c))
  let t = t0
  for (const s of samples) {
    t += s.dt
    rec.pushAccel(t, s.x, s.y, s.z)
    if (gyro) rec.pushGyro(t, 12.34, -5, 0.05)
    if (det) det.push(t, s.x, s.y, s.z)
  }
  return t
}

test('a fall v1 alerts on is kept as v1_fall with 3 s before and 10 s after the peak', () => {
  const { rec, recordings, summaries } = setup()
  feed(rec, longFall(12000).samples, { v1: true, gyro: true })
  assert.equal(recordings.length, 1)
  const r = recordings[0]
  assert.equal(r.kind, 'candidate')
  assert.equal(r.keep, KEEP.V1_FALL)
  assert.equal(r.weight, 1)
  assert.equal(r.truncated, false)
  assert.ok(r.peakG >= 3.0 && r.peakG <= 3.6, `peakG ${r.peakG}`)
  assert.equal(r.v1.fall, true)
  assert.equal(r.accel[0][0], -3000)
  assert.equal(r.accel[r.accel.length - 1][0], 10000)
  assert.equal(r.accel.length, 651) // 13 s at 50 Hz, both ends included
  assert.deepEqual(r.gyro[0].slice(1), [12.3, -5, 0.1])
  assert.ok(r.accel.every((row) => row.every(Number.isInteger)))
  assert.deepEqual(summaries.map((s) => [s.v1, s.keep, s.weight]), [['fall', KEEP.V1_FALL, 1]])
  assert.equal(rec.stats().v1Falls, 1)
})

test('a candidate v1 evaluated and rejected is kept as a near-miss', () => {
  const { rec, recordings } = setup()
  const running = trace({ seed: 5 })
    .motion(3000, { min: 0.6, max: 1.6 })
    .freefall(100, { g: 0.4 })
    .impact(40, { g: 2.8 })
    .motion(12000, { min: 0.6, max: 1.6 })
  feed(rec, running.samples, { v1: true })
  assert.equal(recordings.length, 1)
  assert.equal(recordings[0].keep, KEEP.V1_REJECTED)
  assert.deepEqual(recordings[0].v1.reasons, ['not_still'])
})

test('plain candidates are sampled: kept ones carry weight 1 / sampleRate, all get a summary', () => {
  const clap = trace({ seed: 3 }).rest(3000).spike(3.5).rest(12000).samples

  const kept = setup({}, () => 0.05)
  feed(kept.rec, clap)
  assert.equal(kept.recordings.length, 1)
  assert.equal(kept.recordings[0].keep, KEEP.SAMPLED)
  assert.equal(kept.recordings[0].weight, 10)

  const skipped = setup({}, () => 0.5)
  feed(skipped.rec, clap)
  assert.equal(skipped.recordings.length, 0)
  assert.deepEqual(skipped.summaries.map((s) => [s.v1, s.keep, s.weight]), [[null, null, 0]])
})

test('overlapping impacts each get their own candidate and window', () => {
  const { rec, recordings } = setup({}, () => 0)
  const two = trace().rest(3000).spike(2.5).rest(2000).spike(3.0).rest(12000).samples
  feed(rec, two)
  assert.equal(recordings.length, 2)
  assert.equal(recordings[1].t0 - recordings[0].t0, 2020)
  assert.deepEqual(recordings.map((r) => r.peakG), [2.5, 3])
})

test('flush() writes pending candidates truncated and drops ones with too little data', () => {
  const { rec, recordings } = setup()
  const tEnd = feed(rec, forwardFall().samples, { v1: true }) // ends ~3.5 s after the impact
  const written = rec.flush()
  assert.equal(written.length, 1)
  assert.equal(written[0].keep, KEEP.V1_FALL)
  assert.equal(recordings[0].truncated, true)
  assert.equal(recordings[0].postMs, tEnd - recordings[0].t0)

  const short = setup({}, () => 0)
  feed(short.rec, trace().rest(3000).spike(3).rest(900).samples)
  assert.deepEqual(short.rec.flush(), [])
  assert.equal(short.recordings.length, 0)
})

test('taking the watch off marks pending candidates and keeps them as wear_off', () => {
  const { rec, recordings } = setup()
  const t = feed(rec, trace().rest(3000).spike(3).rest(1000).samples)
  rec.setWorn(false, t)
  feed(rec, trace().rest(10000).samples, { t0: t })
  assert.equal(recordings.length, 1)
  assert.equal(recordings[0].keep, KEEP.WEAR_OFF)
  assert.ok(Math.abs(recordings[0].wornOffAt - 1000) <= 20, `wornOffAt ${recordings[0].wornOffAt}`)
})

test('no new candidates while the watch is off', () => {
  const { rec, summaries } = setup({}, () => 0)
  rec.setWorn(false, T0)
  feed(rec, trace().rest(1000).spike(3).rest(12000).samples)
  assert.equal(summaries.length, 0)
})

test('a staged session switches candidates off but capture() still records the window', () => {
  const { rec, recordings, summaries } = setup({}, () => 0)
  rec.setCandidates(false)
  const t = feed(rec, trace().rest(2000).spike(3).rest(14000).samples, { gyro: true })
  assert.equal(summaries.length, 0)
  assert.equal(recordings.length, 0)
  const cap = rec.capture(t - 15000, t, { activity: 'fall_forward', fall: true, trial: 3, session: 's1' })
  assert.equal(cap.kind, 'staged')
  assert.equal(cap.activity, 'fall_forward')
  assert.equal(cap.accel[0][0], 0)
  assert.equal(cap.accel[cap.accel.length - 1][0], 15000)
  assert.equal(cap.postMs, 15000)
  assert.equal(cap.gyro.length, cap.accel.length)
})

test('a v1 note far from every pending candidate is counted as unmatched', () => {
  const { rec } = setup()
  feed(rec, trace().rest(3000).spike(3).rest(2000).samples)
  assert.equal(rec.noteV1({ t: T0 + 100, fall: true }), false)
  assert.equal(rec.stats().v1Unmatched, 1)
  assert.equal(rec.stats().pending, 1)
})
