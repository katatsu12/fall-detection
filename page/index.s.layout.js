// Home — square 390 × 450, e.g. Amazfit Active (design 2A). All values in design px.
import { px } from '@zos/utils'

// Ring: 132 px outer, 104 px inner (14 px stroke), centred at (195, 102).
export const RING = { x: px(129), y: px(36), w: px(132), h: px(132), start_angle: -90, line_width: px(14) }
export const RING_FULL = 270
export const DISC = { x: px(143), y: px(50), w: px(104), h: px(104), radius: px(52), text: '' }
export const SHIELD = { x: px(172), y: px(79), w: px(46), h: px(46), src: 'shield.png' }

export const TITLE = { x: px(0), y: px(180), w: px(390), h: px(40), text_size: px(32) }

const ROW_H = 58
const ROW_X = 28
const ROW_W = 334
const PAD = 22
const rowY = [234, 298, 362]
export const ROWS = rowY.map((y) => ({
  rect: { x: px(ROW_X), y: px(y), w: px(ROW_W), h: px(ROW_H), radius: px(18) },
  label: { x: px(ROW_X + PAD), y: px(y), w: px(150), h: px(ROW_H), text_size: px(24) },
  value: { x: px(ROW_X + ROW_W - PAD - 190), y: px(y), w: px(190), h: px(ROW_H), text_size: px(24) },
}))
