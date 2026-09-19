// Background probe (developer screen) — round 480 × 480.
import { px } from '@zos/utils'

export const TITLE = { x: px(0), y: px(38), w: px(480), h: px(40), text_size: px(28) }

const ROW_Y0 = 88
const ROW_H = 32
export const ROWS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
  x: px(58),
  y: px(ROW_Y0 + i * ROW_H),
  w: px(364),
  h: px(ROW_H),
  text_size: px(22),
}))

export const START_BTN = { x: px(62), y: px(370), w: px(170), h: px(64), radius: px(32), text_size: px(26) }
export const STOP_BTN = { x: px(248), y: px(370), w: px(170), h: px(64), radius: px(32), text_size: px(26) }
