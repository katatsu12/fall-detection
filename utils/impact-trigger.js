/**
 * Impact trigger for detector v2 and the candidate recorder — pure
 * JavaScript, no Zepp OS imports.
 *
 * A candidate opens when |a| first exceeds `triggerG`. Its time t0 is the
 * highest sample within `mergeMs` of that first crossing, so one impact with
 * its after-shocks gives one candidate. The next crossing after the merge
 * window opens a new candidate: there is no longer refractory period, and
 * candidates may overlap downstream — a fall that follows a harmless arm
 * swing still gets a candidate of its own.
 */

export const TRIGGER_DEFAULTS = Object.freeze({
  triggerG: 1.8, // one trigger for every sensitivity preset, the recorder and training
  mergeMs: 1000,
})

export function createImpactTrigger(options = {}) {
  const cfg = { ...TRIGGER_DEFAULTS, ...options }
  let open = null // { tOpen, t0, peakG } while a merge window runs

  function close() {
    const c = { t0: open.t0, peakG: open.peakG }
    open = null
    return c
  }

  return {
    /**
     * Feed one |a| value in g. Returns the finished candidate { t0, peakG }
     * when this sample closes a merge window, otherwise null.
     */
    push(t, g) {
      const done = open && t - open.tOpen > cfg.mergeMs ? close() : null
      if (g > cfg.triggerG) {
        if (!open) open = { tOpen: t, t0: t, peakG: g }
        else if (g > open.peakG) {
          open.t0 = t
          open.peakG = g
        }
      }
      return done
    },

    /** Close a merge window early (end of a trace, sensors stopping). Returns it or null. */
    flush() {
      return open ? close() : null
    },

    reset() {
      open = null
    },

    isOpen() {
      return open !== null
    },

    getConfig() {
      return { ...cfg }
    },
  }
}
