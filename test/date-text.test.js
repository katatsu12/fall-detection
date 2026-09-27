import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatDate } from '../utils/date-text.js'

// As in page/i18n/en-US.po.
const EN = '{weekday}, {month} {day}'
const WEEKDAYS = 'Mon,Tue,Wed,Thu,Fri,Sat,Sun'.split(',')
const MONTHS = 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'.split(',')

test('uses the watch numbering: weekday 1 is Monday, month 1 is January', () => {
  // Saturday 26 September 2026, as @zos/sensor Time reports it.
  assert.equal(formatDate(EN, WEEKDAYS, MONTHS, { weekday: 6, day: 26, month: 9 }), 'Sat, Sep 26')
  assert.equal(formatDate(EN, WEEKDAYS, MONTHS, { weekday: 1, day: 1, month: 1 }), 'Mon, Jan 1')
  assert.equal(formatDate(EN, WEEKDAYS, MONTHS, { weekday: 7, day: 31, month: 12 }), 'Sun, Dec 31')
})

test('the template sets the word order', () => {
  assert.equal(formatDate('{weekday} {day} {month}', WEEKDAYS, MONTHS, { weekday: 6, day: 26, month: 9 }), 'Sat 26 Sep')
})

test('an out-of-range number leaves its name empty instead of throwing', () => {
  assert.equal(formatDate(EN, WEEKDAYS, MONTHS, { weekday: 0, day: 5, month: 13 }), ',  5')
})
