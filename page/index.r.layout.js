// Round-screen layout (design width 480). zosLoader picks this file for `st: "r"`.
import { px } from '@zos/utils'

export const COLOR = {
  bg: 0x000000,
  text: 0xffffff,
  muted: 0x8a8a8a,
  ok: 0x2ecc71,
  warn: 0xf39c12,
  danger: 0xe74c3c,
  button: 0x1f1f1f,
  buttonPress: 0x3a3a3a,
}

export const TITLE = {
  x: px(0),
  y: px(56),
  w: px(480),
  h: px(50),
  text_size: px(34),
  color: COLOR.text,
}

export const STATUS_DOT = {
  x: px(150),
  y: px(132),
  w: px(18),
  h: px(18),
  radius: px(9),
}

export const STATUS = {
  x: px(176),
  y: px(120),
  w: px(200),
  h: px(42),
  text_size: px(30),
}

export const READOUT = {
  x: px(0),
  y: px(174),
  w: px(480),
  h: px(40),
  text_size: px(26),
  color: COLOR.muted,
}

export const TOGGLE_BTN = {
  x: px(90),
  y: px(240),
  w: px(300),
  h: px(80),
  radius: px(40),
  text_size: px(32),
  normal_color: COLOR.button,
  press_color: COLOR.buttonPress,
}

export const SIMULATE_BTN = {
  x: px(120),
  y: px(340),
  w: px(240),
  h: px(64),
  radius: px(32),
  text_size: px(26),
  normal_color: COLOR.button,
  press_color: COLOR.buttonPress,
}
