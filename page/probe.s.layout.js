// Background probe (developer screen) — square 390 × 450 (Amazfit Active).
import { px } from '@zos/utils'

export const TITLE = { x: px(0), y: px(28), w: px(390), h: px(40), text_size: px(28) }

const ROW_Y0 = 78
const ROW_H = 32
export const ROWS = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
  x: px(22),
  y: px(ROW_Y0 + i * ROW_H),
  w: px(346),
  h: px(ROW_H),
  text_size: px(22),
}))

export const START_BTN = { x: px(24), y: px(366), w: px(162), h: px(60), radius: px(30), text_size: px(26) }
export const STOP_BTN = { x: px(204), y: px(366), w: px(162), h: px(60), radius: px(30), text_size: px(26) }
