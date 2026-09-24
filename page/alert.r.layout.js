// Fall detected (MVP: vibrate until OK) — round 480 × 480.
import { px } from '@zos/utils'

// Radial red glow approximated with three translucent discs (a gradient PNG would be ~900 KB as TGA).
export const GLOW = [
  { center_x: px(240), center_y: px(190), radius: px(200), alpha: 18 },
  { center_x: px(240), center_y: px(190), radius: px(150), alpha: 22 },
  { center_x: px(240), center_y: px(190), radius: px(100), alpha: 26 },
]

export const TITLE = { x: px(0), y: px(96), w: px(480), h: px(46), text_size: px(38) }
export const TIME = { x: px(0), y: px(150), w: px(480), h: px(76), text_size: px(72) }
export const DETAILS = { x: px(40), y: px(234), w: px(400), h: px(34), text_size: px(26) }
export const STOPS = { x: px(40), y: px(272), w: px(400), h: px(30), text_size: px(22) }

export const OK_BTN = { x: px(72), y: px(334), w: px(336), h: px(88), radius: px(44), text_size: px(34) }
