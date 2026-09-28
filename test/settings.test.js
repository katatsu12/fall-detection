import { test } from 'node:test'
import assert from 'node:assert/strict'
import { allDayOn, settingsOf, SS_ALL_DAY } from '../shared/settings.js'

// settingsStorage stand-in: strings in, strings (or undefined) out.
const storage = (values = {}) => ({
  getItem: (k) => values[k],
  setItem: (k, v) => (values[k] = String(v)),
})

test('All-day mode is on until the phone switch says "0"', () => {
  assert.equal(allDayOn(undefined), true) // never touched: a purchase switches it on at once
  assert.equal(allDayOn(null), true)
  assert.equal(allDayOn('1'), true)
  assert.equal(allDayOn('0'), false)
})

test('settingsOf tells the watch what the switch shows, after each flip', () => {
  const s = storage()
  assert.deepEqual(settingsOf(s), { allDay: true })
  s.setItem(SS_ALL_DAY, '0') // the settings page's flip() turning it off…
  assert.deepEqual(settingsOf(s), { allDay: false })
  s.setItem(SS_ALL_DAY, '1') // …and on again
  assert.deepEqual(settingsOf(s), { allDay: true })
})
