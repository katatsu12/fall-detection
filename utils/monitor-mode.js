/**
 * Monitor mode — what makes foreground monitoring liveable (README §10.5).
 * Zepp OS won't sample the accelerometer in the background, so Home stays in
 * the foreground with the screen technically on; this module makes that
 * cheap and self-healing:
 *
 *  - dim() / undim(): lowest brightness while nothing is shown (Home also
 *    hides its widgets, so the OLED is black). The original brightness and
 *    auto-brightness are saved in memory *and* localStorage, and
 *    restoreDisplay() on the next launch undoes a dim that a crash or kill
 *    never got to undo.
 *  - keepAwake() / isAwake(): one "screen wanted until" deadline in
 *    getApp().globalData, bumped by any page's interaction — Home won't dim
 *    while the wearer is busy on Settings, which is pushed on top of it.
 *  - armRelaunch() / disarmRelaunch(): dead-man's switch. Home keeps a
 *    one-shot @zos/alarm pointed at page/index RELAUNCH_S ahead and pushes
 *    it out every REARM_MS while alive. Leave the app or let the OS kill it
 *    and the alarm brings monitoring back; only an explicit pause disarms.
 */
import { getBrightness, setBrightness, getAutoBrightness, setAutoBrightness } from '@zos/display'
import { set as setAlarm, cancel as cancelAlarm, getAllAlarms, REPEAT_ONCE } from '@zos/alarm'
import { queryPermission, requestPermission } from '@zos/app'
import { localStorage } from '@zos/storage'

export const RELAUNCH_S = 90 // alarm delay; must comfortably exceed REARM_MS
export const REARM_MS = 30000
export const DIM_BRIGHTNESS = 5 // 0–100; pixels are black anyway, this only covers whatever the OS may draw
const SAVED_KEY = 'display.saved'
const ALARM_PERMISSION = 'device:os.alarm'
const NOT_GRANTED = 0
const GRANTED = 2

const shared = () => getApp()._options.globalData

// ---------- screen wanted ----------

export function keepAwake(ms) {
  const g = shared()
  g.awakeUntil = Math.max(g.awakeUntil || 0, Date.now() + ms)
}

export function isAwake() {
  return Date.now() < (shared().awakeUntil || 0)
}

// ---------- brightness ----------

let saved = null // { brightness, auto } while dimmed

function apply(s) {
  try {
    setBrightness({ brightness: s.brightness })
    if (s.auto) setAutoBrightness({ autoBright: true })
  } catch (e) {
    console.log('[monitor] restore brightness failed', e)
  }
}

export function isDimmed() {
  return saved !== null
}

export function dim() {
  if (saved) return
  let brightness
  let auto = false
  try {
    brightness = getBrightness()
    auto = !!getAutoBrightness()
  } catch (e) {
    return
  }
  if (typeof brightness !== 'number') return // firmware without the API: stay bright (widgets are hidden anyway)
  saved = { brightness, auto }
  try {
    localStorage.setItem(SAVED_KEY, saved)
  } catch (e) {
    /* no safety net, still fine */
  }
  try {
    if (auto) setAutoBrightness({ autoBright: false }) // setBrightness is ignored while auto is on
    setBrightness({ brightness: DIM_BRIGHTNESS })
  } catch (e) {
    console.log('[monitor] dim failed', e)
    undim()
  }
}

export function undim() {
  if (!saved) return
  apply(saved)
  saved = null
  try {
    localStorage.removeItem(SAVED_KEY)
  } catch (e) {
    /* ignore */
  }
}

/** Call on Home init: undo a dim left behind by a run that never reached undim(). */
export function restoreDisplay() {
  let s = null
  try {
    s = localStorage.getItem(SAVED_KEY)
    if (typeof s === 'string') s = JSON.parse(s)
  } catch (e) {
    s = null
  }
  if (!s || typeof s.brightness !== 'number') return false
  apply(s)
  try {
    localStorage.removeItem(SAVED_KEY)
  } catch (e) {
    /* ignore */
  }
  console.log('[monitor] restored brightness left at', DIM_BRIGHTNESS)
  return true
}

// ---------- dead-man's switch ----------

let alarmId = 0
let alarmDenied = false

function alarmAllowed() {
  if (alarmDenied) return false
  let status = GRANTED
  try {
    status = queryPermission({ permissions: [ALARM_PERMISSION] })[0]
  } catch (e) {
    return true // no query API: just try
  }
  if (status !== NOT_GRANTED) return true // granted, or a static permission the query doesn't know
  requestPermission({
    permissions: [ALARM_PERMISSION],
    callback: (result) => {
      alarmDenied = !(result && result[0] === GRANTED)
      console.log('[monitor] alarm permission', alarmDenied ? 'denied' : 'granted')
    },
  })
  return false // this attempt is skipped; the next re-arm retries
}

/**
 * Cancel every alarm this app owns except `keep`. Each page is its own
 * bundle with its own `alarmId`, so a Home re-created by replace() or a
 * relaunch can't see the alarm an earlier Home set; getAllAlarms() can.
 */
function cancelAll(keep) {
  let ids = alarmId ? [alarmId] : []
  try {
    ids = getAllAlarms() || ids
  } catch (e) {
    /* older firmware: fall back to the one we know */
  }
  for (const id of ids) {
    if (id === keep) continue
    try {
      cancelAlarm(id)
    } catch (e) {
      console.log('[monitor] alarm cancel failed', id, e)
    }
  }
}

/** Point a fresh alarm at `url`, then drop every other one — never a gap, never more than one. */
export function armRelaunch(url) {
  if (!alarmAllowed()) return false
  const id = setAlarm({ url, delay: RELAUNCH_S, repeat_type: REPEAT_ONCE, store: false, param: 'relaunch' })
  if (!id) {
    console.log('[monitor] alarm set failed')
    return false
  }
  cancelAll(id)
  alarmId = id
  return true
}

export function disarmRelaunch() {
  cancelAll(0)
  alarmId = 0
}

export function isRelaunchArmed() {
  return alarmId !== 0
}
