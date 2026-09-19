/**
 * Background feasibility probe — a Zepp OS App Service (README §10).
 *
 * The App Service guide says a service has no timers, no UI, and no
 * "high-power" sensors (Accelerometer, Gyroscope, Geolocation) — only
 * low-power ones such as HeartRate and Time.onPerMinute. This service checks
 * that on real firmware instead of taking the table on faith:
 *
 *   1. tries the Accelerometer anyway and counts samples (also after the
 *      screen goes off), feeding any that arrive into the real detector;
 *   2. keeps a once-a-minute heartbeat (allowed) so "alive in background"
 *      is provable even if the accelerometer isn't;
 *   3. vibrates and posts a notification from the background;
 *   4. uses HeartRate as the control sensor and tracks Screen / Wear state.
 *
 * No timers exist here, so all work happens inside sensor callbacks. Results
 * are written through utils/probe-store.js and shown by page/probe.js.
 */
import {
  Time,
  Screen,
  Wear,
  HeartRate,
  Vibrator,
  Accelerometer,
  FREQ_MODE_NORMAL,
  VIBRATOR_SCENE_STRONG_REMINDER,
} from '@zos/sensor'
import { notify } from '@zos/notification'
import { exit } from '@zos/app-service'
import { createFallDetector, magnitudeG } from '../utils/fall-detector'
import { PROBE_SERVICE, emptyProbe, saveProbe, noteError } from '../utils/probe-store'

const SCREEN_OFF = 2
const HEARTBEAT_BUZZES = 3 // buzz on the first N minute ticks: felt with the app closed = background vibration works
const EARLY_FLUSHES = [1, 10, 100, 1000] // accelerometer sample counts that trigger an immediate save

const stats = emptyProbe()
let accel = null
let vib = null
let time = null
let screen = null
let wear = null
let hr = null
let hrCb = null
let detector = null
let samplesAtLastBeat = 0

const flush = () => saveProbe(stats)

function attempt(where, fn) {
  try {
    fn()
    return 'ok'
  } catch (e) {
    noteError(stats, where, e)
    return `error: ${(e && e.message) || e}`
  }
}

function buzz() {
  attempt('vibrator', () => {
    if (!vib) vib = new Vibrator()
    vib.start({ mode: VIBRATOR_SCENE_STRONG_REMINDER })
  })
}

function post(title, content) {
  return attempt('notify', () => {
    // actions is required; this one just re-enters the service with param 'ack' (see onInit).
    const id = notify({ title, content, actions: [{ text: 'OK', file: PROBE_SERVICE, param: 'ack' }] })
    stats.notify = id ? `ok (#${id})` : 'error: returned 0'
  })
}

function onSample() {
  const a = stats.accel
  const { x, y, z } = accel.getCurrent()
  const now = Date.now()
  a.samples++
  a.lastSampleAt = now
  a.lastG = Math.round(magnitudeG(x, y, z) * 100) / 100
  if (stats.screen.status === SCREEN_OFF) a.sinceScreenOff++
  detector.push(now, x, y, z)
  if (EARLY_FLUSHES.indexOf(a.samples) >= 0) flush()
}

function onBeat() {
  const now = Date.now()
  stats.beats++
  stats.lastBeatAt = now
  stats.accel.perMinute = stats.accel.samples - samplesAtLastBeat
  samplesAtLastBeat = stats.accel.samples
  console.log('[probe] beat', stats.beats, 'accel/min', stats.accel.perMinute, 'screen', stats.screen.status)
  if (stats.beats <= HEARTBEAT_BUZZES) buzz()
  flush()
}

AppService({
  onInit(param) {
    if (param === 'ack') {
      // Single-execution entry from the notification button: nothing to do.
      console.log('[probe] notification acknowledged')
      exit()
      return
    }
    console.log('[probe] service init', param || '')
    stats.startedAt = Date.now()

    detector = createFallDetector()
    detector.onCandidate(() => {
      stats.detector.candidates++
    })
    detector.onFall((evt) => {
      stats.detector.falls++
      stats.detector.lastFallAt = evt.t
      console.log('[probe] fall in background', JSON.stringify(evt))
      buzz()
      post('Fall Guard', 'Fall detected in the background')
      flush()
    })

    // Known-allowed capabilities first, so their results are recorded even if the accelerometer throws.
    stats.vib = attempt('vibrator', () => {
      vib = new Vibrator()
      vib.start({ mode: VIBRATOR_SCENE_STRONG_REMINDER })
    })
    post('Fall Guard', 'Background probe started')

    attempt('time', () => {
      time = new Time()
      time.onPerMinute(onBeat)
    })
    attempt('screen', () => {
      screen = new Screen()
      stats.screen.status = screen.getStatus()
      screen.onChange((status) => {
        stats.screen.status = status
        if (status === SCREEN_OFF) {
          stats.screen.offCount++
          stats.screen.lastOffAt = Date.now()
          stats.accel.sinceScreenOff = 0
        } else {
          stats.screen.lastOnAt = Date.now()
        }
        flush()
      })
    })
    attempt('wear', () => {
      wear = new Wear()
      stats.wear.status = wear.getStatus()
      wear.onChange(() => {
        stats.wear.status = wear.getStatus()
        stats.wear.changes++
        flush()
      })
    })
    attempt('heartRate', () => {
      hr = new HeartRate()
      hrCb = () => {
        stats.hr.samples++
        stats.hr.last = hr.getCurrent()
      }
      hr.onCurrentChange(hrCb)
    })

    // The actual question: does the accelerometer deliver samples to a service?
    stats.accel.ctor = attempt('accelerometer.new', () => {
      accel = new Accelerometer()
    })
    if (accel) {
      stats.accel.start = attempt('accelerometer.start', () => {
        accel.onChange(onSample)
        accel.setFreqMode(FREQ_MODE_NORMAL)
        accel.start()
      })
    }
    flush()
  },

  onDestroy() {
    console.log('[probe] service destroy')
    stats.stoppedAt = Date.now()
    if (accel) attempt('accelerometer.stop', () => (accel.offChange(onSample), accel.stop()))
    if (hr) attempt('heartRate.off', () => hr.offCurrentChange(hrCb))
    flush()
  },
})
