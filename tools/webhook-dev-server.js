#!/usr/bin/env node
/**
 * Minimal webhook receiver for testing the SOS path end-to-end, and the
 * sink for phase 1 recordings (README §12).
 *
 *   npm run webhook            # listens on 0.0.0.0:8787
 *   → put http://<this-mac-lan-ip>:8787/sos in the app's "Webhook URL" setting
 *   → put http://<this-mac-lan-ip>:8787/recording in "Recordings URL"
 *
 * /sos logs every POST body and answers 200 { ok: true }. Set FAIL=1 to
 * answer 500 and exercise the "Alert could not be sent" state on the watch.
 *
 * /recording saves each body under data/recordings/ (git-ignored):
 *   everyday/<id>.json           candidate windows from normal wear
 *   staged/<session>/<id>.json   staged-protocol windows from page/record
 *   summaries/<date>.json        day summaries (re-sent during the day, overwritten)
 */
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'

const PORT = Number(process.env.PORT || 8787)
const FAIL = process.env.FAIL === '1'
const DATA_DIR = join(process.cwd(), 'data', 'recordings')

const safe = (s) => String(s || 'unknown').replace(/[^A-Za-z0-9._-]/g, '_')

function recordingPath(body) {
  if (body.kind === 'summary') return join(DATA_DIR, 'summaries', `${safe(body.date)}.json`)
  if (body.kind === 'staged') return join(DATA_DIR, 'staged', safe(body.session), `${safe(body.id)}.json`)
  return join(DATA_DIR, 'everyday', `${safe(body.id)}.json`)
}

function saveRecording(body, stamp) {
  if (!body || typeof body !== 'object' || !body.kind) return { status: 400, reply: { ok: false, error: 'not a recording' } }
  const file = recordingPath(body)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(body))
  const rows = body.accel ? `${body.accel.length} accel / ${(body.gyro || []).length} gyro rows` : `${(body.candidates || []).length} candidates`
  const label = body.label ? ` label ${JSON.stringify(body.label)}` : ''
  console.log(`[${stamp}] saved ${relative(process.cwd(), file)} (${rows})${label}`)
  return { status: 200, reply: { ok: true, received: stamp } }
}

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
    if (req.method === 'POST' && req.url.startsWith('/recording')) {
      const { status, reply } = saveRecording(body, stamp)
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(reply))
      return
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
  for (const ip of ips) console.log(`  http://${ip}:${PORT}/sos   http://${ip}:${PORT}/recording`)
})
