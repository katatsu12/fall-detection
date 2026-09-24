/**
 * Developer switches shared by the pages. Set DEBUG = false for a release
 * build: it removes the simulate / probe / record gestures, the phase 1
 * recorder with its uploads, and the frequency-mode override.
 */
import { localStorage } from '@zos/storage'
import { FREQ_MODE_LOW, FREQ_MODE_NORMAL, FREQ_MODE_HIGH } from '@zos/sensor'

export const DEBUG = true

const RECORDING_KEY = 'debug.recording'
const FREQ_MODE_KEY = 'debug.freqMode'
const DEFAULT_MODE = 'NORMAL' // README §8: set to the mode phase 0 picks

export const FREQ_MODES = [
  { name: 'LOW', mode: FREQ_MODE_LOW },
  { name: 'NORMAL', mode: FREQ_MODE_NORMAL },
  { name: 'HIGH', mode: FREQ_MODE_HIGH },
]

/** Phase 1 recorder on? On by default in debug builds, never in release builds. */
export function isRecording() {
  if (!DEBUG) return false
  try {
    const v = localStorage.getItem(RECORDING_KEY, true)
    return v !== false && v !== 'false'
  } catch (e) {
    return true
  }
}

export function setRecording(on) {
  localStorage.setItem(RECORDING_KEY, !!on)
}

export function freqModeName() {
  if (!DEBUG) return DEFAULT_MODE
  let v = DEFAULT_MODE
  try {
    v = localStorage.getItem(FREQ_MODE_KEY, DEFAULT_MODE)
  } catch (e) {
    /* default */
  }
  return FREQ_MODES.some((m) => m.name === v) ? v : DEFAULT_MODE
}

/** The @zos/sensor constant for the selected mode, for both accelerometer and gyroscope. */
export function freqMode() {
  const name = freqModeName()
  return FREQ_MODES.find((m) => m.name === name).mode
}

/** LOW → NORMAL → HIGH → LOW; Home applies the change within a second. */
export function cycleFreqMode() {
  const i = FREQ_MODES.findIndex((m) => m.name === freqModeName())
  const next = FREQ_MODES[(i + 1) % FREQ_MODES.length].name
  localStorage.setItem(FREQ_MODE_KEY, next)
  return next
}
