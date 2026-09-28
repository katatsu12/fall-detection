// All-day mode's on/off switch lives on the phone settings page (setting/index.js). The
// watch keeps a copy (utils/prefs.js 'allDay') so the switch holds while the phone is away:
// it asks FG_SETTINGS whenever Fall Guard opens (app.js), and the phone pushes the same
// message when the switch flips while the watch is listening (app-side/index.js).
// Shared by the watch, the phone side and the settings page: no @zos imports here.

export const FG_SETTINGS = 'FG_SETTINGS'

// settingsStorage key, amazla/talkie's convention: '0' = off; anything else, or absent, = on.
export const SS_ALL_DAY = 'allDay'

export const allDayOn = (raw) => raw !== '0'

/** What the phone tells the watch, read from settingsStorage. */
export const settingsOf = (storage) => ({ allDay: allDayOn(storage.getItem(SS_ALL_DAY)) })
