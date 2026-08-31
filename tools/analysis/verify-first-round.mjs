/**
 * Log-only first-round audio correlator.
 *
 * Loop Stage 3a of the 10-Workout Audio Verification Loop
 * (see .claude/plans/it-s-time-to-build-linked-deer.md).
 *
 * Reads an expected manifest emitted by first-round-manifest.ts +
 * a captured logcat.txt from a drive session, categorizes every
 * expected coach event as matched / missing / late / wrong-asset /
 * duplicated, counts transport re-anchor events (health indicator),
 * and emits a verdict.
 *
 * Fast-fails on the "hard-zero" categories per the Loop plan
 * principle #15:
 *   - duplicated coach events (any)
 *   - wrong-asset matches (any)
 *   - missing required combo-announces (any)
 * Anchor storm is a health flag; > 20 re-anchors per round is
 * flagged red but doesn't hard-fail — that's a diagnostic signal
 * for Stage 3b (acoustic) to prove the audio-visual disconnect.
 *
 * Usage:
 *   node tools/analysis/verify-first-round.mjs \
 *     --manifest tools/analysis/manifests/<id>.json \
 *     --session <sessionDir>
 *
 * Exit codes: 0=pass, 1=hard-fail, 2=soft-warn (audible but drifted)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const MATCH_WINDOW_MS = 500 // ±500 ms considered "matched" (loose for now — Stage 3b tightens acoustically)
const LATE_WINDOW_MS = 1500 // outside this = "missing"
const RE_ANCHOR_BUDGET = 20 // per round; > 20 = soft warn

// ---------------------------------------------------------------------------
// Logcat parser
// ---------------------------------------------------------------------------

/**
 * Match a logcat line prefix + puncheokie event.
 * `adb logcat -v time` format: `MM-DD HH:MM:SS.mmm I/ReactNativeJS(pid): 'msg', ...'`
 */
const LOG_PREFIX = /^(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+\w\/\w+\(\s*\d+\):\s*(.*)$/

function parseTimestampMs(dateStr, timeStr) {
  // Return an absolute epoch-like ms — we only care about DIFFERENCES,
  // so relative to an arbitrary base is fine.
  const [hh, mm, ss] = timeStr.split(':')
  const [ssI, ms] = ss.split('.')
  return (
    Number(hh) * 3600_000 +
    Number(mm) * 60_000 +
    Number(ssI) * 1000 +
    Number(ms)
  )
}

/** Extract a specific field from a JSON-like body inside a log line. */
function extractField(body, key) {
  const re = new RegExp(`${key}:\\s*'([^']*)'|${key}:\\s*"([^"]*)"|${key}:\\s*([0-9.eE+-]+)`)
  const m = body.match(re)
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined
}

/**
 * Stitch multi-line logcat records. React Native's logger emits object
 * payloads across multiple lines, all with the same timestamp+prefix.
 * We collapse them into single body strings so a `text:` field ~2 lines
 * below the `puncheokie.voice.play` tag is visible to `extractField`.
 *
 * Continuation heuristic: a line whose body starts with whitespace + a
 * field name (`text:`, `durationMs:`, `asset:`, etc.) or a closing `}`
 * is appended to the previous record's body.
 */
function stitchLogRecords(logcatText) {
  const lines = logcatText.split(/\r?\n/)
  const records = []
  let current = null
  for (const rawLine of lines) {
    const m = LOG_PREFIX.exec(rawLine)
    if (!m) {
      current = null
      continue
    }
    const [, dateStr, timeStr, body] = m
    const startsWithTag = body.startsWith("'[")
    if (startsWithTag || current === null) {
      if (current) records.push(current)
      current = { dateStr, timeStr, body }
    } else {
      current.body += ' ' + body.trim()
    }
  }
  if (current) records.push(current)
  return records
}

/**
 * Parse a whole logcat file into a stream of typed events we care about.
 */
export function parseLogcat(logcatText) {
  const events = []
  const records = stitchLogRecords(logcatText)
  for (const { dateStr, timeStr, body } of records) {
    const ts = parseTimestampMs(dateStr, timeStr)
    if (body.includes('puncheokie.runner.start')) {
      events.push({ type: 'runner.start', ts, raw: body })
      continue
    }
    if (body.includes('puncheokie.slotDispatcher.armed')) {
      events.push({ type: 'slotDispatcher.armed', ts, raw: body })
      continue
    }
    if (body.includes("'intro playing'")) {
      events.push({ type: 'intro.playing', ts, raw: body })
      continue
    }
    if (body.includes("'intro complete'")) {
      events.push({ type: 'intro.complete', ts, raw: body })
      continue
    }
    if (body.includes("puncheokie.metronome") && body.includes("loop started")) {
      events.push({ type: 'metronome.started', ts, raw: body })
      continue
    }
    if (body.includes('puncheokie.transport') && body.includes('re-anchored')) {
      events.push({ type: 'transport.reanchor', ts, raw: body })
      continue
    }
    if (body.includes("puncheokie.voice.play")) {
      if (body.includes("'combo-announce playing'")) {
        const text = extractField(body, 'text')
        const durationMs = extractField(body, 'durationMs')
        events.push({
          type: 'voice.combo-announce',
          ts,
          text,
          durationMs: durationMs !== undefined ? Number(durationMs) : undefined,
          raw: body,
        })
      } else if (body.includes("'clip playing'")) {
        const asset = extractField(body, 'asset')
        events.push({ type: 'voice.clip', ts, asset, raw: body })
      }
      continue
    }
    if (body.includes("puncheokie.cue.tokenDue")) {
      events.push({ type: 'cue.tokenDue', ts, raw: body })
      continue
    }
  }
  return events
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

/**
 * Anchor observed events to workElapsedMs=0. The transport's `loop started`
 * event happens right at the first bell — the moment the round clock
 * begins — so it's our best t0 marker.
 */
function findT0(events) {
  const metronome = events.find((e) => e.type === 'metronome.started')
  if (metronome) return { ts: metronome.ts, source: 'metronome.started' }
  const runnerStart = events.find((e) => e.type === 'runner.start')
  if (runnerStart) return { ts: runnerStart.ts, source: 'runner.start' }
  return null
}

/**
 * Correlate observed audio events against expected coach events. Handles
 * two expected kinds:
 *   - `combo-announce`: matched to `voice.combo-announce` observed
 *     events by TEXT (log emits text but not assetId today).
 *   - `per-word`: matched to `voice.clip` observed events by ASSET id
 *     (log fields the asset name for clip plays).
 *
 * Categories per expected event: matched / late / missing.
 * Categories per unmatched observed event: extra / duplicated.
 */
function correlateCoachEvents(expected, observed) {
  const observedByText = new Map()
  const observedByAsset = new Map()
  for (const e of observed) {
    if (e.type === 'voice.combo-announce' && e.text) {
      if (!observedByText.has(e.text)) observedByText.set(e.text, [])
      observedByText.get(e.text).push(e)
    } else if (e.type === 'voice.clip' && e.asset) {
      if (!observedByAsset.has(e.asset)) observedByAsset.set(e.asset, [])
      observedByAsset.get(e.asset).push(e)
    }
  }
  const usedObservedIndex = new Set()
  const verdicts = []
  for (const exp of expected) {
    let candidates = []
    if (exp.kind === 'combo-announce') {
      candidates = observedByText.get(exp.text ?? '') ?? []
    } else if (exp.kind === 'per-word') {
      candidates = observedByAsset.get(exp.assetId) ?? []
    }
    let bestIdx = -1
    let bestDelta = Number.POSITIVE_INFINITY
    for (let i = 0; i < candidates.length; i += 1) {
      const globalIdx = observed.indexOf(candidates[i])
      if (usedObservedIndex.has(globalIdx)) continue
      const delta = candidates[i].elapsedMs - exp.expectedStartMs
      if (Math.abs(delta) < Math.abs(bestDelta)) {
        bestDelta = delta
        bestIdx = globalIdx
      }
    }
    if (bestIdx === -1 || Math.abs(bestDelta) > LATE_WINDOW_MS) {
      verdicts.push({
        expected: exp,
        verdict: 'missing',
        observed: null,
        deltaMs: null,
      })
    } else if (Math.abs(bestDelta) <= MATCH_WINDOW_MS) {
      usedObservedIndex.add(bestIdx)
      verdicts.push({
        expected: exp,
        verdict: 'matched',
        observed: observed[bestIdx],
        deltaMs: bestDelta,
      })
    } else {
      usedObservedIndex.add(bestIdx)
      verdicts.push({
        expected: exp,
        verdict: 'late',
        observed: observed[bestIdx],
        deltaMs: bestDelta,
      })
    }
  }
  // Anything observed that didn't get claimed = 'extra' initially, then
  // reclassify as 'duplicated' if it matches an expected event's identity
  // within the late window.
  const extras = []
  observed.forEach((e, i) => {
    if (usedObservedIndex.has(i)) return
    if (e.type !== 'voice.combo-announce' && e.type !== 'voice.clip') return
    extras.push({ observed: e, verdict: 'extra' })
  })
  for (const ex of extras) {
    const isCombo = ex.observed.type === 'voice.combo-announce'
    const nearby = expected.find((exp) => {
      if (isCombo && exp.kind === 'combo-announce' && exp.text === ex.observed.text) {
        return Math.abs(ex.observed.elapsedMs - exp.expectedStartMs) <= LATE_WINDOW_MS
      }
      if (!isCombo && exp.kind === 'per-word' && exp.assetId === ex.observed.asset) {
        return Math.abs(ex.observed.elapsedMs - exp.expectedStartMs) <= LATE_WINDOW_MS
      }
      return false
    })
    if (nearby) {
      ex.verdict = 'duplicated'
      ex.expected = nearby
    }
  }
  return { verdicts, extras }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function classifyRunHealth(t0, reanchorCount, verdicts, extras) {
  const missing = verdicts.filter((v) => v.verdict === 'missing').length
  const late = verdicts.filter((v) => v.verdict === 'late').length
  const matched = verdicts.filter((v) => v.verdict === 'matched').length
  const wrongAsset = 0 // not detectable with text-only matching; Stage 3a-fu (assetId log)
  const duplicated = extras.filter((e) => e.verdict === 'duplicated').length
  const extra = extras.filter((e) => e.verdict === 'extra').length
  const total = verdicts.length
  const hardFail =
    missing > 0 || duplicated > 0 || wrongAsset > 0 || !t0
  const softWarn = late > 0 || extra > 0 || reanchorCount > RE_ANCHOR_BUDGET
  return {
    total,
    matched,
    late,
    missing,
    wrongAsset,
    duplicated,
    extra,
    reanchorCount,
    hardFail,
    softWarn,
    verdict: hardFail ? 'FAIL' : softWarn ? 'WARN' : 'PASS',
  }
}

function renderReport(manifestPath, sessionDir, manifest, t0, health, verdicts, extras) {
  const lines = []
  lines.push(`# First-round verification — ${manifest.workoutName}`)
  lines.push('')
  lines.push(`- Manifest: \`${manifestPath}\``)
  lines.push(`- Session: \`${sessionDir}\``)
  lines.push(`- Timeline hash: \`${manifest.identity.timelineHash}\``)
  lines.push(`- BPM: ${manifest.bpm} · Work duration: ${manifest.workDurationMs / 1000}s`)
  lines.push(`- t0 anchor: ${t0 ? t0.source + ' @ ' + t0.ts + 'ms' : 'MISSING (fatal)'}`)
  lines.push('')
  lines.push(`## Verdict: **${health.verdict}**`)
  lines.push('')
  lines.push(`| Metric | Count |`)
  lines.push(`|---|---|`)
  lines.push(`| Total expected combo-announces | ${health.total} |`)
  lines.push(`| Matched (within ±${MATCH_WINDOW_MS}ms) | ${health.matched} |`)
  lines.push(`| Late (${MATCH_WINDOW_MS}–${LATE_WINDOW_MS}ms drift) | ${health.late} |`)
  lines.push(`| Missing | ${health.missing} |`)
  lines.push(`| Duplicated | ${health.duplicated} |`)
  lines.push(`| Extra (stray) | ${health.extra} |`)
  lines.push(`| Transport re-anchors | ${health.reanchorCount} (budget: ${RE_ANCHOR_BUDGET}) |`)
  lines.push('')
  if (verdicts.length > 0) {
    lines.push(`## Per-event verdicts`)
    lines.push('')
    lines.push(`| # | Expected text | Expected @ ms | Verdict | Observed @ ms | Δ ms |`)
    lines.push(`|---|---|---|---|---|---|`)
    verdicts.forEach((v, i) => {
      const text = (v.expected.text ?? v.expected.assetId ?? '').slice(0, 40)
      const obsMs = v.observed ? Math.round(v.observed.elapsedMs) : '—'
      const dMs = v.deltaMs !== null && v.deltaMs !== undefined ? Math.round(v.deltaMs) : '—'
      lines.push(
        `| ${i + 1} | ${text} | ${Math.round(v.expected.expectedStartMs)} | ${v.verdict} | ${obsMs} | ${dMs} |`,
      )
    })
    lines.push('')
  }
  if (extras.length > 0) {
    lines.push(`## Extra / duplicated observed events`)
    lines.push('')
    lines.push(`| # | Text | Observed @ ms | Verdict |`)
    lines.push(`|---|---|---|---|`)
    extras.forEach((e, i) => {
      lines.push(
        `| ${i + 1} | ${(e.observed.text ?? '').slice(0, 40)} | ${Math.round(e.observed.elapsedMs)} | ${e.verdict} |`,
      )
    })
    lines.push('')
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { manifest: undefined, session: undefined }
  for (const a of argv) {
    if (a.startsWith('--manifest=')) args.manifest = a.slice('--manifest='.length)
    else if (a === '--manifest') args._nextManifest = true
    else if (args._nextManifest) {
      args.manifest = a
      args._nextManifest = false
    } else if (a.startsWith('--session=')) args.session = a.slice('--session='.length)
    else if (a === '--session') args._nextSession = true
    else if (args._nextSession) {
      args.session = a
      args._nextSession = false
    }
  }
  if (!args.manifest || !args.session) {
    throw new Error(
      'Usage: node tools/analysis/verify-first-round.mjs --manifest <path.json> --session <sessionDir>',
    )
  }
  return args
}

export function verify(manifest, logcatText) {
  const events = parseLogcat(logcatText)
  const t0 = findT0(events)
  const observed = events
    .filter((e) => e.type === 'voice.combo-announce' || e.type === 'voice.clip')
    .map((e) => ({ ...e, elapsedMs: t0 ? e.ts - t0.ts : 0 }))
  const reanchorCount = events.filter((e) => e.type === 'transport.reanchor').length
  const { verdicts, extras } = correlateCoachEvents(manifest.coachEvents ?? [], observed)
  const health = classifyRunHealth(t0, reanchorCount, verdicts, extras)
  return { t0, verdicts, extras, health, reanchorCount, observedCount: observed.length }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.manifest)) {
    console.error(`manifest not found: ${args.manifest}`)
    process.exit(3)
  }
  const sessionLogPath = join(args.session, 'logcat.txt')
  if (!existsSync(sessionLogPath)) {
    console.error(`session logcat not found: ${sessionLogPath}`)
    process.exit(3)
  }
  const manifest = JSON.parse(readFileSync(args.manifest, 'utf8'))
  const logcatText = readFileSync(sessionLogPath, 'utf8')
  const result = verify(manifest, logcatText)
  const md = renderReport(basename(args.manifest), args.session, manifest, result.t0, result.health, result.verdicts, result.extras)
  const reportPath = join(args.session, 'verify-report.md')
  const jsonPath = join(args.session, 'verify-report.json')
  writeFileSync(reportPath, md, 'utf8')
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        workoutId: manifest.workoutId,
        timelineHash: manifest.identity.timelineHash,
        t0: result.t0,
        health: result.health,
        reanchorCount: result.reanchorCount,
        observedCount: result.observedCount,
        verdicts: result.verdicts,
        extras: result.extras,
      },
      null,
      2,
    ),
    'utf8',
  )
  console.log(md)
  console.log(`\nWrote ${reportPath}`)
  console.log(`Wrote ${jsonPath}`)
  process.exit(result.health.hardFail ? 1 : result.health.softWarn ? 2 : 0)
}

const invokedDirectly = process.argv[1]?.endsWith('verify-first-round.mjs')
if (invokedDirectly) {
  main()
}
