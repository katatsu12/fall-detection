// Fall detected ("Are you alright?") — square 390 × 450 (design 2A).
import { px } from '@zos/utils'

export const GLOW = [
  { center_x: px(195), center_y: px(160), radius: px(170), alpha: 18 },
  { center_x: px(195), center_y: px(160), radius: px(125), alpha: 22 },
  { center_x: px(195), center_y: px(160), radius: px(80), alpha: 26 },
]

export const TITLE = { x: px(0), y: px(34), w: px(390), h: px(36), text_size: px(30) }

// Ring: 156 px outer, 128 px inner (14 px stroke), centred at (195, 154).
export const RING = { x: px(117), y: px(76), w: px(156), h: px(156), start_angle: -90, line_width: px(14) }
export const SECONDS = { x: px(117), y: px(76), w: px(156), h: px(156), text_size: px(76) }

export const CAPTION1 = { x: px(20), y: px(236), w: px(350), h: px(32), text_size: px(24) }
export const CAPTION2 = { x: px(20), y: px(268), w: px(350), h: px(32), text_size: px(24) }

export const FINE_BTN = { x: px(28), y: px(300), w: px(334), h: px(84), radius: px(26), text_size: px(32) }
export const HELP_BTN = { x: px(95), y: px(388), w: px(200), h: px(34), radius: px(17), text_size: px(24) }
