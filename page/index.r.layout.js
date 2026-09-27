// Home — round 480 × 480: the time on top, the detector ring, then the date and the state under it.
import { px } from '@zos/utils'

export const SCREEN = { x: px(0), y: px(0), w: px(480), h: px(480), radius: px(0) }
export const CLOCK = { x: px(0), y: px(30), w: px(480), h: px(50), text_size: px(40) }

// Ring: 200 px outer, 160 px inner (20 px stroke), centred at (240, 206). 0° = 3 o'clock.
export const RING = { x: px(140), y: px(106), w: px(200), h: px(200), start_angle: -90, line_width: px(20) }
export const RING_FULL = 270 // end_angle for 100 %
// "Beep" while covered (utils/pulse.js): r 100 → 120, thinning from 8 px, so it stays between the clock (to y 80)
// and the date's text (from about y 329).
export const PULSE = { spread: px(20), line_width: px(8) }
// Inner disc is a circular BUTTON so the ring can be tapped (toggle) / long-pressed (debug).
export const DISC = { x: px(160), y: px(126), w: px(160), h: px(160), radius: px(80), text: '' }
export const SHIELD = { x: px(206), y: px(172), w: px(68), h: px(68), src: 'shield.png' }

export const DATE = { x: px(0), y: px(324), w: px(480), h: px(30), text_size: px(24) }
export const TITLE = { x: px(0), y: px(354), w: px(480), h: px(42), text_size: px(32) }
// Today's alerts, shown once there has been one: "2 alerts today · last 14:32" (utils/alert-log.js). The circle
// is about 300 px wide down here.
export const ALERTS = { x: px(60), y: px(398), w: px(360), h: px(28), text_size: px(22) }
