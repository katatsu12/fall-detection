/**
 * Raise-to-wake from the accelerometer stream — pure JS, no Zepp imports.
 *
 * In monitor mode the screen is black while monitoring (README §10.5), so
 * something has to notice the wearer looking at the watch. Face-up means
 * gravity points out of the screen: z/|a| ≥ faceUp. The detector arms once
 * the watch has been away from face-up (z/|a| < faceDown) for holdMs, and
 * fires once it is back face-up for holdMs — so a watch that simply lies
 * face-up on a desk never fires, and one raise gives one wake.
 */
export const RAISE_DEFAULTS = Object.freeze({
  faceUp: 0.8, // z/|a| at or above this ⇒ face up
  faceDown: 0.5, // z/|a| below this ⇒ away from face up (arms the detector)
  holdMs: 300, // both states must last this long
})

export function createRaiseDetector(options = {}) {
  const cfg = { ...RAISE_DEFAULTS, ...options }
  let armed = false
  let downSince = 0
  let upSince = 0

  return {
    /** Feed one sample (any units, only the direction matters). Returns true on a raise. */
    push(t, x, y, z) {
      const n = Math.sqrt(x * x + y * y + z * z)
      if (!n) return false
      const up = z / n

      if (up < cfg.faceDown) {
        upSince = 0
        if (!downSince) downSince = t
        else if (!armed && t - downSince >= cfg.holdMs) armed = true
        return false
      }
      downSince = 0
      if (up < cfg.faceUp) {
        upSince = 0 // in between: neither state accumulates
        return false
      }
      if (!upSince) upSince = t
      if (armed && t - upSince >= cfg.holdMs) {
        armed = false
        upSince = 0
        return true
      }
      return false
    },

    isArmed() {
      return armed
    },

    reset() {
      armed = false
      downSince = 0
      upSince = 0
    },
  }
}
