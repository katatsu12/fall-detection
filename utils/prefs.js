/**
 * Device-side preferences. Persisted in @zos/storage localStorage; the phone
 * settings app (README Step 7) pushes contactName here through the app-side.
 */
import { localStorage } from '@zos/storage'
import { PRESETS } from './fall-detector'

export const SENSITIVITY = Object.freeze({ RELAXED: 'relaxed', BALANCED: 'balanced', WATCHFUL: 'watchful' })

const PRESET_FOR = {
  [SENSITIVITY.RELAXED]: PRESETS.low,
  [SENSITIVITY.BALANCED]: PRESETS.normal,
  [SENSITIVITY.WATCHFUL]: PRESETS.high,
}

const DEFAULTS = Object.freeze({
  contactName: '',
  sensitivity: SENSITIVITY.BALANCED,
  siren: true,
})

export function getPref(key) {
  const v = localStorage.getItem(key, DEFAULTS[key])
  return v === undefined || v === null ? DEFAULTS[key] : v
}

export function setPref(key, value) {
  localStorage.setItem(key, value)
}

export function getPrefs() {
  const out = {}
  for (const k of Object.keys(DEFAULTS)) out[k] = getPref(k)
  return out
}

/** Detector options for the stored sensitivity. */
export function detectorOptions() {
  return PRESET_FOR[getPref('sensitivity')] || PRESET_FOR[SENSITIVITY.BALANCED]
}

/** Apply prefs received from the phone (app-side `prefs.get` / `prefs.update`). */
export function applyRemotePrefs(remote) {
  if (!remote || typeof remote !== 'object') return
  if (typeof remote.contactName === 'string') setPref('contactName', remote.contactName)
}

export function firstName(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)[0]
}

export function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('')
}
