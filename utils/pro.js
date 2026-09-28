/**
 * All-day mode is the Pro feature (shared/watchplus-config.js): monitor mode keeps Home
 * alive with the screen dark and reopens it if it closes (README §10.5). Without it the
 * watch closes the app about 10 s after the screen goes off, so detection runs only
 * while the app is open.
 *
 * It runs when it is licensed and switched on. The licence is app.js's Watchplus: a
 * verdict read from the watch file at launch, never a wait on Bluetooth; DEBUG builds
 * unlock it without one. The switch is on the phone settings page; the watch keeps the
 * last position it heard (shared/settings.js).
 */
import { push } from '@zos/router'
import { DEBUG } from './debug'
import { getPref } from './prefs'

export function licensed() {
  if (DEBUG) return true
  try {
    const wp = getApp()._options.globalData.watchplus
    return !!(wp && wp.isPro)
  } catch (e) {
    return false
  }
}

export function allDayWanted() {
  return !!getPref('allDay')
}

/** The watch's "Get All-day mode" page (amazla/watchplus paywall); the purchase itself is on the phone. */
export function openPro() {
  push({ url: 'page/pro' })
}
