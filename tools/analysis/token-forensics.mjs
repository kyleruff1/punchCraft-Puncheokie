/**
 * Token-order violation detector.
 *
 * Stage 3 of the token-order forensics harness (tracking: GH #305).
 *
 * Reads the `puncheokie.viz.batch` records a forensic drive emitted (see
 * `src/diagnostics/vizForensics.ts`) and answers the question the whole
 * investigation exists for: WHEN does a ring light out of order, and what
 * was happening in the moments before it did.
 *
 * Violation classes:
 *   - `re-light`   same tokenIndex lit twice inside one cue occurrence
 *   - `backtrack`  tokenIndex N lights after N+k (k>=1) already lit
 *   - `burst`      two or more tokens share one `workElapsedMs` — the
 *                  engine caught up and replayed a backlog
 *   - `cue-burst`  a burst that SPANS cues; the row resets mid-replay,
 *                  which is what reads on-glass as backtracking
 *
 * Each violation carries a context window of everything recorded around
 * it, so a fix is designed against evidence rather than a hypothesis.
 *
 * Usage:
 *   node tools/analysis/token-forensics.mjs --session <sessionDir>
 *   node tools/analysis/token-forensics.mjs --session <dir> --window=2000
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Pull every viz record out of a logcat file.
 *
 * React Native splits an object payload across lines that share one
 * timestamp+prefix, so the `records: '[...]'` array can land on its own
 * line. We scan for that array directly rather than trying to
 * reconstruct the whole log record.
 */
export function parseVizRecords(logcatText) {
  const records = []
  const lineRe = /^(\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d{3})\s+\w\/\w+\(\s*\d+\):\s*(.*)$/
  for (const rawLine of logcatText.split(/\r?\n/)) {
    const m = lineRe.exec(rawLine)
    if (!m) continue
    const [, , wallTime, body] = m
    const start = body.indexOf("records: '")
    if (start === -1) continue
    const jsonStart = body.indexOf('[', start)
    const jsonEnd = body.lastIndexOf(']')
    if (jsonStart === -1 || jsonEnd <= jsonStart) continue
    const json = body.slice(jsonStart, jsonEnd + 1)
    let parsed
    try {
      parsed = JSON.parse(json)
    } catch {
      continue // a truncated line — skip rather than guess
    }
    if (!Array.isArray(parsed)) continue
    for (const record of parsed) records.push({ ...record, wallTime })
  }
  return records
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Walk the token stream and classify ordering violations.
 *
 * Cue occurrence is the unit: a repeated combo mints a distinct cueId per
 * repeat (`r1-b1#0`, `r1-b1#1`), so a legitimate repeat is NOT a
 * violation — but the same token lighting twice inside one occurrence is.
 */
export function detectViolations(records) {
  const tokens = records.filter((r) => r.kind === 'token')
  const violations = []
  /** @type {Map<string, {seen: Set<number>, maxIndex: number}>} */
  const perCue = new Map()

  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]
    let state = perCue.get(t.cueId)
    if (!state) {
      state = { seen: new Set(), maxIndex: -1 }
      perCue.set(t.cueId, state)
    }

    if (state.seen.has(t.tokenIndex)) {
      violations.push({
        kind: 're-light',
        at: i,
        record: t,
        detail: `token ${t.tokenIndex} lit again inside ${t.cueId}`,
      })
    } else if (t.tokenIndex < state.maxIndex) {
      violations.push({
        kind: 'backtrack',
        at: i,
        record: t,
        detail: `token ${t.tokenIndex} lit after ${state.maxIndex} in ${t.cueId}`,
      })
    }
    state.seen.add(t.tokenIndex)
    state.maxIndex = Math.max(state.maxIndex, t.tokenIndex)
  }

  // Bursts: consecutive tokens sharing one work-clock sample. These are
  // the engine catching up, and they are the mechanism behind everything
  // the athlete perceives as spastic.
  let runStart = 0
  for (let i = 1; i <= tokens.length; i += 1) {
    const sameSample =
      i < tokens.length && tokens[i].workElapsedMs === tokens[runStart].workElapsedMs
    if (sameSample) continue
    const runLength = i - runStart
    if (runLength > 1) {
      const run = tokens.slice(runStart, i)
      const cues = new Set(run.map((r) => r.cueId))
      violations.push({
        kind: cues.size > 1 ? 'cue-burst' : 'burst',
        at: runStart,
        record: tokens[runStart],
        detail:
          `${runLength} tokens at workElapsedMs ${tokens[runStart].workElapsedMs.toFixed(1)} ` +
          `across ${cues.size} cue(s): ${[...cues].join(', ')}`,
        run,
      })
    }
    runStart = i
  }

  return { tokens, violations }
}

/** Everything recorded within `windowMs` of a violation, in time order. */
function contextWindow(records, centerMonotonicMs, windowMs) {
  return records
    .filter((r) => Math.abs(r.monotonicMs - centerMonotonicMs) <= windowMs)
    .sort((a, b) => a.monotonicMs - b.monotonicMs)
}

function describe(record) {
  if (record.kind === 'token') {
    return `token   ${record.cueId} idx=${record.tokenIndex} ord=${record.ordinal} src=${record.source} work=${record.workElapsedMs.toFixed(1)}`
  }
  if (record.kind === 'avatar') {
    return `avatar  ${record.frameKey} ${record.step} occ=${record.occurrence}`
  }
  return `CLOCK   wallGap=${record.wallDeltaMs.toFixed(0)}ms workGap=${record.workDeltaMs.toFixed(0)}ms  <-- STALL`
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function buildReport(sessionDir, records, tokens, violations, windowMs) {
  const clocks = records.filter((r) => r.kind === 'clock')
  const byKind = violations.reduce((acc, v) => {
    acc[v.kind] = (acc[v.kind] ?? 0) + 1
    return acc
  }, {})

  const lines = []
  lines.push('# Token-order forensics')
  lines.push('')
  lines.push(`- Session: \`${sessionDir}\``)
  lines.push(`- viz records: ${records.length} (tokens ${tokens.length}, clock ${clocks.length})`)
  lines.push('')
  lines.push('## Violations')
  lines.push('')
  lines.push('| Class | Count |')
  lines.push('|---|---|')
  for (const kind of ['re-light', 'backtrack', 'burst', 'cue-burst']) {
    lines.push(`| ${kind} | ${byKind[kind] ?? 0} |`)
  }
  lines.push('')

  if (clocks.length > 0) {
    const work = clocks.filter((c) => c.workElapsedMs > 0)
    const total = work.reduce((s, c) => s + c.wallDeltaMs, 0)
    const worst = work.reduce((m, c) => Math.max(m, c.wallDeltaMs), 0)
    lines.push('## Tick health')
    lines.push('')
    lines.push(`- work-phase stalls (>250 ms): **${work.length}**`)
    if (work.length > 0) {
      lines.push(`- mean gap: **${Math.round(total / work.length)} ms** (interval is 50 ms)`)
      lines.push(`- worst gap: **${Math.round(worst)} ms**`)
      lines.push(`- total stalled: **${(total / 1000).toFixed(1)} s**`)
    }
    lines.push('')
  }

  // Rank: cue-burst first — that is the class producing the backtracking
  // the athlete sees.
  const rank = { 'cue-burst': 0, backtrack: 1, 're-light': 2, burst: 3 }
  const ranked = [...violations].sort(
    (a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || b.at - a.at,
  )

  lines.push(`## Top violations (context ±${windowMs} ms)`)
  lines.push('')
  for (const v of ranked.slice(0, 12)) {
    lines.push(`### ${v.kind} — ${v.detail}`)
    lines.push('')
    lines.push(`Wall time: \`${v.record.wallTime}\``)
    lines.push('')
    lines.push('```')
    for (const r of contextWindow(records, v.record.monotonicMs, windowMs)) {
      const marker = r.monotonicMs === v.record.monotonicMs ? '>' : ' '
      lines.push(`${marker} ${r.wallTime}  ${describe(r)}`)
    }
    lines.push('```')
    lines.push('')
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { session: undefined, windowMs: 2000 }
  for (const a of argv) {
    if (a.startsWith('--session=')) args.session = a.slice('--session='.length)
    else if (a === '--session') args._next = true
    else if (args._next) {
      args.session = a
      args._next = false
    } else if (a.startsWith('--window=')) args.windowMs = Number(a.slice('--window='.length))
  }
  if (!args.session) {
    throw new Error('Usage: token-forensics.mjs --session <sessionDir> [--window=<ms>]')
  }
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const logPath = join(args.session, 'logcat.txt')
  if (!existsSync(logPath)) {
    console.error(`logcat not found: ${logPath}`)
    process.exit(3)
  }
  const records = parseVizRecords(readFileSync(logPath, 'utf8'))
  if (records.length === 0) {
    console.error('No viz records found — was this drive run with the instrumented dev bundle?')
    process.exit(3)
  }
  const { tokens, violations } = detectViolations(records)
  const report = buildReport(args.session, records, tokens, violations, args.windowMs)
  const outPath = join(args.session, 'forensics-report.md')
  writeFileSync(outPath, report, 'utf8')
  console.log(report)
  console.log(`\nWrote ${outPath}`)
}

const invokedDirectly = process.argv[1]?.endsWith('token-forensics.mjs')
if (invokedDirectly) main()
