import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  allDayOn,
  mergeSensitivity,
  settingsOf,
  storeSensitivity,
  SENSITIVITY,
  SS_ALL_DAY,
  SS_SENSITIVITY,
  SS_SENSITIVITY_AT,
} from '../shared/settings.js'

// settingsStorage stand-in: strings in, strings (or undefined) out.
const storage = (values = {}) => ({
  values,
  getItem: (k) => values[k],
  setItem: (k, v) => (values[k] = String(v)),
})

test('All-day mode is on until the phone switch says "0"', () => {
  assert.equal(allDayOn(undefined), true) // never touched: a purchase switches it on at once
  assert.equal(allDayOn(null), true)
  assert.equal(allDayOn('1'), true)
  assert.equal(allDayOn('0'), false)
})

test('settingsOf tells the watch what the settings page shows', () => {
  const s = storage()
  assert.deepEqual(settingsOf(s), { allDay: true, sensitivity: null, sensitivityAt: 0 }) // nothing picked here yet
  s.setItem(SS_ALL_DAY, '0') // the page's flip() turning All-day mode off
  s.setItem(SS_SENSITIVITY, SENSITIVITY.WATCHFUL) // the page's pick(): level, then time
  s.setItem(SS_SENSITIVITY_AT, 1000)
  assert.deepEqual(settingsOf(s), { allDay: false, sensitivity: 'watchful', sensitivityAt: 1000 })
  s.setItem(SS_SENSITIVITY, 'loud') // not a level: reported as never picked
  assert.equal(settingsOf(s).sensitivity, null)
})

test('mergeSensitivity: the later pick wins, on either side', () => {
  const phone = (sensitivity, sensitivityAt) => ({ allDay: true, sensitivity, sensitivityAt })
  // picked on the phone after the watch's last pick → the watch adopts it
  assert.deepEqual(mergeSensitivity({ sensitivity: 'balanced', at: 100 }, phone('relaxed', 200)), { adopt: 'relaxed', at: 200 })
  // picked on the watch while the phone was away → the phone is told
  assert.deepEqual(mergeSensitivity({ sensitivity: 'watchful', at: 300 }, phone('relaxed', 200)), {
    tell: { sensitivity: 'watchful', sensitivityAt: 300 },
  })
  assert.deepEqual(mergeSensitivity({ sensitivity: 'watchful', at: 300 }, phone(null, 0)), { tell: { sensitivity: 'watchful', sensitivityAt: 300 } })
  // same pick on both (the phone echoing the watch's own save) → nothing to do
  assert.deepEqual(mergeSensitivity({ sensitivity: 'watchful', at: 300 }, phone('watchful', 300)), {})
  // never picked anywhere → nothing to do, the watch keeps its default
  assert.deepEqual(mergeSensitivity({ sensitivity: 'balanced', at: 0 }, phone(null, 0)), {})
  // garbage from the phone is ignored
  assert.deepEqual(mergeSensitivity({ sensitivity: 'balanced', at: 0 }, phone('loud', 999)), {})
  assert.deepEqual(mergeSensitivity({ sensitivity: 'balanced', at: 0 }, null), {})
})

test('storeSensitivity keeps only later, valid picks from the watch', () => {
  const s = storage({ [SS_SENSITIVITY]: 'relaxed', [SS_SENSITIVITY_AT]: '200' })
  assert.equal(storeSensitivity(s, { sensitivity: 'watchful', sensitivityAt: 100 }), false) // older than the phone's
  assert.equal(storeSensitivity(s, { sensitivity: 'watchful', sensitivityAt: 200 }), false) // same time: already known
  assert.equal(storeSensitivity(s, { sensitivity: 'loud', sensitivityAt: 900 }), false)
  assert.equal(settingsOf(s).sensitivity, 'relaxed')
  assert.equal(storeSensitivity(s, { sensitivity: 'watchful', sensitivityAt: 300 }), true)
  assert.deepEqual([settingsOf(s).sensitivity, settingsOf(s).sensitivityAt], ['watchful', 300])
})

test('a pick on the watch while the phone is away reaches the phone on the next sync', () => {
  const phone = storage({ [SS_SENSITIVITY]: 'relaxed', [SS_SENSITIVITY_AT]: '200' })
  const watch = { sensitivity: 'watchful', at: 500 } // picked on the watch, FG_SAVE never arrived
  const { tell } = mergeSensitivity(watch, settingsOf(phone)) // app.js on the next launch
  assert.ok(tell)
  assert.equal(storeSensitivity(phone, tell), true) // the phone side's FG_SAVE
  assert.deepEqual(mergeSensitivity(watch, settingsOf(phone)), {}) // agreed; the echo is a no-op
})
