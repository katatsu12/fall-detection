// Fall Guard palette, lifted from the design canvas ("Fall Guard - Zepp OS.dc.html").
import { setStatusBarVisible } from '@zos/ui'

/**
 * Square watches draw a system status bar (app name + time) over the top
 * ~70 px of every page, which hides Home's clock and the page titles, and
 * keeps monitor mode's black screen from being black. Round watches have
 * none, so the call may be missing there.
 */
export function hideStatusBar() {
  try {
    setStatusBarVisible(false)
  } catch (e) {
    /* round watch: nothing to hide */
  }
}

export const COLOR = {
  bg: 0x000000,
  white: 0xffffff,
  ink: 0x101113, // text on the white OK pill
  text: 0xffffff,
  textSoft: 0xe8e9eb,
  caption: 0xc6c9ce,
  muted: 0x9a9da3,
  dim: 0x8a8f96,
  faint: 0x6e7278,
  card: 0x1d1e20,
  cardPress: 0x2a2b2e,
  avatar: 0x2f3237,
  track: 0x2a2d31,
  radioOff: 0x4a4e54,
  green: 0x1fc08a,
  greenDeep: 0x10281f,
  red: 0xff3b2f,
  redSoft: 0xff6b5c,
  redCard: 0x2a1712,
}
