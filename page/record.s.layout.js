// Staged recordings (developer screen) — square 390 × 450 (Amazfit Active).
import { px } from '@zos/utils'

export const TITLE = { x: px(0), y: px(24), w: px(390), h: px(34), text_size: px(24) }
export const ACTIVITY = { x: px(16), y: px(62), w: px(358), h: px(50), text_size: px(32) }

const LINE_Y0 = 118
const LINE_H = 32
export const LINES = [0, 1, 2].map((i) => ({
  x: px(16),
  y: px(LINE_Y0 + i * LINE_H),
  w: px(358),
  h: px(LINE_H),
  text_size: px(22),
}))

export const RECORD_BTN = { x: px(45), y: px(222), w: px(300), h: px(72), radius: px(26), text_size: px(30) }
export const SKIP_BTN = { x: px(45), y: px(306), w: px(144), h: px(56), radius: px(26), text_size: px(24) }
export const MODE_BTN = { x: px(201), y: px(306), w: px(144), h: px(56), radius: px(26), text_size: px(24) }
export const TOGGLE = { x: px(16), y: px(378), w: px(358), h: px(40), text_size: px(20) }
