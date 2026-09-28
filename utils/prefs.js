/**
 * Device-side preferences, persisted in @zos/storage localStorage and set on
 * the watch's Sensitivity page (page/settings) — except `allDay`, the watch's
 * copy of the phone settings page's switch (shared/settings.js).
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
  allDay: true, // on until the phone says otherwise, so a purchase switches it on at once
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

/** The phone's settings (shared/settings.js settingsOf), asked for or pushed: keep the watch's copy current. */
export function applyPhoneSettings(s) {
  if (s && typeof s.allDay === 'boolean') setPref('allDay', s.allDay)
}

/** Detector options for the stored sensitivity. */
export function detectorOptions() {
  return PRESET_FOR[getPref('sensitivity')] || PRESET_FOR[SENSITIVITY.BALANCED]
}
