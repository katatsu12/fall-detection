import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRingBuffer } from '../utils/ring-buffer.js'

const T0 = 1_758_000_000_000 // a Date.now()-sized time: must survive the Uint32 offsets exactly

function fill(buf, n, { dt = 20, t0 = T0 } = {}) {
  for (let i = 0; i < n; i++) buf.push(t0 + i * dt, i, -i, i * 2)
}

test('keeps samples in order and returns absolute times exactly', () => {
  const b = createRingBuffer({ channels: 3, spanMs: 10_000 })
  fill(b, 5)
  assert.deepEqual(
    b.slice(-Infinity, Infinity).map((r) => r[0]),
    [0, 1, 2, 3, 4].map((i) => T0 + i * 20),
  )
  assert.deepEqual(b.slice(T0 + 20, T0 + 60), [
    [T0 + 20, 1, -1, 2],
    [T0 + 40, 2, -2, 4],
    [T0 + 60, 3, -3, 6],
  ])
  assert.equal(b.oldestTime(), T0)
  assert.equal(b.newestTime(), T0 + 80)
  assert.equal(b.countIn(T0 + 20, T0 + 60), 3)
})

test('overwrites the oldest sample once it holds spanMs of history', () => {
  const b = createRingBuffer({ channels: 1, spanMs: 50, capacity: 4 })
  fill(b, 10) // 20 ms apart: 4 slots already span 60 ms ≥ 50 ms, so no growth
  assert.equal(b.capacity(), 4)
  assert.equal(b.size(), 4)
  assert.deepEqual(
    b.slice(-Infinity, Infinity).map((r) => r[1]),
    [6, 7, 8, 9],
  )
})

test('grows instead of shortening the window when the rate is higher than expected', () => {
  const b = createRingBuffer({ channels: 2, spanMs: 1000, capacity: 4 })
  fill(b, 40, { dt: 10 }) // 390 ms of data — less than spanMs, so nothing may be dropped
  assert.equal(b.size(), 40)
  assert.ok(b.capacity() >= 40)
  assert.deepEqual(b.slice(T0 + 100, T0 + 120), [
    [T0 + 100, 10, -10],
    [T0 + 110, 11, -11],
    [T0 + 120, 12, -12],
  ])
})

test('stops growing at maxCapacity', () => {
  const b = createRingBuffer({ channels: 1, spanMs: 1e9, capacity: 4, maxCapacity: 8 })
  fill(b, 20)
  assert.equal(b.capacity(), 8)
  assert.equal(b.size(), 8)
  assert.equal(b.slice(-Infinity, Infinity)[0][1], 12)
})

test('rejects samples older than the newest one, accepts equal times', () => {
  const b = createRingBuffer({ channels: 1, spanMs: 1000 })
  assert.equal(b.push(T0 + 100, 1), true)
  assert.equal(b.push(T0 + 50, 2), false)
  assert.equal(b.push(T0 + 100, 3), true)
  assert.equal(b.push(NaN, 4), false)
  assert.deepEqual(
    b.slice(-Infinity, Infinity).map((r) => r[1]),
    [1, 3],
  )
})

test('forEach reuses its row array and clear() empties the buffer', () => {
  const b = createRingBuffer({ channels: 2, spanMs: 1000 })
  fill(b, 3)
  const rows = []
  b.forEach(-Infinity, Infinity, (t, row) => rows.push(row))
  assert.equal(rows[0], rows[2])
  b.clear()
  assert.equal(b.size(), 0)
  assert.ok(Number.isNaN(b.oldestTime()))
  assert.equal(b.push(T0 - 1_000_000, 1, 1), true) // after clear, any time is accepted again
})
