/**
 * The mic-free timing analyzer (GH #291/#292, plan C5).
 *
 * Joins one capture's observer records to the runner's dispatch records
 * and reports what the athlete's ear would have judged — with numbers:
 *
 * - coverage: every coach play that minted a playId has an observation;
 * - onset latency per family and per path (armed vs fresh), labelled with
 *   the build it was measured on (dev vs release from `qa.run`);
 * - truncation: a play whose observed length is under its planned length;
 * - breath per call slot: `firstNodeMs − observed call end`, the click-track
 *   rail (plan C6) measured on audio instead of `dispatch + duration`;
 * - lead-ins: observed end against the runner's `endByMs` budget;
 * - combo announces: observed end against the block's first ring
 *   (`endToRingMs`) — the announce-then-work rail;
 * - ceremonies: bell onset after the boundary, warn end → bell (target
 *   0–400 ms; negative = the bell cut the countdown), recovery end → warn
 *   onset (> 0 required), intro and metronome onsets;
 * - rings: `cue.tokenDue` fire time against its own schedule;
 * - ducks: silent births (volume 0 at dispatch) and silent ms per round;
 * - the instrument tap and the observer's own cost.
 *
 * Work-axis ↔ monotonic: the runner's `cue.tokenDue` records carry both
 * clocks, so each round gets a robust offset (median of monotonic − work),
 * cross-checked against that round's `round.boundary work-entered`. The
 * wall-clock `audioT0EpochMs` derivation of the mic tools is retired here.
 *
 * Proposals are written under `proposals`, keyed to constants that exist
 * (tools/analysis/timing-constants.mjs reads them from the sources). They
 * are inputs to Kyle's ear, never applied by this tool.
 *
 *   node tools/analysis/observed-timing.mjs --session <dir>
 *   → <dir>/observed-timing-report.json + .md
 *
 * Exit: 0 clean, 1 hard (coverage < 98 %, truncation, or a fit that
 * disagrees with its boundary by > 250 ms), 2 soft (any warning), 3 usage.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { boolField, extractField, numField, recordsWithTag } from './logcat.mjs'
import { latencyStats, median, parseInstrumentObserved, parseVoiceObserved, percentile, TRUNCATION_MS } from './observed-summary.mjs'
import { loadTimingConstants } from './timing-constants.mjs'

export const COVERAGE_HARD = 0.98
export const FIT_DISAGREEMENT_HARD_MS = 250
export const FIT_DISAGREEMENT_SOFT_MS = 50
export const WARN_END_TO_BELL_TARGET_MS = [0, 400]
export const RAIL_TIGHT_MS = 60
/** A per-slot breath shift smaller than this is noise, not a proposal. */
export const BREATH_PROPOSAL_MIN_MS = 40
const BELL_WINDOW_MS = [-500, 3000]

const r1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export function parsePlays(text) {
  return recordsWithTag(text, 'puncheokie.voice.play').map(({ ts, body }) => ({
    ts,
    playId: extractField(body, 'playId'),
    kind: extractField(body, 'kind'),
    label: extractField(body, 'label'),
    asset: extractField(body, 'asset'),
    path: extractField(body, 'path'),
    traceId: extractField(body, 'traceId'),
    vocabulary: extractField(body, 'vocabulary'),
    text: extractField(body, 'text'),
    dispatchMs: numField(body, 'dispatchMs'),
    durationMs: numField(body, 'durationMs'),
    expectedDurationMs: numField(body, 'expectedDurationMs'),
    volume: numField(body, 'volume'),
  }))
}

export function parseClickDispatches(text) {
  return recordsWithTag(text, 'puncheokie.clickScript.dispatch').map(({ ts, body }) => ({
    ts,
    kind: extractField(body, 'kind'),
    slot: extractField(body, 'slot'),
    traceId: extractField(body, 'traceId'),
    dispatchAtMs: numField(body, 'dispatchAtMs'),
    lateMs: numField(body, 'lateMs'),
    durationMs: numField(body, 'durationMs'),
    endByMs: numField(body, 'endByMs'),
    firstNodeMs: numField(body, 'firstNodeMs'),
    monotonicTimeMs: numField(body, 'monotonicTimeMs'),
  }))
}

export function parseAnnounceDispatches(text) {
  return recordsWithTag(text, 'puncheokie.comboAnnounce.dispatch').map(({ ts, body }) => ({
    ts,
    slotId: extractField(body, 'slotId'),
    assetId: extractField(body, 'assetId'),
    atTick: numField(body, 'atTick'),
    monotonicTimeMs: numField(body, 'monotonicTimeMs'),
    traceId: extractField(body, 'traceId'),
    durationMs: numField(body, 'durationMs'),
  }))
}

export function parseTokenDue(text) {
  return recordsWithTag(text, 'puncheokie.cue.tokenDue').map(({ ts, body }) => ({
    ts,
    roundIndex: numField(body, 'roundIndex'),
    cueId: extractField(body, 'cueId'),
    combination: extractField(body, 'combination'),
    tokenIndex: numField(body, 'tokenIndex'),
    ordinal: numField(body, 'ordinal'),
    workElapsedMs: numField(body, 'workElapsedMs'),
    monotonicTimeMs: numField(body, 'monotonicTimeMs'),
    scheduledMs: numField(body, 'scheduledMs'),
  }))
}

export function parseBoundaries(text) {
  return recordsWithTag(text, 'puncheokie.round.boundary').map(({ ts, body }) => ({
    ts,
    transition: extractField(body, 'transition'),
    roundIndex: numField(body, 'roundIndex'),
    workElapsedMs: numField(body, 'workElapsedMs'),
    monotonicTimeMs: numField(body, 'monotonicTimeMs'),
  }))
}

export function parseBuild(text) {
  const run = recordsWithTag(text, 'puncheokie.qa.run').at(-1)
  if (!run) return { dev: null, gitSha: null, workout: null, vocab: null }
  return {
    dev: boolField(run.body, 'dev'),
    gitSha: extractField(run.body, 'gitSha') ?? null,
    workout: extractField(run.body, 'workout') ?? null,
    vocab: extractField(run.body, 'vocab') ?? null,
  }
}

// ---------------------------------------------------------------------------
// Work axis ↔ monotonic
// ---------------------------------------------------------------------------

/**
 * One offset per round: `monotonicTimeMs − workElapsedMs`, the median over
 * that round's `cue.tokenDue` records, cross-checked against the round's
 * `work-entered` boundary (which carries both clocks too).
 */
export function fitWorkAxis(tokenDue, boundaries) {
  const rounds = new Map()
  const byRound = new Map()
  for (const t of tokenDue) {
    if (t.roundIndex === undefined || t.workElapsedMs === undefined || t.monotonicTimeMs === undefined) continue
    const list = byRound.get(t.roundIndex) ?? []
    list.push(t.monotonicTimeMs - t.workElapsedMs)
    byRound.set(t.roundIndex, list)
  }
  const entered = boundaries.filter((b) => b.transition === 'work-entered' && b.monotonicTimeMs !== undefined)
  const roundIndexes = new Set([...byRound.keys(), ...entered.map((b) => b.roundIndex)])
  for (const roundIndex of roundIndexes) {
    const offsets = byRound.get(roundIndex) ?? []
    const boundary = entered.find((b) => b.roundIndex === roundIndex)
    const boundaryOffsetMs = boundary ? boundary.monotonicTimeMs - (boundary.workElapsedMs ?? 0) : null
    const offsetMs = offsets.length > 0 ? median(offsets) : boundaryOffsetMs
    rounds.set(roundIndex, {
      roundIndex,
      offsetMs,
      n: offsets.length,
      spreadMs: offsets.length > 1 ? r1(percentile(offsets, 95) - percentile(offsets, 5)) : 0,
      boundaryOffsetMs,
      disagreementMs: offsetMs !== null && boundaryOffsetMs !== null ? r1(Math.abs(offsetMs - boundaryOffsetMs)) : null,
      source: offsets.length > 0 ? 'tokenDue' : boundary ? 'boundary' : 'none',
    })
  }
  return rounds
}

/** Round windows on the monotonic clock: work-entered → the next boundary. */
export function roundWindows(boundaries) {
  const sorted = boundaries.filter((b) => b.monotonicTimeMs !== undefined).sort((a, b) => a.monotonicTimeMs - b.monotonicTimeMs)
  const windows = []
  for (let i = 0; i < sorted.length; i += 1) {
    const b = sorted[i]
    if (b.transition !== 'work-entered') continue
    const next = sorted.slice(i + 1).find((x) => x.transition !== 'work-entered' || x.roundIndex !== b.roundIndex)
    windows.push({ roundIndex: b.roundIndex, startMs: b.monotonicTimeMs, endMs: next ? next.monotonicTimeMs : Number.POSITIVE_INFINITY })
  }
  return windows
}

function roundAt(windows, monotonicMs) {
  if (monotonicMs === undefined || monotonicMs === null) return null
  const w = windows.find((x) => monotonicMs >= x.startMs && monotonicMs < x.endMs)
  return w ? w.roundIndex : null
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

function tally(items, key) {
  const out = {}
  for (const item of items) {
    const k = item[key] ?? 'unknown'
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}

export function analyze(text, constants = null) {
  const plays = parsePlays(text)
  const observed = parseVoiceObserved(text)
  const instrument = parseInstrumentObserved(text)
  const clickDispatches = parseClickDispatches(text)
  const announceDispatches = parseAnnounceDispatches(text)
  const tokenDue = parseTokenDue(text)
  const boundaries = parseBoundaries(text)
  const build = parseBuild(text)
  const statsRecord = recordsWithTag(text, 'puncheokie.observer.stats').at(-1)
  const observer = statsRecord
    ? { watched: numField(statsRecord.body, 'watched') ?? null, openAtRelease: numField(statsRecord.body, 'openAtRelease') ?? null, maxHandlerMs: numField(statsRecord.body, 'maxHandlerMs') ?? null }
    : null

  const hard = []
  const soft = []
  const notes = []

  // -- coverage ------------------------------------------------------------
  const obsById = new Map(observed.filter((o) => o.playId).map((o) => [o.playId, o]))
  const playsWithId = plays.filter((p) => p.playId)
  const unobserved = playsWithId.filter((p) => !obsById.has(p.playId))
  const coverage = playsWithId.length === 0 ? null : (playsWithId.length - unobserved.length) / playsWithId.length
  const present = observed.length + instrument.length > 0
  if (!present) soft.push('no observer records in this capture (QA flag off when the output was constructed?)')
  if (coverage !== null && coverage < COVERAGE_HARD) {
    hard.push(`coverage ${Math.round(coverage * 1000) / 10}% < ${COVERAGE_HARD * 100}% (${unobserved.length} of ${playsWithId.length} plays never observed)`)
  }

  // -- work axis -----------------------------------------------------------
  const fit = fitWorkAxis(tokenDue, boundaries)
  const windows = roundWindows(boundaries)
  for (const round of fit.values()) {
    if (round.disagreementMs === null) continue
    if (round.disagreementMs > FIT_DISAGREEMENT_HARD_MS) hard.push(`round ${round.roundIndex}: tokenDue fit disagrees with its work-entered boundary by ${round.disagreementMs} ms`)
    else if (round.disagreementMs > FIT_DISAGREEMENT_SOFT_MS) soft.push(`round ${round.roundIndex}: tokenDue fit vs boundary ${round.disagreementMs} ms`)
  }
  const toMonotonic = (roundIndex, workMs) => {
    const round = fit.get(roundIndex)
    return round && round.offsetMs !== null && workMs !== undefined ? round.offsetMs + workMs : null
  }

  // -- families ------------------------------------------------------------
  const joined = playsWithId.map((p) => ({ play: p, obs: obsById.get(p.playId) ?? null }))
  const families = {}
  for (const kind of new Set(joined.map((j) => j.play.kind ?? 'unknown'))) {
    const rows = joined.filter((j) => (j.play.kind ?? 'unknown') === kind)
    const ok = rows.filter((j) => j.obs?.outcome === 'ok')
    const paths = [...new Set(rows.map((j) => j.play.path).filter((p) => p !== undefined))]
    families[kind] = {
      plays: rows.length,
      observed: rows.filter((j) => j.obs !== null).length,
      outcomes: tally(rows.map((j) => j.obs ?? { outcome: 'unobserved' }), 'outcome'),
      onset: latencyStats(ok.map((j) => j.obs.onsetLatencyMs)),
      byPath: Object.fromEntries(paths.map((path) => [path, latencyStats(ok.filter((j) => j.play.path === path).map((j) => j.obs.onsetLatencyMs))])),
      truncated: ok.filter((j) => typeof j.obs.observedDurationMs === 'number' && typeof j.obs.expectedDurationMs === 'number' && j.obs.observedDurationMs < j.obs.expectedDurationMs - TRUNCATION_MS).map((j) => ({ playId: j.play.playId, label: j.play.label, expectedMs: j.obs.expectedDurationMs, observedMs: j.obs.observedDurationMs })),
    }
    if (families[kind].truncated.length > 0) hard.push(`${kind}: ${families[kind].truncated.length} play(s) cut short by more than ${TRUNCATION_MS} ms`)
    const timeouts = (families[kind].outcomes.timeout ?? 0) + (families[kind].outcomes.stalled ?? 0)
    if (timeouts > 0) soft.push(`${kind}: ${timeouts} timeout/stalled observation(s)`)
  }

  // -- breath per call slot, lead-ins against endBy ---------------------------
  const playByTrace = new Map(plays.filter((p) => p.traceId).map((p) => [p.traceId, p]))
  const calls = []
  const leadIns = []
  for (const d of clickDispatches) {
    const play = d.traceId ? playByTrace.get(d.traceId) : undefined
    const obs = play?.playId ? obsById.get(play.playId) : undefined
    const roundIndex = roundAt(windows, d.monotonicTimeMs)
    if (!obs || obs.outcome !== 'ok' || typeof obs.endMs !== 'number' || roundIndex === null) continue
    const endByMono = toMonotonic(roundIndex, d.endByMs)
    if (d.kind === 'call') {
      const firstNodeMono = toMonotonic(roundIndex, d.firstNodeMs)
      if (firstNodeMono === null) continue
      calls.push({
        slot: d.slot,
        roundIndex,
        vocabulary: play.vocabulary ?? null,
        path: play.path ?? null,
        plannedBreathMs: typeof d.firstNodeMs === 'number' && typeof d.endByMs === 'number' ? d.firstNodeMs - d.endByMs : null,
        breathMs: r1(firstNodeMono - obs.endMs),
        endLateMs: endByMono === null ? null : r1(obs.endMs - endByMono),
        onsetLatencyMs: obs.onsetLatencyMs ?? null,
        lateMs: d.lateMs ?? null,
      })
    } else if (d.kind === 'lead-in') {
      leadIns.push({
        slot: d.slot,
        roundIndex,
        vocabulary: play.vocabulary ?? null,
        path: play.path ?? null,
        endMinusEndByMs: endByMono === null ? null : r1(obs.endMs - endByMono),
        onsetLatencyMs: obs.onsetLatencyMs ?? null,
        lateMs: d.lateMs ?? null,
      })
    }
  }
  const bySlot = {}
  for (const c of calls) {
    const s = (bySlot[c.slot] ??= { n: 0, breath: [], endLate: [], plannedBreathMs: c.plannedBreathMs, vocabulary: c.vocabulary })
    s.n += 1
    s.breath.push(c.breathMs)
    if (c.endLateMs !== null) s.endLate.push(c.endLateMs)
  }
  const breathBySlot = Object.fromEntries(
    Object.entries(bySlot).map(([slot, s]) => [slot, { n: s.n, vocabulary: s.vocabulary, plannedBreathMs: s.plannedBreathMs, medianBreathMs: r1(median(s.breath)), medianEndLateMs: s.endLate.length > 0 ? r1(median(s.endLate)) : null, p95BreathMs: r1(percentile(s.breath, 95)) }]),
  )
  const breathByVocab = {}
  for (const vocab of new Set(calls.map((c) => c.vocabulary ?? 'unknown'))) {
    const rows = calls.filter((c) => (c.vocabulary ?? 'unknown') === vocab)
    breathByVocab[vocab] = { n: rows.length, medianBreathMs: r1(median(rows.map((c) => c.breathMs))), medianEndLateMs: r1(median(rows.map((c) => c.endLateMs).filter((v) => v !== null))) }
  }
  const leadInSummary = {
    n: leadIns.length,
    medianEndMinusEndByMs: r1(median(leadIns.map((l) => l.endMinusEndByMs).filter((v) => v !== null))),
    p95EndMinusEndByMs: r1(percentile(leadIns.map((l) => l.endMinusEndByMs).filter((v) => v !== null), 95)),
    walkedOver: leadIns.filter((l) => l.endMinusEndByMs !== null && l.endMinusEndByMs > 0).length,
    byVocab: Object.fromEntries([...new Set(leadIns.map((l) => l.vocabulary ?? 'unknown'))].map((v) => [v, r1(median(leadIns.filter((l) => (l.vocabulary ?? 'unknown') === v).map((l) => l.endMinusEndByMs).filter((x) => x !== null)))])),
  }
  if (leadInSummary.walkedOver > 0) soft.push(`${leadInSummary.walkedOver} lead-in(s) ended past endBy (median ${leadInSummary.medianEndMinusEndByMs} ms)`)

  // -- combo announces → first ring ----------------------------------------
  const announces = []
  for (const d of announceDispatches) {
    const play = d.traceId ? playByTrace.get(d.traceId) : undefined
    const obs = play?.playId ? obsById.get(play.playId) : undefined
    if (!obs || obs.outcome !== 'ok' || typeof obs.endMs !== 'number') continue
    const cueId = (d.slotId ?? '').split(':')[0]
    const firstRing = tokenDue
      .filter((t) => t.cueId === cueId && t.tokenIndex === 0 && t.monotonicTimeMs !== undefined && t.monotonicTimeMs >= (obs.onsetMs ?? obs.dispatchMs ?? 0))
      .sort((a, b) => a.monotonicTimeMs - b.monotonicTimeMs)[0]
    announces.push({ slotId: d.slotId, cueId, onsetLatencyMs: obs.onsetLatencyMs ?? null, endToRingMs: firstRing ? r1(firstRing.monotonicTimeMs - obs.endMs) : null })
  }
  const endToRing = announces.map((a) => a.endToRingMs).filter((v) => v !== null)
  const announceSummary = {
    n: announces.length,
    withRing: endToRing.length,
    medianEndToRingMs: r1(median(endToRing)),
    spreadMs: endToRing.length > 1 ? r1(percentile(endToRing, 95) - percentile(endToRing, 5)) : null,
    tightWithin60ms: endToRing.length === 0 ? null : endToRing.filter((v) => Math.abs(v - median(endToRing)) <= RAIL_TIGHT_MS).length / endToRing.length,
    cutByRing: endToRing.filter((v) => v < 0).length,
  }
  if (announceSummary.cutByRing > 0) soft.push(`${announceSummary.cutByRing} combo announce(s) still speaking at the first ring`)

  // -- ceremonies ----------------------------------------------------------
  const bells = joined.filter((j) => j.play.kind === 'instruction' && /bell/i.test(j.play.label ?? j.play.asset ?? '') && j.obs?.onsetMs !== undefined && j.obs.outcome === 'ok').map((j) => j.obs)
  const warns = observed.filter((o) => o.kind === 'round-warning')
  const recoveries = observed.filter((o) => o.kind === 'recovery')
  const intros = observed.filter((o) => o.kind === 'intro')
  const metronomes = observed.filter((o) => o.kind === 'metronome')
  const rounds = []
  for (const b of boundaries.filter((x) => x.transition === 'work-entered' && x.monotonicTimeMs !== undefined)) {
    const bell = bells.filter((o) => o.onsetMs - b.monotonicTimeMs >= BELL_WINDOW_MS[0] && o.onsetMs - b.monotonicTimeMs <= BELL_WINDOW_MS[1]).sort((x, y) => Math.abs(x.onsetMs - b.monotonicTimeMs) - Math.abs(y.onsetMs - b.monotonicTimeMs))[0]
    const bellAt = bell?.onsetMs ?? b.monotonicTimeMs
    const warn = warns.filter((o) => typeof o.endMs === 'number' && o.endMs <= bellAt + 2_000 && bellAt - o.endMs < 30_000).sort((x, y) => y.endMs - x.endMs)[0]
    const recovery = warn ? recoveries.filter((o) => typeof o.endMs === 'number' && typeof warn.onsetMs === 'number' && o.endMs < warn.onsetMs + 5_000 && warn.onsetMs - o.endMs < 90_000).sort((x, y) => y.endMs - x.endMs)[0] : undefined
    const row = {
      roundIndex: b.roundIndex,
      bellOnsetLatencyMs: bell ? r1(bell.onsetMs - b.monotonicTimeMs) : null,
      warnEndToBellMs: warn && bell ? r1(bell.onsetMs - warn.endMs) : null,
      warnOutcome: warn?.outcome ?? null,
      warnLengthVsPlannedMs: warn && typeof warn.observedDurationMs === 'number' && typeof warn.expectedDurationMs === 'number' ? r1(warn.observedDurationMs - warn.expectedDurationMs) : null,
      recoveryEndToWarnOnsetMs: recovery && warn && typeof warn.onsetMs === 'number' ? r1(warn.onsetMs - recovery.endMs) : null,
      recoveryOutcome: recovery?.outcome ?? null,
    }
    if (row.warnEndToBellMs !== null && (row.warnEndToBellMs < WARN_END_TO_BELL_TARGET_MS[0] || row.warnEndToBellMs > WARN_END_TO_BELL_TARGET_MS[1])) {
      soft.push(`round ${b.roundIndex}: warn end → bell ${row.warnEndToBellMs} ms (target ${WARN_END_TO_BELL_TARGET_MS[0]}–${WARN_END_TO_BELL_TARGET_MS[1]}${row.warnEndToBellMs < 0 ? '; the bell cut the countdown' : ''})`)
    }
    if (row.recoveryEndToWarnOnsetMs !== null && row.recoveryEndToWarnOnsetMs <= 0) soft.push(`round ${b.roundIndex}: recovery still speaking at the warning (${row.recoveryEndToWarnOnsetMs} ms)`)
    rounds.push(row)
  }
  const ceremonies = {
    rounds,
    intro: intros.map((o) => ({ onsetLatencyMs: o.onsetLatencyMs ?? null, driftMs: typeof o.observedDurationMs === 'number' && typeof o.expectedDurationMs === 'number' ? r1(o.observedDurationMs - o.expectedDurationMs) : null, outcome: o.outcome })),
    metronome: { n: metronomes.length, onset: latencyStats(metronomes.map((o) => o.onsetLatencyMs)), outcomes: tally(metronomes, 'outcome') },
    bells: { n: bells.length, onset: latencyStats(bells.map((o) => o.onsetLatencyMs)) },
  }

  // -- rings against their own schedule --------------------------------------
  const ringLate = tokenDue.filter((t) => t.scheduledMs !== undefined && t.workElapsedMs !== undefined).map((t) => t.workElapsedMs - t.scheduledMs)
  const rings = { n: tokenDue.length, late: latencyStats(ringLate), maxLateMs: ringLate.length > 0 ? r1(Math.max(...ringLate)) : null }

  // -- ducks -----------------------------------------------------------------
  const silent = joined.filter((j) => j.obs?.silentByVolume)
  const silentByRound = {}
  for (const j of silent) {
    const roundIndex = roundAt(windows, j.obs.dispatchMs ?? j.play.dispatchMs) ?? 'outside'
    const s = (silentByRound[roundIndex] ??= { births: 0, silentMs: 0 })
    s.births += 1
    s.silentMs += j.obs.expectedDurationMs ?? j.play.durationMs ?? 0
  }
  const duck = { silentBirths: silent.length, byRound: silentByRound, labels: silent.slice(0, 12).map((j) => j.play.label) }
  if (silent.length > 0) soft.push(`${silent.length} play(s) born at volume 0 (duck) — see labels`)

  // -- instrument --------------------------------------------------------------
  const instrumentOk = instrument.filter((i) => i.outcome === 'ok')
  const instrumentSummary = {
    n: instrument.length,
    outcomes: tally(instrument, 'outcome'),
    latency: latencyStats(instrumentOk.map((i) => i.latencyMs)),
    pipeline: latencyStats(instrumentOk.map((i) => i.pipelineMs)),
    maskedRatio: instrument.length === 0 ? null : r1(instrument.filter((i) => i.outcome === 'masked').length / instrument.length),
    busyRatio: instrument.length === 0 ? null : r1(instrument.filter((i) => i.outcome === 'busy').length / instrument.length),
  }

  // -- proposals ---------------------------------------------------------------
  const proposals = buildProposals({ constants, families, breathBySlot, breathByVocab, leadInSummary, announceSummary, instrumentSummary, notes })
  if (constants?.rail && constants.rail.RAIL_K_MS !== constants.rail.RAIL_K_MS_spine) soft.push(`RAIL_K_MS differs between RhythmMap (${constants.rail.RAIL_K_MS}) and RhythmSpine (${constants.rail.RAIL_K_MS_spine})`)

  const exit = hard.length > 0 ? 1 : soft.length > 0 ? 2 : 0
  return {
    build,
    present,
    coverage: { playsWithId: playsWithId.length, observed: playsWithId.length - unobserved.length, ratio: coverage === null ? null : Math.round(coverage * 1000) / 1000, unobserved: unobserved.slice(0, 20).map((p) => ({ playId: p.playId, kind: p.kind, label: p.label })) },
    fit: [...fit.values()],
    families,
    breath: { calls: calls.length, bySlot: breathBySlot, byVocab: breathByVocab },
    leadIns: leadInSummary,
    announces: announceSummary,
    ceremonies,
    rings,
    duck,
    instrument: instrumentSummary,
    observer,
    proposals,
    notes,
    verdict: { exit, hard, soft },
  }
}

function buildProposals({ constants, families, breathBySlot, breathByVocab, leadInSummary, announceSummary, instrumentSummary, notes }) {
  const c = constants ?? {}
  const proposals = []
  const cal = c.calibration?.PLAYHEAD_TO_SPEAKER_MS ?? null
  const calNote = cal === null ? 'uncalibrated: PLAYHEAD_TO_SPEAKER_MS not measured yet (plan C4) — onset numbers are playhead onsets, the speaker follows by a per-route constant' : `calibrated: +${cal} ms playhead → speaker (${c.calibration.route ?? 'route?'})`
  notes.push(calNote)

  proposals.push({
    constant: 'RAIL_K_MS',
    current: c.rail?.RAIL_K_MS ?? null,
    status: 'inert',
    note: 'the runner passes wordMarksFor: () => undefined — the rail is not engaged at runtime until plan C6; the announce end→ring below is the measurable stand-in',
    measured: { announceEndToRingMedianMs: announceSummary.medianEndToRingMs, spreadMs: announceSummary.spreadMs, tightWithin60ms: announceSummary.tightWithin60ms },
  })

  // Lead-in pad: the observed end past the runner's endBy budget is the shortfall.
  const leadShift = leadInSummary.medianEndMinusEndByMs
  if (leadShift !== null && leadInSummary.n >= 3) {
    const current = c.leads?.LEAD_IN_PAD_MS ?? null
    proposals.push({
      constant: 'LEAD_IN_PAD_MS',
      current,
      proposed: current === null || leadShift <= 0 ? current : Math.round((current + leadShift) / 10) * 10,
      basis: `median observed lead-in end − endBy = ${leadShift} ms over ${leadInSummary.n} lead-ins (p95 ${leadInSummary.p95EndMinusEndByMs})`,
      apply: leadShift > 0,
    })
    const tech = leadInSummary.byVocab?.techniques
    if (tech !== null && tech !== undefined) {
      const cur = c.leads?.TECHNIQUE_LEADIN_LEAD_MS ?? null
      proposals.push({ constant: 'TECHNIQUE_LEADIN_LEAD_MS', current: cur, proposed: cur === null || tech <= 0 ? cur : Math.round((cur + tech) / 10) * 10, basis: `techniques lead-ins end − endBy median ${tech} ms`, apply: tech > 0 })
    }
  }

  // Breath: the call ended late by d → dispatch it d earlier by growing breathMs.
  for (const [slot, s] of Object.entries(breathBySlot)) {
    if (s.n < 3 || s.medianEndLateMs === null || s.plannedBreathMs === null) continue
    if (Math.abs(s.medianEndLateMs) < BREATH_PROPOSAL_MIN_MS) continue
    const override = c.breath?.CALL_BREATH_OVERRIDES?.[slot] ?? null
    proposals.push({
      constant: `CALL_BREATH_OVERRIDES['${slot}']`,
      current: override ?? `derived ${s.plannedBreathMs}`,
      proposed: Math.round(s.plannedBreathMs + s.medianEndLateMs),
      basis: `observed call end − planned end median ${s.medianEndLateMs} ms over ${s.n} bars (measured breath ${s.medianBreathMs} vs planned ${s.plannedBreathMs})`,
      apply: true,
    })
  }
  for (const [vocab, v] of Object.entries(breathByVocab)) {
    if (v.n < 10 || v.medianEndLateMs === null || Math.abs(v.medianEndLateMs) < BREATH_PROPOSAL_MIN_MS) continue
    const dense = c.breath?.DENSE_BREATH_MS?.[vocab] ?? null
    proposals.push({ constant: `DENSE_BREATH_MS.${vocab}`, current: dense, proposed: dense === null ? null : Math.round(dense + v.medianEndLateMs), basis: `${vocab} calls end late by median ${v.medianEndLateMs} ms over ${v.n} bars`, apply: dense !== null })
  }
  const minBreath = c.breath?.MIN_BREATH_MS ?? null
  const allLate = Object.values(breathByVocab).map((v) => v.medianEndLateMs).filter((x) => x !== null)
  if (minBreath !== null && allLate.length > 0 && Math.max(...allLate) >= BREATH_PROPOSAL_MIN_MS) {
    proposals.push({ constant: 'MIN_BREATH_MS', current: minBreath, proposed: Math.round(minBreath + Math.max(...allLate)), basis: 'the floor must absorb the largest measured late end', apply: true })
  }

  // Audio output latency: the armed-path onset median is the playhead's own lag.
  const click = families['click-script']
  const armed = click?.byPath?.armed ?? click?.onset ?? null
  if (armed && armed.n >= 10 && armed.medianMs !== null) {
    const current = c.audio?.DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS ?? null
    proposals.push({
      constant: 'DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS',
      current,
      proposed: Math.round(armed.medianMs + (cal ?? 0)),
      basis: `armed click-script onset median ${armed.medianMs} ms (p95 ${armed.p95Ms}, jitter ${armed.jitterMs}) over ${armed.n}${cal === null ? ' — uncalibrated, playhead only' : ` + ${cal} ms calibration`}`,
      apply: cal !== null,
    })
  }
  const fresh = click?.byPath?.fresh ?? null
  if (fresh && fresh.n >= 10) {
    const current = c.audio?.ONE_SHOT_RELEASE_PAD_MS ?? null
    proposals.push({ constant: 'ONE_SHOT_RELEASE_PAD_MS', current, proposed: Math.round((fresh.p95Ms + 200) / 50) * 50, basis: `fresh-path onset p95 ${fresh.p95Ms} ms over ${fresh.n} + 200 ms margin`, apply: current !== null })
  }
  if (armed && armed.n >= 10) {
    const current = c.audio?.CLICK_SCRIPT_PREARM_PAD_MS ?? null
    proposals.push({ constant: 'CLICK_SCRIPT_PREARM_PAD_MS', current, proposed: Math.round((armed.p95Ms + 50) / 10) * 10, basis: `armed onset p95 ${armed.p95Ms} ms + 50 ms`, apply: current !== null })
  }
  if (instrumentSummary.n > 0) {
    proposals.push({ constant: 'instrument (no constant)', current: null, proposed: null, basis: `trigger → first frame median ${instrumentSummary.latency.medianMs} ms, jitter ${instrumentSummary.latency.jitterMs} ms — jitter is the gate; masked ${instrumentSummary.maskedRatio}, busy ${instrumentSummary.busyRatio}`, apply: false })
  }
  return proposals
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export function renderReport(report, sessionDir = '') {
  const L = []
  const b = report.build
  L.push(`# Observed timing — ${sessionDir || 'capture'}`)
  L.push('')
  L.push(`build: ${b.dev === null ? 'unknown' : b.dev ? 'DEV (Metro fetches contaminate onset latency)' : 'release'} · sha ${b.gitSha ?? '?'} · workout ${b.workout ?? '?'} (${b.vocab ?? '?'})`)
  L.push(`verdict: exit ${report.verdict.exit}${report.verdict.hard.length ? ` · HARD: ${report.verdict.hard.join('; ')}` : ''}${report.verdict.soft.length ? ` · soft: ${report.verdict.soft.join('; ')}` : ''}`)
  L.push(`coverage: ${report.coverage.ratio === null ? 'n/a' : `${Math.round(report.coverage.ratio * 1000) / 10}%`} (${report.coverage.observed}/${report.coverage.playsWithId})${report.observer ? ` · observer maxHandlerMs ${report.observer.maxHandlerMs}` : ''}`)
  L.push('')
  L.push('## Onset latency by family')
  L.push('| family | plays | observed | ok | median | p95 | jitter | by path | truncated |')
  L.push('|---|---|---|---|---|---|---|---|---|')
  for (const [k, f] of Object.entries(report.families)) {
    const paths = Object.entries(f.byPath).map(([p, s]) => `${p} ${s.medianMs ?? '—'}/${s.p95Ms ?? '—'} (n${s.n})`).join(', ')
    L.push(`| ${k} | ${f.plays} | ${f.observed} | ${f.outcomes.ok ?? 0} | ${f.onset.medianMs ?? '—'} | ${f.onset.p95Ms ?? '—'} | ${f.onset.jitterMs ?? '—'} | ${paths || '—'} | ${f.truncated.length} |`)
  }
  L.push('')
  L.push('## Work axis fit')
  for (const r of report.fit) L.push(`- round ${r.roundIndex}: offset ${r.offsetMs} ms from ${r.n} tokenDue (spread ${r.spreadMs}) · boundary ${r.boundaryOffsetMs} · disagreement ${r.disagreementMs ?? '—'} ms`)
  L.push('')
  L.push(`## Breath (${report.breath.calls} calls)`)
  L.push('| slot | n | vocab | planned | measured median | p95 | end late median |')
  L.push('|---|---|---|---|---|---|---|')
  for (const [slot, s] of Object.entries(report.breath.bySlot)) L.push(`| ${slot} | ${s.n} | ${s.vocabulary ?? '—'} | ${s.plannedBreathMs ?? '—'} | ${s.medianBreathMs} | ${s.p95BreathMs} | ${s.medianEndLateMs ?? '—'} |`)
  L.push('')
  L.push(`lead-ins: n ${report.leadIns.n} · end − endBy median ${report.leadIns.medianEndMinusEndByMs ?? '—'} ms (p95 ${report.leadIns.p95EndMinusEndByMs ?? '—'}) · walked over ${report.leadIns.walkedOver}`)
  L.push(`combo announces: n ${report.announces.n} · end → first ring median ${report.announces.medianEndToRingMs ?? '—'} ms · spread ${report.announces.spreadMs ?? '—'} · tight(60) ${report.announces.tightWithin60ms ?? '—'} · cut by ring ${report.announces.cutByRing}`)
  L.push(`rings: n ${report.rings.n} · fire − schedule median ${report.rings.late.medianMs ?? '—'} p95 ${report.rings.late.p95Ms ?? '—'} max ${report.rings.maxLateMs ?? '—'}`)
  L.push('')
  L.push('## Ceremonies')
  L.push('| round | bell onset | warn end → bell | warn len − planned | recovery end → warn | outcomes |')
  L.push('|---|---|---|---|---|---|')
  for (const r of report.ceremonies.rounds) L.push(`| ${r.roundIndex} | ${r.bellOnsetLatencyMs ?? '—'} | ${r.warnEndToBellMs ?? '—'} | ${r.warnLengthVsPlannedMs ?? '—'} | ${r.recoveryEndToWarnOnsetMs ?? '—'} | warn ${r.warnOutcome ?? '—'} / recovery ${r.recoveryOutcome ?? '—'} |`)
  if (report.ceremonies.intro.length) L.push(`intro: ${report.ceremonies.intro.map((i) => `onset ${i.onsetLatencyMs ?? '—'} drift ${i.driftMs ?? '—'} (${i.outcome})`).join('; ')}`)
  L.push(`metronome: n ${report.ceremonies.metronome.n} onset median ${report.ceremonies.metronome.onset.medianMs ?? '—'} · bells: n ${report.ceremonies.bells.n} onset median ${report.ceremonies.bells.onset.medianMs ?? '—'}`)
  L.push(`ducks: ${report.duck.silentBirths} silent birth(s)${report.duck.silentBirths ? ` — ${report.duck.labels.join(', ')}` : ''}`)
  const i = report.instrument
  L.push(`instrument: n ${i.n} · latency median ${i.latency.medianMs ?? '—'} p95 ${i.latency.p95Ms ?? '—'} jitter ${i.latency.jitterMs ?? '—'} · pipeline median ${i.pipeline.medianMs ?? '—'} · masked ${i.maskedRatio ?? '—'} busy ${i.busyRatio ?? '—'}`)
  L.push('')
  L.push('## Proposals (for the ear, never applied here)')
  L.push('| constant | current | proposed | apply? | basis |')
  L.push('|---|---|---|---|---|')
  for (const p of report.proposals) L.push(`| ${p.constant} | ${p.current ?? '—'} | ${p.proposed ?? '—'} | ${p.status ?? (p.apply ? 'yes' : 'no')} | ${p.basis ?? p.note ?? ''} |`)
  if (report.notes.length) {
    L.push('')
    for (const n of report.notes) L.push(`- ${n}`)
  }
  return L.join('\n') + '\n'
}

function main() {
  const argv = process.argv.slice(2)
  const sessionArg = argv.find((a) => a.startsWith('--session='))?.slice('--session='.length) ?? (argv.includes('--session') ? argv[argv.indexOf('--session') + 1] : undefined)
  if (!sessionArg || !existsSync(sessionArg)) {
    console.error('Usage: node tools/analysis/observed-timing.mjs --session <dir> [--constants <timing-constants.json>]')
    process.exit(3)
  }
  const logPath = [join(sessionArg, 'logcat.txt'), join(sessionArg, 'log.txt')].find((p) => existsSync(p))
  if (!logPath) {
    console.error(`no logcat.txt (or log.txt) in ${sessionArg}`)
    process.exit(3)
  }
  const constantsArg = argv.find((a) => a.startsWith('--constants='))?.slice('--constants='.length)
  const constants = constantsArg ? JSON.parse(readFileSync(constantsArg, 'utf8')) : loadTimingConstants()
  const report = analyze(readFileSync(logPath, 'utf8'), constants)
  report.constants = constants
  const md = renderReport(report, sessionArg)
  writeFileSync(join(sessionArg, 'observed-timing-report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  writeFileSync(join(sessionArg, 'observed-timing-report.md'), md, 'utf8')
  console.log(md)
  console.log(`Wrote ${join(sessionArg, 'observed-timing-report.json')}`)
  process.exit(report.verdict.exit)
}

const invokedDirectly = process.argv[1]?.endsWith('observed-timing.mjs')
if (invokedDirectly) main()
