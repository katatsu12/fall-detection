// Fall detected (MVP: vibrate until OK) — square 390 × 450 (Amazfit Active).
import { px } from '@zos/utils'

export const GLOW = [
  { center_x: px(195), center_y: px(160), radius: px(170), alpha: 18 },
  { center_x: px(195), center_y: px(160), radius: px(125), alpha: 22 },
  { center_x: px(195), center_y: px(160), radius: px(80), alpha: 26 },
]

export const TITLE = { x: px(0), y: px(70), w: px(390), h: px(44), text_size: px(36) }
export const TIME = { x: px(0), y: px(120), w: px(390), h: px(72), text_size: px(66) }
export const DETAILS = { x: px(20), y: px(200), w: px(350), h: px(32), text_size: px(24) }
export const STOPS = { x: px(20), y: px(236), w: px(350), h: px(30), text_size: px(22) }

export const OK_BTN = { x: px(28), y: px(300), w: px(334), h: px(84), radius: px(26), text_size: px(32) }
