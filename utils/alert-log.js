/**
 * Alert history for the MVP test (README "MVP scope"). Every detected fall is
 * kept as { t, peakG, freefallMs }, so Home can show how many alerts fired
 * today and when the last one was — the numbers the proof of concept is
 * judged on. Pure JavaScript; page/index.js persists the list in
 * localStorage.
 */

export const MAX_ALERTS = 50

const round2 = (v) => Math.round((v || 0) * 100) / 100

/** Append one detector event (newest last), keeping only the newest MAX_ALERTS. */
export function addAlert(list, evt, t) {
  const entry = { t: Math.round(t), peakG: round2(evt && evt.peakG), freefallMs: Math.round((evt && evt.freefallMs) || 0) }
  return [...(Array.isArray(list) ? list : []), entry].slice(-MAX_ALERTS)
}

/** { today, last }: alerts since local midnight, and the most recent alert (or null). */
export function summarizeAlerts(list, now) {
  const items = Array.isArray(list) ? list : []
  const d = new Date(now)
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return {
    today: items.filter((a) => a.t >= midnight && a.t <= now).length,
    last: items.length ? items[items.length - 1] : null,
  }
}

/** "14:32", or "2:32" on a watch set to 12-hour time (Home's clock shows no AM/PM either). */
export function formatTime(t, twelveHour) {
  const d = new Date(t)
  let h = d.getHours()
  if (twelveHour) h = h % 12 || 12
  const m = d.getMinutes()
  return `${h}:${m < 10 ? '0' : ''}${m}`
}
