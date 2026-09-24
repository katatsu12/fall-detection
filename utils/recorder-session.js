/**
 * Phase 1 state shared by Home, the record page and the result page through
 * getApp() globalData. Pages are separate bundles, so module variables are
 * not shared between them; globalData is.
 *
 *   recorder     — the candidate recorder; Home creates a fresh one on every
 *                  start and feeds it; the record page reads windows from it
 *   queue        — finished recordings waiting to be written, one per tick
 *   day          — today's summary being built (utils/recording-store.js)
 *   stats        — Home's latest sensor-rate reading, for the record page
 *   staged       — the record page is open: no v1, no everyday candidates
 *   homeRunning  — Home is monitoring, so samples are flowing
 */
import { saveRecording } from './recording-store'

export function getSession() {
  const g = getApp()._options.globalData
  if (!g.rec) g.rec = { recorder: null, queue: [], day: null, stats: null, staged: false, homeRunning: false }
  return g.rec
}

/** Write queued recordings: one per call, or all of them before Home goes away. */
export function persist(session, all) {
  let n = 0
  while (session.queue.length && (all || n < 1)) {
    saveRecording(session.queue.shift())
    n++
  }
}
