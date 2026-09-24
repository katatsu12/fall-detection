import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createUploader } from '../utils/uploader.js'

const flush = () => new Promise((r) => setImmediate(r))

/** An uploader over a fake queue, a fake clock and a scripted request. */
function setup(responses) {
  let clock = 0
  const queue = [{ id: 'a', body: { id: 'a' } }, { id: 'b', body: { id: 'b' } }]
  const sent = []
  const failures = []
  const up = createUploader(
    {
      request: (data) => {
        sent.push(data)
        const r = responses.shift()
        if (r instanceof Error) throw r
        return r === 'reject' ? Promise.reject(new Error('timeout')) : Promise.resolve(r)
      },
      next: () => queue[0] || null,
      done: (item) => queue.splice(queue.indexOf(item), 1),
      now: () => clock,
      onFail: (why) => failures.push(why),
    },
    { gapMs: 1000, idleMs: 30000, maxBackoffMs: 8000 },
  )
  return { up, queue, sent, failures, setClock: (t) => (clock = t) }
}

test('sends one item per request and removes it only after an ok', async () => {
  const { up, queue, sent, setClock } = setup([{ ok: true }, { ok: true }])
  assert.equal(up.tick(0), true)
  assert.equal(up.tick(0), false) // busy
  await flush()
  assert.deepEqual(sent[0], { method: 'rec.put', params: { id: 'a' } })
  assert.deepEqual(queue.map((q) => q.id), ['b'])
  assert.equal(up.tick(500), false) // still inside the gap
  setClock(1000)
  assert.equal(up.tick(1000), true)
  await flush()
  assert.equal(queue.length, 0)
  assert.equal(up.tick(2000), false) // nothing left: idle
  assert.equal(up.stats().sent, 2)
})

test('failures keep the item and back off exponentially up to the cap', async () => {
  const { up, queue, failures, setClock } = setup([{ ok: false, error: 'no_record_url' }, 'reject', new Error('ble disconnect'), 'reject'])
  up.tick(0)
  await flush()
  assert.equal(up.stats().backoffMs, 2000)
  assert.equal(up.tick(1999), false)
  setClock(2000)
  up.tick(2000)
  await flush()
  assert.equal(up.stats().backoffMs, 4000)
  setClock(6000)
  assert.equal(up.tick(6000), false) // synchronous throw is caught
  assert.equal(up.stats().backoffMs, 8000)
  setClock(14000)
  up.tick(14000)
  await flush()
  assert.equal(up.stats().backoffMs, 8000) // capped
  assert.equal(queue.length, 2)
  assert.equal(up.stats().failed, 4)
  assert.equal(up.stats().lastError, 'timeout')
  assert.deepEqual(failures, ['no_record_url', 'timeout', 'ble disconnect', 'timeout']) // Home stops uploading on no_record_url
})
