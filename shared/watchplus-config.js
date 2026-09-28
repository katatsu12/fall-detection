// The only per-app licensing code (amazla/watchplus, wired like amazla/talkie). Pro is
// All-day mode: Home keeps watching with the screen dark and reopens itself if closed
// (utils/pro.js). Fall Guard sells its own Pro only — Watch+ is not launched, so
// `checkout.watchplus: null` keeps every Watch+ surface out of the app. Ids are logical;
// the Watch+ Worker maps them to whatever provider sells them.
//
// "Fall Guard Pro" — $2.99 one-time, limit 3 watches (the Worker's rule).
import { WP_API } from '../../amazla/watchplus/shared/config.js'

export const FALL_GUARD_PRO_PRODUCT_ID = 'fall-guard-pro'

export const watchplusConfig = {
  app: 'fall-guard',
  features: {
    pro: [FALL_GUARD_PRO_PRODUCT_ID],
  },
  checkout: {
    single: WP_API + '/buy/fall-guard-pro?app=fall-guard',
    watchplus: null,
  },
  labels: {
    app: 'Fall Guard', // as the Zepp app lists it — the pro page points people there
    title: 'All-day mode',
    pitch: 'Keeps watching with the screen dark\nand reopens itself if closed.',
    // The figure is set in the provider's dashboard; this is the US price, repeated on
    // the watch. Change it here whenever the dashboard changes.
    single: '$2.99 once',
  },
}
