// Home — square 390 × 450 (Amazfit Active): the time on top, the detector ring, then the date and the state under it.
import { px } from '@zos/utils'

export const SCREEN = { x: px(0), y: px(0), w: px(390), h: px(450), radius: px(0) }
export const CLOCK = { x: px(0), y: px(38), w: px(390), h: px(50), text_size: px(40) }

// Ring: 180 px outer, 144 px inner (18 px stroke), centred at (195, 204).
export const RING = { x: px(105), y: px(114), w: px(180), h: px(180), start_angle: -90, line_width: px(18) }
export const RING_FULL = 270
// "Beep" while covered (utils/pulse.js): r 90 → 110, clear of the clock (to y 88) and the date (from y 314).
export const PULSE = { spread: px(20), line_width: px(7) }
export const DISC = { x: px(123), y: px(132), w: px(144), h: px(144), radius: px(72), text: '' }
export const SHIELD = { x: px(164), y: px(173), w: px(62), h: px(62), src: 'shield.png' }

export const DATE = { x: px(0), y: px(314), w: px(390), h: px(30), text_size: px(24) }
export const TITLE = { x: px(0), y: px(346), w: px(390), h: px(42), text_size: px(32) }
// Today's alerts, shown once there has been one: "2 alerts today · last 14:32" (utils/alert-log.js).
export const ALERTS = { x: px(0), y: px(392), w: px(390), h: px(28), text_size: px(22) }
