/**
 * Shared record between the background probe service (app-service/probe.js)
 * and its page (page/probe.js). The service has no UI, so it writes its
 * findings here and the page polls them.
 *
 * Which storage a service may write to is itself part of the experiment:
 * @zos/storage isn't listed in the App Service capability table and @zos/fs
 * writes are documented as "screen off or AOD only", so save() tries both
 * and records which one worked (`store`) and what failed (`errors`).
 */
import { localStorage } from '@zos/storage'
import { readFileSync, writeFileSync, rmSync } from '@zos/fs'

export const PROBE_SERVICE = 'app-service/probe'
const KEY = 'probe'
const FILE = 'probe.json'
const MAX_ERRORS = 8

export function emptyProbe() {
  return {
    startedAt: 0,
    stoppedAt: 0,
    updatedAt: 0,
    store: '', // 'localStorage' | 'fs' | 'none' — last channel that accepted a write
    beats: 0, // Time.onPerMinute heartbeats — proves the service is alive
    lastBeatAt: 0,
    screen: { status: 0, offCount: 0, lastOffAt: 0, lastOnAt: 0 }, // 1 on, 2 off
    wear: { status: -1, changes: 0 },
    hr: { samples: 0, last: 0 }, // control: a low-power sensor the docs allow
    accel: { ctor: '', start: '', samples: 0, lastSampleAt: 0, sinceScreenOff: 0, perMinute: 0, lastG: 0 },
    detector: { candidates: 0, falls: 0, lastFallAt: 0 },
    vib: '', // '' untried, 'ok', or 'error: …'
    notify: '',
    errors: [],
  }
}

export function noteError(stats, where, e) {
  const msg = `${where}: ${(e && e.message) || e}`
  if (stats.errors.length < MAX_ERRORS) stats.errors.push(msg)
  console.log('[probe] ' + msg)
}

/** Persist the record; returns true if some channel accepted it. */
export function saveProbe(stats) {
  stats.updatedAt = Date.now()
  try {
    stats.store = 'localStorage'
    localStorage.setItem(KEY, JSON.stringify(stats))
    return true
  } catch (e) {
    noteError(stats, 'localStorage.setItem', e)
  }
  try {
    stats.store = 'fs'
    writeFileSync({ path: FILE, data: JSON.stringify(stats), options: { encoding: 'utf8' } })
    return true
  } catch (e) {
    noteError(stats, 'fs.writeFileSync', e)
  }
  stats.store = 'none'
  return false
}

export function loadProbe() {
  try {
    const v = localStorage.getItem(KEY)
    if (v) return typeof v === 'string' ? JSON.parse(v) : v
  } catch (e) {
    /* fall through */
  }
  try {
    const v = readFileSync({ path: FILE, options: { encoding: 'utf8' } })
    if (typeof v === 'string' && v) return JSON.parse(v)
  } catch (e) {
    /* nothing recorded */
  }
  return null
}

export function clearProbe() {
  try {
    localStorage.removeItem(KEY)
  } catch (e) {
    /* ignore */
  }
  try {
    rmSync(FILE)
  } catch (e) {
    /* ignore */
  }
}
