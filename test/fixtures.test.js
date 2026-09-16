// Every fixture in test/fixtures/ must behave as its name says:
// fall_* → exactly one event, adl_* → none.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFallDetector, replay } from '../utils/fall-detector.js'

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))

test('fixtures directory is populated (run `npm run fixtures`)', () => {
  assert.ok(files.length > 0)
})

for (const file of files) {
  test(`fixture ${file}`, () => {
    const samples = JSON.parse(readFileSync(join(dir, file), 'utf8'))
    const events = replay(createFallDetector(), samples)
    const expected = file.startsWith('fall_') ? 1 : 0
    assert.equal(events.length, expected, `${file}: expected ${expected} event(s), got ${events.length}`)
  })
}
