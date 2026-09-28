import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateConfig, WP_API } from '../../amazla/watchplus/shared/config.js'
import { unlocks } from '../../amazla/watchplus/shared/verdict.js'
import { FALL_GUARD_PRO_PRODUCT_ID, watchplusConfig } from '../shared/watchplus-config.js'
import { zmlBridge } from '../utils/zml-bridge.js'

const verdict = (productId, status = 'active') => ({
  key: 'K',
  instanceId: 'I',
  productId,
  status,
  expiresAt: null,
  checkedAt: Date.now(),
  source: 'ls',
})

test('the licence config passes watchplus validation', () => {
  assert.deepEqual(validateConfig(watchplusConfig), [])
})

test('checkout goes through the Watch+ Worker, tagged with this app', () => {
  assert.equal(watchplusConfig.checkout.single, WP_API + '/buy/' + FALL_GUARD_PRO_PRODUCT_ID + '?app=' + watchplusConfig.app)
  assert.equal(watchplusConfig.checkout.watchplus, null) // Watch+ not launched: no Watch+ surfaces
})

test('a Fall Guard Pro key unlocks All-day mode; other keys and lapsed ones do not', () => {
  assert.equal(unlocks(verdict(FALL_GUARD_PRO_PRODUCT_ID), 'pro', watchplusConfig), true)
  assert.equal(unlocks(verdict('talkie-pro'), 'pro', watchplusConfig), false)
  assert.equal(unlocks(verdict(FALL_GUARD_PRO_PRODUCT_ID, 'disabled'), 'pro', watchplusConfig), false) // refunded
  assert.equal(unlocks(null, 'pro', watchplusConfig), false)
})

test('zmlBridge hands watchplus the { result } shape and passes failures through', async () => {
  const sent = []
  const ok = zmlBridge({ request: (d) => (sent.push(d), Promise.resolve({ verdict: 'v' })) })
  assert.deepEqual(await ok.request({ method: 'WP_STATUS' }), { result: { verdict: 'v' } })
  assert.deepEqual(sent, [{ method: 'WP_STATUS' }])

  const down = zmlBridge({ request: () => Promise.reject(new Error('ble disconnect')) })
  await assert.rejects(down.request({ method: 'WP_STATUS' }), /ble disconnect/)
})
