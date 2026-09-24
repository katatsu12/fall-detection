// Home — square 390 × 450 (Amazfit Active): a single detector ring centred on the screen.
import { px } from '@zos/utils'

export const SCREEN = { x: px(0), y: px(0), w: px(390), h: px(450), radius: px(0) }
export const CLOCK = { x: px(0), y: px(36), w: px(390), h: px(40), text_size: px(30) }

// Ring: 180 px outer, 144 px inner (18 px stroke), centred at (195, 196).
export const RING = { x: px(105), y: px(106), w: px(180), h: px(180), start_angle: -90, line_width: px(18) }
export const RING_FULL = 270
export const DISC = { x: px(123), y: px(124), w: px(144), h: px(144), radius: px(72), text: '' }
export const SHIELD = { x: px(164), y: px(165), w: px(62), h: px(62), src: 'shield.png' }

export const TITLE = { x: px(0), y: px(304), w: px(390), h: px(42), text_size: px(32) }
// MVP test tally: "2 alerts today · last 14:32" (utils/alert-log.js).
export const ALERTS = { x: px(0), y: px(350), w: px(390), h: px(32), text_size: px(24) }
