// Fall detected ("Are you alright?") — round 480 × 480 (design 2A).
import { px } from '@zos/utils'

// Radial red glow approximated with three translucent discs (a gradient PNG would be ~900 KB as TGA).
export const GLOW = [
  { center_x: px(240), center_y: px(190), radius: px(200), alpha: 18 },
  { center_x: px(240), center_y: px(190), radius: px(150), alpha: 22 },
  { center_x: px(240), center_y: px(190), radius: px(100), alpha: 26 },
]

export const TITLE = { x: px(0), y: px(44), w: px(480), h: px(36), text_size: px(30) }

// Ring: 170 px outer, 140 px inner (15 px stroke), centred at (240, 171).
export const RING = { x: px(155), y: px(86), w: px(170), h: px(170), start_angle: -90, line_width: px(15) }
export const SECONDS = { x: px(155), y: px(86), w: px(170), h: px(170), text_size: px(84) }

export const CAPTION1 = { x: px(40), y: px(260), w: px(400), h: px(34), text_size: px(26) }
export const CAPTION2 = { x: px(40), y: px(294), w: px(400), h: px(34), text_size: px(26) }

export const FINE_BTN = { x: px(72), y: px(334), w: px(336), h: px(88), radius: px(44), text_size: px(34) }
export const HELP_BTN = { x: px(120), y: px(424), w: px(240), h: px(36), radius: px(18), text_size: px(26) }
