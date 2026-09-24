import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRateMeter } from '../utils/rate-meter.js'

test('a steady 50 Hz stream reads as 50 Hz with 20 ms intervals', () => {
  const m = createRateMeter(0)
  for (let t = 20; t <= 5000; t += 20) m.push(t)
  const r = m.read(5000)
  assert.equal(r.n, 250)
  assert.equal(r.hz, 50)
  assert.equal(r.dtMedian, 20)
  assert.equal(r.dtP95, 20)
  assert.equal(r.dtMax, 20)
})

test('jitter shows up in p95 and max; each read starts a new period', () => {
  const m = createRateMeter(0)
  let t = 0
  for (let i = 0; i < 100; i++) {
    t += i % 10 === 9 ? 60 : 20 // every tenth callback arrives late
    m.push(t)
  }
  const r = m.read(t)
  assert.equal(r.dtMedian, 20)
  assert.equal(r.dtP95, 60)
  assert.equal(r.dtMax, 60)
  const empty = m.read(t + 1000)
  assert.equal(empty.n, 0)
  assert.equal(empty.hz, 0)
})

test('without a start time the first sample starts the period', () => {
  const m = createRateMeter()
  for (let t = 1000; t <= 2000; t += 40) m.push(t)
  assert.equal(Math.round(m.read(2000).hz), 26) // 26 samples over 1 s
})
