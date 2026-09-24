/**
 * Device-side preferences, persisted in @zos/storage localStorage and set on
 * the watch's Sensitivity page (page/settings).
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
