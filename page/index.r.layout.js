// Home — round 480 × 480: a single detector ring centred on the screen.
import { px } from '@zos/utils'

export const SCREEN = { x: px(0), y: px(0), w: px(480), h: px(480), radius: px(0) }
export const CLOCK = { x: px(0), y: px(48), w: px(480), h: px(40), text_size: px(30) }

// Ring: 200 px outer, 160 px inner (20 px stroke), centred at (240, 214). 0° = 3 o'clock.
export const RING = { x: px(140), y: px(114), w: px(200), h: px(200), start_angle: -90, line_width: px(20) }
export const RING_FULL = 270 // end_angle for 100 %
// Inner disc is a circular BUTTON so the ring can be tapped (toggle) / long-pressed (debug).
export const DISC = { x: px(160), y: px(134), w: px(160), h: px(160), radius: px(80), text: '' }
export const SHIELD = { x: px(206), y: px(180), w: px(68), h: px(68), src: 'shield.png' }

export const TITLE = { x: px(0), y: px(332), w: px(480), h: px(44), text_size: px(34) }
