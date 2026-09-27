/**
 * Home's "beeping" ring — pure JavaScript, no Zepp OS imports, tested in Node.
 *
 * While the wearer is covered and the screen is awake, a thin ring grows out
 * of the coverage ring and fades away, once every PULSE_PERIOD_MS. Zepp OS
 * 3.0 has no property animation, IMG_ANIM frames would be megabytes once the
 * build turns them into TGA, and ARC has no alpha. So page/index.js steps one
 * ARC through the frames computed here, and "fading" scales the colour toward
 * black, which on Home's black background looks the same as alpha.
 */

export const PULSE_FRAME_MS = 50 // 20 fps
export const PULSE_FRAMES = 24 // one beep lasts 1.2 s…
export const PULSE_PERIOD_MS = 2000 // …and starts every 2 s

/** `color` (0xRRGGBB) scaled toward black: k = 1 leaves it as is, k = 0 is black. */
export function towardBlack(color, k) {
  const f = Math.max(0, Math.min(1, k))
  const ch = (shift) => Math.round(((color >> shift) & 0xff) * f)
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

/**
 * ARC properties for each frame of one beep. It starts at the outer edge of
 * `ring` (an ARC's stroke is drawn inside its box, so the first frame hides
 * under the ring), moves `spread` px outward with an ease-out, thins from
 * `line_width` to 2 px and fades from `opacity` to black.
 */
export function pulseFrames(ring, { spread, line_width, color, frames = PULSE_FRAMES, opacity = 0.8 }) {
  const cx = ring.x + ring.w / 2
  const cy = ring.y + ring.h / 2
  const out = []
  for (let i = 0; i < frames; i++) {
    const p = frames > 1 ? i / (frames - 1) : 1
    const r = Math.round(ring.w / 2 + spread * (1 - (1 - p) ** 2))
    out.push({
      x: Math.round(cx - r),
      y: Math.round(cy - r),
      w: 2 * r,
      h: 2 * r,
      start_angle: ring.start_angle,
      end_angle: ring.start_angle + 360,
      line_width: Math.max(2, Math.round(line_width + (2 - line_width) * p)),
      color: towardBlack(color, opacity * (1 - p)),
    })
  }
  return out
}
