/**
 * Where phase 1 recordings live on the watch: one JSON file per recording in
 * the app's /data/rec folder (@zos/fs), an index with labels and retention
 * state, and one summary file per day. Zepp OS only; the pure logic is in
 * utils/candidate-recorder.js.
 *
 * Every call reads and writes the files directly. Pages are separate
 * bundles, so a module-level cache in Home would overwrite a label the
 * result page wrote in between. The day summary being built lives in the
 * shared session (utils/recorder-session.js) for the same reason.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from '@zos/fs'

const DIR = 'rec'
const INDEX = `${DIR}/index.json`
export const MAX_BYTES = 4 * 1024 * 1024 // unsent recordings; the 10% sample goes first
const EVICT_ORDER = ['sampled', 'v1_rejected', 'wear_off', null] // null: anything left, oldest first
const DAY_UPLOAD_EVERY_MS = 10 * 60 * 1000 // today's summary is re-sent at most this often

let dirReady = false

function ensureDir() {
  if (dirReady) return
  try {
    mkdirSync({ path: DIR })
  } catch (e) {
    /* already exists */
  }
  dirReady = true
}

function readJson(path) {
  try {
    const s = readFileSync({ path, options: { encoding: 'utf8' } })
    return typeof s === 'string' && s ? JSON.parse(s) : null
  } catch (e) {
    return null
  }
}

/** Throws when the write fails. */
function writeJson(path, value) {
  ensureDir()
  const data = JSON.stringify(value)
  writeFileSync({ path, data, options: { encoding: 'utf8' } })
  return data.length
}

function remove(path) {
  try {
    rmSync({ path })
  } catch (e) {
    /* already gone */
  }
}

const recPath = (id) => `${DIR}/${id}.json`
const dayPath = (date) => `${DIR}/day-${date}.json`

function loadIndex() {
  const idx = readJson(INDEX)
  if (!idx || !Array.isArray(idx.items)) return { items: [], days: {}, evicted: {} }
  return { days: {}, evicted: {}, ...idx }
}

function saveIndex(idx) {
  try {
    writeJson(INDEX, idx)
  } catch (e) {
    console.log('[rec] index write failed', e)
  }
}

function evict(idx) {
  let total = idx.items.reduce((a, it) => a + it.bytes, 0)
  for (const keep of EVICT_ORDER) {
    for (let i = 0; i < idx.items.length && total > MAX_BYTES; ) {
      const it = idx.items[i]
      if (keep !== null && it.keep !== keep) {
        i++
        continue
      }
      remove(recPath(it.id))
      total -= it.bytes
      idx.evicted[it.keep] = (idx.evicted[it.keep] || 0) + 1 // reported with the day summary
      idx.items.splice(i, 1)
    }
  }
}

// ---------- recordings ----------

/** Write a candidate or staged recording and index it. Returns false if the file could not be written. */
export function saveRecording(rec) {
  let bytes
  try {
    bytes = writeJson(recPath(rec.id), rec)
  } catch (e) {
    console.log('[rec] write failed', rec.id, e)
    return false
  }
  const idx = loadIndex()
  idx.items = idx.items.filter((it) => it.id !== rec.id)
  idx.items.push({ id: rec.id, keep: rec.keep || rec.kind, bytes, label: null })
  evict(idx)
  saveIndex(idx)
  return true
}

/** Merge `label` into a recording's label, e.g. { outcome: 'ok', fell: false }. */
export function labelRecording(id, label) {
  const idx = loadIndex()
  const it = idx.items.find((i) => i.id === id)
  if (!it) return false
  it.label = { ...(it.label || {}), ...label }
  saveIndex(idx)
  return true
}

export function storeStats() {
  const idx = loadIndex()
  return {
    count: idx.items.length,
    bytes: idx.items.reduce((a, it) => a + it.bytes, 0),
    evicted: idx.evicted,
  }
}

// ---------- day summaries ----------

export function dateKey(t) {
  const d = new Date(t)
  const two = (n) => (n < 10 ? '0' : '') + n
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}`
}

function emptyDay(date) {
  // candidates: [t0, peakG, v1, keep, weight, truncated]; samples: [t, battery %, accel Hz, gyro Hz, mode]
  return { v: 1, kind: 'summary', date, wornMs: 0, monitoredMs: 0, candidates: [], samples: [] }
}

/** Today's summary in the shared session; reloaded from its file after an app restart, rolled over at midnight. */
function currentDay(session, now) {
  const date = dateKey(now)
  if (session.day && session.day.date === date) return session.day
  if (session.day) saveDay(session) // final write of the previous day
  session.day = readJson(dayPath(date)) || emptyDay(date)
  return session.day
}

export function noteCandidate(session, line, now) {
  currentDay(session, now).candidates.push([line.t0, line.peakG, line.v1, line.keep, line.weight, line.truncated ? 1 : 0])
}

export function addTime(session, wornMs, monitoredMs, now) {
  const d = currentDay(session, now)
  d.wornMs += wornMs
  d.monitoredMs += monitoredMs
}

export function noteSample(session, s, now) {
  currentDay(session, now).samples.push([Math.round(now), s.battery, s.accelHz, s.gyroHz, s.mode])
}

export function saveDay(session) {
  const d = session.day
  if (!d) return
  try {
    writeJson(dayPath(d.date), d)
  } catch (e) {
    console.log('[rec] day write failed', e)
    return
  }
  const idx = loadIndex()
  idx.days[d.date] = { ...(idx.days[d.date] || {}), changedAt: Date.now() }
  saveIndex(idx)
}

// ---------- upload queue ----------

/**
 * The next thing to send: the oldest recording (with its label), else a day
 * summary that changed since it was last sent — today's at most every
 * 10 minutes. Returns { type, id, body } or null.
 */
export function nextUpload(now) {
  const idx = loadIndex()
  for (const it of idx.items) {
    const body = readJson(recPath(it.id))
    if (body) {
      body.label = it.label
      return { type: 'rec', id: it.id, body }
    }
    console.log('[rec] unreadable, dropping', it.id)
    idx.items = idx.items.filter((x) => x.id !== it.id)
    saveIndex(idx)
    return null
  }
  const today = dateKey(now)
  for (const date of Object.keys(idx.days).sort()) {
    const info = idx.days[date]
    if ((info.uploadedAt || 0) >= (info.changedAt || 0)) continue
    if (date === today && now - (info.uploadedAt || 0) < DAY_UPLOAD_EVERY_MS) continue
    const body = readJson(dayPath(date))
    if (body) return { type: 'day', id: date, body: { ...body, evicted: idx.evicted } }
  }
  return null
}

/** After the phone confirmed: delete a recording; mark a day sent (and delete it once it is over). */
export function markUploaded(item, now) {
  const idx = loadIndex()
  if (item.type === 'rec') {
    remove(recPath(item.id))
    idx.items = idx.items.filter((it) => it.id !== item.id)
  } else if (item.id === dateKey(now)) {
    idx.days[item.id] = { ...(idx.days[item.id] || {}), uploadedAt: now }
  } else {
    remove(dayPath(item.id))
    delete idx.days[item.id]
  }
  saveIndex(idx)
}
