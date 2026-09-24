# Fall Guard — Zepp OS Mini Program

**Fall Guard** is a Zepp OS app that watches the wrist-worn accelerometer for the signature of a
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
device-app / side-service API references (see §11 for the full list).

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

`device:os.bg_service` is only there for the background probe (§10) — the
accelerometer can't be used in a service (§1.2), so the production path
doesn't need it.

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
│  page/alert.js  ── vibrate, 30 s countdown, I'm fine / Get help│
│      │  replace() on timeout or "Get help now"                 │
│      ▼                                                         │
│  page/result.js ── zml this.request({ method: 'sos.send' })    │
│      │                          page/settings.js ── sensitivity│
└──────┼─────────────────────────────────────────────────────────┘
       │ BLE
┌──────▼───────────── Phone (app-side service) ──────────────────┐
│  app-side/index.js ── onRequest → fetch(POST webhook/Twilio)   │
│  setting/index.js  ── emergency contact, webhook URL + token   │
└────────────────────────────────────────────────────────────────┘
```

Project layout (the directory and git repo keep the name `fall-detection`;
the app itself is called **Fall Guard**):

```
fall-detection/
├── app.js                 # App() lifecycle (onCreate / onDestroy)
├── app.json               # manifest — see §4
├── package.json           # deps: @zeppos/zml
├── assets/<device>/       # icon.png per target
├── page/
│   ├── index.js  index.{r,s}.layout.js      # Home: ring + facts, sensor wiring
│   ├── alert.js  alert.{r,s}.layout.js      # "Are you alright?" countdown
│   ├── result.js result.{r,s}.layout.js    # "Glad you're OK" / "Contacting"
│   ├── settings.js settings.{r,s}.layout.js # "How careful?" sensitivity
│   ├── probe.js  probe.{r,s}.layout.js      # background probe (developer screen, §10)
│   └── record.js record.{r,s}.layout.js    # staged recordings + rates (developer screen, §12)
├── utils/
│   ├── fall-detector.js   # algorithm (unit-testable in Node)
│   ├── prefs.js           # localStorage-backed settings + sensitivity → presets
│   ├── monitor-mode.js    # dimming, shared "awake" deadline, dead-man's alarm (§10.5)
│   ├── raise-detector.js  # raise-to-wake from the accel stream (pure, tested)
│   ├── probe-store.js     # record shared by the probe service and its page
│   ├── theme.js           # palette from the design
│   ├── demo-trace.js      # generated synthetic fall for the debug replay
│   ├── debug.js           # DEBUG switch, recorder on/off, frequency-mode override (§12)
│   ├── ring-buffer.js     # typed-array sample history (pure, tested; v2 reuses it)
│   ├── impact-trigger.js  # the 1.8 g candidate trigger (pure, tested; v2 reuses it)
│   ├── candidate-recorder.js # windows around impacts, keep policy (pure, tested)
│   ├── rate-meter.js      # sensor rate + jitter (pure, tested)
│   ├── uploader.js        # one upload at a time with backoff (pure, tested)
│   ├── recording-store.js # recordings, labels, day summaries in /data/rec
│   └── recorder-session.js # recorder state shared across pages via globalData
├── tools/
│   ├── render-mocks.py    # layout → PNG mocks (npm run mocks)
│   ├── webhook-dev-server.js # SOS test receiver + recording sink (npm run webhook)
│   └── eval.js eval-lib.js   # npm run eval (§12.6)
├── eval/report.json       # latest evaluation report, committed with detector changes
├── app-service/probe.js   # device background service: feasibility probe (§10)
├── app-side/index.js      # SOS forwarding via fetch(), recording upload
├── setting/index.js       # settings UI on the phone
├── data/                  # recordings and public datasets (git-ignored)
└── test/
    ├── fall-detector.test.js  raise-detector.test.js
    ├── ring-buffer, impact-trigger, candidate-recorder, rate-meter, uploader, eval .test.js
    └── fixtures/*.json    # synthetic accel traces (falls / ADLs)
```

---

## 2b. Design (implemented 2026-09-16)

Source: Claude Design project *Fall Detection App Interface* →
`Fall Guard - Zepp OS.dc.html`, section **2A** ("Warm tone, two escalation
steps, both screen shapes"). Four screens × round 480 and square 390×450.
The SOS-sent state, which 2A doesn't cover, adapts 1A's "Contacting" screen.

| Screen | Page | What's on it |
|---|---|---|
| Home — "You're covered" | `page/index` | Simplified from the design: a single coverage ring with the shield, centred, the state title beneath it (covered / paused / not on wrist) and a clock line above, since in monitor mode this screen *is* the wearer's watch face. The three info rows were dropped on 2026-09-16. |
| Fall detected — "Are you alright?" | `page/alert` | Red countdown ring, "We'll call {contact}, then emergency services", white **I'm fine** pill, **Get help now** link. |
| Confirmed — "Glad you're OK" | `page/result?type=ok` | Green check disc, "Nobody was called. We'll keep watching.", closes in 3 s. |
| Contacting | `page/result?type=sos` | Initials avatar, contact name, live status of the `sos.send` request, **Done**. |
| Sensitivity — "How careful?" | `page/settings` | Relaxed / Balanced / Watchful radio rows (→ `PRESETS.low/normal/high`), *Watch siren* toggle. |

Interactions the design leaves implicit:

- Home: **tap the ring** to pause/resume monitoring, **swipe up** for
  Sensitivity, **long-press the ring** to replay a synthetic fall (`DEBUG`).
- Monitor mode (§10.5): 20 s after the last interaction Home hides
  everything and drops the brightness — black OLED. **Tap anywhere** or
  **raise the wrist** to see it again. Leaving the app (side button) or an
  OS kill brings Home back within 90 s by itself; **pausing** (tap the ring
  while awake) is the only thing that switches that off.
- Alert: swipes are swallowed during the countdown so a gesture can't dismiss it.
- Navigation through the alert flow is `replace()` end-to-end
  (`index → alert → result → index`), so every page is built fresh.
- Sensitivity is `push()`ed on top of Home instead, so Home stays alive
  underneath. API 3.0 pages have no `onResume`, so Home re-reads the stored
  sensitivity in its 1 s tick and rebuilds the detector when it changed
  (`[detector] rebuilt for sensitivity …` in the log); an evaluation in
  progress is left to finish first.

Design → Zepp OS mapping:

| Design | Watch |
|---|---|
| Conic-gradient rings | `widget.ARC` track + progress, `start_angle: -90` (0° is 3 o'clock) |
| Shield / check icons | `assets/default.{r,s}/shield.png` (68 / 62 px), `check.png` (60 / 54 px) rendered from the SVG paths with `rsvg-convert` |
| Radial red glow | three translucent `CIRCLE`s (`alpha` 18/22/26); a gradient PNG would be ~900 KB once the build converts it to TGA |
| White pill / text link | `BUTTON` with `normal_color` white / black |
| Radio rows, toggle | `FILL_RECT` + `STROKE_RECT` + `CIRCLE`, both states pre-created and swapped with `prop.VISIBLE` |
| Noto Sans, weights, pulse animation | system font; not reproducible — skipped |
| App icon | red disc + white shield (`assets/default.*/icon.png`) |

Palette lives in `utils/theme.js`; per-shape geometry in `page/<page>.{r,s}.layout.js`.
`npm run mocks` renders every screen for both shapes to `tools/mocks/sheet.png`
straight from the layout files (no simulator needed) — check it after moving
anything.

Not wired yet: the **siren** toggle persists but no audio plays (needs an
audio asset + `@zos/media`). `contactName` is read from `@zos/storage`; the
phone settings page (Step 7) pushes it there through the app-side.

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
    "appName": "Fall Guard",
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
    "device:os.local_storage",
    "device:os.alarm",
    "device:os.bg_service"
  ],
  "runtime": {
    "apiVersion": { "compatible": "3.0.0", "target": "3.0.0", "minVersion": "3.0" }
  },
  "targets": {
    "default": {
      "module": {
        "page": { "pages": ["page/index", "page/alert", "page/result", "page/settings", "page/probe"] },
        "app-service": { "services": ["app-service/probe"] },
        "app-side": { "path": "app-side/index" },
        "setting": { "path": "setting/index" }
      },
      "platforms": [
        { "st": "r", "dw": 480 },
        { "st": "s", "dw": 390 }
      ]
    }
  },
  "i18n": { "en-US": { "appName": "Fall Guard" } },
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
  not needed here. Each shape needs its own `page/<name>.<st>.layout.js`
  (`index.r.layout.js` for round, `index.s.layout.js` for square — the
  **Amazfit Active** is square, 390×450, API_LEVEL 3.6) and
  `assets/default.<st>/icon.png`.
- `module.page.pages` must list **every** page you navigate to.
- `module.app-service.services` lists the **device** background services
  (§10); `device:os.bg_service` is the matching permission and is also
  requested at runtime with `requestPermission` before `start()`.
- `device:os.alarm` is for the monitor-mode relaunch alarm (§10.5);
  `utils/monitor-mode.js` also asks for it with `requestPermission` if
  `queryPermission` reports it as not granted.
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

§4 is applied: name, description, permissions, `debug`, all four pages.

### Step 3 — Write the detector (`utils/fall-detector.js`)  ✅ done

Pure JS, no Zepp imports, so it runs under Node for tests and compiles to
QuickJS bytecode unchanged (verified with `zeus build`). Public API:

```js
import { createFallDetector, replay, PRESETS, STATE, magnitudeG } from '../utils/fall-detector'

const d = createFallDetector(PRESETS.normal)   // or { impactG: 2.8, useAngle: true, ... }

d.push(t, x, y, z)        // t in ms, x/y/z in cm/s²; returns the event when one fires, else null
d.pushGyro(t, x, y, z)    // optional, dps; only consulted when minGyroDps > 0
d.onFall(evt => …)        // confirmed falls — returns an unsubscribe fn
d.onCandidate(c => …)     // every completed evaluation, with c.fall and c.reasons[] — use for tuning
d.getState()              // 'IDLE' | 'FREEFALL' | 'IMPACT' | 'STILL'
d.getConfig(); d.reset()

replay(d, samples)        // feed [{dt, x, y, z}, …] and return the events that fired
```

Event / candidate payload:

```js
{ t, freefallMs, peakG, stillStd, angleDeg, gyroPeakDps, samples, fall, reasons }
// reasons ⊂ ['too_few_samples', 'not_still', 'no_orientation_change', 'no_rotation']
```

Options (all in `DEFAULTS`): `freefallG 0.6`, `impactG 2.5`, `impactWindowMs 600`,
`stillDelayMs 1000`, `stillWindowMs 2000`, `stillStdG 0.15`, `minStillSamples 4`,
`useAngle false`, `angleDeg 60`, `preWindowMs 1500`, `minGyroDps 0`,
`cooldownMs 10000`. `PRESETS.low / normal / high` map the settings-page
sensitivity onto `freefallG` / `impactG` / `stillStdG`.

Tests and fixtures:

```bash
npm test            # node --test — state machine, ADL rejection, presets, angle/gyro gates, fixtures
npm run fixtures    # regenerates test/fixtures/*.json from test/helpers/synth.js
```

`test/helpers/synth.js` builds deterministic traces (`rest / freefall / impact /
motion / spike`) in the same `{dt,x,y,z}` format as device recordings, so
synthetic fixtures and real ones are interchangeable. `test/fixtures.test.js`
asserts every `fall_*.json` fires exactly once and every `adl_*.json` never
does — drop real recordings in with those name prefixes and they're covered
automatically.

### Step 4 — Monitoring page (`page/index.js`)  ✅ done · UI replaced by the design in §2b

Files: `page/index.js` (logic), `page/index.r.layout.js` (round-screen
positions/colours, picked by `zosLoader:./index.[pf].layout.js`),
`page/i18n/en-US.po` (strings), `app.js` (now `BaseApp`), `utils/demo-trace.js`
(generated).

What the page does:

1. `onInit` — `setWakeUpRelaunch({ relaunch: true })` so a screen wake returns
   here instead of the watch face; builds the detector and logs every
   candidate as `[fall-candidate] {...}` for tuning.
2. `startMonitoring()` (auto on open, or by tapping the ring while awake) —
   creates `Wear` + `Accelerometer`, `setFreqMode(FREQ_MODE_NORMAL)`,
   `start()`, then `setPageBrightTime({ brightTime: 2147483000 })` and
   `pauseDropWristScreenOff({ duration: 0 })` to keep the page alive, and
   arms the relaunch alarm (§10.5).
3. `onSample()` — reads `getCurrent()`, counts the sample for the rate /
   coverage stats, and feeds the detector unless `Wear.getStatus() === 0`
   (not worn). A wear-off also `reset()`s the detector so a half-seen fall
   can't span a gap.
4. A 1 s `tick()` rolls the coverage ring (share of 5 s buckets that had
   samples while worn, over the last 5 min), logs `[rate] …` every 5 s
   when `DEBUG` — the **measured sample rate** and callback jitter, first
   unknown in §8 (format in §12.5) — and
   re-reads the stored sensitivity, rebuilding the detector if Settings
   changed it (that page is `push`ed on top, so Home never gets a fresh
   `onInit`), dims/undims the screen and re-arms the relaunch alarm every
   30 s (§10.5). Widgets are never touched per sample — except that every
   sample also feeds `utils/raise-detector.js`, which wakes a dimmed screen.
5. `onFall` — disarms the relaunch alarm (the alert flow returns here by
   itself), wakes the screen, stops the sensor, sets the title to "Fall
   detected" and `replace({ url: 'page/alert', params: JSON.stringify(evt) })`.
6. `stopMonitoring()` / `onDestroy` — `offChange(cb)` + `stop()` on both
   sensors (the same function objects that went into `onChange` — the typings
   require the callback), clears the timer, `resetPageBrightTime()`,
   `resetDropWristScreenOff()`, restores brightness; `onDestroy` also
   `offGesture()`s but leaves the relaunch alarm armed — only `pause()` (the
   wearer's tap) disarms it.
7. Long-pressing the ring (`DEBUG = true` at the top of the file) replays
   `DEMO_FALL` from `utils/demo-trace.js` straight into the detector, so the
   whole flow can be exercised in the simulator where there is no sensor data.

Things that differ from the original sketch:

- **No runtime permission request.** `device:os.accelerometer` is a static
  permission granted by `app.json`; `@zos/app requestPermission` is for
  *dynamic* permissions such as `device:os.bg_service`.
- **`app.js` must use zml's `BaseApp`.** `BasePage` reads its messaging
  channel from `getApp()._options.globalData`, so a plain `App({})` makes
  every `BasePage.onInit` throw.
- Page lifecycle at API 3.0 is `onInit(params)` / `build` / `onDestroy` only.
  (`onResume` / `onPause` exist at runtime and zml forwards them, but the 3.0
  typings don't declare them — don't rely on them.)
- `utils/demo-trace.js` is written by `npm run fixtures` from the same
  synthetic `fall_forward` trace the tests use — regenerate, don't edit.

Build note: zeus's esbuild pass scans every `.js` in the project, including
`test/`, and warns on `import.meta` — so test helpers use `process.cwd()`
-relative paths instead (`npm` always runs scripts from the package root).

### Step 5 — Alert page (`page/alert.js`)  ✅ done · UI replaced by the design in §2b (result states moved to `page/result.js`)

Files: `page/alert.js`, `page/alert.r.layout.js`, `page/alert.s.layout.js`,
strings in `page/i18n/en-US.po`, `"page/alert"` added to `app.json` pages.

Flow:

1. `onInit(params)` parses the detector event `page/index` passed as JSON.
2. `build` — `setPageBrightTime` for countdown + 60 s,
   `pauseDropWristScreenOff({ duration: 0 })`, and
   `onGesture(() => phase === 'countdown')` so a swipe can't dismiss the alert
   by accident. `Vibrator.start({ mode: VIBRATOR_SCENE_CALL })` repeats until
   `stop()`.
3. UI: red "Fall detected" title, a countdown ring (`widget.ARC`, 0° = 3
   o'clock, so `start_angle: -90` is 12 o'clock; `end_angle` shrinks each
   second via `prop.MORE`), the big number, and two buttons — green
   **I'm OK** and red **Send SOS now**.
4. `tick()` every second; at 0 → `sendSos('timeout')`. Buttons call
   `dismiss()` or `sendSos('manual')`.
5. `sendSos` stops the vibration, shows "Sending SOS…", then
   `this.request({ method: 'sos.send', params: { ...event, source, ts } },
   { timeout: 15000 })`. Resolves to `{ ok }` from the app-side (Step 6);
   `ok` → "SOS sent", otherwise "Send failed"; a rejection (phone out of
   range) → "No phone connection".
6. The result stays with a **Done** button, and auto-returns after 20 s.
7. Navigation is `replace()` in both directions: `index → alert` and
   `alert → index`. Each page is built fresh, so `AUTO_START` restarts
   monitoring on return without relying on `onResume`.

Gotchas found in the docs/typings:

- `Vibrator.start()` takes `{ mode }` — not a bare constant.
- BUTTON text can only be changed with `setProperty(prop.MORE, { x, y, w, h,
  text })`; `prop.TEXT` alone isn't supported on buttons (fixed on the index
  toggle too).
- `prop.VISIBLE` is used to swap the OK/SOS buttons for Done.
- Until Step 6 exists, the app-side has no `sos.send` handler, so the request
  ends in "Send failed" / "No phone connection" — the page itself is complete.

### Step 6 — App-side service (`app-side/index.js`)  ✅ done

Runs inside the Zepp phone app (zml `BaseSideService`). Three messages:

| Direction | Method | Purpose |
|---|---|---|
| watch → phone | `sos.send` `{ source, ts, event }` | POST the alert to the webhook; replies `{ ok, status }` or `{ ok: false, error }` |
| watch → phone | `prefs.get` | Home asks for the contact name on open (5 s timeout, silently keeps stored values if the phone is out of range) |
| phone → watch | `prefs.update` | pushed from `onSettingsChange` whenever the settings page edits `contactName`; Home's `onCall` stores it via `utils/prefs.js` |

Settings are read from `settings.settingsStorage` (string-only) under the
keys the phone settings page (Step 7) will write: `contactName`,
`contactPhone`, `webhookUrl`, `webhookToken`.

**Webhook contract.** The Zepp app cannot place calls, so the webhook is the
escalation engine ("call the contact, then emergency services"). It receives:

```http
POST <webhookUrl>
Authorization: Bearer <webhookToken>      # only if set
Content-Type: application/json

{
  "type": "fall",
  "app": "fall-guard",
  "source": "timeout" | "manual",
  "ts": 1789550000000,
  "contact": { "name": "Anna Reyes", "phone": "+49…" },
  "event": { "t", "freefallMs", "peakG", "stillStd", "angleDeg", "gyroPeakDps", "samples" }
}
```

Any 2xx counts as sent; anything else (or a 10 s timeout) shows "Alert could
not be sent" on the watch. Point it at a Twilio Function / Cloud Function /
Make scenario that holds the credentials — never bundle secrets in the app.

**Local end-to-end test** without a real relay:

```bash
npm run webhook          # tools/webhook-dev-server.js on :8787, prints your LAN URLs
FAIL=1 npm run webhook   # answers 500 to exercise the failure state
```

Put `http://<mac-lan-ip>:8787/sos` in the Webhook URL setting (phone and Mac
on the same Wi-Fi), long-press the ring on the watch → *Get help now* → the
payload prints in the terminal and the watch shows "Alert sent".

Not attached yet: **location**. The status string is "Alert sent" until a
position is actually included (watch GPS via `@zos/sensor Geolocation` on
GPS models, or phone location if the Zepp app exposes it).

### Step 7 — Settings page (`setting/index.js`)  ✅ done

Rendered inside the Zepp phone app (Fall Guard → Settings). Components are
globals (`View`, `Section`, `TextInput`, `Text`, `Button`), and `build(props)`
re-runs whenever `settingsStorage` changes, so the page is a pure function of
storage.

| Section | Fields → `settingsStorage` key |
|---|---|
| Emergency contact | Name → `contactName`, Phone → `contactPhone` (the watch shows "We'll call {first name}…") |
| Alert delivery | Webhook URL → `webhookUrl`, Bearer token → `webhookToken`, **Send test alert** |
| On the watch | note that sensitivity + siren live on the wrist (swipe up on Home) — one source of truth, no two-way sync |

**Send test alert** goes through storage, since the settings page can't
talk to the app-side directly: the button writes `testAlertRequest = now`;
the app-side's `onSettingsChange` runs `sendSos({ source: 'test' })` and
writes `testAlertResult = { ok, status | error, ts }`; the page re-renders and
shows "Delivered (HTTP 200)", "Enter a webhook URL first." or the error.

`contactName` edits are pushed to the watch immediately (`prefs.update`), so
the alert caption updates without reopening the app.

Strings live in `setting/i18n/en-US.po` (`gettext`).

### Step 8 — Test in the simulator with synthetic data  ✅ done

The simulator returns no real accelerometer motion, so the algorithm is
exercised two ways:

- **Under Node:** `npm test` runs the state-machine tests plus one test per
  fixture in `test/fixtures/` — `fall_forward`, `fall_sideways` must fire
  exactly once; `adl_clap`, `adl_sit_down_hard`, `adl_running`,
  `adl_fall_then_get_up` never (see Step 3).
- **In the simulator / on the watch:** long-press the ring on Home. With
  `DEBUG = true` (`page/index.js`) it replays `DEMO_FALL` from
  `utils/demo-trace.js` — the same synthetic `fall_forward` trace, written by
  `npm run fixtures` — straight into the detector, so the whole
  `index → alert → result → index` flow runs without sensor data.

```bash
open -a simulator      # Zepp OS Simulator, then pick a device in its window
zeus dev               # installs to the simulator and hot-reloads on save
```

What the simulator *can't* tell you: the real sample rate, whether the
accelerometer survives screen-off, vibration, or BLE timing — that's Step 9.

### Step 9 — Test on a real watch and tune

#### 9a. One-time setup

| Where | What |
|---|---|
| Terminal | `zeus login` — opens a browser; use the **same Zepp account** the phone app is logged into. Check with `zeus status`. |
| Zepp phone app (≥ 6.9.0) | **Profile → Settings → About → tap the Zepp logo 7×** until the "Developer Mode" confirmation appears. |
| Zepp phone app | Open **Developer Mode** (Profile → your watch → scroll to the bottom). It offers: *Scan* (install from a `zeus preview` QR), *Bridge*, *Screenshot*, per-app *Logs*, and "Device information" which shows the watch's **API_LEVEL** — confirm it is ≥ 3.0. |
| Watch | Paired with that phone, Bluetooth on, nearby. |

No developer-console registration is needed for side-loading; the `appId`
the CLI generated is fine until you publish (Step 10).

#### 9b. Install — option A: QR code (simplest)

```bash
zeus preview                        # prompts for a device model, then prints a QR code
zeus preview -t "Amazfit Active"    # skip the prompt; -t takes the product name as listed
zeus build   -t "Amazfit Active"    # same filter for a production package
```

A device is only offered if `app.json` has a platform with its screen shape
(`st`) and its API level range covers `runtime.apiVersion.minVersion`. If
the CLI says "no available device", that's the first thing to check.

Phone: Developer Mode → **Scan** → point at the terminal QR. The phone
downloads the package and pushes it to the watch over BLE (10–60 s). Re-run
`zeus preview` after every code change.

#### 9c. Install — option B: Developer Bridge (faster iteration)

```bash
zeus bridge             # opens a bridge$ prompt
bridge$ connect         # lists "online" runtimes — pick the phone app
bridge$ install         # builds and pushes to the watch through the phone
bridge$ screenshot      # saves the watch screen (OS 2.0+)
bridge$ uninstall       # removes the app
bridge$ exit
```

Phone: Developer Mode → **+** (top right) → **Bridge**, and leave the app in
the foreground. Both ends must be on the same Zepp account (the bridge is a
cloud relay, not a LAN connection). Requires CLI ≥ 1.1.0, app ≥ 6.9.0.

#### 9d. See the logs

Phone: Developer Mode → tap the **Fall Guard** icon → **Logs** → start
collection (bottom-right). "Device App" shows `console.log` from `page/*`
(the `[fall-candidate]`, `[fall]`, `[simulate]` lines); "Side Service"
shows `app-side/`. Stop collection before reading — the viewer buffers.

#### 9e. What to check, in order

1. **It runs.** Open the app on the watch: green ring, "You're covered".
   The Device App log prints `[rate] NORMAL accel 50.0 Hz dt 20/22/41 ms, …`
   every 5 s — the real `FREQ_MODE_NORMAL` rate on this hardware and how
   regular the callbacks are (README §8, first unknown; §12.5).
2. **Wear gate.** Take the watch off: title → "Not on wrist", ring turns
   red. Put it back.
3. **Simulate fall.** Long-press the ring: the "Are you alright?" page
   appears vibrating with the countdown; log shows `[fall] {...}`. "I'm fine"
   → "Glad you're OK" → back to Home with monitoring restarted.
4. **Screen-off behaviour.** Lower your wrist, wait 60 s, raise it. Does the
   app come back (setWakeUpRelaunch)? Did the Hz counter keep running
   while dark? This answers §8's second unknown and decides whether
   `KEEP_BRIGHT_MS` can be shortened to save battery.
4b. **Settings round-trip.** Swipe up, pick *Watchful*, swipe back: within a
   second the log shows `[detector] rebuilt for sensitivity watchful`. While
   on the Sensitivity page, swipe up once more — if a *second* Sensitivity
   page opens, `onGesture` handlers are app-global rather than per-page and
   Home's handler needs guarding (the docs don't say which it is).
5. **Real falls.** Onto a mattress, wrist-worn, 5–10 reps each of forward,
   backward and sideways, plus a sitting-to-floor slump. Then ADLs: sit down
   hard, clap, drop the arm onto a table, run 30 s, put the watch on a table.
   Read the `[fall-candidate]` lines: each shows `peakG`, `freefallMs`,
   `stillStd` and `reasons`. Tune `DEFAULTS` / `PRESETS` in
   `utils/fall-detector.js` until ADLs stay at zero and mattress falls
   fire; then `npm test` still has to pass.
6. **Record traces**: done by the phase 1 recorder (§12). Everyday wear
   records the motion around every hard impact, swipe left on Home runs the
   staged protocol, both upload to `npm run webhook`, and `npm run eval`
   scores the detector on them, so tuning is repeatable instead of manual.
7. **Battery.** Leave it monitoring for a full day and note the drain; if
   unacceptable, drop to `FREQ_MODE_LOW` and re-tune, or shorten
   `KEEP_BRIGHT_MS` if step 4 showed the sensor survives screen-off.
8. **Background probe.** Swipe down on Home → *Start* → follow §10.3 and
   fill in the results table there.
9. **Monitor mode** (§10.5). Leave the watch alone for 20 s: the screen goes
   black. Tap: it comes back. Let it dim again, lower the arm, raise it:
   it comes back (log `[g]` lines keep flowing throughout — the sensor
   never stopped). Press the side button to leave the app and start a
   stopwatch: Home should reopen by itself within 90 s and the Device App
   log shows `app on create invoke "relaunch"`. Tap the ring to pause, leave
   the app: it must **not** come back. Swipe up/down must still open
   Settings / the probe (a full-screen rect sits under the widgets to catch
   taps). Finally check the watch face brightness is what it was before
   (`[monitor] restored …` in the log means a previous run had left it
   dimmed).

### Step 10 — Build and ship

```bash
zeus build            # → dist/*.zab
```

Upload through the Zepp developer console, or side-load with `zeus preview`.

---

## 6. Runtime flow (happy path)

1. User opens app → monitoring starts (no runtime permission prompt —
   `device:os.accelerometer` is static, see Step 4).
2. Page keeps running; detector consumes samples at `FREQ_MODE_NORMAL`.
3. Fall signature matched → `replace('page/alert')`, sensor stopped.
4. Watch vibrates in `VIBRATOR_SCENE_CALL` pattern, 30 s countdown shown.
5. a) "I'm fine" → "Glad you're OK" → back to monitoring. b) Timeout or
   "Get help now" → `page/result` → `request('sos.send')` over BLE →
   app-side `fetch` → webhook → the relay calls the contact.
6. Result shown on watch ("Alert sent" / "Alert could not be sent" /
   "Phone not reachable").

## 7. Known limitations

- **Foreground only.** Zepp OS forbids the accelerometer in background
  services, so detection stops when the user leaves the app or the OS reclaims
  the page. Monitor mode (§10.5) narrows the gap to ≤ 90 s and keeps the
  screen black meanwhile, but the app still owns the watch while it runs.
  §10 has the full research and a probe that measures what a service *can*
  do on your firmware.
- **No phone = no outbound alert.** BLE range to the phone is required for the
  SOS. Consider an on-watch fallback such as a loud `notify()` plus repeating
  vibration until dismissed.
- **Wrist placement.** Wrist accelerations from arm swings can exceed 2.5 g.
  The stillness phase is what makes this usable — don't remove it.
- **Simulator.** No sensor data; test the algorithm in Node and on hardware.
- **Not certified.** Not a substitute for a medical alert service.

## 8. Things to measure early (they're not in the docs)

| Unknown | How to find out | Result |
|---|---|---|
| Actual Hz and jitter of `FREQ_MODE_LOW/NORMAL/HIGH`, accel and gyro | Record page (swipe left) → *Mode* cycles the mode; read the rates line or the `[rate]` log (§12.5) | _to fill_ |
| Does `onChange` fire once per sample? | Compare the `[rate]` Hz with the mode's nominal rate; there is no batch/FIFO read in the API | _to fill_ |
| Candidates per hour at the 1.8 g trigger | Day summaries: `candidates` ÷ `wornMs` (§12.4) | _to fill_ |
| Battery drain per hour, per mode, with and without the gyroscope | Day summaries: battery % every 10 min; switch the recorder off on the record page for the no-gyro run | _to fill_ |
| How long the wear sensor takes to report removal | Staged activity *Watch off, onto table*, or `wornOffAt` in `wear_off` recordings | _to fill_ |
| Memory headroom for the ring buffers | Run HIGH with the gyro for an hour and watch for crashes in the Device App log | _to fill_ |
| Whether `onChange` keeps firing with the screen off but page alive | Log timestamps to `@zos/fs`, wrist-down, wait 30 s, check | _to fill_ |
| `setPageBrightTime` vs. system max-screen-on settings interaction | Try it; some firmware caps it | _to fill_ |
| BLE `request()` timeout when the phone is out of range | Time a request with Bluetooth off on the phone | _to fill_ |

When the rates are known, set `DEFAULT_MODE` in `utils/debug.js` to the
lowest mode that gives at least 50 Hz (`HIGH` if none does).

## 9. Next-step ideas

- Heart-rate sanity check after impact (available even in app-service).
- GPS fix from the phone side (`app-side` has access to phone location on some
  Zepp app versions) attached to the SOS payload.
- Auto-resume monitoring when the watch is re-worn (`Wear.onChange`).
- Replace the threshold state machine with a small decision tree trained on
  your recorded fixtures — the `push(t,x,y,z)` interface stays the same.
  This is now the detector v2 plan; phases 0–1 are §12.

## 10. Background monitoring — research and probe (2026-09-17)

**Question:** can detection + vibration run with the app closed and the
screen off?

**Verdict from the docs: not with the accelerometer.** Zepp OS has exactly
one background mechanism for mini programs, the *App Service*
(`@zos/app-service`, API_LEVEL 3.0), and its capability table
(<https://docs.zepp.com/docs/guides/framework/device/app-service/>) says:

| Capability | In a service | Doc wording |
|---|---|---|
| Timers (`setTimeout` …) | **NO** | "Timer related interfaces such as `setTimeout`" |
| `@zos/ui` | **NO** | "No UI for Device App" |
| `Accelerometer`, `Gyroscope`, `Geolocation` | **NO** | "Unable to use high power consumption interfaces" |
| Other sensors (`HeartRate`, `Time.onPerMinute`, `Wear`, `Screen` …) | YES | |
| `@zos/notification`, `@zos/media` audio, `@zos/ble` (non-`mst`) | YES | |
| `@zos/fs` writes | YES | "only when the screen is off or in AOD display mode" |
| `@zos/app` / `display` / `device` / `settings` / `user` | `get*` only | |

Other facts that shape the answer:

- A page is not an alternative: "the system will exit the Mini Program after
  10 s" once the screen is off (`setWakeUpRelaunch` reference). Today's
  design therefore keeps the screen **on** (`setPageBrightTime` +
  `pauseDropWristScreenOff`) — that is the battery cost, and it is the only
  documented way to keep sampling.
- Nothing changed later: the API_LEVEL 4.0 / 4.2 feature lists add
  `@zos/timer createSysTimer` ("runs regardless of watch screen state",
  services allowed, 4.0+) but do not lift the sensor restriction, and
  `@zeppos/device-types@4.0.0` exposes the same sensor list as 3.0 — there
  is no system "fall detected" event a third-party app could subscribe to.
- Newer Amazfit firmware has **native fall detection** in the system SOS
  settings. It is the right answer for users who just need the feature; it
  has no API, so this app can't build on it.
- A service *can* survive app exit, screen-off and reboot, vibrate, post
  notifications, play audio and talk BLE — enough for a watchdog ("Fall
  Guard isn't monitoring — open the app") or an alarm siren, not for
  detection.

### 10.1 What the probe MVP proves

Docs tables are sometimes stricter than firmware, and "NO" doesn't say
*how* it fails, so `app-service/probe.js` measures it on the real watch:

| # | Question | Evidence on the probe page |
|---|---|---|
| 1 | Does a service stay alive with the app closed and the screen off? | `beats` keeps growing (`Time.onPerMinute`), `screen: off Nx` |
| 2 | Does the accelerometer deliver samples in a service — and after screen-off? | `accel: ok · N samples · N/min` vs `accel: error: …`; `samples since off` |
| 3 | Does vibration work from the background? | the first 3 minute-beats buzz (`HEARTBEAT_BUZZES`) — felt with the app closed |
| 4 | Do notifications work from a service? | `notify: ok (#id)` + the notification itself |
| 5 | Which store can a service write? | `store: localStorage` / `fs` / `none`, `errors` |
| 6 | Control: does a low-power sensor work? | `hr: 72 (N)` (`HeartRate.onCurrentChange`) |

If any samples arrive, the service runs the real `createFallDetector()` on
them and a background fall buzzes + notifies (`falls: N`). If #2 says
*error*, the platform answer is final and the production design stays
foreground-only.

### 10.2 How it is built

- `app.json`: `permissions` += `device:os.bg_service`;
  `module.app-service.services = ["app-service/probe"]`; page `page/probe`.
- `app-service/probe.js` — `AppService({ onInit, onDestroy })`. No timers, so
  everything runs inside sensor callbacks: `Time.onPerMinute` heartbeat,
  `Screen.onChange`, `Wear.onChange`, `HeartRate.onCurrentChange`, and the
  `Accelerometer` attempt wrapped in try/catch (`accel.ctor` / `accel.start`
  record the outcome). `Vibrator` + `notify()` run at start. The notification
  button re-enters the service with `param: 'ack'`, which just `exit()`s.
- `utils/probe-store.js` — one JSON record; `save()` tries `localStorage`
  then `@zos/fs`, records which worked. Flushes on every beat/event and on
  accelerometer sample 1 / 10 / 100 / 1000.
- `page/probe.js` (+ `.r/.s.layout.js`) — swipe **down** on Home (`DEBUG`).
  *Start* checks `queryPermission`, calls `requestPermission` (system
  dialog), clears the record and `start()`s the service; *Stop* calls
  `stop()`. `getAllAppServices()` says whether it is running; the record is
  re-read every second.

### 10.3 Protocol (real watch — the simulator has no services or sensors)

1. Install (Step 9b/9c), open Fall Guard, swipe down, tap **Start**, accept
   the background-service permission dialog. Expect one buzz and a
   "Background probe started" notification.
2. Press the side button to leave the app. Let the screen go off. Wait
   3–4 minutes without touching the watch (the first three minute-beats
   buzz — count them).
3. Raise the wrist, reopen Fall Guard, swipe down, read the rows, and check
   the Device App log (9d) for `[probe] beat …` lines.
4. Optional: with the app closed, drop the watch onto a cushion from arm
   height. If the accelerometer works, `falls` increments and the watch
   buzzes + notifies.
5. Tap **Stop**.

Results (fill in):

| Watch / firmware / API_LEVEL | beats after 3 min | accel ctor / start | samples · /min · since off | buzzes felt | notify | store | notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

### 10.4 What to do with the outcome

- **Accelerometer works in the service** (unlikely per docs): move
  `page/index` sampling into the service, keep the page as the UI, have the
  service `notify()` + vibrate on a fall and the page take over when opened.
  Watch battery for a day.
- **Accelerometer refused, service otherwise fine** (expected): keep
  foreground detection, add a *watchdog* service that buzzes/notifies when
  monitoring stops (screen-off kill, app exit) so the wearer knows they are
  uncovered, and optionally an audio siren via `@zos/media`.
- **Service itself dies on screen-off**: nothing to gain from services on
  this firmware; the keep-screen-on design stands.

### 10.5 Option 1 — monitor mode (implemented 2026-09-18)

Since the platform answer is "foreground only", the foreground is made to
behave like a background service. All of it is documented page-level API;
nothing here depends on the probe's outcome.

| Piece | Where | How |
|---|---|---|
| Black screen | `page/index.js` `tick()`, `utils/monitor-mode.js` `dim()` | 20 s (`AWAKE_MS`) after the last interaction Home sets every widget `VISIBLE: false` — a black OLED draws almost nothing — and lowers brightness to `DIM_BRIGHTNESS` (5) via `setAutoBrightness(false)` + `setBrightness()`. The previous values are saved in memory and in `localStorage` (`display.saved`); `restoreDisplay()` in `onInit` undoes a dim that a crash or kill never got to undo. |
| Wake | full-screen black `FILL_RECT` under everything; `utils/raise-detector.js` | A tap anywhere calls `wake()`. Every accelerometer sample also feeds the raise detector: once the watch has been away from face-up (z/‖a‖ < 0.5 for 300 ms) and comes back face-up (≥ 0.8 for 300 ms) the screen wakes — one raise, one wake; a watch lying face-up never fires. `npm test` covers it. |
| Shared "awake" deadline | `keepAwake()` / `isAwake()` in `getApp().globalData` | Settings is pushed on top of Home, and Home's tick would dim underneath it; Settings bumps the deadline on build and every tap instead of Home needing an `onResume`. |
| Clock | `L.CLOCK`, `Time.getFormatHour()` | Home is the wearer's screen all day, so it shows the time when awake. |
| Dead-man's switch | `armRelaunch()` / `disarmRelaunch()`; `@zos/alarm set({ url: 'page/index', delay: 90, repeat_type: REPEAT_ONCE, param: 'relaunch' })` | Home arms on start and re-arms every 30 s (`REARM_MS`), always setting the new alarm before cancelling the old one. If the wearer presses the side button or the OS kills the page, the pending alarm opens Home ≤ 90 s later and `AUTO_START` resumes monitoring. `onFallDetected` disarms first (the alert flow returns by itself); `pause()` — a tap on the ring while awake — is the only user action that disarms. `app.js` logs `app on create invoke "relaunch"` when the alarm was the launcher. |

To verify on hardware (9e-9): that brightness `5` with hidden widgets is
really black on your panel (try `0` if not — and check the app isn't
treated as screen-off and killed), that the alarm relaunch is quiet enough
to live with, and the raise thresholds on your wrist. Then the number that
decides whether this is shippable: **battery over a day** with the sensor at
`FREQ_MODE_NORMAL`; if it's too much, `FREQ_MODE_LOW` is the next lever (the
detector windows are in ms, `npm test` has a 25 Hz case).

Known trade-offs: the app owns the watch while monitoring (the system watch
face is not shown; the clock line is the substitute); a palm-over-screen
still turns the screen off and the app is killed 10 s later, then relaunched
by the alarm; a relaunch while the watch is off the wrist (charging) is
harmless but pointless — pause before charging if it bothers you.

## 11. Documentation links

- app.json reference — <https://docs.zepp.com/docs/reference/app-json/>
- Accelerometer — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Accelerometer/>
- Gyroscope — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Gyroscope/>
- Wear — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Wear/>
- Vibrator — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/sensor/Vibrator/>
- Display: setPageBrightTime / pauseDropWristScreenOff / setWakeUpRelaunch — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/display/setPageBrightTime/>
- App Service guide (background limits) — <https://docs.zepp.com/docs/guides/framework/device/app-service/>
- `@zos/timer` createSysTimer (4.0+, services) — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/timer/createSysTimer/>
- `@zos/app-service` stop / getAllAppServices — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-service/stop/>
- `@zos/app-service` start — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/app-service/start/>
- `@zos/app` requestPermission — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/app/requestPermission/>
- `@zos/notification` notify — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/notification/notify/>
- `@zos/alarm` set — <https://docs.zepp.com/docs/reference/device-app-api/newAPI/alarm/set/>
- Side-service fetch — <https://docs.zepp.com/docs/reference/side-service-api/fetch/>
- ZML (device ↔ phone messaging) — <https://github.com/zepp-health/zml>
- Zeus CLI — <https://docs.zepp.com/docs/guides/tools/cli/>

## 12. Detector v2, phases 0–1 — measure and record (implemented 2026-09-24)

The v2 plan replaces the free-fall → impact → stillness chain with an
impact trigger, features and a trained score. Nothing can be trained or
tuned without real data, so phases 0 and 1 only **measure and record**; v1
still makes every decision. All of it runs only when `DEBUG = true` in
`utils/debug.js`, which also defaults the recorder to on. A release build
(`DEBUG = false`) has none of it.

### 12.1 Setup

1. On your computer: `npm run webhook`. It prints
   `http://<lan-ip>:8787/recording`.
2. Phone: Zepp app → Fall Guard → Settings → **Developer → Recordings URL**,
   paste that URL. Phone and computer must be on the same network.
3. Install a debug build on the watch (§5 Step 9) and open the app. Home
   now also runs the gyroscope and the recorder.

Home asks the phone whether a Recordings URL is set before it uploads
anything (`rec.ready`), and rechecks every 10 min, so an empty setting
costs no BLE traffic. Files wait on the watch until it is set (up to 4 MB).

### 12.2 Everyday recording

`utils/candidate-recorder.js` runs the v2 trigger beside v1: a candidate
opens when |a| exceeds **1.8 g**, and its t0 is the highest sample within
the next second. When 10 s have passed, the window from 3 s before to 10 s
after t0 is kept if:

| `keep` | When | Weight |
|---|---|---|
| `v1_fall` | v1 alerted on this impact | 1 |
| `v1_rejected` | v1 evaluated it and said no (a near-miss) | 1 |
| `wear_off` | the watch came off during the window (`wornOffAt` says when) | 1 |
| `sampled` | a random 10% of everything else | 10 |

Every candidate, kept or not, adds a line to the day summary, so the
candidate rate and false alarms per day can be computed from the 10% sample.

A v1 alert opens the alert page, which vibrates and would pollute the
accelerometer. So Home writes the alert's window straight away, at about
+3 s, marked `truncated`. It also passes the recording id to the result
page: after **I'm fine** it asks **Did you fall? Yes / No** (10 s, then it
closes unanswered). "I'm fine" alone is not a label, because people who
fall and are unhurt press it too.

### 12.3 Staged protocol — swipe left on Home

`page/record.js` walks through 15 activities × 10 repeats: seven falls
(forward, backward, sideways, slide off a chair, trip while walking, fall
and try to get up, fall and lie still), then eight non-falls (flop onto a
bed, sit hard on a sofa, slam a hand on a table, clap, jump, jog, stairs,
watch off onto a table). Do the falls onto a mattress.

**Record** counts down 3-2-1 with light buzzes, gives a strong buzz, then
records 15 s and buzzes again when it has saved. **Skip** moves to the next
activity, or cancels a countdown. Progress survives leaving the page.
While the page is open, Home keeps sampling but feeds neither v1 nor
everyday candidates, so no alert interrupts the session and no staged fall
is ever filed as everyday activity.

The page is also the phase 0 readout: the frequency mode (**Mode** cycles
LOW / NORMAL / HIGH, and Home restarts its sensors in the new mode), live
accel and gyro rates, and the number and size of files waiting to upload.
Tap the bottom line to switch the recorder off, for example to measure
battery drain without the gyroscope.

### 12.4 Files

The dev server saves to `data/recordings/`, which git ignores:

```
data/recordings/
├── everyday/c-<t0>.json            candidate windows (+ label from the result page)
├── staged/<session>/s-<t0>.json    staged windows (activity, fall, trial)
└── summaries/<yyyymmdd>.json       day summary, re-sent every 10 min while it grows
```

A recording is `{ v, id, kind, t0, keep, weight, truncated, preMs, postMs,
v1, label, accel: [[t, x, y, z]], gyro: [[t, gx, gy, gz]] }`. `t` is in ms
from t0 (negative before the impact), accel in cm/s² as integers, gyro in
°/s to one decimal. At 50 Hz, a candidate window is about 22 KB and a
staged window about 25 KB. A day summary holds `wornMs`, `monitoredMs`,
`candidates` as `[t0, peakG, v1, keep, weight, truncated]` rows, `samples`
as `[t, battery %, accel Hz, gyro Hz, mode]` rows every 10 min, and the
count of recordings evicted when the watch ran out of room.

### 12.5 Rates

Every 5 s the Device App log shows, for example:

```
[rate] NORMAL accel 49.8 Hz dt 20/22/41 ms, gyro 50.1 Hz dt 20/21/38 ms
```

That is the callback rate and the interval between callbacks as median /
95th percentile / max, per sensor. A max far above the median means the OS
batches or drops callbacks. The Accelerometer API has no batch read, so
those samples are lost. Fill in the §8 table from these numbers.

### 12.6 Evaluation — `npm run eval`

```bash
npm run eval                              # v1, normal preset: test/fixtures + data/recordings + data/public
npm run eval -- --sweep                   # low / normal / high presets
npm run eval -- --compare eval/old.json   # difference against an earlier report
npm run eval -- --out none data/recordings/staged
```

It replays every trace through a fresh detector and prints recall (with a
95% Wilson interval), specificity per activity, false alarms per day
(weighted alarms ÷ worn hours × 16 waking hours), and alert latency. An
everyday window only counts alarms for its own impact (within 1 s of t0),
because neighbouring windows overlap. `eval/report.json` is rewritten on
each run; commit it with every detector change so the baseline travels
with the code. Today it holds v1 on the synthetic fixtures only.

### 12.7 Checks on the watch

1. Home runs as before, and the log shows `[rate]` lines with a gyro part.
2. Long-press the ring (simulate fall) → **I'm fine** → **Did you fall?**
   appears. Answer it. Within a minute the dev server logs
   `saved data/recordings/everyday/c-….json` with `"simulated":true` in
   the label, and `npm run eval` skips that file.
3. Swipe left: the record page shows rates after a few seconds. Record one
   *Clap*, and the dev server logs a `staged/…` file with about 750 rows.
4. Leave the watch on for a day, then check the day summary's `wornMs` and
   candidate count, and fill in the candidate rate in §8.
