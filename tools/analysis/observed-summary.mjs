/**
 * Summarize the silent timing observers' records in one capture
 * (GH #291/#292, plan B3 — the seed of the C5 analyzer).
 *
 * Reads `puncheokie.voice.observed` (the coach playhead observer, C1/C2),
 * `puncheokie.instrument.observed` (the Oboe onset tap, C3) and
 * `puncheokie.observer.stats`, and reports coverage, onset latency per
 * family (median / p95 / jitter) and the outcome tallies. Non-gating: a
 * capture with no observer records at all (flag off) summarizes to
 * `present: false` and exits 0 — the suite prints it, the verifier judges.
 *
 *   node tools/analysis/observed-summary.mjs --session <dir>
 *   → <dir>/observed-summary.json
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { boolField, extractField, numField, recordsWithTag } from './logcat.mjs'

/** A play whose observed length is this far under its planned length was cut. */
export const TRUNCATION_MS = 150

export function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

/** Median, p95 and jitter (p95 − median) of a latency series, rounded to 0.1 ms. */
export function latencyStats(values) {
  const clean = values.filter((v) => typeof v === 'number' && Number.isFinite(v))
  if (clean.length === 0) return { n: 0, medianMs: null, p95Ms: null, jitterMs: null }
  const med = median(clean)
  const p95 = percentile(clean, 95)
  const r = (v) => Math.round(v * 10) / 10
  return { n: clean.length, medianMs: r(med), p95Ms: r(p95), jitterMs: r(p95 - med) }
}

function tally(items, key) {
  const out = {}
  for (const item of items) {
    const k = item[key] ?? 'unknown'
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

export function parseVoiceObserved(logcatText) {
  return recordsWithTag(logcatText, 'puncheokie.voice.observed').map(({ ts, body }) => ({
    ts,
    playId: extractField(body, 'playId'),
    kind: extractField(body, 'kind'),
    label: extractField(body, 'label'),
    path: extractField(body, 'path'),
    traceId: extractField(body, 'traceId'),
    method: extractField(body, 'method'),
    outcome: extractField(body, 'outcome'),
    dispatchMs: numField(body, 'dispatchMs'),
    onsetMs: numField(body, 'onsetMs'),
    endMs: numField(body, 'endMs'),
    onsetLatencyMs: numField(body, 'onsetLatencyMs'),
    observedDurationMs: numField(body, 'observedDurationMs'),
    expectedDurationMs: numField(body, 'expectedDurationMs'),
    positionAtOnsetMs: numField(body, 'positionAtOnsetMs'),
    volumeAtDispatch: numField(body, 'volumeAtDispatch'),
    silentByVolume: boolField(body, 'silentByVolume') ?? false,
  }))
}

export function parseInstrumentObserved(logcatText) {
  return recordsWithTag(logcatText, 'puncheokie.instrument.observed').map(({ ts, body }) => ({
    ts,
    eventId: extractField(body, 'eventId'),
    hand: extractField(body, 'hand'),
    outcome: extractField(body, 'outcome'),
    latencyMs: numField(body, 'latencyMs'),
    pipelineMs: numField(body, 'pipelineMs'),
    peak: numField(body, 'peak'),
  }))
}

export function summarizeObserved(logcatText) {
  const voice = parseVoiceObserved(logcatText)
  const instrument = parseInstrumentObserved(logcatText)
  const statsRecords = recordsWithTag(logcatText, 'puncheokie.observer.stats')
  const lastStats = statsRecords.at(-1)
  const observer = lastStats
    ? {
        watched: numField(lastStats.body, 'watched') ?? null,
        openAtRelease: numField(lastStats.body, 'openAtRelease') ?? null,
        maxHandlerMs: numField(lastStats.body, 'maxHandlerMs') ?? null,
      }
    : null
  // Coverage denominator: every coach play that minted a playId (the four
  // VoiceOutputExpo play sites do so only when the observer is armed).
  // The ceremony players and the metronome mint their OWN playIds and never
  // write a `voice.play`, so they belong in neither side of this ratio —
  // counting them in the numerator produced "1/0 plays" on the first real
  // capture. They are reported separately as `ceremonyObserved`.
  const playIds = new Set(
    recordsWithTag(logcatText, 'puncheokie.voice.play')
      .map((r) => extractField(r.body, 'playId'))
      .filter((id) => id !== undefined),
  )
  const playsWithId = playIds.size
  const fromPlays = voice.filter((v) => v.playId !== undefined && playIds.has(v.playId))
  const ceremonyObserved = voice.length - fromPlays.length

  const byKind = {}
  for (const kind of new Set(voice.map((v) => v.kind ?? 'unknown'))) {
    const rows = voice.filter((v) => (v.kind ?? 'unknown') === kind)
    const ok = rows.filter((v) => v.outcome === 'ok')
    byKind[kind] = {
      n: rows.length,
      outcomes: tally(rows, 'outcome'),
      onset: latencyStats(ok.map((v) => v.onsetLatencyMs)),
      byPath: Object.fromEntries(
        [...new Set(ok.map((v) => v.path).filter((p) => p !== undefined))].map((path) => [
          path,
          latencyStats(ok.filter((v) => v.path === path).map((v) => v.onsetLatencyMs)),
        ]),
      ),
      truncated: rows.filter(
        (v) =>
          v.outcome === 'ok' &&
          typeof v.observedDurationMs === 'number' &&
          typeof v.expectedDurationMs === 'number' &&
          v.observedDurationMs < v.expectedDurationMs - TRUNCATION_MS,
      ).length,
      silentBirths: rows.filter((v) => v.silentByVolume).length,
    }
  }

  const instrumentOk = instrument.filter((i) => i.outcome === 'ok')
  const instrumentSummary = {
    n: instrument.length,
    outcomes: tally(instrument, 'outcome'),
    latency: latencyStats(instrumentOk.map((i) => i.latencyMs)),
    pipeline: latencyStats(instrumentOk.map((i) => i.pipelineMs)),
    maskedRatio: instrument.length === 0 ? null : (instrument.filter((i) => i.outcome === 'masked').length / instrument.length),
    busyRatio: instrument.length === 0 ? null : (instrument.filter((i) => i.outcome === 'busy').length / instrument.length),
  }

  return {
    present: voice.length + instrument.length > 0,
    playsWithId,
    voiceObserved: voice.length,
    ceremonyObserved,
    coverage: playsWithId === 0 ? null : Math.round((fromPlays.length / playsWithId) * 1000) / 1000,
    byKind,
    instrument: instrumentSummary,
    observer,
  }
}

export function renderObservedTable(summary) {
  if (!summary.present) return 'observed: no observer records in this capture (QA flag off?)'
  const lines = []
  lines.push(
    `observed: coverage ${summary.coverage === null ? 'n/a' : `${Math.round(summary.coverage * 100)}%`} of ${summary.playsWithId} plays · ${summary.ceremonyObserved} ceremony` +
      (summary.observer ? ` · observer maxHandlerMs ${summary.observer.maxHandlerMs}` : ''),
  )
  // Raw status-event onsets — see the note on verify-suite's summary table.
  lines.push('| kind | n | ok | onset median (status event) | p95 | jitter | truncated | silent births | other outcomes |')
  lines.push('|---|---|---|---|---|---|---|---|---|')
  for (const [kind, k] of Object.entries(summary.byKind)) {
    const other = Object.entries(k.outcomes)
      .filter(([o]) => o !== 'ok')
      .map(([o, n]) => `${o}=${n}`)
      .join(' ')
    lines.push(
      `| ${kind} | ${k.n} | ${k.outcomes.ok ?? 0} | ${k.onset.medianMs ?? '—'} | ${k.onset.p95Ms ?? '—'} | ${k.onset.jitterMs ?? '—'} | ${k.truncated} | ${k.silentBirths} | ${other || '—'} |`,
    )
  }
  const i = summary.instrument
  if (i.n > 0) {
    lines.push(
      `instrument: n ${i.n} · ok ${i.outcomes.ok ?? 0} · latency median ${i.latency.medianMs} p95 ${i.latency.p95Ms} jitter ${i.latency.jitterMs} · pipeline median ${i.pipeline.medianMs} · masked ${Math.round((i.maskedRatio ?? 0) * 100)}% · busy ${Math.round((i.busyRatio ?? 0) * 100)}%`,
    )
  }
  return lines.join('\n')
}

function main() {
  const sessionArg = process.argv.find((a) => a.startsWith('--session='))?.slice('--session='.length)
    ?? process.argv[process.argv.indexOf('--session') + 1]
  if (!sessionArg || !existsSync(sessionArg)) {
    console.error('Usage: node tools/analysis/observed-summary.mjs --session <dir>')
    process.exit(3)
  }
  const logPath = [join(sessionArg, 'logcat.txt'), join(sessionArg, 'log.txt')].find((p) => existsSync(p))
  if (!logPath) {
    console.error(`no logcat.txt (or log.txt) in ${sessionArg}`)
    process.exit(3)
  }
  const summary = summarizeObserved(readFileSync(logPath, 'utf8'))
  const outPath = join(sessionArg, 'observed-summary.json')
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n', 'utf8')
  console.log(renderObservedTable(summary))
  console.log(`\nWrote ${outPath}`)
}

const invokedDirectly = process.argv[1]?.endsWith('observed-summary.mjs')
if (invokedDirectly) main()
