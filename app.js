import { BaseApp } from '@zeppos/zml/base-app'

// BaseApp wires up zml's device ↔ phone messaging in globalData so pages that
// use BasePage can call this.request() / this.call().
App(
  BaseApp({
    globalData: {},
    onCreate(options) {
      // The monitor-mode relaunch alarm passes param 'relaunch' (utils/monitor-mode.js).
      console.log('app on create invoke', options ? JSON.stringify(options) : '')
    },
    onDestroy(options) {
      console.log('app on destroy invoke')
    },
  }),
)
