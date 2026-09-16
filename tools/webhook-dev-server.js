#!/usr/bin/env node
/**
 * Minimal webhook receiver for testing the SOS path end-to-end.
 *
 *   npm run webhook            # listens on 0.0.0.0:8787
 *   → put http://<this-mac-lan-ip>:8787/sos in the app's "Webhook URL" setting
 *
 * Logs every POST body and answers 200 { ok: true }. Set FAIL=1 to answer 500
 * and exercise the "Alert could not be sent" state on the watch.
 */
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'

const PORT = Number(process.env.PORT || 8787)
const FAIL = process.env.FAIL === '1'

createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const stamp = new Date().toISOString()
    let body = raw
    try {
      body = JSON.parse(raw)
    } catch {
      /* not JSON */
    }
    console.log(`[${stamp}] ${req.method} ${req.url}`)
    console.log(JSON.stringify(body, null, 2))
    res.writeHead(FAIL ? 500 : 200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: !FAIL, received: stamp }))
  })
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
  console.log(`webhook dev server on port ${PORT}${FAIL ? ' (FAIL mode: answering 500)' : ''}`)
  for (const ip of ips) console.log(`  http://${ip}:${PORT}/sos`)
})
