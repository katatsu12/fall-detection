/**
 * Uploads finished recordings and daily summaries to the phone one request
 * at a time, backing off while the phone or the dev server is unreachable.
 * Pure JavaScript: the ZML request and the store are injected, so Home wires
 * it up and Node tests it.
 *
 *   const up = createUploader({ request: (d, o) => page.request(d, o), next, done })
 *   up.tick(Date.now())   // from Home's 1 s tick
 */

export const UPLOAD_DEFAULTS = Object.freeze({
  gapMs: 3000, // pause between successful uploads
  idleMs: 30000, // look again this long after finding nothing to send
  maxBackoffMs: 300000,
  timeoutMs: 60000, // ZML splits a ~30 KB recording into ~9 BLE frames
})

/**
 * @param {{ request: Function, next: (now: number) => any, done: (item: any, now: number) => void, now?: () => number, log?: Function, onFail?: (why: string) => void }} io
 * @param {Partial<typeof UPLOAD_DEFAULTS>} [options]
 */
export function createUploader(io, options = {}) {
  const cfg = { ...UPLOAD_DEFAULTS, ...options }
  const now = io.now || (() => Date.now())
  const log = io.log || (() => {})
  const onFail = io.onFail || (() => {})
  let busy = false
  let nextAt = 0
  let backoff = cfg.gapMs
  const stats = { sent: 0, failed: 0, lastError: '' }

  function fail(why) {
    busy = false
    stats.failed++
    stats.lastError = why
    backoff = Math.min(backoff * 2, cfg.maxBackoffMs)
    nextAt = now() + backoff
    log('[upload] failed:', why, `retry in ${Math.round(backoff / 1000)} s`)
    onFail(why)
  }

  function succeed(item) {
    busy = false
    stats.sent++
    backoff = cfg.gapMs
    nextAt = now() + cfg.gapMs
    try {
      io.done(item, now())
    } catch (e) {
      log('[upload] done() failed:', e)
    }
  }

  return {
    /** Start the next upload if none is running and the backoff has passed. Returns true if one started. */
    tick(t) {
      if (busy || t < nextAt) return false
      const item = io.next(t)
      if (!item) {
        nextAt = t + cfg.idleMs
        return false
      }
      busy = true
      let pending
      try {
        pending = io.request({ method: 'rec.put', params: item.body }, { timeout: cfg.timeoutMs })
      } catch (e) {
        fail(String((e && e.message) || e)) // ZML throws synchronously when BLE is down
        return false
      }
      pending
        .then((r) => (r && r.ok ? succeed(item) : fail((r && r.error) || 'rejected')))
        .catch((e) => fail(String((e && e.message) || e)))
      return true
    },

    stats() {
      return { ...stats, busy, backoffMs: backoff }
    },
  }
}
