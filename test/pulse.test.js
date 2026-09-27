import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pulseFrames, towardBlack, PULSE_FRAMES, PULSE_FRAME_MS, PULSE_PERIOD_MS } from '../utils/pulse.js'

const RING = { x: 140, y: 106, w: 200, h: 200, start_angle: -90, line_width: 20 } // page/index.r.layout.js
const GREEN = 0x1fc08a
const frames = pulseFrames(RING, { spread: 20, line_width: 8, color: GREEN })
const radius = (f) => f.w / 2
const brightness = (c) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff)

test('towardBlack scales every channel toward black, clamped', () => {
  assert.equal(towardBlack(GREEN, 1), GREEN)
  assert.equal(towardBlack(GREEN, 0), 0)
  assert.equal(towardBlack(0x204060, 0.5), 0x102030)
  assert.equal(towardBlack(GREEN, 2), GREEN)
  assert.equal(towardBlack(GREEN, -1), 0)
})

test('one beep fits in its period', () => {
  assert.equal(frames.length, PULSE_FRAMES)
  assert.ok(PULSE_FRAMES * PULSE_FRAME_MS < PULSE_PERIOD_MS)
})

test('a beep starts hidden under the ring and ends spread px out, black', () => {
  const first = frames[0]
  const last = frames[frames.length - 1]
  assert.equal(radius(first), RING.w / 2)
  assert.ok(first.line_width <= RING.line_width) // inside the ring's own stroke
  assert.equal(radius(last), RING.w / 2 + 20)
  assert.equal(last.line_width, 2)
  assert.equal(last.color, 0)
})

test('every frame is a full circle centred on the ring', () => {
  for (const f of frames) {
    assert.equal(f.x + f.w / 2, 240)
    assert.equal(f.y + f.h / 2, 206)
    assert.equal(f.w, f.h)
    assert.equal(f.end_angle - f.start_angle, 360)
  }
})

test('it only grows, thins and fades', () => {
  for (let i = 1; i < frames.length; i++) {
    assert.ok(radius(frames[i]) >= radius(frames[i - 1]), `radius at frame ${i}`)
    assert.ok(frames[i].line_width <= frames[i - 1].line_width, `line width at frame ${i}`)
    assert.ok(brightness(frames[i].color) <= brightness(frames[i - 1].color), `colour at frame ${i}`)
  }
})
