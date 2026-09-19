import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRaiseDetector } from '../utils/raise-detector.js'

const G = 980
// Feed `ms` of a fixed orientation at 50 Hz; returns how many raises fired.
function feed(d, t0, ms, [x, y, z]) {
  let fired = 0
  for (let t = t0; t < t0 + ms; t += 20) if (d.push(t, x, y, z)) fired++
  return fired
}
const UP = [0, 0, G]
const HANGING = [G, 0, 0] // arm down: gravity along x
const TILTED = [0.7 * G, 0, 0.7 * G] // z/|a| ≈ 0.7: between the two thresholds

test('a watch lying face up never fires', () => {
  const d = createRaiseDetector()
  assert.equal(feed(d, 0, 10000, UP), 0)
  assert.equal(d.isArmed(), false)
})

test('arm hanging then raised fires exactly once', () => {
  const d = createRaiseDetector()
  assert.equal(feed(d, 0, 2000, HANGING), 0)
  assert.equal(d.isArmed(), true)
  assert.equal(feed(d, 2000, 1000, UP), 1)
  assert.equal(d.isArmed(), false)
  assert.equal(feed(d, 3000, 5000, UP), 0) // staying up does not re-fire
})

test('a brief face-up blip shorter than holdMs does not fire', () => {
  const d = createRaiseDetector()
  feed(d, 0, 2000, HANGING)
  assert.equal(feed(d, 2000, 200, UP), 0)
  assert.equal(feed(d, 2200, 1000, HANGING), 0)
  assert.equal(feed(d, 3200, 1000, UP), 1)
})

test('an in-between orientation neither arms nor fires', () => {
  const d = createRaiseDetector()
  assert.equal(feed(d, 0, 3000, TILTED), 0)
  assert.equal(d.isArmed(), false)
  assert.equal(feed(d, 3000, 1000, UP), 0)
})

test('re-arms after firing once the arm drops again', () => {
  const d = createRaiseDetector()
  feed(d, 0, 1000, HANGING)
  assert.equal(feed(d, 1000, 1000, UP), 1)
  feed(d, 2000, 1000, HANGING)
  assert.equal(feed(d, 3000, 1000, UP), 1)
})

test('reset() disarms', () => {
  const d = createRaiseDetector()
  feed(d, 0, 1000, HANGING)
  d.reset()
  assert.equal(feed(d, 1000, 1000, UP), 0)
})
