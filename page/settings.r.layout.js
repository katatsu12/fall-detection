// Sensitivity ("How careful?") — round 480 × 480 (design 2A).
import { px } from '@zos/utils'

export const TITLE = { x: px(0), y: px(40), w: px(480), h: px(34), text_size: px(28) }

const ROW_X = 44
const ROW_W = 392
const ROW_H = 84
const PAD = 26
const RADIO_R = 15
const rowY = [86, 178, 270]
export const ROWS = rowY.map((y) => ({
  rect: { x: px(ROW_X), y: px(y), w: px(ROW_W), h: px(ROW_H), radius: px(26) },
  border: { x: px(ROW_X), y: px(y), w: px(ROW_W), h: px(ROW_H), radius: px(26), line_width: px(2) },
  radio: { center_x: px(ROW_X + PAD + RADIO_R), center_y: px(y + ROW_H / 2), radius: px(RADIO_R) },
  radioInner: { center_x: px(ROW_X + PAD + RADIO_R), center_y: px(y + ROW_H / 2), radius: px(RADIO_R - 3) },
  radioDot: { center_x: px(ROW_X + PAD + RADIO_R), center_y: px(y + ROW_H / 2), radius: px(5) },
  label: { x: px(ROW_X + PAD + 46), y: px(y + 10), w: px(300), h: px(32), text_size: px(26) },
  sub: { x: px(ROW_X + PAD + 46), y: px(y + 42), w: px(300), h: px(32), text_size: px(24) },
}))

export const TOGGLE = {
  rect: { x: px(70), y: px(366), w: px(340), h: px(74), radius: px(24) },
  label: { x: px(96), y: px(366), w: px(200), h: px(74), text_size: px(26) },
  track: { x: px(316), y: px(384), w: px(68), h: px(38), radius: px(19) },
  knobOn: { center_x: px(365), center_y: px(403), radius: px(15) },
  knobOff: { center_x: px(335), center_y: px(403), radius: px(15) },
}
