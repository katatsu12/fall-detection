import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createImpactTrigger } from '../utils/impact-trigger.js'

/** Feed [t, g] pairs; collect every candidate, including one still open at the end. */
function run(pairs, options) {
  const trig = createImpactTrigger(options)
  const out = []
  for (const [t, g] of pairs) {
    const c = trig.push(t, g)
    if (c) out.push(c)
  }
  const last = trig.flush()
  if (last) out.push(last)
  return out
}

const quiet = (from, to, step = 20) => {
  const out = []
  for (let t = from; t <= to; t += step) out.push([t, 1])
  return out
}

test('nothing below the trigger level', () => {
  assert.deepEqual(run([...quiet(0, 2000), [2020, 1.79], ...quiet(2040, 4000)]), [])
})

test('one spike gives one candidate at the spike, once the merge window has passed', () => {
  const trig = createImpactTrigger()
  for (const [t, g] of quiet(0, 1000)) assert.equal(trig.push(t, g), null)
  assert.equal(trig.push(1020, 3.1), null)
  assert.equal(trig.isOpen(), true)
  assert.equal(trig.push(2000, 1), null) // 980 ms after the crossing: still merging
  assert.deepEqual(trig.push(2040, 1), { t0: 1020, peakG: 3.1 })
  assert.equal(trig.isOpen(), false)
})

test('t0 is the highest sample within the merge window', () => {
  const out = run([...quiet(0, 1000), [1020, 2.0], [1040, 1.2], [1300, 3.4], [1320, 2.2], ...quiet(1340, 3000)])
  assert.deepEqual(out, [{ t0: 1300, peakG: 3.4 }])
})

test('a crossing after the merge window opens a second candidate', () => {
  const out = run([...quiet(0, 1000), [1020, 2.5], ...quiet(1040, 2400), [2420, 3.0], ...quiet(2440, 5000)])
  assert.deepEqual(out, [
    { t0: 1020, peakG: 2.5 },
    { t0: 2420, peakG: 3.0 },
  ])
})

test('the sample that closes a window can open the next one', () => {
  const out = run([[0, 2.0], [1001, 2.5], ...quiet(1021, 3000)], { mergeMs: 1000 })
  assert.deepEqual(out, [
    { t0: 0, peakG: 2.0 },
    { t0: 1001, peakG: 2.5 },
  ])
})

test('options override the defaults; reset() drops an open window', () => {
  assert.deepEqual(run([[0, 1], [20, 2.2], [40, 1]], { triggerG: 2.5 }), [])
  const trig = createImpactTrigger()
  trig.push(0, 3)
  trig.reset()
  assert.equal(trig.flush(), null)
  assert.equal(trig.getConfig().triggerG, 1.8)
})
