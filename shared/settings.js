// Settings shared by the watch and the phone settings page (setting/index.js):
//
// - All-day mode's on/off switch exists on the phone only. The watch keeps a copy
//   (utils/prefs.js 'allDay') so the switch holds while the phone is away.
// - Sensitivity can be picked on either side (page/settings.js on the watch). Each pick
//   is stamped with its time and the later one wins (mergeSensitivity).
//
// The watch asks FG_SETTINGS whenever Fall Guard opens (app.js), and the phone pushes the
// same message when a setting changes while the watch is listening (app-side/index.js).
// A pick on the watch, or a newer one the watch holds, goes to the phone as FG_SAVE.
// Shared by the watch, the phone side and the settings page: no @zos imports here.

export const FG_SETTINGS = 'FG_SETTINGS'
export const FG_SAVE = 'FG_SAVE'

export const SENSITIVITY = Object.freeze({ RELAXED: 'relaxed', BALANCED: 'balanced', WATCHFUL: 'watchful' })
const LEVELS = [SENSITIVITY.RELAXED, SENSITIVITY.BALANCED, SENSITIVITY.WATCHFUL]
export const isSensitivity = (v) => LEVELS.indexOf(v) !== -1

// settingsStorage keys. All-day mode follows amazla/talkie's convention: '0' = off;
// anything else, or absent, = on. Sensitivity is the level id plus the pick's time in ms,
// written in that order so the time's change event finds the level already there.
export const SS_ALL_DAY = 'allDay'
export const SS_SENSITIVITY = 'sensitivity'
export const SS_SENSITIVITY_AT = 'sensitivityAt'

export const allDayOn = (raw) => raw !== '0'

/** What the phone tells the watch, read from settingsStorage. */
export const settingsOf = (storage) => {
  const level = storage.getItem(SS_SENSITIVITY)
  return {
    allDay: allDayOn(storage.getItem(SS_ALL_DAY)),
    sensitivity: isSensitivity(level) ? level : null, // null: never picked on the phone
    sensitivityAt: Number(storage.getItem(SS_SENSITIVITY_AT)) || 0,
  }
}

/**
 * The later pick wins. `local` is the watch's { sensitivity, at }; `remote` is what the
 * phone sent (settingsOf). Returns { adopt, at } when the watch should take the phone's
 * level, { tell } when the phone should be told the watch's, or {} when they agree.
 */
export const mergeSensitivity = (local, remote) => {
  const theirs = remote && isSensitivity(remote.sensitivity) ? remote.sensitivityAt || 0 : 0
  const mine = (local && local.at) || 0
  if (theirs > mine) return { adopt: remote.sensitivity, at: theirs }
  if (mine > theirs && isSensitivity(local.sensitivity)) return { tell: { sensitivity: local.sensitivity, sensitivityAt: mine } }
  return {}
}

/** Phone side: store a pick the watch sent (FG_SAVE) if it is later than the stored one. */
export const storeSensitivity = (storage, pick) => {
  if (!pick || !isSensitivity(pick.sensitivity)) return false
  if (!(pick.sensitivityAt > (Number(storage.getItem(SS_SENSITIVITY_AT)) || 0))) return false
  storage.setItem(SS_SENSITIVITY, pick.sensitivity)
  storage.setItem(SS_SENSITIVITY_AT, String(pick.sensitivityAt))
  return true
}
