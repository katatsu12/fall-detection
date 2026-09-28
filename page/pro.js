import { back } from '@zos/router'
import { paywall } from '../../amazla/watchplus/page/paywall.js'
import { hideStatusBar } from '../utils/theme'

// "All-day mode": shell for amazla/watchplus's pro page — app.json needs a page path
// inside the app. Title, pitch and price come from shared/watchplus-config.js. v3-only:
// no hmUI/hmApp globals, so the status bar and the way back are ours. Home (underneath)
// switches to All-day mode on its next tick once "I've bought it" finds the licence.
const page = paywall(null, { back })

Page({
  build() {
    hideStatusBar()
    page.build()
  },
  onDestroy() {
    page.onDestroy()
  },
})
