import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addAlert, summarizeAlerts, formatTime, MAX_ALERTS } from '../utils/alert-log.js'

// Local times, so "today" means the same thing as on the watch.
const at = (day, h, m = 0) => new Date(2026, 8, day, h, m).getTime()

test('addAlert keeps the detector numbers, rounded, newest last', () => {
  let list = addAlert(undefined, { peakG: 3.14159, freefallMs: 287.6, stillStd: 0.01 }, at(24, 9, 5))
  list = addAlert(list, {}, at(24, 10))
  assert.deepEqual(list, [
    { t: at(24, 9, 5), peakG: 3.14, freefallMs: 288 },
    { t: at(24, 10), peakG: 0, freefallMs: 0 },
  ])
})

test('addAlert keeps only the newest MAX_ALERTS', () => {
  let list = []
  for (let i = 0; i < MAX_ALERTS + 5; i++) list = addAlert(list, { peakG: 3 }, at(24, 0, i))
  assert.equal(list.length, MAX_ALERTS)
  assert.equal(list[0].t, at(24, 0, 5))
})

test('summarizeAlerts counts alerts since local midnight and returns the newest', () => {
  const list = [{ t: at(23, 23, 50) }, { t: at(24, 0, 10) }, { t: at(24, 14, 32) }]
  assert.deepEqual(summarizeAlerts(list, at(24, 18)), { today: 2, last: { t: at(24, 14, 32) } })
  assert.equal(summarizeAlerts(list, at(25, 8)).today, 0) // a new day starts at zero
  assert.deepEqual(summarizeAlerts(null, at(24, 18)), { today: 0, last: null })
})

test('formatTime follows the watch 12/24-hour setting', () => {
  assert.equal(formatTime(at(24, 14, 5), false), '14:05')
  assert.equal(formatTime(at(24, 14, 5), true), '2:05')
  assert.equal(formatTime(at(24, 0, 30), true), '12:30')
  assert.equal(formatTime(at(24, 9, 0), false), '9:00')
})
