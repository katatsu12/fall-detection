import { BaseApp } from '@zeppos/zml/base-app'
import * as fs from '@zos/fs'
import Watchplus from '../amazla/watchplus/app.js'
import { FG_SAVE, FG_SETTINGS } from './shared/settings.js'
import { watchplusConfig } from './shared/watchplus-config.js'
import { applyPhoneSettings } from './utils/prefs.js'
import { zmlBridge } from './utils/zml-bridge.js'

// Take the phone's settings (shared/settings.js). If the watch holds the later sensitivity
// pick — made while the phone was away — send it back so the phone settings page shows it.
const settle = (messaging, remote) => {
  const tell = applyPhoneSettings(remote)
  if (!tell) return
  try {
    messaging.request({ method: FG_SAVE, params: tell }).catch(() => {})
  } catch (e) {
    console.log('[settings] save to phone failed', e)
  }
}

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

      // All-day mode's switch and the sensitivity are also on the phone settings page
      // (shared/settings.js): sync them whenever Fall Guard opens. Phone away: the watch's
      // copies stand.
      try {
        const messaging = this.globalData.messaging
        messaging
          .request({ method: FG_SETTINGS })
          .then((remote) => settle(messaging, remote))
          .catch(() => {})
      } catch (e) {
        console.log('[settings] request failed', e)
      }
    },
    // The phone pushes its settings when they change while Fall Guard is open (app-side/index.js).
    onCall(data) {
      if (data && data.method === FG_SETTINGS) settle(this.globalData.messaging, data.params)
    },
    onDestroy(options) {
      console.log('app on destroy invoke')
    },
  }),
)
