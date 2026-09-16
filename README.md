# Fall Detection — Zepp OS Mini Program

A Zepp OS app that watches the wrist-worn accelerometer for the signature of a
human fall (free-fall → impact → stillness), vibrates and asks "Are you OK?",
and — if the wearer doesn't respond — forwards an SOS through the phone to an
emergency contact.

> **Safety note.** A wrist-worn, threshold-based detector will miss some falls
> and will raise some false alarms (clapping, sitting down hard, dropping the
> arm onto a table). Treat this as an assistive tool, not a medical device.
> Newer Amazfit devices ship a native fall-detection feature in system settings;
> this project is a third-party implementation for learning and customisation.

---

## 1. What the Zepp OS docs tell us (research summary)

Sources: <https://docs.zepp.com/docs/reference/app-json/> and the linked
device-app / side-service API references (see §10 for the full list).

### 1.1 Sensors we can use

| Sensor | Import | Permission | API_LEVEL | Notes |
|---|---|---|---|---|
| `Accelerometer` | `@zos/sensor` | `device:os.accelerometer` | 3.0 | `getCurrent()` → `{x, y, z}` in **cm/s²**. `onChange(cb)`, `start()`, `stop()`, `setFreqMode(FREQ_MODE_LOW / NORMAL / HIGH)`. Exact Hz per mode is not published — measure it (§8). |
| `Gyroscope` | `@zos/sensor` | `device:os.gyroscope` | 3.0 | `{x, y, z}` in degrees/second. Optional; improves rejection of hand-only motion. |
| `Wear` | `@zos/sensor` | — | 2.0 | `getStatus()` → `0` not worn, `1` worn, `2` in motion, `3` unsure. Use it to pause detection when the watch is off the wrist. |
| `Vibrator` | `@zos/sensor` | — | 2.0 | `VIBRATOR_SCENE_STRONG_REMINDER` (4 pulses/1200 ms), `VIBRATOR_SCENE_CALL` (loops until `stop()`). |

Axes: x/y are parallel to the screen, z is perpendicular (positive = up out of
the screen). **1 g ≈ 980.665 cm/s²**.

### 1.2 The critical constraint: no accelerometer in the background

The app-service guide states that inside a background `AppService`:

- **Unavailable:** `@zos/ui`, `setTimeout`, and *high-power sensors —
  Accelerometer, Gyroscope, Geolocation*.
- Available: HeartRate and other low-power sensors, notifications, BLE, `get*` APIs.

So continuous fall monitoring **cannot** run as a background service. It has to
run in a **foreground page** that we deliberately keep alive:

| API (`@zos/display`) | Purpose |
|---|---|
| `setPageBrightTime({ brightTime })` | Keep the screen lit; range 1 000 – 2 147 483 000 ms (default 10 000). Reset on page destroy. |
| `pauseDropWristScreenOff({ duration })` | Stop the "wrist down → screen off" behaviour; `duration: 0` = until `resetDropWristScreenOff()`. API_LEVEL 2.1. |
| `setWakeUpRelaunch({ relaunch: true })` | By default the system quits a mini program ~10 s after the screen goes off and returns to the watch face on wake. With `relaunch: true` it re-opens our page instead. |

Trade-off: battery. The README's design uses `FREQ_MODE_LOW` where possible,
lets the screen dim (not the process), and gives the user an explicit
Start/Stop toggle.

### 1.3 Alerting the wearer and the outside world

- **On-watch prompt:** navigate to a dedicated page (`@zos/router push`) that
  vibrates and shows a countdown with "I'm OK" / "Send SOS" buttons.
- **`notify()`** (`@zos/notification`, permission `device:os.notification`,
  API_LEVEL 3.0) posts a system notification; its `actions[].file` launches an
  *app-service* file (not a page). Useful for a "fall recorded" receipt, not for
  the interactive prompt.
- **Reaching the phone:** `@zeppos/zml` gives `BasePage.request()` on the device
  and `BaseSideService.onRequest(req, res)` in `app-side/`. The app-side service
  can call `fetch({ url, method, headers, body })` to hit any HTTPS endpoint
  (Twilio, a webhook, your own server). Note `res.body` may arrive as a string
  on some models — type-check before `JSON.parse`. ZML ≥ 0.0.28 needs
  API_LEVEL 3.6, so this project pins `@zeppos/zml@0.0.27`.

### 1.4 Permissions we need in `app.json`

```json
"permissions": [
  "device:os.accelerometer",
  "device:os.gyroscope",
  "device:os.notification",
  "device:os.local_storage"
]
```

`device:os.bg_service` is **not** needed — we can't use the sensor there anyway
(§1.2). Add it only if you later add a low-power heart-rate watchdog service.

### 1.5 Toolchain

- Node.js ≥ 14 (docs); use an LTS release.
- `npm i @zeppos/zeus-cli -g` → `zeus login`, `zeus create`, `zeus dev`
  (simulator, hot reload), `zeus preview` (QR install to a real watch via the
  Zepp app's Developer Mode), `zeus build` (→ `dist/`).
- Zepp OS Simulator (desktop) for UI work. **The simulator does not generate
  real accelerometer data** — we add a synthetic-sample injector for that (§8).

---

## 2. Architecture

```
┌────────────────────── Watch (device app) ──────────────────────┐
│                                                                │
│  page/index.js  ── monitoring screen, keeps page alive         │
│      │  onChange @ FREQ_MODE_NORMAL                            │
│      ▼                                                         │
│  utils/fall-detector.js  ── pure state machine (no zOS deps)   │
│      │  emits 'fall'                                           │
│      ▼                                                         │
│  page/alert.js  ── vibrate, 30 s countdown, I'm OK / Send SOS  │
│      │  zml this.request({ method: 'sos.send' })               │
└──────┼─────────────────────────────────────────────────────────┘
       │ BLE
┌──────▼───────────── Phone (app-side service) ──────────────────┐
│  app-side/index.js ── onRequest → fetch(POST webhook/Twilio)   │
│  setting/index.js  ── emergency contact, webhook URL, sens.    │
└────────────────────────────────────────────────────────────────┘
```

Project layout:

```
fall-detection/
├── app.js                 # App() lifecycle (onCreate / onDestroy)
├── app.json               # manifest — see §4
├── package.json           # deps: @zeppos/zml
├── assets/<device>/       # icon.png per target
├── page/
│   ├── index.js           # monitoring UI + sensor wiring
│   └── alert.js           # countdown / confirmation
├── utils/
│   ├── fall-detector.js   # algorithm (unit-testable in Node)
│   └── ring-buffer.js
├── app-side/index.js      # SOS forwarding via fetch()
├── setting/index.js       # settings UI on the phone
└── test/
    ├── fall-detector.test.js
    └── fixtures/*.json    # recorded accel traces (real falls / ADLs)
```

---

## 3. Detection algorithm

Classic multi-phase threshold detector on the Signal Magnitude Vector (SMV).
All thresholds in *g*; convert samples with `g = sqrt(x²+y²+z²) / 980.665`.

```
        ┌─────────┐  SMV < FREEFALL_G   ┌──────────┐  SMV > IMPACT_G  ┌────────────┐
 ──────►│  IDLE   │────────────────────►│ FREEFALL │─────────────────►│   IMPACT   │
        └─────────┘                     └──────────┘   within         └─────┬──────┘
             ▲                               │         IMPACT_WINDOW        │
             │ timeout                       │ timeout                      │ wait STILL_DELAY
             │                               ▼                              ▼
             │                          back to IDLE                  ┌────────────┐
             │                                                        │ POST-IMPACT│
             │  variance > STILL_VAR  (person moved → not a fall)     │  (STILL)   │
             └────────────────────────────────────────────────────────┤            │
                                                                      └─────┬──────┘
                                              variance < STILL_VAR over STILL_WINDOW
                                              AND (optional) orientation change > ANGLE
                                                                            │
                                                                            ▼
                                                                     emit 'fall' + COOLDOWN
```

Default parameters (starting points from the wrist-worn fall-detection
literature, e.g. Bourke 2007 / Kangas 2008 — **tune on your own recordings**):

| Name | Default | Meaning |
|---|---|---|
| `FREEFALL_G` | 0.6 | SMV below this ⇒ possible free fall |
| `IMPACT_G` | 2.5 | SMV above this ⇒ impact |
| `IMPACT_WINDOW_MS` | 600 | impact must follow free-fall start within this |
| `STILL_DELAY_MS` | 1000 | ignore bounce/flailing right after impact |
| `STILL_WINDOW_MS` | 2000 | window for the stillness test |
| `STILL_VAR_G` | 0.15 | std-dev of SMV must stay below this |
| `ANGLE_DEG` | 60 | optional: angle between pre-fall and post-fall gravity vectors |
| `COOLDOWN_MS` | 10000 | suppress re-triggers after an event |

Extras that cut false positives cheaply:

- Skip everything when `Wear.getStatus() === 0` (not worn).
- If Gyroscope is enabled, require peak angular rate > ~200 dps around impact
  (a real fall rotates the body; a clap rotates only the hand and is brief).
- Ignore impacts where the *pre-fall* window already had high variance for
  > 5 s (running / sports) — or expose a "sport mode" pause.

---

## 4. `app.json` for this app

Field reference per <https://docs.zepp.com/docs/reference/app-json/>. This is
what `zeus create` (v1.9.3, API 3.0 "Empty" template) generates, plus our
permissions and naming — it is the file checked in at the repo root.

```json
{
  "configVersion": "v3",
  "app": {
    "appId": 27081,
    "appName": "Fall Detection",
    "appType": "app",
    "version": { "code": 1, "name": "1.0.0" },
    "icon": "icon.png",
    "vender": "zepp",
    "description": "Detects falls and alerts an emergency contact"
  },
  "permissions": [
    "device:os.accelerometer",
    "device:os.gyroscope",
    "device:os.notification",
    "device:os.local_storage"
  ],
  "runtime": {
    "apiVersion": { "compatible": "3.0.0", "target": "3.0.0", "minVersion": "3.0" }
  },
  "targets": {
    "default": {
      "module": {
        "page": { "pages": ["page/index"] },
        "app-side": { "path": "app-side/index" },
        "setting": { "path": "setting/index" }
      },
      "platforms": [{ "st": "r", "dw": 480 }]
    }
  },
  "i18n": { "en-US": { "appName": "Fall Detection" } },
  "defaultLanguage": "en-US",
  "debug": true
}
```

- `configVersion: "v3"` is the current manifest format.
- `runtime.apiVersion.minVersion: "3.0"` because Accelerometer / Gyroscope /
  `notify` / `requestPermission` all start at API_LEVEL 3.0. Raise `target`
  (and `minVersion`) to 3.6 only if you upgrade `@zeppos/zml` past 0.0.27.
- `targets.default.platforms` uses the **shape-based** form: `st` is the screen
  type (`r` round, `s` square, `b` band) and `dw` the design width. One entry
  covers every device of that shape; `zeus build` then emits per-device
  packages. Per-device `deviceSource` targets are the older v2 style and are
  not needed here.
- `module.page.pages` must list **every** page you `push()` to — add
  `"page/alert"` when that file exists (§5 Step 5).
- `appId` / `vender` are placeholders assigned by the CLI; `zeus login` +
  the developer console give you real ones before publishing.

---

## 5. Step-by-step implementation

### Step 0 — Prerequisites

1. Install Node LTS and the CLI: `npm i @zeppos/zeus-cli -g`.
2. Install the Zepp OS Simulator (from the Zepp developer site) and log in:
   `zeus login`.
3. On your phone, open the Zepp app → Profile → *your watch* → Developer Mode
   (tap the app version 7× if hidden). You need a watch running **Zepp OS 3.0+**.
4. Decide how the SOS leaves the phone: an HTTPS webhook you own, IFTTT/Make,
   or Twilio's SMS API. You'll need the URL + token later.

### Step 1 — Scaffold  ✅ done (2026-09-16)

```bash
cd /Users/katatsu12/Documents/zepp_app
zeus create fall-detection --appType app --APILevel 3.0 --template Empty --withAppSide --withSettings
cd fall-detection
npm i @zeppos/zml@0.0.27 --save-exact   # last release that runs on API_LEVEL 3.0 (0.0.28+ needs 3.6)
zeus build                              # sanity check → dist/*.zab
zeus dev                                # live preview in the simulator
```

Flag notes for zeus-cli 1.9.3: `--appType` must be lowercase `app`; `--template`
is the template's display name (`Empty` or `Hello_World`); `--withAppSide` /
`--withSettings` only apply to the `Empty` template; the device-shape prompt
defaults to round (`--shape s` / `b` for square / band). With all flags set the
command runs without prompts.

Generated layout (before our additions):

```
fall-detection/
├── app.js  app.json  package.json  jsconfig.json  global.d.ts
├── assets/default.{r,s,b}/icon.png    # one icon per screen shape
├── page/index.js  page/index.r.layout.js  page/i18n/en-US.po
├── app-side/index.js  app-side/i18n/en-US.po
└── setting/index.js   setting/i18n/en-US.po
```

`page/index.js` imports `zosLoader:./index.[pf].layout.js` — the loader picks
`index.r.layout.js` / `index.s.layout.js` per screen shape. Keep layout
constants there and logic in `index.js`.

### Step 2 — Edit `app.json`  ✅ done

§4 is applied: name, description, permissions, `debug`. Still to do later:
add `"page/alert"` to `module.page.pages` once that page exists.

### Step 3 — Write the detector (`utils/fall-detector.js`)

Pure JS, no Zepp imports, so it runs under Node for tests.

```js
const G = 980.665 // cm/s² per g

export function createFallDetector(opts = {}) {
  const P = {
    FREEFALL_G: 0.6, IMPACT_G: 2.5, IMPACT_WINDOW_MS: 600,
    STILL_DELAY_MS: 1000, STILL_WINDOW_MS: 2000, STILL_VAR_G: 0.15,
    ANGLE_DEG: 60, USE_ANGLE: false, COOLDOWN_MS: 10000, ...opts,
  }
  let state = 'IDLE', tFreefall = 0, tImpact = 0, tCooldownUntil = 0
  let pre = [], post = []                     // {t, x, y, z, g}
  const listeners = []

  function magnitude(x, y, z) { return Math.sqrt(x*x + y*y + z*z) / G }
  function stddev(arr) {
    const m = arr.reduce((a, s) => a + s.g, 0) / arr.length
    return Math.sqrt(arr.reduce((a, s) => a + (s.g - m) ** 2, 0) / arr.length)
  }
  function meanVec(arr) {
    const n = arr.length
    return arr.reduce((a, s) => [a[0]+s.x/n, a[1]+s.y/n, a[2]+s.z/n], [0,0,0])
  }
  function angleDeg(a, b) {
    const dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2]
    const na = Math.hypot(...a), nb = Math.hypot(...b)
    return Math.acos(Math.max(-1, Math.min(1, dot / (na*nb || 1)))) * 180 / Math.PI
  }

  return {
    onFall(cb) { listeners.push(cb) },
    getState() { return state },
    /** Feed one sample. t = ms timestamp, x/y/z in cm/s². */
    push(t, x, y, z) {
      const g = magnitude(x, y, z)
      const s = { t, x, y, z, g }
      pre.push(s); while (pre.length && t - pre[0].t > 1500) pre.shift()
      if (t < tCooldownUntil) return

      switch (state) {
        case 'IDLE':
          if (g < P.FREEFALL_G) { state = 'FREEFALL'; tFreefall = t }
          break
        case 'FREEFALL':
          if (g > P.IMPACT_G) { state = 'IMPACT'; tImpact = t; post = [] }
          else if (t - tFreefall > P.IMPACT_WINDOW_MS) state = 'IDLE'
          break
        case 'IMPACT':
          if (t - tImpact >= P.STILL_DELAY_MS) { state = 'STILL'; post = [] }
          break
        case 'STILL': {
          post.push(s)
          const elapsed = t - (tImpact + P.STILL_DELAY_MS)
          if (elapsed < P.STILL_WINDOW_MS) break
          const still = stddev(post) < P.STILL_VAR_G
          const angleOk = !P.USE_ANGLE ||
            angleDeg(meanVec(pre.filter(p => p.t < tFreefall)), meanVec(post)) > P.ANGLE_DEG
          if (still && angleOk) {
            tCooldownUntil = t + P.COOLDOWN_MS
            listeners.forEach(cb => cb({ t: tImpact, peakG: Math.max(...post.map(p => p.g), P.IMPACT_G) }))
          }
          state = 'IDLE'
          break
        }
      }
    },
  }
}
```

### Step 4 — Monitoring page (`page/index.js`)

Responsibilities: request permissions, start the sensor, keep the page alive,
feed samples to the detector, show status, and route to the alert page.

```js
import { Accelerometer, Wear, FREQ_MODE_NORMAL } from '@zos/sensor'
import { setPageBrightTime, pauseDropWristScreenOff, resetDropWristScreenOff,
         setWakeUpRelaunch } from '@zos/display'
import { push } from '@zos/router'
import { queryPermission, requestPermission } from '@zos/app'
import { createWidget, widget, prop } from '@zos/ui'
import { BasePage } from '@zeppos/zml/base-page'
import { createFallDetector } from '../utils/fall-detector'

const PERMS = ['device:os.accelerometer']

Page(BasePage({
  state: { running: false, accel: null, wear: null, detector: null, statusText: null },

  onInit() {
    setWakeUpRelaunch({ relaunch: true })      // come back to this page after screen-off
    this.state.detector = createFallDetector()
    this.state.detector.onFall(evt => {
      this.stopMonitoring()
      push({ url: 'page/alert', params: JSON.stringify(evt) })
    })
  },

  build() {
    this.state.statusText = createWidget(widget.TEXT, {
      x: 0, y: 160, w: 480, h: 60, text_size: 32, align_h: 1, text: 'Stopped',
    })
    createWidget(widget.BUTTON, {
      x: 90, y: 260, w: 300, h: 80, text: 'Start / Stop', radius: 40,
      click_func: () => (this.state.running ? this.stopMonitoring() : this.ensurePermsThenStart()),
    })
  },

  ensurePermsThenStart() {
    const [granted] = queryPermission({ permissions: PERMS })
    if (granted === 2) return this.startMonitoring()
    requestPermission({ permissions: PERMS, callback: ([r]) => r === 2 && this.startMonitoring() })
  },

  startMonitoring() {
    const { detector } = this.state
    this.state.wear = new Wear()
    this.state.accel = new Accelerometer()
    this.state.accel.setFreqMode(FREQ_MODE_NORMAL)
    this.state.accel.onChange(() => {
      if (this.state.wear.getStatus() === 0) return          // not on wrist
      const { x, y, z } = this.state.accel.getCurrent()
      detector.push(Date.now(), x, y, z)
    })
    this.state.accel.start()
    setPageBrightTime({ brightTime: 2147483000 })            // keep page alive
    pauseDropWristScreenOff({ duration: 0 })
    this.state.running = true
    this.state.statusText.setProperty(prop.TEXT, 'Monitoring…')
  },

  stopMonitoring() {
    if (this.state.accel) { this.state.accel.offChange(); this.state.accel.stop() }
    resetDropWristScreenOff()
    this.state.running = false
    this.state.statusText && this.state.statusText.setProperty(prop.TEXT, 'Stopped')
  },

  onDestroy() { this.stopMonitoring() },
}))
```

### Step 5 — Alert page (`page/alert.js`)

```js
import { Vibrator, VIBRATOR_SCENE_CALL } from '@zos/sensor'
import { back } from '@zos/router'
import { createWidget, widget, prop } from '@zos/ui'
import { BasePage } from '@zeppos/zml/base-page'

const COUNTDOWN_S = 30

Page(BasePage({
  state: { remaining: COUNTDOWN_S, timer: null, vib: null, label: null },

  onInit(params) { this.state.event = params ? JSON.parse(params) : {} },

  build() {
    this.state.vib = new Vibrator()
    this.state.vib.start(VIBRATOR_SCENE_CALL)                // loops until stop()

    createWidget(widget.TEXT, { x: 0, y: 80, w: 480, h: 60, text_size: 36, align_h: 1,
      text: 'Fall detected' })
    this.state.label = createWidget(widget.TEXT, { x: 0, y: 150, w: 480, h: 80,
      text_size: 64, align_h: 1, text: String(COUNTDOWN_S) })
    createWidget(widget.BUTTON, { x: 40, y: 260, w: 400, h: 80, radius: 40,
      text: "I'm OK", normal_color: 0x1e7f3a, click_func: () => this.dismiss() })
    createWidget(widget.BUTTON, { x: 40, y: 360, w: 400, h: 80, radius: 40,
      text: 'Send SOS now', normal_color: 0xa02020, click_func: () => this.sendSos() })

    this.state.timer = setInterval(() => {
      this.state.remaining -= 1
      this.state.label.setProperty(prop.TEXT, String(this.state.remaining))
      if (this.state.remaining <= 0) this.sendSos()
    }, 1000)
  },

  sendSos() {
    this.cleanup()
    this.state.label.setProperty(prop.TEXT, 'Sending…')
    this.request({ method: 'sos.send', params: { ...this.state.event, ts: Date.now() } })
      .then(r => this.state.label.setProperty(prop.TEXT, r && r.ok ? 'SOS sent' : 'Send failed'))
      .catch(() => this.state.label.setProperty(prop.TEXT, 'No phone connection'))
  },

  dismiss() { this.cleanup(); back() },

  cleanup() {
    if (this.state.timer) { clearInterval(this.state.timer); this.state.timer = null }
    if (this.state.vib) this.state.vib.stop()
  },

  onDestroy() { this.cleanup() },
}))
```

### Step 6 — App-side service (`app-side/index.js`)

Runs inside the Zepp phone app. Receives the SOS and forwards it over HTTPS.

```js
import { BaseSideService } from '@zeppos/zml/base-side'

AppSideService(BaseSideService({
  onRequest(req, res) {
    if (req.method !== 'sos.send') return res(null, { ok: false, error: 'unknown method' })

    const url = settings.settingsStorage.getItem('webhookUrl')
    const contact = settings.settingsStorage.getItem('contact')
    if (!url) return res(null, { ok: false, error: 'no webhook configured' })

    fetch({
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'fall', contact, ...req.params }),
    })
      .then(r => res(null, { ok: r.status >= 200 && r.status < 300, status: r.status }))
      .catch(e => res(null, { ok: false, error: String(e) }))
  },
}))
```

For Twilio, point `url` at a tiny relay you host (Cloud Function / Worker) that
holds the Twilio credentials — never ship API secrets inside the mini program.

### Step 7 — Settings page (`setting/index.js`)

Rendered in the Zepp phone app. Store: emergency contact, webhook URL,
countdown seconds, sensitivity (which maps to `IMPACT_G` / `STILL_VAR_G`).

```js
AppSettingsPage({
  build(props) {
    return View({}, [
      TextInput({ label: 'Emergency contact', settingsKey: 'contact' }),
      TextInput({ label: 'Webhook URL', settingsKey: 'webhookUrl' }),
      Select({ label: 'Sensitivity', settingsKey: 'sensitivity',
        options: [{ name: 'Low', value: 'low' }, { name: 'Normal', value: 'normal' }, { name: 'High', value: 'high' }] }),
    ])
  },
})
```

Push sensitivity to the watch on change (app-side `onSettingsChange` →
`this.call({ method: 'config.update', params })`; device `onCall` → rebuild
the detector with new thresholds and persist with `@zos/storage`).

### Step 8 — Test in the simulator with synthetic data

The simulator returns no real accelerometer motion, so add a debug button on
`page/index` (only when `app.json` has `"debug": true`) that replays a fixture:

```js
import fall from '../test/fixtures/fall_forward.json'   // [{dt, x, y, z}, …]
let t = Date.now()
fall.forEach(s => { t += s.dt; this.state.detector.push(t, s.x, s.y, s.z) })
```

Also unit-test the detector under Node (`node --test test/`) with fixtures for:
a forward fall, a sideways fall, sitting down hard, clapping, running, and
putting the watch on a table. Assert exactly one `fall` for the first two and
none for the rest.

### Step 9 — Test on a real watch and tune

```bash
zeus preview          # scan QR with Zepp app → installs on watch
```

1. Add a "Record" mode that logs `{dt,x,y,z}` to `@zos/fs` for 60 s; export via
   the app-side (`this.call` chunks) or `zeus bridge` logs.
2. Measure the real sample rate per `FREQ_MODE_*` on your device — window sizes
   in ms assume you know it.
3. Record ~10 simulated falls onto a mattress plus ~30 daily activities.
4. Tune §3 thresholds until you get zero false alarms on ADLs and ≥ 90 % recall
   on the mattress falls. Expect wrist data to be noisier than the literature's
   waist-mounted numbers.
5. Battery: run for a full day; if drain is unacceptable drop to
   `FREQ_MODE_LOW` and re-tune, or shorten `setPageBrightTime` and rely on
   `setWakeUpRelaunch` (verify on your device whether sensor callbacks continue
   with the screen off — behaviour is not documented and varies by firmware).

### Step 10 — Build and ship

```bash
zeus build            # → dist/*.zab
```

Upload through the Zepp developer console, or side-load with `zeus preview`.

---

## 6. Runtime flow (happy path)

1. User opens app → taps Start → permission prompt for accelerometer (once).
2. Page keeps running; detector consumes samples at `FREQ_MODE_NORMAL`.
3. Fall signature matched → `push('page/alert')`, sensor stopped.
4. Watch vibrates in `VIBRATOR_SCENE_CALL` pattern, 30 s countdown shown.
5. a) "I'm OK" → back to monitoring. b) Timeout or "Send SOS" →
   `request('sos.send')` over BLE → app-side `fetch` → webhook → SMS/call.
6. Result shown on watch ("SOS sent" / "No phone connection").

## 7. Known limitations

- **Foreground only.** Zepp OS forbids the accelerometer in background
  services, so detection stops when the user leaves the app or the OS reclaims
  the page. Communicate this clearly in the UI.
- **No phone = no outbound alert.** BLE range to the phone is required for the
  SOS. Consider an on-watch fallback such as a loud `notify()` plus repeating
  vibration until dismissed.
- **Wrist placement.** Wrist accelerations from arm swings can exceed 2.5 g.
  The stillness phase is what makes this usable — don't remove it.
- **Simulator.** No sensor data; test the algorithm in Node and on hardware.
- **Not certified.** Not a substitute for a medical alert service.

## 8. Things to measure early (they're not in the docs)

| Unknown | How to find out |
|---|---|
| Actual Hz of `FREQ_MODE_LOW/NORMAL/HIGH` | Count `onChange` calls over 10 s on the target watch |
| Whether `onChange` keeps firing with the screen off but page alive | Log timestamps to `@zos/fs`, wrist-down, wait 30 s, check |
| `setPageBrightTime` vs. system max-screen-on settings interaction | Try it; some firmware caps it |
| BLE `request()` timeout when the phone is out of range | Time a request with Bluetooth off on the phone |

## 9. Next-step ideas

- Heart-rate sanity check after impact (available even in app-service).
- GPS fix from the phone side (`app-side` has access to phone location on some
  Zepp app versions) attached to the SOS payload.
- Auto-resume monitoring when the watch is re-worn (`Wear.onChange`).
- Replace the threshold state machine with a small decision tree trained on
  your recorded fixtures — the `push(t,x,y,z)` interface stays the same.

## 10. Documentation links

- app.json reference — <https://docs.zepp.com/docs/reference/app-json/>
- Accelerometer — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Accelerometer/>
- Gyroscope — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Gyroscope/>
- Wear — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Wear/>
- Vibrator — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Vibrator/>
- Display: setPageBrightTime / pauseDropWristScreenOff / setWakeUpRelaunch — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/display/setPageBrightTime/>
- App Service guide (background limits) — <https://docs.zepp.com/docs/guides/framework/device/app-service/>
- `@zos/app-service` start — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-service/start/>
- `@zos/app` requestPermission — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/app/requestPermission/>
- `@zos/notification` notify — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/notification/notify/>
- `@zos/alarm` set — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/alarm/set/>
- Side-service fetch — <https://docs.zepp.com/docs/reference/side-service-api/fetch/>
- ZML (device ↔ phone messaging) — <https://github.com/zepp-health/zml>
- Zeus CLI — <https://docs.zepp.com/docs/guides/tools/cli/>
