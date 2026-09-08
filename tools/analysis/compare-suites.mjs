/**
 * Diff two verify-suite runs — the A/B the breath-floor change is judged by.
 *
 *   node tools/analysis/compare-suites.mjs --before <dir> --after <dir> [--before <d2> --after <d2>]
 *
 * Two runs of ~5 hours of exclusive tablet time produce the inputs. A false
 * PASS here ships an audio regression; a false FAIL burns the tablet again.
 * So the governing rule of this file is: **absent or unreadable evidence is a
 * HARD FAILURE, never a pass.** An earlier version defaulted missing fields to
 * benign values and could be made to print ALL CRITERIA PASS on a run whose
 * worst delivered bar collapsed from 210 ms to 20 ms against a 150 ms floor.
 * Every `?? 0` below was deliberately removed for that reason; do not add them
 * back to quiet a noisy run.
 *
 * Exit: 3 bad input, 1 a hard criterion failed, 2 only soft, 0 all pass.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

/**
 * Floor on the "unchanged" band for a slot's delivered median.
 *
 * The real band is computed per slot from that slot's own spread (see
 * `bandFor`); this is only the floor, so a very tight slot cannot demand
 * sub-millisecond stability. Sized from the dense slots the criterion is
 * named after (n ~= 60, p5-p95 ~= 250 ms), where the 95% band on a
 * difference of two medians works out near 30 ms.
 */
const UNMOVED_SLOT_JITTER_MS = 40

/**
 * Below this many bars a slot's median is not a median. Body-work drives
 * carry slots with n = 2 whose "median" moved 119 ms between two drives of
 * the same build — noise indistinguishable from any change under test.
 * Reported as unjudgeable rather than passed or failed.
 */
const MIN_SLOT_N = 20

/** A planned-breath move smaller than this is float noise, not a change. */
const PLANNED_MOVE_EPSILON_MS = 1

/** Suite settings that must match on both sides or the comparison is meaningless. */
const MUST_MATCH_ARGS = ['vocab', 'sim', 'firstRoundOnly', 'expectRelease', 'launch']

const r1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)
const key = (r) => `${r.workoutId}/${r.vocab}`
const signed = (v) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${r1(v)}`)

class InputError extends Error {}

function loadSuite(dir) {
  const summaryPath = join(dir, 'summary.json')
  if (!existsSync(summaryPath)) throw new InputError(`no summary.json in ${dir}`)
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
  const rows = (summary.rows ?? []).filter((r) => !r.superseded)
  if (rows.length === 0) throw new InputError(`${dir}: summary.json has no drives`)
  for (const row of rows) {
    // Derived from the directory WE were handed, never from `row.sessionDir`.
    // `--out` is stored verbatim by verify-suite, so a relative --out (the
    // normal case) yields a sessionDir that resolves against whatever cwd
    // this tool happens to run in. Resolving it that way made criterion 4
    // iterate an empty set and print PASS from the wrong directory.
    const reportPath = join(dir, basename(row.sessionDir ?? ''), 'observed-timing-report.json')
    if (!existsSync(reportPath)) {
      throw new InputError(
        `${key(row)}: no observed-timing-report.json at ${reportPath}. ` +
          `Either the suite ran with --timing-gate=off, or that drive never produced one. ` +
          `Without it the "dense bars did not move" criterion cannot be evaluated.`,
      )
    }
    row._timing = JSON.parse(readFileSync(reportPath, 'utf8'))
  }
  return { dir, summary, rows }
}

/** The floor block from the drive's own report — the ledger copy may predate the field. */
const floorOf = (r) => r._timing?.breath?.floor ?? null
const constOf = (r) => ({
  min: r._timing?.constants?.breath?.MIN_BREATH_MS ?? null,
  shortfall: r._timing?.constants?.breath?.DELIVERED_BREATH_SHORTFALL_MS ?? null,
})

/** Spread of a slot, from the percentiles the report already carries. */
function sigmaOf(s) {
  if (s.p95BreathMs === null || s.p5BreathMs === null) return null
  return (s.p95BreathMs - s.p5BreathMs) / 3.29
}

/**
 * How far this slot's delivered median may move on jitter alone — the 95%
 * band on a difference of two medians, floored at UNMOVED_SLOT_JITTER_MS.
 * A flat 40 ms was 2-3x too tight for every slot below n ~= 40 and produced
 * false alarms on real repeat drives of the same build.
 */
function bandFor(bs, as) {
  const sb = sigmaOf(bs)
  const sa = sigmaOf(as)
  if (sb === null || sa === null) return UNMOVED_SLOT_JITTER_MS
  const se = Math.sqrt((1.253 * sb) ** 2 / bs.n + (1.253 * sa) ** 2 / as.n)
  return Math.max(UNMOVED_SLOT_JITTER_MS, 1.96 * se)
}

function dedup(rows, side) {
  const m = new Map()
  for (const r of rows) {
    const prev = m.get(key(r))
    if (prev) {
      throw new InputError(
        `${side}: ${key(r)} appears twice (${prev._suiteDir} and ${r._suiteDir}). ` +
          `Last-write-wins would silently pick one by argument order — pass only one suite containing it.`,
      )
    }
    m.set(key(r), r)
  }
  return m
}

function parseArgs(argv) {
  const befores = []
  const afters = []
  let expectDrives = null
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--before' || a === '--after') {
      const v = argv[i + 1]
      if (!v || v.startsWith('--')) throw new InputError(`${a} needs a directory`)
      ;(a === '--before' ? befores : afters).push(v)
      i += 1
    } else if (a.startsWith('--expect-drives=')) {
      expectDrives = Number(a.slice('--expect-drives='.length))
      if (!Number.isInteger(expectDrives) || expectDrives < 1) throw new InputError('--expect-drives needs a positive integer')
    } else {
      throw new InputError(`unknown argument: ${a}`)
    }
  }
  if (befores.length === 0 || afters.length === 0) {
    throw new InputError('Usage: compare-suites.mjs --before <dir> --after <dir> [--expect-drives=N]')
  }
  return { befores, afters, expectDrives }
}

function run(argv) {
  const { befores, afters, expectDrives } = parseArgs(argv)
  const bSuites = befores.map(loadSuite)
  const aSuites = afters.map(loadSuite)
  const tag = (suites) =>
    suites.flatMap((s) => s.rows.map((r) => Object.assign(r, { _suiteDir: s.dir })))
  const beforeBy = dedup(tag(bSuites), 'before')
  const afterBy = dedup(tag(aSuites), 'after')
  const before = [...beforeBy.values()]
  const after = [...afterBy.values()]

  const L = []
  const C = []
  const hard = []
  const soft = []
  const push = (ok, level, name, detail) => {
    C.push(`${ok ? 'PASS' : level === 'hard' ? 'FAIL' : 'WARN'}  ${name}`)
    for (const d of detail) if (d) C.push(`        ${d}`)
    if (!ok) (level === 'hard' ? hard : soft).push(name)
  }

  // -- 0. THE RUNS ARE COMPARABLE AND COMPLETE -------------------------------
  //
  // Completeness is judged on DRIVE COUNT, not on how the process exited.
  // verify-suite rewrites summary.json after every drive and only the final
  // write carries `exitCode`, so a suite killed at drive 21 of 22 leaves a
  // perfectly well-formed 21-row summary. That is not hypothetical: the
  // pre-floor baseline lost its tablet to a dropped wireless-adb link after
  // drive 21 and had to be finished into a second suite directory. A run
  // legitimately assembled from several directories has no single exitCode
  // and must still pass; a run that is silently two drives short must not.
  //
  // `--expect-drives` is the only thing that can tell those apart, so when it
  // is given it is the gate, and the missing exitCode drops to a note.
  const unfinished = [...bSuites, ...aSuites].filter((s) => s.summary.exitCode === undefined)
  if (expectDrives === null) {
    push(unfinished.length === 0, 'hard', 'both suites ran to completion', [
      unfinished.length === 0
        ? 'each summary.json carries a final exitCode'
        : unfinished.map((s) => `${s.dir}: no exitCode — interrupted. Pass --expect-drives=N if this side was deliberately assembled from several runs.`).join('; '),
    ])
  } else {
    push(before.length === expectDrives && after.length === expectDrives, 'hard', `each side covers all ${expectDrives} expected drives`, [
      `before ${before.length}, after ${after.length}`,
      unfinished.length > 0 ? `(${unfinished.length} suite(s) carry no exitCode — expected when a side is assembled from several runs)` : null,
    ])
  }

  const gateOff = [...bSuites, ...aSuites].filter((s) => s.summary.args?.timingGate === 'off')
  push(gateOff.length === 0, 'hard', 'the timing gate was on for both runs', [
    gateOff.length === 0 ? 'every drive was analysed' : gateOff.map((s) => s.dir).join(', ') + ' ran with --timing-gate=off, so no floor evidence exists',
  ])

  const argMismatch = []
  for (const k of MUST_MATCH_ARGS) {
    const vals = [...new Set([...bSuites, ...aSuites].map((s) => JSON.stringify(s.summary.args?.[k])))]
    if (vals.length > 1) argMismatch.push(`${k}: ${vals.join(' vs ')}`)
  }
  push(argMismatch.length === 0, 'hard', 'both sides ran the same suite configuration', [
    argMismatch.length === 0 ? MUST_MATCH_ARGS.join(', ') + ' all match' : argMismatch.join('; '),
  ])

  const devices = [...new Set([...bSuites, ...aSuites].map((s) => s.summary.deviceId))]
  push(devices.length === 1, 'soft', 'both sides ran on the same device', [devices.join(' vs ')])

  // -- 1. PROVENANCE ---------------------------------------------------------
  // A wrong-APK run is only a WARN inside verify-suite and never reaches
  // summary.md, so a "baseline" that silently re-ran the other build would
  // show no change — and read as "the change did nothing".
  const shas = (rows) => [...new Set(rows.map((r) => r.build?.gitSha).filter(Boolean))]
  const bSha = shas(before)
  const aSha = shas(after)
  const mismatched = [...before, ...after].filter((r) => r.build?.shaMismatch)
  push(
    bSha.length === 1 && aSha.length === 1 && bSha[0] !== aSha[0] && mismatched.length === 0,
    'hard',
    'one build per side, and the two sides differ',
    [
      `before ${bSha.join('+') || '(none)'} · after ${aSha.join('+') || '(none)'}`,
      mismatched.length > 0 ? `${mismatched.length} drive(s) flagged shaMismatch: ${mismatched.map(key).join(', ')}` : null,
    ],
  )

  // `loadTimingConstants` prefers a GITIGNORED cache over the source tree, so
  // this can be identical on both sides even when the trees differ — the
  // baseline would then self-report the other build's constants.
  const cB = [...new Set(before.map((r) => JSON.stringify(constOf(r))))]
  const cA = [...new Set(after.map((r) => JSON.stringify(constOf(r))))]
  push(cB.length === 1 && cA.length === 1 && cB[0] !== cA[0], 'hard', 'the two sides were scored with different constants', [
    `before ${cB.join(' | ')}`,
    `after  ${cA.join(' | ')}`,
    cB[0] === cA[0] ? 'identical means tools/analysis/reports/timing-constants.json was not regenerated after checkout' : null,
  ])

  // -- 2. EVERY DRIVE PRODUCED USABLE EVIDENCE -------------------------------
  // Guards the whole family of "field absent reads as field is fine" bugs. If
  // MIN_BREATH_MS becomes a computed expression the constants reader cannot
  // parse, floorMs goes null and the floor gates below would skip the very
  // rows they exist to judge.
  const unusable = [...before, ...after].filter((r) => {
    const f = floorOf(r)
    return !f || f.floorMs === null || f.n === 0 || f.minBreathMs === null || f.barsUnderFloorRatio === null
  })
  push(unusable.length === 0, 'hard', 'every drive produced a readable breath floor', [
    unusable.length === 0
      ? `${before.length + after.length} drives, all with a floor, bars and a minimum`
      : unusable.map((r) => `${key(r)} (${r._suiteDir}): ${JSON.stringify(floorOf(r) && { floorMs: floorOf(r).floorMs, n: floorOf(r).n, min: floorOf(r).minBreathMs })}`).join('; '),
  ])

  // -- 3. COVERAGE -----------------------------------------------------------
  const missing = [...beforeBy.keys()].filter((k) => !afterBy.has(k))
  const added = [...afterBy.keys()].filter((k) => !beforeBy.has(k))
  push(missing.length === 0 && added.length === 0, 'hard', 'the two runs cover the same drives', [
    missing.length ? `only in before: ${missing.join(', ')}` : null,
    added.length ? `only in after: ${added.join(', ')}` : null,
    missing.length === 0 && added.length === 0 ? `${beforeBy.size} drives on both sides` : null,
  ])

  // -- 4. NEVER LATE ---------------------------------------------------------
  const pastAfter = after.filter((r) => floorOf(r).barsAtOrPastPunch > 0)
  const pastBefore = before.filter((r) => floorOf(r).barsAtOrPastPunch > 0)
  push(pastAfter.length === 0, 'hard', 'barsAtOrPastPunch = 0 on every after drive', [
    pastAfter.length === 0 ? 'no call reached its punch' : pastAfter.map((r) => `${key(r)}: ${floorOf(r).barsAtOrPastPunch} bar(s), worst ${floorOf(r).minBreathMs} ms`).join('; '),
    `before had ${pastBefore.length} such drive(s)${pastBefore.length ? ': ' + pastBefore.map(key).join(', ') : ''}`,
  ])

  // -- 5. THE FLOOR ----------------------------------------------------------
  const underAfter = after.filter((r) => floorOf(r).minBreathMs < floorOf(r).floorMs)
  push(underAfter.length === 0, 'hard', 'minBreathMs >= MIN_BREATH_MS on every after drive', [
    underAfter.length === 0
      ? "every drive's tightest bar clears its floor"
      : underAfter.map((r) => `${key(r)}: min ${floorOf(r).minBreathMs} < floor ${floorOf(r).floorMs} (${floorOf(r).barsUnderFloor}/${floorOf(r).n})`).join('; '),
  ])

  const worseRatio = []
  for (const [k, b] of beforeBy) {
    const a = afterBy.get(k)
    if (!a) continue
    const rb = floorOf(b).barsUnderFloorRatio
    const ra = floorOf(a).barsUnderFloorRatio
    if (ra > rb + 1e-9) worseRatio.push(`${k}: ${rb} → ${ra}`)
  }
  push(worseRatio.length === 0, 'hard', 'barsUnderFloorRatio never increased', [
    worseRatio.length === 0 ? 'no drive got worse' : worseRatio.join('; '),
  ])

  // -- 6. NO VERDICT REGRESSION, AND THE AFTER SIDE IS ACTUALLY HEALTHY ------
  const rank = (v) => (v === 'PASS' ? 0 : v === 'WARN' ? 1 : v === 'STALE' ? 2 : 3)
  const regressed = []
  for (const [k, b] of beforeBy) {
    const a = afterBy.get(k)
    if (!a) continue
    if (rank(a.verdict) > rank(b.verdict)) regressed.push(`${k}: ${b.verdict} → ${a.verdict}${a.reason ? ` (${a.reason})` : ''}`)
  }
  push(regressed.length === 0, 'hard', 'no drive regressed its verdict', [regressed.length === 0 ? 'every drive held or improved' : regressed.join('; ')])

  // Relative rank alone would pass 22 drives that FAIL identically on both
  // sides — "every drive held or improved" over a uniformly broken run.
  const brokenAfter = after.filter((r) => r.verdict === 'FAIL' || r.verdict === 'ERROR' || r.verdict === 'STALE')
  push(brokenAfter.length === 0, 'hard', 'no after drive is FAIL/ERROR/STALE in absolute terms', [
    brokenAfter.length === 0 ? 'the after run is healthy on its own, not merely no worse' : brokenAfter.map((r) => `${key(r)}: ${r.verdict}${r.reason ? ` (${r.reason})` : ''}`).join('; '),
  ])

  const crashed = [...before, ...after].filter((r) => ![0, 1, 2].includes(r.timingExit))
  push(crashed.length === 0, 'hard', 'the analyzer ran cleanly on every drive', [
    crashed.length === 0 ? 'no usage/crash exit codes' : crashed.map((r) => `${key(r)}: timingExit ${r.timingExit}`).join('; '),
  ])

  // -- 7. THE CLAMP BIT ONLY WHERE IT SHOULD ---------------------------------
  //
  // The sharpest check, and the one no summary table can show. Per
  // (workout, slot): if `plannedBreathMs` is unchanged the clamp did not touch
  // that slot, so its DELIVERED median must hold within that slot's own noise
  // band — that is the proof dense bars did not move. If planned rose, the
  // delivered median must rise with it.
  const drift = []
  const notFollowed = []
  const unjudgeable = []
  const oneSided = []
  const ambiguous = []
  let lifted = 0
  let lowered = 0
  let held = 0
  for (const [k, b] of beforeBy) {
    const a = afterBy.get(k)
    if (!a) continue
    const bySlotB = b._timing?.breath?.bySlot ?? {}
    const bySlotA = a._timing?.breath?.bySlot ?? {}
    // The UNION — iterating only the before side hid slots the after run
    // introduced, and slots that vanished were skipped without a word.
    for (const slot of new Set([...Object.keys(bySlotB), ...Object.keys(bySlotA)])) {
      const bs = bySlotB[slot]
      const as = bySlotA[slot]
      if (!bs || !as) {
        oneSided.push(`${k} ${slot}: only in ${bs ? 'before' : 'after'}`)
        continue
      }
      if (bs.medianBreathMs === null || as.medianBreathMs === null) {
        unjudgeable.push(`${k} ${slot}: no median`)
        continue
      }
      if (bs.plannedBreathMs === null || as.plannedBreathMs === null) {
        ambiguous.push(`${k} ${slot}: plannedBreathMs null on ${bs.plannedBreathMs === null ? 'before' : 'after'} — cannot classify`)
        continue
      }
      if (Math.min(bs.n, as.n) < MIN_SLOT_N) {
        unjudgeable.push(`${k} ${slot}: n ${bs.n}/${as.n} < ${MIN_SLOT_N}`)
        continue
      }
      const plannedDelta = as.plannedBreathMs - bs.plannedBreathMs
      const deliveredDelta = as.medianBreathMs - bs.medianBreathMs
      const band = bandFor(bs, as)
      if (Math.abs(plannedDelta) < PLANNED_MOVE_EPSILON_MS) {
        held += 1
        if (Math.abs(deliveredDelta) > band) {
          drift.push(`${k} ${slot}: planned held at ${bs.plannedBreathMs} but delivered ${bs.medianBreathMs} → ${as.medianBreathMs} (${signed(deliveredDelta)}, band ±${r1(band)})`)
        }
      } else if (plannedDelta > 0) {
        lifted += 1
        if (deliveredDelta < plannedDelta - band) {
          notFollowed.push(`${k} ${slot}: planned ${signed(plannedDelta)} but delivered only ${signed(deliveredDelta)} (band ±${r1(band)})`)
        }
      } else {
        // Not expected for this change, but a lowered planned breath is a
        // finding in its own right rather than something to fold into "raised".
        lowered += 1
        if (deliveredDelta > plannedDelta + band) {
          notFollowed.push(`${k} ${slot}: planned LOWERED ${signed(plannedDelta)} but delivered ${signed(deliveredDelta)} (band ±${r1(band)})`)
        }
      }
    }
  }
  push(drift.length === 0, 'soft', `slots the clamp did not touch held their delivered median`, [
    `${held} slot(s) had their planned breath unchanged`,
    drift.length === 0 ? 'each held within its own noise band — the clamp did not bite where it should not' : drift.slice(0, 12).join('; ') + (drift.length > 12 ? ` …and ${drift.length - 12} more` : ''),
  ])
  push(notFollowed.length === 0, 'soft', 'slots the clamp moved delivered the move', [
    `${lifted} lifted, ${lowered} lowered`,
    notFollowed.length === 0 ? 'each carried through to the ear' : notFollowed.slice(0, 12).join('; '),
  ])
  push(ambiguous.length === 0, 'soft', 'every paired slot could be classified', [
    ambiguous.length === 0 ? 'no null plannedBreathMs' : ambiguous.slice(0, 8).join('; '),
  ])
  if (oneSided.length > 0 || unjudgeable.length > 0) {
    C.push(`NOTE  ${oneSided.length} slot(s) present on one side only, ${unjudgeable.length} too small to judge (n < ${MIN_SLOT_N})`)
    for (const s of [...oneSided, ...unjudgeable].slice(0, 8)) C.push(`        ${s}`)
  }

  // -- 8. AUDIO TRACK LEAK CANARY (GH #356) ----------------------------------
  const trackDrift = []
  for (const [k, b] of beforeBy) {
    const a = afterBy.get(k)
    if (!a) continue
    const bEnd = b.audioTracks?.end?.ours ?? null
    const aEnd = a.audioTracks?.end?.ours ?? null
    if (bEnd === null || aEnd === null) trackDrift.push(`${k}: missing reading (${bEnd} → ${aEnd})`)
    else if (aEnd > bEnd) trackDrift.push(`${k}: ${bEnd} → ${aEnd}`)
  }
  push(trackDrift.length === 0, 'soft', 'audioTracks.end.ours did not grow', [
    trackDrift.length === 0 ? 'no drive ended holding more tracks' : trackDrift.join('; '),
  ])

  // -- report ----------------------------------------------------------------
  L.push('# Suite A/B')
  L.push('')
  L.push(`before: ${befores.join(', ')} — ${before.length} drives · ${bSha.join('+') || '?'}`)
  L.push(`after:  ${afters.join(', ')} — ${after.length} drives · ${aSha.join('+') || '?'}`)
  L.push('')
  L.push('## Delivered breath, before → after')
  L.push('')
  L.push('| workout | vocab | min | p5 | median | at·past punch | under floor |')
  L.push('|---|---|---|---|---|---|---|')
  for (const k of [...beforeBy.keys()].sort()) {
    const b = beforeBy.get(k)
    const a = afterBy.get(k)
    const [w, v] = k.split('/')
    const bf = floorOf(b)
    const af = a ? floorOf(a) : null
    if (!bf || !af) {
      L.push(`| ${w} | ${v} | — | — | — | — | — |`)
      continue
    }
    const pct = (f) => (f.barsUnderFloorRatio === null ? 'n/a' : `${Math.round(f.barsUnderFloorRatio * 1000) / 10}%`)
    L.push(
      `| ${w} | ${v} | ${bf.minBreathMs} → **${af.minBreathMs}** | ${bf.p5BreathMs} → ${af.p5BreathMs} | ${bf.medianBreathMs} → ${af.medianBreathMs} | ${bf.barsAtOrPastPunch} → ${af.barsAtOrPastPunch} | ${bf.barsUnderFloor}/${bf.n} (${pct(bf)}) → **${af.barsUnderFloor}/${af.n} (${pct(af)})** |`,
    )
  }

  const totals = (rows) => {
    const f = rows.map(floorOf).filter(Boolean)
    const mins = f.map((x) => x.minBreathMs).filter((v) => v !== null)
    const bars = f.reduce((n, x) => n + x.n, 0)
    const under = f.reduce((n, x) => n + x.barsUnderFloor, 0)
    return { bars, under, past: f.reduce((n, x) => n + x.barsAtOrPastPunch, 0), min: mins.length ? Math.min(...mins) : null, pct: bars > 0 ? r1((under / bars) * 100) : null }
  }
  const tB = totals(before)
  const tA = totals(after)
  L.push('')
  L.push(
    `**Totals** — bars ${tB.bars} → ${tA.bars} · under floor ${tB.under} (${tB.pct ?? 'n/a'}%) → ${tA.under} (${tA.pct ?? 'n/a'}%) · at/past punch ${tB.past} → ${tA.past} · worst bar ${tB.min ?? 'n/a'} → ${tA.min ?? 'n/a'} ms`,
  )
  L.push('')
  L.push('## Criteria')
  L.push('')
  L.push(...C)
  L.push('')
  L.push(hard.length === 0 && soft.length === 0 ? 'ALL CRITERIA PASS' : `${hard.length} HARD${hard.length ? ': ' + hard.join('; ') : ''} · ${soft.length} soft${soft.length ? ': ' + soft.join('; ') : ''}`)
  console.log(L.join('\n'))
  return hard.length > 0 ? 1 : soft.length > 0 ? 2 : 0
}

try {
  process.exit(run(process.argv.slice(2)))
} catch (err) {
  // Exit 3 for anything about the INPUT, so an automated caller can never read
  // a typo'd path as "the coach regressed". 1 and 2 are verdicts only.
  console.error(err instanceof InputError ? `input: ${err.message}` : err)
  process.exit(3)
}
