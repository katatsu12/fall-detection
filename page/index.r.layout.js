// Home — round 480 × 480 (design 2A "You're covered"). All values in design px.
import { px } from '@zos/utils'

// Ring: 150 px outer, 120 px inner (15 px stroke), centred at (240, 129). 0° = 3 o'clock.
export const RING = { x: px(165), y: px(54), w: px(150), h: px(150), start_angle: -90, line_width: px(15) }
export const RING_FULL = 270 // end_angle for 100 %
// Inner disc is a circular BUTTON so the ring can be tapped (toggle) / long-pressed (debug).
export const DISC = { x: px(180), y: px(69), w: px(120), h: px(120), radius: px(60), text: '' }
export const SHIELD = { x: px(214), y: px(103), w: px(52), h: px(52), src: 'shield.png' }

export const TITLE = { x: px(0), y: px(208), w: px(480), h: px(42), text_size: px(34) }

const ROW_H = 58
const ROW_X = 70
const ROW_W = 340
const PAD = 24
const rowY = [252, 316, 380]
export const ROWS = rowY.map((y) => ({
  rect: { x: px(ROW_X), y: px(y), w: px(ROW_W), h: px(ROW_H), radius: px(20) },
  label: { x: px(ROW_X + PAD), y: px(y), w: px(150), h: px(ROW_H), text_size: px(24) },
  value: { x: px(ROW_X + ROW_W - PAD - 190), y: px(y), w: px(190), h: px(ROW_H), text_size: px(24) },
}))
