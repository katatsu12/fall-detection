import { BaseApp } from '@zeppos/zml/base-app'
import * as fs from '@zos/fs'
import Watchplus from '../amazla/watchplus/app.js'
import { FG_SETTINGS } from './shared/settings.js'
import { watchplusConfig } from './shared/watchplus-config.js'
import { applyPhoneSettings } from './utils/prefs.js'
import { zmlBridge } from './utils/zml-bridge.js'

// BaseApp wires up zml's device ↔ phone messaging in globalData so pages that
// use BasePage can call this.request() / this.call().
App(
  BaseApp({
    globalData: {
      watchplus: null, // All-day mode's licence, read by utils/pro.js
    },
    onCreate(options) {
      // The monitor-mode relaunch alarm passes param 'relaunch' (utils/monitor-mode.js).
      console.log('app on create invoke', options ? JSON.stringify(options) : '')

      // Reads the cached verdict from watchplus.json (v3: the @zos/fs module goes in);
      // asks the phone once only while not licensed. BaseApp's mixins have already put
      // `messaging` in globalData. Wrapped so licensing can never abort onCreate.
      try {
        this.globalData.watchplus = new Watchplus({
          config: watchplusConfig,
          messageBuilder: zmlBridge(this.globalData.messaging),
          dialogPath: 'page/pro',
          fs,
        }).init()
      } catch (e) {
        console.log('[watchplus] init failed', e)
      }

      // All-day mode's switch is on the phone settings page (shared/settings.js): take its
      // position whenever Fall Guard opens. Phone away: the watch's copy stands.
      try {
        this.globalData.messaging
          .request({ method: FG_SETTINGS })
          .then(applyPhoneSettings)
          .catch(() => {})
      } catch (e) {
        console.log('[settings] request failed', e)
      }
    },
    // The phone pushes the switch when it flips while Fall Guard is open (app-side/index.js).
    onCall(data) {
      if (data && data.method === FG_SETTINGS) applyPhoneSettings(data.params)
    },
    onDestroy(options) {
      console.log('app on destroy invoke')
    },
  }),
)
