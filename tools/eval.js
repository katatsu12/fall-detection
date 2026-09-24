#!/usr/bin/env node
/**
 * npm run eval — replay labelled traces through a detector and report
 * recall, specificity and false alarms per day (plan: Evaluation).
 *
 *   npm run eval                              # v1, normal preset, test/fixtures + data/recordings
 *   npm run eval -- --sweep                   # all three presets
 *   npm run eval -- --compare eval/old.json   # difference against an earlier report
 *   npm run eval -- --out none data/recordings/staged
 *
 * Positional arguments replace the default sources (files or directories,
 * searched recursively for .json). The report goes to eval/report.json
 * unless --out says otherwise; commit it with every detector change.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { traceFromFixture, traceFromRecording, evaluate, wornHoursFrom, detectorFactory } from './eval-lib.js'

const DEFAULT_SOURCES = ['test/fixtures', 'data/recordings', 'data/public']

function parseArgs(argv) {
  const opts = { detector: 'v1', presets: ['normal'], out: 'eval/report.json', compare: null, sources: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--detector') opts.detector = argv[++i]
    else if (a === '--preset') opts.presets = [argv[++i]]
    else if (a === '--sweep') opts.presets = ['low', 'normal', 'high']
    else if (a === '--out') opts.out = argv[++i]
    else if (a === '--compare') opts.compare = argv[++i]
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}`)
    else opts.sources.push(a)
  }
  if (!opts.sources.length) opts.sources = DEFAULT_SOURCES
  return opts
}

function jsonFiles(path) {
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return path.endsWith('.json') ? [path] : []
  return readdirSync(path)
    .sort()
    .flatMap((f) => jsonFiles(join(path, f)))
}

function load(sources) {
  const traces = []
  const summaries = []
  let skipped = 0
  for (const file of sources.flatMap(jsonFiles)) {
    let json
    try {
      json = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      console.warn(`skipping ${file}: ${e.message}`)
      skipped++
      continue
    }
    if (Array.isArray(json)) traces.push(traceFromFixture(basename(file), json))
    else if (json && json.kind === 'summary') summaries.push(json)
    else {
      const tr = traceFromRecording(json)
      if (tr) traces.push(tr)
      else skipped++
    }
  }
  return { traces, summaries, skipped }
}

const pct = (v) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`)

function print(name, r) {
  const f = r.falls
  const lines = [
    `${name}`,
    `  falls      ${f.detected}/${f.total} detected   recall ${pct(f.recall)} (95% CI ${pct(f.ci95[0])}–${pct(f.ci95[1])})`,
    `  non-falls  ${r.adl.clean}/${r.adl.total} clean      specificity ${pct(r.adl.specificity)}`,
    `  everyday   ${r.everyday.windows} windows, ${r.everyday.alarms} alarms (${r.everyday.weightedAlarms} weighted), ` +
      (r.everyday.falseAlarmsPerDay === null ? 'no worn hours yet' : `${r.everyday.falseAlarmsPerDay.toFixed(2)} false alarms/day`),
    `  latency    ${r.latencyMs ? `median ${r.latencyMs.median} ms, p95 ${r.latencyMs.p95} ms` : '—'}`,
  ]
  const acts = [
    ...Object.entries(f.byActivity).map(([k, v]) => `    ${k.padEnd(22)} ${v.flagged}/${v.total} detected`),
    ...Object.entries(r.adl.byActivity).map(([k, v]) => `    ${k.padEnd(22)} ${v.flagged}/${v.total} false alarms`),
  ]
  console.log([...lines, ...(acts.length ? ['  by activity', ...acts] : [])].join('\n'))
}

function compare(report, oldPath) {
  const old = JSON.parse(readFileSync(oldPath, 'utf8'))
  const delta = (a, b, scale = 100, unit = ' pts') =>
    a === null || b === null || a === undefined || b === undefined ? 'n/a' : `${((a - b) * scale >= 0 ? '+' : '')}${((a - b) * scale).toFixed(1)}${unit}`
  console.log(`\nversus ${oldPath}`)
  for (const [preset, r] of Object.entries(report.results)) {
    const o = old.results && old.results[preset]
    if (!o) continue
    console.log(
      `  ${preset}: recall ${delta(r.falls.recall, o.falls.recall)}, specificity ${delta(r.adl.specificity, o.adl.specificity)}, ` +
        `false alarms/day ${delta(r.everyday.falseAlarmsPerDay, o.everyday.falseAlarmsPerDay, 1, '')}`,
    )
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const { traces, summaries, skipped } = load(opts.sources)
  const wornHours = wornHoursFrom(summaries)
  const count = (src) => traces.filter((t) => t.source === src).length
  console.log(
    `${traces.length} traces: ${count('fixture')} fixtures, ${count('staged')} staged, ${count('everyday')} everyday` +
      ` (${skipped} skipped) · ${summaries.length} day summaries, ${wornHours.toFixed(1)} h worn\n`,
  )

  const results = {}
  for (const preset of opts.presets) {
    results[preset] = evaluate(traces, detectorFactory(opts.detector, preset), { wornHours })
    print(`${opts.detector} / ${preset}`, results[preset])
    console.log('')
  }

  const report = {
    generatedAt: new Date().toISOString(),
    detector: opts.detector,
    sources: opts.sources,
    traces: { fixture: count('fixture'), staged: count('staged'), everyday: count('everyday'), skipped },
    wornHours,
    results,
  }
  if (opts.compare) compare(report, opts.compare)
  if (opts.out && opts.out !== 'none') {
    mkdirSync(dirname(opts.out), { recursive: true })
    writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n')
    console.log(`report → ${opts.out}`)
  }
}

main()
