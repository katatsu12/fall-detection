import { SS_VERDICT } from '../../amazla/watchplus/shared/config.js'
import { unlocks } from '../../amazla/watchplus/shared/verdict.js'
import { WatchplusButton, openWatchplusDialog } from '../../amazla/watchplus/settings/index.js'
import { SENSITIVITY, SS_ALL_DAY, SS_SENSITIVITY, SS_SENSITIVITY_AT, allDayOn, settingsOf } from '../shared/settings.js'
import { watchplusConfig } from '../shared/watchplus-config.js'
import { DEBUG } from '../utils/debug.js'

// Phone settings (Zepp app → Fall Guard): All-day mode's on/off switch and the button that
// buys or activates it (amazla/watchplus — checkout through the Watch+ Worker, the key comes
// back by itself), and the sensitivity, which the watch offers too; shared/settings.js
// carries both to the watch. Unlicensed, the switch is locked and opens the purchase
// dialog, the pattern of amazla/talkie's Pro switches. The button must stay in the tree:
// its off-screen Auth() is what catches the checkout's return, and the dialog it owns is
// what a locked switch opens. Colours and wording follow the watch (utils/theme.js,
// page/i18n/en-US.po).

const PAGE = {
  minHeight: '100vh',
  boxSizing: 'border-box',
  padding: '24px 16px 40px',
  background: '#000000',
  color: '#ffffff',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontSize: '15px',
  lineHeight: '1.45',
}
const TITLE = { display: 'block', fontSize: '22px', fontWeight: '700', marginBottom: '4px' }
const SECTION = { display: 'block', fontSize: '17px', fontWeight: '600', marginTop: '28px' }
const MUTED = { display: 'block', color: '#9a9da3', fontSize: '14px' }
const NOTE = { ...MUTED, marginTop: '8px' }
const CARD = { background: '#1d1e20', borderRadius: '16px', padding: '14px 16px', marginTop: '12px' }
const CARD_TITLE = { display: 'block', fontWeight: '600', marginBottom: '4px' }
const CARD_TEXT = { display: 'block', color: '#c6c9ce', fontSize: '14px' }
const ROW = { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '12px' }
const ROW_TEXTS = { flex: 1, minWidth: 0 }
const TITLE_ROW = { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', marginBottom: '4px' }
const LOCKED = { opacity: 0.6 }
const PRO_TAG = {
  padding: '2px 7px',
  borderRadius: '8px',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '0.04em',
  color: '#ffffff',
  background: '#ff3b2f',
}
const TRACK = {
  position: 'relative',
  width: '48px',
  height: '28px',
  borderRadius: '100vw',
  flexShrink: 0,
  cursor: 'pointer',
  boxSizing: 'border-box',
  background: '#2a2d31',
  border: '1px solid #4a4e54',
}
const TRACK_ON = { background: '#1fc08a', border: '1px solid #1fc08a' }
const KNOB = {
  position: 'absolute',
  top: '3px',
  left: '3px',
  width: '20px',
  height: '20px',
  borderRadius: '50%',
  background: '#ffffff',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.45)',
}
const KNOB_ON = { transform: 'translateX(20px)' }
const BUY = { background: '#ff3b2f', border: '1px solid #ff3b2f', color: '#ffffff', fontWeight: '600', fontSize: '15px' }
// Sensitivity rows, as on the watch (design 2A): the picked one on a red card with a red
// border and a filled radio; the others dark with a grey ring. Same border width on both,
// so picking doesn't shift the layout.
const LEVEL = {
  ...ROW,
  boxSizing: 'border-box',
  background: '#1d1e20',
  border: '2px solid #1d1e20',
  borderRadius: '16px',
  padding: '12px 14px',
  marginTop: '8px',
  cursor: 'pointer',
}
const LEVEL_ON = { background: '#2a1712', border: '2px solid #ff3b2f' }
const RADIO = { position: 'relative', width: '22px', height: '22px', flexShrink: 0, boxSizing: 'border-box', borderRadius: '50%', border: '3px solid #4a4e54' }
const RADIO_ON = { background: '#ff3b2f', border: '3px solid #ff3b2f' }
const RADIO_DOT = { position: 'absolute', top: '4px', left: '4px', width: '8px', height: '8px', borderRadius: '50%', background: '#000000' }
const LEVEL_LABEL = { display: 'block', fontWeight: '600', color: '#e8e9eb' }
const LEVEL_SUB = { display: 'block', fontSize: '14px', color: '#8a8f96' }

const LEVELS = [
  { id: SENSITIVITY.RELAXED, label: 'Relaxed', sub: 'Hard falls only' },
  { id: SENSITIVITY.BALANCED, label: 'Balanced', sub: 'What we suggest' },
  { id: SENSITIVITY.WATCHFUL, label: 'Watchful', sub: 'May ask more often' },
]

const Card = (title, text) =>
  View({ style: CARD }, [Text({ style: CARD_TITLE }, title), Text({ style: CARD_TEXT }, text)])

const Switch = (on, onClick) =>
  View({ style: on ? { ...TRACK, ...TRACK_ON } : TRACK, onClick }, [View({ style: on ? { ...KNOB, ...KNOB_ON } : KNOB })])

const Level = ({ label, sub }, on, onClick) =>
  View({ style: on ? { ...LEVEL, ...LEVEL_ON } : LEVEL, onClick }, [
    View({ style: on ? { ...RADIO, ...RADIO_ON } : RADIO }, [on ? View({ style: RADIO_DOT }) : null]),
    View({ style: ROW_TEXTS }, [
      Text({ style: on ? { ...LEVEL_LABEL, color: '#ffffff' } : LEVEL_LABEL }, label),
      Text({ style: on ? { ...LEVEL_SUB, color: '#c6c9ce' } : LEVEL_SUB }, sub),
    ]),
  ])

const verdict = (storage) => {
  try {
    return JSON.parse(storage.getItem(SS_VERDICT) || 'null')
  } catch (_e) {
    return null
  }
}

AppSettingsPage({
  build({ settingsStorage }) {
    // DEBUG builds unlock All-day mode on the watch without a licence (utils/pro.js), so
    // the switch follows suit there.
    const locked = !DEBUG && !unlocks(verdict(settingsStorage), 'pro', watchplusConfig)
    const on = !locked && allDayOn(settingsStorage.getItem(SS_ALL_DAY))
    const flip = (e) => (locked ? openWatchplusDialog(e) : settingsStorage.setItem(SS_ALL_DAY, on ? '0' : '1'))

    // Never picked here: the watch's default until it tells us otherwise.
    const level = settingsOf(settingsStorage).sensitivity || SENSITIVITY.BALANCED
    // Level first, then the time: the time's change is what the phone side sends on.
    const pick = (id) => () => {
      if (id === level) return
      settingsStorage.setItem(SS_SENSITIVITY, id)
      settingsStorage.setItem(SS_SENSITIVITY_AT, String(Date.now()))
    }

    return View({ style: PAGE }, [
      Text({ style: TITLE }, 'Fall Guard'),
      Text({ style: MUTED }, 'Fall Guard can only watch for falls while it is open on your watch. All-day mode keeps it open.'),
      View({ style: locked ? { ...CARD, ...LOCKED } : CARD }, [
        View({ style: ROW }, [
          View({ style: ROW_TEXTS }, [
            View({ style: TITLE_ROW }, [Text({ style: { fontWeight: '600' } }, 'All-day mode'), locked ? Text({ style: PRO_TAG }, 'PRO') : null]),
            Text(
              { style: CARD_TEXT },
              'Keeps watching with the screen dark, wakes when you raise your wrist, and reopens itself within 90 seconds if it closes. Uses more battery.',
            ),
          ]),
          Switch(on, flip),
        ]),
      ]),
      locked
        ? Card(
            'Without it',
            'Fall Guard watches only while it is on screen. The watch closes it about 10 seconds after the screen goes off, and it stops watching.',
          )
        : null,
      WatchplusButton({ settingsStorage, config: watchplusConfig, label: 'Unlock All-day mode · $2.99', style: BUY }),
      Text({ style: MUTED }, 'One-time purchase, for up to 3 watches.'),

      Text({ style: SECTION }, 'How careful?'),
      ...LEVELS.map((l) => Level(l, l.id === level, pick(l.id))),
      Text({ style: NOTE }, "Also on your watch: swipe up on Fall Guard's home screen."),

      Text({ style: { ...NOTE, marginTop: '28px' } }, 'Your watch picks up changes the next time Fall Guard opens, or right away if it is open.'),
      Text({ style: NOTE }, 'Fall Guard alerts you on your wrist only; it does not contact anyone.'),
    ])
  },
})
