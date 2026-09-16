/**
 * Writes synthetic `{ dt, x, y, z }` traces to test/fixtures/ so the on-device
 * debug button (README §5 Step 8) and the tests share the same data.
 * Replace these with real recordings as soon as you have them.
 *
 *   npm run fixtures
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { trace, forwardFall, SIDE } from './synth.js'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
mkdirSync(out, { recursive: true })

const fixtures = {
  // should trigger
  fall_forward: forwardFall().samples,
  fall_sideways: trace({ seed: 7 })
    .rest(1500)
    .freefall(250, { g: 0.3 })
    .impact(60, { g: 4.0, dir: [0, 1, 0] })
    .rest(3500, { dir: [0, 1, 0] })
    .samples,
  // should NOT trigger
  adl_clap: trace({ seed: 3 }).rest(1000).spike(3.5).spike(3.0).rest(3000).samples,
  adl_sit_down_hard: trace({ seed: 4 })
    .rest(1000)
    .freefall(200, { g: 0.75 })
    .impact(80, { g: 2.0 })
    .rest(3000)
    .samples,
  adl_running: trace({ seed: 5 })
    .motion(1000, { min: 0.4, max: 2.0 })
    .freefall(100, { g: 0.4 })
    .impact(40, { g: 2.8 })
    .motion(4000, { min: 0.4, max: 2.0 })
    .samples,
  adl_fall_then_get_up: trace({ seed: 6 })
    .rest(1000)
    .freefall(300)
    .impact(80)
    .rest(800, { dir: SIDE })
    .motion(3000, { min: 0.7, max: 1.6 })
    .samples,
}

for (const [name, samples] of Object.entries(fixtures)) {
  const rounded = samples.map((s) => ({
    dt: Math.round(s.dt),
    x: Math.round(s.x),
    y: Math.round(s.y),
    z: Math.round(s.z),
  }))
  writeFileSync(join(out, `${name}.json`), JSON.stringify(rounded))
  console.log(`${name}.json  ${rounded.length} samples`)
}
