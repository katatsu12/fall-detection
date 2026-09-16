// Sensitivity ("How careful?") — square 390 × 450 (design 2A).
import { px } from '@zos/utils'

export const TITLE = { x: px(0), y: px(30), w: px(390), h: px(34), text_size: px(28) }

const ROW_X = 26
const ROW_W = 338
const ROW_H = 80
const PAD = 22
const RADIO_R = 14
const rowY = [76, 164, 252]
export const ROWS = rowY.map((y) => ({
  rect: { x: px(ROW_X), y: px(y), w: px(ROW_W), h: px(ROW_H), radius: px(22) },
  border: { x: px(ROW_X), y: px(y), w: px(ROW_W), h: px(ROW_H), radius: px(22), line_width: px(2) },
  radio: { center_x: px(ROW_X + PAD + RADIO_R), center_y: px(y + ROW_H / 2), radius: px(RADIO_R) },
  radioInner: { center_x: px(ROW_X + PAD + RADIO_R), center_y: px(y + ROW_H / 2), radius: px(RADIO_R - 3) },
  radioDot: { center_x: px(ROW_X + PAD + RADIO_R), center_y: px(y + ROW_H / 2), radius: px(5) },
  label: { x: px(ROW_X + PAD + 42), y: px(y + 8), w: px(260), h: px(32), text_size: px(26) },
  sub: { x: px(ROW_X + PAD + 42), y: px(y + 40), w: px(260), h: px(30), text_size: px(24) },
}))

export const TOGGLE = {
  rect: { x: px(26), y: px(344), w: px(338), h: px(72), radius: px(22) },
  label: { x: px(48), y: px(344), w: px(200), h: px(72), text_size: px(26) },
  track: { x: px(278), y: px(362), w: px(64), h: px(36), radius: px(18) },
  knobOn: { center_x: px(326), center_y: px(380), radius: px(14) },
  knobOff: { center_x: px(294), center_y: px(380), radius: px(14) },
}
