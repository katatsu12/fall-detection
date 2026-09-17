/**
 * Phone settings page (Zepp app → Fall Guard → Settings).
 *
 * Writes to settingsStorage (string-only). The app-side reads these keys:
 *   contactName, contactPhone, webhookUrl, webhookToken
 * and pushes contactName to the watch whenever it changes.
 *
 * "Send test alert" works through storage too: this page sets
 * `testAlertRequest`, the app-side sends a test POST and writes
 * `testAlertResult`; the page re-renders (build re-runs on every storage
 * change) and shows the outcome.
 */
import { gettext } from 'i18n'

const STYLE = {
  page: { padding: '12px 0 32px' },
  help: { fontSize: '13px', color: '#6E7278', padding: '4px 16px 12px', lineHeight: '1.45' },
  status: { fontSize: '13px', padding: '6px 16px 12px', lineHeight: '1.45' },
  ok: { color: '#1FC08A' },
  fail: { color: '#FF3B2F' },
  pending: { color: '#8A8F96' },
}

function testStatus(storage) {
  const requested = Number(storage.getItem('testAlertRequest') || 0)
  let result = null
  try {
    result = JSON.parse(storage.getItem('testAlertResult') || 'null')
  } catch (e) {
    result = null
  }
  if (!requested) return null
  if (!result || Number(result.ts) !== requested) return { text: gettext('delivery.testing'), style: STYLE.pending }
  if (result.ok) return { text: gettext('delivery.test_ok').replace('{status}', result.status), style: STYLE.ok }
  if (result.error === 'no_webhook') return { text: gettext('delivery.no_url'), style: STYLE.fail }
  return { text: gettext('delivery.test_fail').replace('{error}', result.error || 'unknown'), style: STYLE.fail }
}

AppSettingsPage({
  build(props) {
    const storage = props.settingsStorage
    const status = testStatus(storage)
    const contactName = storage.getItem('contactName') || ''
    const helpName = contactName.trim().split(/\s+/)[0] || 'your contact'

    return View({ style: STYLE.page }, [
      Section({ title: gettext('section.contact') }, [
        TextInput({
          label: gettext('contact.name'),
          placeholder: gettext('contact.name_placeholder'),
          settingsKey: 'contactName',
        }),
        TextInput({
          label: gettext('contact.phone'),
          placeholder: gettext('contact.phone_placeholder'),
          settingsKey: 'contactPhone',
        }),
        Text({ paragraph: true, style: STYLE.help }, gettext('contact.help').replace('{name}', helpName)),
      ]),

      Section({ title: gettext('section.delivery') }, [
        TextInput({
          label: gettext('delivery.url'),
          placeholder: gettext('delivery.url_placeholder'),
          settingsKey: 'webhookUrl',
        }),
        TextInput({
          label: gettext('delivery.token'),
          settingsKey: 'webhookToken',
        }),
        Text({ paragraph: true, style: STYLE.help }, gettext('delivery.help')),
        Button({
          label: gettext('delivery.test'),
          color: 'primary',
          onClick: () => storage.setItem('testAlertRequest', String(Date.now())),
        }),
        status ? Text({ paragraph: true, style: { ...STYLE.status, ...status.style } }, status.text) : View({}, []),
      ]),

      Section({ title: gettext('section.watch') }, [Text({ paragraph: true, style: STYLE.help }, gettext('watch.help'))]),
    ])
  },
})
