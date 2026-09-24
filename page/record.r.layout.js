// Staged recordings (developer screen) — round 480 × 480.
import { px } from '@zos/utils'

export const TITLE = { x: px(0), y: px(34), w: px(480), h: px(34), text_size: px(24) }
export const ACTIVITY = { x: px(56), y: px(72), w: px(368), h: px(50), text_size: px(34) }

const LINE_Y0 = 128
const LINE_H = 32
export const LINES = [0, 1, 2].map((i) => ({
  x: px(52),
  y: px(LINE_Y0 + i * LINE_H),
  w: px(376),
  h: px(LINE_H),
  text_size: px(22),
}))

export const RECORD_BTN = { x: px(90), y: px(232), w: px(300), h: px(72), radius: px(36), text_size: px(30) }
export const SKIP_BTN = { x: px(90), y: px(316), w: px(144), h: px(56), radius: px(28), text_size: px(24) }
export const MODE_BTN = { x: px(246), y: px(316), w: px(144), h: px(56), radius: px(28), text_size: px(24) }
export const TOGGLE = { x: px(100), y: px(384), w: px(280), h: px(40), text_size: px(20) }
