/**
 * Device-side preferences, persisted in @zos/storage localStorage and set on
 * the watch's Sensitivity page (page/settings) or from the phone settings page:
 * `allDay` is the watch's copy of the phone's switch, and `sensitivity` can be
 * picked on either side, the later pick winning (shared/settings.js).
 */
import { localStorage } from '@zos/storage'
import { PRESETS } from './fall-detector'
import { SENSITIVITY, mergeSensitivity } from '../shared/settings.js'

export { SENSITIVITY }

const PRESET_FOR = {
  [SENSITIVITY.RELAXED]: PRESETS.low,
  [SENSITIVITY.BALANCED]: PRESETS.normal,
  [SENSITIVITY.WATCHFUL]: PRESETS.high,
}

const DEFAULTS = Object.freeze({
  sensitivity: SENSITIVITY.BALANCED,
  sensitivityAt: 0, // when `sensitivity` was last picked, on either side; 0 = never
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

/** A level picked on the watch, stamped so the later of watch and phone wins. Returns what to tell the phone (FG_SAVE). */
export function pickSensitivity(level, now) {
  setPref('sensitivity', level)
  setPref('sensitivityAt', now)
  return { sensitivity: level, sensitivityAt: now }
}

/**
 * The phone's settings (shared/settings.js settingsOf), asked for or pushed: keep the
 * watch's copy current. Returns what the phone should be told back (FG_SAVE) when the
 * watch holds the later sensitivity pick — one made while the phone was away — or null.
 */
export function applyPhoneSettings(s) {
  if (!s) return null
  if (typeof s.allDay === 'boolean') setPref('allDay', s.allDay)
  const m = mergeSensitivity({ sensitivity: getPref('sensitivity'), at: getPref('sensitivityAt') }, s)
  if (m.adopt) {
    setPref('sensitivity', m.adopt)
    setPref('sensitivityAt', m.at)
  }
  return m.tell || null
}

/** Detector options for the stored sensitivity. */
export function detectorOptions() {
  return PRESET_FOR[getPref('sensitivity')] || PRESET_FOR[SENSITIVITY.BALANCED]
}
