/**
 * App-side service — runs inside the Zepp phone app.
 *
 *   watch ──sos.send──▶ here ──POST──▶ your webhook (relay that calls the
 *                                       contact, then emergency services)
 *   watch ◀─prefs.update── here        when the settings page changes
 *   watch ──prefs.get───▶ here         on Home open, to seed local prefs
 *
 * Settings come from `settings.settingsStorage` (string-only), written by
 * setting/index.js (README Step 7). Keys: contactName, contactPhone,
 * webhookUrl, webhookToken.
 */
import { BaseSideService } from '@zeppos/zml/base-side'

const FETCH_TIMEOUT_MS = 10000

function setting(key) {
  const v = settings.settingsStorage.getItem(key)
  return typeof v === 'string' ? v.trim() : ''
}

/** Subset of settings the watch keeps in localStorage (see utils/prefs.js). */
function devicePrefs() {
  return { contactName: setting('contactName') }
}

function withTimeout(promise, ms) {
  let t
  const timeout = new Promise((_, reject) => {
    t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t))
}

AppSideService(
  BaseSideService({
    onInit() {
      this.log('fall-guard side service init')
    },

    onRequest(req, res) {
      switch (req.method) {
        case 'prefs.get':
          return res(null, devicePrefs())
        case 'sos.send':
          return this.sendSos(req.params || {})
            .then((r) => res(null, r))
            .catch((e) => {
              this.error('sos.send failed', e)
              res(null, { ok: false, error: String((e && e.message) || e) })
            })
        default:
          return res(null, { ok: false, error: `unknown method ${req.method}` })
      }
    },

    // Fired by zml when the phone settings page writes to settingsStorage.
    onSettingsChange({ key }) {
      if (key === 'contactName') this.call({ method: 'prefs.update', params: devicePrefs() })
    },

    /**
     * POST the alert to the configured webhook. The webhook owns escalation
     * (call the contact, then emergency services) — the Zepp app cannot
     * place calls itself. Resolves { ok, status } / { ok: false, error }.
     */
    async sendSos(params) {
      const url = setting('webhookUrl')
      if (!url) return { ok: false, error: 'no_webhook' }

      const headers = { 'Content-Type': 'application/json' }
      const token = setting('webhookToken')
      if (token) headers.Authorization = `Bearer ${token}`

      const body = {
        type: 'fall',
        app: 'fall-guard',
        source: params.source || 'unknown', // 'timeout' | 'manual'
        ts: params.ts || Date.now(),
        contact: { name: setting('contactName'), phone: setting('contactPhone') },
        event: params.event || {},
      }

      const r = await withTimeout(fetch({ url, method: 'POST', headers, body: JSON.stringify(body) }), FETCH_TIMEOUT_MS)
      const ok = r.status >= 200 && r.status < 300
      this.log('sos.send →', r.status)
      return ok ? { ok, status: r.status } : { ok, status: r.status, error: `http_${r.status}` }
    },
  }),
)
