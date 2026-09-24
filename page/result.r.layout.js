// Result — round 480 × 480. Two variants: "Glad you're OK" (design 2A) and
// "Contacting" (adapted from design 1A screen 3 for the SOS path).
import { px } from '@zos/utils'

// --- ok variant ---
export const OK_DISC = { center_x: px(240), center_y: px(138), radius: px(64) }
export const OK_CHECK = { x: px(210), y: px(108), w: px(60), h: px(60), src: 'check.png' }
export const OK_TITLE = { x: px(0), y: px(220), w: px(480), h: px(46), text_size: px(38) }
export const OK_LINE1 = { x: px(40), y: px(284), w: px(400), h: px(36), text_size: px(26) }
export const OK_LINE2 = { x: px(40), y: px(320), w: px(400), h: px(36), text_size: px(26) }
export const OK_CLOSING = { x: px(0), y: px(374), w: px(480), h: px(33), text_size: px(24) }

// --- "Did you fall?" (debug builds, labels the alert's recording) ---
export const FELL_Q = { x: px(40), y: px(278), w: px(400), h: px(38), text_size: px(28) }
export const FELL_YES = { x: px(96), y: px(324), w: px(136), h: px(52), radius: px(26), text_size: px(26) }
export const FELL_NO = { x: px(248), y: px(324), w: px(136), h: px(52), radius: px(26), text_size: px(26) }
export const ASK_CLOSING = { x: px(0), y: px(386), w: px(480), h: px(30), text_size: px(22) }

// --- sos variant ---
export const SOS_HEADER = { x: px(0), y: px(52), w: px(480), h: px(34), text_size: px(24), char_space: px(2) }
export const SOS_AVATAR = { center_x: px(240), center_y: px(156), radius: px(58) }
export const SOS_INITIALS = { x: px(182), y: px(98), w: px(116), h: px(116), text_size: px(40) }
export const SOS_NAME = { x: px(20), y: px(224), w: px(440), h: px(44), text_size: px(36) }
export const SOS_STATUS = { x: px(40), y: px(272), w: px(400), h: px(34), text_size: px(24) }
export const SOS_DONE = { x: px(90), y: px(340), w: px(300), h: px(76), radius: px(38), text_size: px(30) }
