import { BaseSideService } from '@zeppos/zml/base-side'
import WatchplusSide from '../../amazla/watchplus/app-side/index.js'
import { WP_STATUS } from '../../amazla/watchplus/shared/messages.js'
import { FG_SETTINGS, SS_ALL_DAY, settingsOf } from '../shared/settings.js'
import { watchplusConfig } from '../shared/watchplus-config.js'

// The phone half serves All-day mode only: its licence (amazla/watchplus — the settings
// page buys and activates through WP_ACTION in settingsStorage, and the watch asks
// WP_STATUS once per launch while it is not licensed) and its on/off switch
// (shared/settings.js). No fall data ever comes here.
const watchplus = new WatchplusSide({ config: watchplusConfig })

AppSideService(
  BaseSideService({
    onInit() {
      // Settings-page commands + weekly revalidation. Wrapped so a licensing fault can
      // never take the service down.
      try {
        watchplus.init()
      } catch (e) {
        console.log('[watchplus] init failed', e)
      }
    },

    // zml answers with res(error, result); the watch's utils/zml-bridge.js hands the
    // result to watchplus as { result }, the shape its MessageBuilder would produce.
    onRequest(req, res) {
      if (req && req.method === WP_STATUS) return res(null, { verdict: watchplus.verdict() })
      if (req && req.method === FG_SETTINGS) return res(null, settingsOf(settings.settingsStorage))
      res('unknown method')
    },

    // The switch flipped on the settings page: tell the watch now, which only lands while
    // Fall Guard is open and connected; otherwise it asks the next time it opens. zml also
    // calls this when a settings change is what started the service.
    onSettingsChange(change) {
      if (!change || change.key !== SS_ALL_DAY) return
      Promise.resolve()
        .then(() => this.call({ method: FG_SETTINGS, params: settingsOf(settings.settingsStorage) }))
        .catch((e) => console.log('[settings] push failed', e))
    },

    onRun() {},

    onDestroy() {
      watchplus.destroy()
    },
  }),
)
