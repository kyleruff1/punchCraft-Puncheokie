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
/**
 * When every slot's late end sits inside this band, ONE constant explains
 * them all and the per-slot overrides are noise dressed as findings.
 *
 * Measured on the tablet (release, body-work round 1): four slots of
 * different lengths each ended 198–205 ms late over 46 bars. Proposing four
 * `CALL_BREATH_OVERRIDES` entries there would hard-code a global latency into
 * per-slot exceptions and hide the single cause.
 */
export const GLOBAL_SHIFT_BAND_MS = 50
const BELL_WINDOW_MS = [-500, 3000]

const r1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v * 10) / 10)

/**
 * Below this many samples, `percentile(v, 95)` returns the MAXIMUM — its index
 * is `ceil(0.95 * n) - 1`, which is the last element for every n ≤ 19. Calling
 * that "p95" in a proposal's basis line dresses a single worst sample as a
 * distribution, and both quick-workout reports did exactly that from n = 11.
 */
export const TAIL_MIN_SAMPLES = 20

/**
 * How much LATER the audio actually starts than the observer's `onsetMs` says.
 *
 * The observer stamps onset when `playbackStatusUpdate` reports
 * `playing: true`. Two full release sessions carried `positionAtOnsetMs: 0`
 * in 296 of 296 observations — media3 asserts "playing" with the playhead
 * still at zero, on a buffer floored at 250 ms. So that event fires before
 * any audio has left the device, and every onset this analyzer reported was
 * optimistic by roughly this much.
 *
 * Measured directly (src/app/dev/voice-latency.tsx "Calibrate ruler", release
 * build 73f7ea6f, TB125FU, armed path, one play timed two ways at once):
 *
 *   call cc-e08318c0 (48 kHz)  status 25.2  playhead 118.8  skew  95.4  (65.5-158.5, n=40)
 *   bell             (24 kHz)  status 19.2  playhead 119.1  skew 101.4  (76.6-136,   n=40)
 *
 * One number for both: they agree within their own spread, and the spread
 * (~93 ms on the call) dwarfs the 6 ms between them.
 *
 * This is a FLOOR, twice over. The playhead moving is itself earlier than
 * sound reaching the speaker, and `currentTime` is a blocking `runOnMain`
 * read resolved to one JS loop turn, so it reads late and compresses the gap.
 * Converting "playhead moving" into "sound at the speaker" needs a
 * microphone — that measurement is `PLAYHEAD_TO_SPEAKER_MS` and is still open.
 */
export const OBSERVER_ONSET_SKEW_MS = 95

/**
 * The skew was measured on `createAudioPlayer`. The ceremony players are
 * `createAudioPlaylist` — a different native object whose startup was never
 * calibrated — so the correction is NOT applied to them and their numbers
 * stay raw rather than being silently adjusted by a constant borrowed from a
 * different code path.
 */
const SKEW_CORRECTED_KINDS = new Set(['click-script', 'clip', 'instruction', 'combo-announce'])

/**
 * How far the end-event residual may sit from zero before this tool says the
 * skew constant has gone stale. The observed spread by path is roughly
 * +29 / −1 / −28, so 45 admits every path we have measured while still
 * catching a media3 or expo-audio change that moves the startup cost.
 */
export const SKEW_CROSS_CHECK_TOLERANCE_MS = 45

/** Below this, one slow teardown moves the median. Do not warn on noise. */
export const SKEW_CROSS_CHECK_MIN_SAMPLES = 10

/**
 * How long after a lead-in's audible end its section's first call may sound
 * and still be counted as that lead-in's pair. Past this the next sound is
 * the following section, and pairing across it would report a gap of tens of
 * seconds as though it were a placement finding.
 */
export const LEAD_IN_TO_CALL_WINDOW_MS = 6_000

/**
 * The share of bars allowed under `MIN_BREATH_MS` before the capture warns.
 *
 * Not zero, and deliberately so. The floor is a comfort target for the wide
 * slow bars where the clamp pins the breath; the tighter workouts run 8-15%
 * under it today and that is the known state this gate exists to watch shrink.
 * A ratio, not a count, so a 47-bar body-work drive and a 185-bar speed burst
 * are held to the same standard.
 *
 * `barsAtOrPastPunch` is the correctness gate and has no tolerance at all.
 */
export const FLOOR_BREACH_SOFT_RATIO = 0.02

/** How many of the tightest bars to name. Enough to see a pattern, not a dump. */
export const WORST_BARS_LISTED = 5

/**
 * The mirror of `TAIL_MIN_SAMPLES` at the other end, and NOT the same number.
 *
 * `percentile` indexes at `ceil(p/100 * n) - 1`. For p = 5 that clamps to 0 —
 * the MINIMUM — whenever `ceil(0.05n) <= 1`, i.e. for every n ≤ 20. So a
 * "p5" needs one more sample than a p95 does before it stops being the
 * extreme it is supposed to summarise.
 *
 * This matters more here than the p95 bug did. The low tail is where
 * never-late lives: a p5 that is silently the minimum makes a single tight
 * bar look like a population, and a p5 that is silently the minimum ALSO
 * makes a population look like a single bar. Both readings are wrong in the
 * direction that gets a floor breach waved through.
 */
export const LOW_TAIL_MIN_SAMPLES = 21

/** `p95` when there are enough samples to mean it, `max (n=…)` when there are not. */
function tailLabel(stats) {
  return stats.n >= TAIL_MIN_SAMPLES ? 'p95' : `max (n=${stats.n}, too few for a p95)`
}

/** `p5` when there are enough samples to mean it, `min (n=…)` when there are not. */
function lowTailLabel(n) {
  return n >= LOW_TAIL_MIN_SAMPLES ? 'p5' : `min (n=${n}, too few for a p5)`
}

/**
 * Whether a tail-derived proposal has the evidence to be acted on. Note what
 * this is NOT: `current !== null`, which is what it used to be — that says
 * only "the constant exists", so every such proposal shipped `apply: yes`
 * however thin the sample.
 */
function enoughForTail(stats) {
  return stats.n >= TAIL_MIN_SAMPLES
}

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
    breathMs: numField(body, 'breathMs'),
    lagMs: numField(body, 'lagMs'),
    monotonicTimeMs: numField(body, 'monotonicTimeMs'),
  }))
}

/**
 * When the sound actually STOPPED, as opposed to when the observer heard
 * about it.
 *
 * Built from the clip's own length rather than the end event, because the end
 * event carries a teardown lag of its own and every rendered wav matches its
 * manifest `durationMs` to within 0.5 ms. Measured against the RAW onset that
 * lag looked enormous — ~113 ms at the median, 124/94/67 by player path.
 * Against the corrected onset it collapses to roughly +29 / −1 / −28, which
 * is how we learned the onset was the liar; see `skewCrossCheck`.
 *
 * The onset it is measured from is NOT the raw event. `playing: true` fires
 * with the playhead still at zero (296 of 296 observations), so it is
 * corrected by the measured status-event skew first — see
 * `OBSERVER_ONSET_SKEW_MS` and `trueOnsetMs`. An earlier version of this
 * comment claimed the onset was trustworthy "because the audio starts when
 * the player says it starts". That was the assumption the ruler disproved.
 */
export function audibleEndMs(obs, play) {
  if (obs?.onsetMs == null) return null
  const stated = obs.expectedDurationMs ?? play?.durationMs ?? null
  if (stated === null) return obs.endMs ?? null
  return trueOnsetMs(obs) + stated
}

/**
 * The observer's `onsetMs` moved forward by the measured status-event skew,
 * for the play kinds the skew was measured on. Everything downstream — the
 * audible end, delivered breath, the lead-in budget — is built on this rather
 * than on the raw event.
 */
export function trueOnsetMs(obs) {
  if (obs?.onsetMs == null) return null
  return obs.onsetMs + (SKEW_CORRECTED_KINDS.has(obs.kind) ? OBSERVER_ONSET_SKEW_MS : 0)
}

/** `onsetLatencyMs` corrected the same way; null when the raw value is absent. */
export function trueOnsetLatencyMs(obs) {
  if (obs?.onsetLatencyMs == null) return null
  return obs.onsetLatencyMs + (SKEW_CORRECTED_KINDS.has(obs.kind) ? OBSERVER_ONSET_SKEW_MS : 0)
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
      /** The boundary's own `workElapsedMs`; 0 means it is the record that OPENS the round. */
      boundaryWorkElapsedMs: boundary ? (boundary.workElapsedMs ?? null) : null,
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
    // A round's OWN opening boundary carries `workElapsedMs: 0` — the session
    // clock has not advanced yet — so the whole disagreement there is the gap
    // between the transition firing and the log record being written, not two
    // clocks disagreeing. Warning on it made every capture report a ~78 ms
    // "clock disagreement" that was the log site's own latency.
    const opensTheRound = round.boundaryWorkElapsedMs === 0
    if (round.disagreementMs > FIT_DISAGREEMENT_HARD_MS) hard.push(`round ${round.roundIndex}: tokenDue fit disagrees with its work-entered boundary by ${round.disagreementMs} ms`)
    else if (!opensTheRound && round.disagreementMs > FIT_DISAGREEMENT_SOFT_MS) soft.push(`round ${round.roundIndex}: tokenDue fit vs boundary ${round.disagreementMs} ms`)
    else if (opensTheRound && round.disagreementMs > FIT_DISAGREEMENT_SOFT_MS) notes.push(`round ${round.roundIndex}: the work-entered boundary trails the tokenDue fit by ${round.disagreementMs} ms — that is the boundary log site's latency (its workElapsedMs is 0 by construction), not a clock disagreement`)
  }
  const toMonotonic = (roundIndex, workMs) => {
    const round = fit.get(roundIndex)
    return round && round.offsetMs !== null && workMs !== undefined ? round.offsetMs + workMs : null
  }

  // -- families ------------------------------------------------------------
  // `playInstruction`'s record opens with `asset:` and carries no `kind` —
  // the kind lives on the observation's WatchMeta. Reading only the play's
  // put every bell in a family called "unknown" and left `ceremonies.bells`
  // empty on a capture that had two of them.
  const joined = playsWithId.map((p) => {
    const obs = obsById.get(p.playId) ?? null
    return { play: { ...p, kind: p.kind ?? obs?.kind }, obs }
  })
  const families = {}
  for (const kind of new Set(joined.map((j) => j.play.kind ?? 'unknown'))) {
    const rows = joined.filter((j) => (j.play.kind ?? 'unknown') === kind)
    const ok = rows.filter((j) => j.obs?.outcome === 'ok')
    const paths = [...new Set(rows.map((j) => j.play.path).filter((p) => p !== undefined))]
    families[kind] = {
      plays: rows.length,
      observed: rows.filter((j) => j.obs !== null).length,
      outcomes: tally(rows.map((j) => j.obs ?? { outcome: 'unobserved' }), 'outcome'),
      onset: latencyStats(ok.map((j) => trueOnsetLatencyMs(j.obs))),
      onsetRawStatusEvent: latencyStats(ok.map((j) => j.obs.onsetLatencyMs)),
      byPath: Object.fromEntries(paths.map((path) => [path, latencyStats(ok.filter((j) => j.play.path === path).map((j) => trueOnsetLatencyMs(j.obs)))])),
      truncated: ok.filter((j) => typeof j.obs.observedDurationMs === 'number' && typeof j.obs.expectedDurationMs === 'number' && j.obs.observedDurationMs < j.obs.expectedDurationMs - TRUNCATION_MS).map((j) => ({ playId: j.play.playId, label: j.play.label, expectedMs: j.obs.expectedDurationMs, observedMs: j.obs.observedDurationMs })),
    }
    if (families[kind].truncated.length > 0) hard.push(`${kind}: ${families[kind].truncated.length} play(s) cut short by more than ${TRUNCATION_MS} ms`)
    const timeouts = (families[kind].outcomes.timeout ?? 0) + (families[kind].outcomes.stalled ?? 0)
    if (timeouts > 0) soft.push(`${kind}: ${timeouts} timeout/stalled observation(s)`)
  }

  // -- breath per call slot, lead-ins against endBy ---------------------------
  // A traceId is `<slot>#<dispatchAtMs>` on the ROUND's work axis, which
  // resets every round — so the same id recurs in round 2 and a Map keyed on
  // it is last-write-wins. That silently scored round 1's onset against round
  // 0's firstNodeMs on 8 of Six Count's 20 `call/1-2-3-4` bars and dragged
  // that slot's published median from 308.7 to 299.2 ms. Consume matches in
  // log order instead, so each dispatch takes the next unclaimed play.
  const playQueueByTrace = new Map()
  for (const p of plays) {
    if (!p.traceId) continue
    const queue = playQueueByTrace.get(p.traceId)
    if (queue === undefined) playQueueByTrace.set(p.traceId, [p])
    else queue.push(p)
  }
  const takePlay = (traceId) => {
    const queue = playQueueByTrace.get(traceId)
    return queue === undefined || queue.length === 0 ? undefined : queue.shift()
  }
  const calls = []
  const leadIns = []
  for (const d of clickDispatches) {
    const play = d.traceId ? takePlay(d.traceId) : undefined
    const obs = play?.playId ? obsById.get(play.playId) : undefined
    const roundIndex = roundAt(windows, d.monotonicTimeMs)
    if (!obs || obs.outcome !== 'ok' || typeof obs.endMs !== 'number' || roundIndex === null) continue
    const audibleEnd = audibleEndMs(obs, play)
    if (audibleEnd === null) continue
    const endLagMs = r1(obs.endMs - audibleEnd)
    // The same lag measured against the UNCORRECTED onset. The pair is the
    // skew cross-check: `rawEndLagMs - endLagMs` is the correction by
    // construction, but the two are computed from opposite ends of the clip,
    // and only one of them can be near zero. See `skewCrossCheck`.
    const rawEndLagMs = r1(endLagMs + (SKEW_CORRECTED_KINDS.has(obs.kind) ? OBSERVER_ONSET_SKEW_MS : 0))
    const endByMono = toMonotonic(roundIndex, d.endByMs)
    if (d.kind === 'call') {
      const firstNodeMono = toMonotonic(roundIndex, d.firstNodeMs)
      if (firstNodeMono === null) continue
      // The INTENDED breath is logged (`breathMs`) — never re-derived from
      // the dispatch time, which carries CALL_DISPATCH_LAG_MS compensation
      // and would read that much too generous. A capture from before that
      // field existed falls back to the old derivation, and a CALL's
      // `endByMs` is its give-up time, not a planned end.
      const derivedPlanned =
        typeof d.dispatchAtMs === 'number' && typeof d.durationMs === 'number' && typeof d.firstNodeMs === 'number'
          ? Math.round(d.firstNodeMs - (d.dispatchAtMs + d.durationMs))
          : null
      const intendedBreathMs = d.breathMs ?? derivedPlanned
      const deliveredBreathMs = r1(firstNodeMono - audibleEnd)
      calls.push({
        slot: d.slot,
        roundIndex,
        // A click-script play record names no vocabulary; the drive runs in
        // exactly one, which `qa.run` states — without this every breath row
        // read "unknown" and the proposal named a constant that has no such key.
        vocabulary: play.vocabulary ?? build.vocab ?? null,
        path: play.path ?? null,
        plannedBreathMs: intendedBreathMs,
        breathMs: deliveredBreathMs,
        // Positive = the call finished later than intended, eating breath.
        endLateMs: intendedBreathMs === null ? null : r1(intendedBreathMs - deliveredBreathMs),
        giveUpMarginMs: endByMono === null ? null : r1(endByMono - audibleEnd),
        onsetLatencyMs: trueOnsetLatencyMs(obs),
        onsetLatencyRawMs: obs.onsetLatencyMs ?? null,
        lateMs: d.lateMs ?? null,
        lagAppliedMs: d.lagMs ?? null,
        /** Paired with a lead-in's audible end for the skew-invariant gap. */
        audibleOnsetMs: trueOnsetMs(obs),
        endLagMs,
        rawEndLagMs,
      })
    } else if (d.kind === 'lead-in') {
      leadIns.push({
        slot: d.slot,
        roundIndex,
        vocabulary: play.vocabulary ?? build.vocab ?? null,
        path: play.path ?? null,
        endMinusEndByMs: endByMono === null ? null : r1(audibleEnd - endByMono),
        /** Kept so the skew-invariant gap to the next call can be measured. */
        audibleEndMs: audibleEnd,
        audibleOnsetMs: trueOnsetMs(obs),
        onsetLatencyMs: trueOnsetLatencyMs(obs),
        onsetLatencyRawMs: obs.onsetLatencyMs ?? null,
        lateMs: d.lateMs ?? null,
        endLagMs,
        rawEndLagMs,
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
    Object.entries(bySlot).map(([slot, s]) => [
      slot,
      {
        n: s.n,
        vocabulary: s.vocabulary,
        plannedBreathMs: s.plannedBreathMs,
        medianBreathMs: r1(median(s.breath)),
        medianEndLateMs: s.endLate.length > 0 ? r1(median(s.endLate)) : null,
        p95BreathMs: r1(percentile(s.breath, 95)),
        // The LOW tail. A median breath of 338 ms says nothing about whether
        // the coach ever landed on a punch; these two do, and they are the
        // only numbers in this block the never-late guarantee depends on.
        minBreathMs: s.breath.length > 0 ? r1(Math.min(...s.breath)) : null,
        p5BreathMs: r1(percentile(s.breath, 5)),
        lowTail: lowTailLabel(s.n),
      },
    ]),
  )
  // -- THE FLOOR — the never-late guarantee, asserted -------------------------
  //
  // Every per-bar call is placed to FINISH a tuned breath before that bar's
  // first punch. It may be early; it must never be late. Until now that was a
  // number in a report someone had to read. Two gates:
  //
  //   barsAtOrPastPunch — delivered breath ≤ 0. The call was still speaking
  //     when the athlete threw. HARD, always, at any count. There is no
  //     acceptable rate of this; one bar is the defect.
  //   barsUnderFloor — delivered breath below `MIN_BREATH_MS`. SOFT above
  //     `FLOOR_BREACH_SOFT_RATIO`, because the design floor is a comfort
  //     target, not a correctness one, and a handful of wide slow bars
  //     grazing it is the known state this plan is fixing.
  //
  // The floor comes from `callPlacement.ts` through `timing-constants.mjs`,
  // never from a literal here. A capture analysed with a stale floor would
  // report a breach rate against a number the app has not used for weeks;
  // when the constant cannot be read the block says so and gates nothing.
  const floorMs = constants?.breath?.MIN_BREATH_MS ?? null
  const atOrPast = calls.filter((c) => c.breathMs <= 0)
  const underFloor = floorMs === null ? [] : calls.filter((c) => c.breathMs < floorMs)
  const worstBars = [...calls]
    .sort((a, b) => a.breathMs - b.breathMs)
    .slice(0, WORST_BARS_LISTED)
    .map((c) => ({ slot: c.slot, roundIndex: c.roundIndex, vocabulary: c.vocabulary, deliveredBreathMs: c.breathMs, intendedBreathMs: c.plannedBreathMs, lateMs: c.lateMs, path: c.path }))
  const breathFloor = {
    floorMs,
    source: floorMs === null ? 'unavailable — callPlacement.ts not read; the floor gates nothing on this run' : 'callPlacement.ts MIN_BREATH_MS',
    n: calls.length,
    barsAtOrPastPunch: atOrPast.length,
    barsUnderFloor: underFloor.length,
    barsUnderFloorRatio: calls.length === 0 || floorMs === null ? null : Math.round((underFloor.length / calls.length) * 1000) / 1000,
    // WHERE the breaches are. A breach concentrated in one slot is a clip or
    // a cue problem; one spread evenly across every slot is the clamp, and
    // only the second is what the floor change addresses. Without this the
    // count alone cannot tell them apart.
    barsUnderFloorBySlot: Object.fromEntries(
      [...new Set(underFloor.map((c) => c.slot))].map((slot) => {
        const rows = underFloor.filter((c) => c.slot === slot)
        return [slot, { bars: rows.length, ofSlot: calls.filter((c) => c.slot === slot).length, minBreathMs: r1(Math.min(...rows.map((c) => c.breathMs))) }]
      }),
    ),
    minBreathMs: calls.length > 0 ? r1(Math.min(...calls.map((c) => c.breathMs))) : null,
    p5BreathMs: r1(percentile(calls.map((c) => c.breathMs), 5)),
    // The reference the tail is read against, over EVERY call in the capture
    // — not per slot and not per vocabulary. A min of 57 ms means one thing
    // against a median of 222 and another against a median of 90.
    medianBreathMs: r1(median(calls.map((c) => c.breathMs))),
    lowTail: lowTailLabel(calls.length),
    worstBars,
  }
  if (atOrPast.length > 0) {
    hard.push(`${atOrPast.length} bar(s) with the call still sounding at the punch (delivered breath ≤ 0) — never-late is broken: ${atOrPast.slice(0, 3).map((c) => `${c.slot} r${c.roundIndex} ${c.breathMs} ms`).join(', ')}`)
  }
  if (floorMs !== null && breathFloor.barsUnderFloorRatio !== null && breathFloor.barsUnderFloorRatio > FLOOR_BREACH_SOFT_RATIO) {
    soft.push(`${underFloor.length}/${calls.length} bars (${Math.round(breathFloor.barsUnderFloorRatio * 1000) / 10}%) delivered under the ${floorMs} ms breath floor — min ${breathFloor.minBreathMs} ms`)
  }

  // THE SKEW CROSS-CHECK — the independent corroboration of
  // `OBSERVER_ONSET_SKEW_MS`, and the reason this block exists at all.
  //
  // A clip's end event should land on `onset + stated duration`. Measured
  // against the RAW onset it did not: the residual ran +124 / +94 / +67 ms by
  // path, and for a long time that was written off here as "reporting lag" —
  // a property of the end event nobody could explain.
  //
  // It was never the end event. Re-measured against the CORRECTED onset the
  // residual collapses to roughly +29 / −1 / −28, straddling zero. The end
  // event was honest all along; the onset was early by the same ~95 ms the
  // direct calibration measured at the other end of the clip.
  //
  // That is the whole argument. Two instruments that share no code path — a
  // stopwatch on `voice-latency.tsx` timing one play two ways, and the drift
  // of an end event against a stated duration across hundreds of plays —
  // agree on the size of the error and on which end of the clip was lying.
  // A future capture where `residualByPath` walks away from zero means the
  // constant has gone stale (a media3 or expo-audio change), not that the
  // end event has drifted.
  const allEnds = [...calls, ...leadIns]
  const pathsSeen = [...new Set(allEnds.map((r) => r.path ?? 'unknown'))]
  const statsFor = (path, key) => latencyStats(allEnds.filter((r) => (r.path ?? 'unknown') === path).map((r) => r[key]))
  const skewCrossCheck = {
    appliedSkewMs: OBSERVER_ONSET_SKEW_MS,
    measures: 'end event vs onset + stated duration; residual should straddle zero, raw should sit near +skew',
    /** Against the corrected onset. This is the one that should be ~0. */
    residualByPath: Object.fromEntries(pathsSeen.map((p) => [p, statsFor(p, 'endLagMs')])),
    /** Against the raw onset — what this tool used to call "reporting lag". */
    rawByPath: Object.fromEntries(pathsSeen.map((p) => [p, statsFor(p, 'rawEndLagMs')])),
    /** Signed: how much closer to zero the correction moved the median. */
    agreementByPath: Object.fromEntries(
      pathsSeen.map((p) => {
        const raw = statsFor(p, 'rawEndLagMs').medianMs
        const res = statsFor(p, 'endLagMs').medianMs
        return [p, raw === null || res === null ? null : { rawMedianMs: raw, residualMedianMs: res, improvedByMs: r1(Math.abs(raw) - Math.abs(res)) }]
      }),
    ),
  }
  // A residual this large means the correction is no longer the right size on
  // this build. Soft, not hard: one odd path should not fail a whole capture.
  for (const [path, s] of Object.entries(skewCrossCheck.residualByPath)) {
    if (s.medianMs !== null && s.n >= SKEW_CROSS_CHECK_MIN_SAMPLES && Math.abs(s.medianMs) > SKEW_CROSS_CHECK_TOLERANCE_MS) {
      soft.push(`skew cross-check: ${path} end-event residual median ${s.medianMs} ms (n${s.n}) exceeds ±${SKEW_CROSS_CHECK_TOLERANCE_MS} — OBSERVER_ONSET_SKEW_MS (${OBSERVER_ONSET_SKEW_MS}) may be stale on this build`)
    }
  }
  const breathByVocab = {}
  for (const vocab of new Set(calls.map((c) => c.vocabulary ?? 'unknown'))) {
    const rows = calls.filter((c) => (c.vocabulary ?? 'unknown') === vocab)
    const b = rows.map((c) => c.breathMs)
    breathByVocab[vocab] = {
      n: rows.length,
      medianBreathMs: r1(median(b)),
      medianEndLateMs: r1(median(rows.map((c) => c.endLateMs).filter((v) => v !== null))),
      minBreathMs: b.length > 0 ? r1(Math.min(...b)) : null,
      p5BreathMs: r1(percentile(b, 5)),
      lowTail: lowTailLabel(rows.length),
    }
  }
  // THE SKEW-INVARIANT LEAD-IN METRIC.
  //
  // `endMinusEndByMs` compares a CORRECTED audible end against `endByMs`, a
  // planned time on the work axis with no audio path of its own. Every
  // millisecond of `OBSERVER_ONSET_SKEW_MS` therefore lands in it, and the
  // number got 95 ms worse the day the ruler was corrected — which reads as
  // "the lead-ins regressed" and drives a `LEAD_IN_PAD_MS` proposal that
  // would pay for the audio path a second time.
  //
  // This one compares two OBSERVED sounds: the lead-in's audible end and the
  // audible onset of the first call after it. Both carry the same correction,
  // so it cancels exactly, and the number means the same thing before and
  // after any future re-calibration. It is the gap the athlete actually hears
  // between the whisper and the first call of the section.
  const leadInGaps = []
  for (const l of leadIns) {
    if (l.audibleEndMs === null) continue
    // Paired from the lead-in's ONSET, not its end. Pairing from the end
    // would make an overlap unrepresentable — the call that a long lead-in
    // runs into starts BEFORE that end, so it would be skipped and the next
    // section's call reported as a comfortable gap. That is the one case this
    // metric exists to catch.
    const next = calls
      .filter((c) => c.roundIndex === l.roundIndex && c.audibleOnsetMs !== null && l.audibleOnsetMs !== null && c.audibleOnsetMs >= l.audibleOnsetMs)
      .sort((a, b) => a.audibleOnsetMs - b.audibleOnsetMs)[0]
    // A section's rep-0 call follows its lead-in closely; anything past this
    // window is the NEXT section and would report a gap of many seconds.
    if (next && next.audibleOnsetMs - l.audibleEndMs <= LEAD_IN_TO_CALL_WINDOW_MS) {
      leadInGaps.push(r1(next.audibleOnsetMs - l.audibleEndMs))
    }
  }
  const leadInSummary = {
    n: leadIns.length,
    /** Skew-invariant: observed → observed. Prefer this over endMinusEndBy. */
    gapToFirstCall: { n: leadInGaps.length, ...latencyStats(leadInGaps), minMs: leadInGaps.length > 0 ? r1(Math.min(...leadInGaps)) : null, overlapping: leadInGaps.filter((g) => g < 0).length },
    medianEndMinusEndByMs: r1(median(leadIns.map((l) => l.endMinusEndByMs).filter((v) => v !== null))),
    p95EndMinusEndByMs: r1(percentile(leadIns.map((l) => l.endMinusEndByMs).filter((v) => v !== null), 95)),
    walkedOver: leadIns.filter((l) => l.endMinusEndByMs !== null && l.endMinusEndByMs > 0).length,
    byVocab: Object.fromEntries([...new Set(leadIns.map((l) => l.vocabulary ?? 'unknown'))].map((v) => [v, r1(median(leadIns.filter((l) => (l.vocabulary ?? 'unknown') === v).map((l) => l.endMinusEndByMs).filter((x) => x !== null)))])),
  }
  if (leadInSummary.walkedOver > 0) soft.push(`${leadInSummary.walkedOver} lead-in(s) ended past endBy (median ${leadInSummary.medianEndMinusEndByMs} ms)`)

  // -- combo announces → first ring ----------------------------------------
  const announces = []
  for (const d of announceDispatches) {
    // Same FIFO consumption as the click dispatches above — a combo announce's
    // traceId is its slotId, which is unique per cue, but taking from the
    // shared queue keeps one rule for both joins.
    const play = d.traceId ? takePlay(d.traceId) : undefined
    const obs = play?.playId ? obsById.get(play.playId) : undefined
    if (!obs || obs.outcome !== 'ok' || typeof obs.endMs !== 'number') continue
    const cueId = (d.slotId ?? '').split(':')[0]
    const firstRing = tokenDue
      .filter((t) => t.cueId === cueId && t.tokenIndex === 0 && t.monotonicTimeMs !== undefined && t.monotonicTimeMs >= (obs.onsetMs ?? obs.dispatchMs ?? 0))
      .sort((a, b) => a.monotonicTimeMs - b.monotonicTimeMs)[0]
    // The audible end, like calls and lead-ins — the announce rail was the
    // last place still scoring against the end EVENT, which would have
    // reported the ~100 ms reporting lag as the coach overrunning the ring.
    const announceEnd = audibleEndMs(obs, play)
    announces.push({ slotId: d.slotId, cueId, onsetLatencyMs: trueOnsetLatencyMs(obs), endToRingMs: firstRing && announceEnd !== null ? r1(firstRing.monotonicTimeMs - announceEnd) : null })
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
  // The bell goes out through `playInstruction`, whose observation is watched
  // as kind `clip` (its WatchMeta) while the play record names no kind at all
  // — so match on the ASSET, not the kind, or every ceremony row reads "—" on
  // a capture that rang two bells.
  const bells = joined
    .filter((j) => /bell/i.test(j.play.asset ?? j.play.label ?? '') && j.obs?.onsetMs != null && j.obs.outcome === 'ok')
    .map((j) => j.obs)
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
    // The ceremonies are scored on the AUDIBLE end, exactly as calls and
    // lead-ins are. The round warning is always torn down by the bell, so its
    // observation closes as `released` and its `endMs` is the teardown moment
    // — subtracting that from the bell onset reported 29 ms and 40 ms on the
    // two quick-workout sessions, which reads as a perfect landing and is
    // actually just "the bell stopped it, then rang". The true gaps were
    // 420 ms and 498 ms, both past this analyzer's own 400 ms band, and no
    // warning fired.
    // DOMAIN RULE. The skew correction applies to players, not to the ceremony
    // playlists (`SKEW_CORRECTED_KINDS`), so three kinds of comparison exist
    // here and only two are legitimate:
    //
    //   corrected audio vs a CLOCK event  — fine, and it must be corrected:
    //       the bell against `round.boundary` is real audio lateness.
    //   raw audio vs raw audio            — fine: both playlists, one domain.
    //   corrected audio vs RAW audio      — never. It manufactures the skew as
    //       a finding. The warning (playlist, uncalibrated) against the bell
    //       (player, calibrated) is exactly that pairing, so the bell is used
    //       RAW there and the row says so.
    //
    // Once the playlist path is calibrated too (plan 5b), warnEndToBell moves
    // into the corrected domain and this split goes away.
    const warnAudibleEnd = audibleEndMs(warn)
    const recoveryAudibleEnd = audibleEndMs(recovery)
    const row = {
      roundIndex: b.roundIndex,
      bellOnsetLatencyMs: bell ? r1(trueOnsetMs(bell) - b.monotonicTimeMs) : null,
      warnEndToBellMs: warn && bell && warnAudibleEnd !== null ? r1(bell.onsetMs - warnAudibleEnd) : null,
      /** Both operands raw: the playlist path has no calibration yet. */
      warnEndToBellDomain: 'raw (playlist uncalibrated)',
      warnOutcome: warn?.outcome ?? null,
      // How long the playlist was held open past its own audio — the teardown
      // gap, NOT the clip overrunning. Reported separately so the two can
      // never be read as one number again.
      warnHeldOpenPastAudioMs: warn && typeof warn.endMs === 'number' && warnAudibleEnd !== null ? r1(warn.endMs - warnAudibleEnd) : null,
      recoveryEndToWarnOnsetMs: recovery && warn && typeof warn.onsetMs === 'number' && recoveryAudibleEnd !== null ? r1(warn.onsetMs - recoveryAudibleEnd) : null,
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
    // Which domain each row is reported in, so a reader never lines these up
    // against the corrected family medians and reads the difference as a
    // finding. Intro/metronome/warning/recovery run through
    // `createAudioPlaylist`, which the ruler has not measured (plan 5b); the
    // bell is a player and is corrected.
    domain: { bells: 'corrected', intro: 'raw (playlist uncalibrated)', metronome: 'raw (playlist uncalibrated)', rounds: 'mixed — see per-row *Domain fields' },
    intro: intros.map((o) => ({ onsetLatencyMs: o.onsetLatencyMs ?? null, driftMs: typeof o.observedDurationMs === 'number' && typeof o.expectedDurationMs === 'number' ? r1(o.observedDurationMs - o.expectedDurationMs) : null, outcome: o.outcome })),
    metronome: { n: metronomes.length, onset: latencyStats(metronomes.map((o) => o.onsetLatencyMs)), outcomes: tally(metronomes, 'outcome') },
    bells: { n: bells.length, onset: latencyStats(bells.map((o) => trueOnsetLatencyMs(o))) },
  }

  // -- the token-due dispatch loop against its own schedule -------------------
  // NOT ring latency. `cue.tokenDue` is JS-thread telemetry on the runner's
  // 50 ms loop; the visible ring is a projection driven by
  // `useRingBeatClock`'s Reanimated frame callback and lands within one
  // 60 Hz frame (measured max 16.7 ms over 288 bars). The two disagree by a
  // median 30-34 ms, so reading this as "the rings are 40 ms late" blames the
  // paint for the probe's own lag.
  const ringLate = tokenDue.filter((t) => t.scheduledMs !== undefined && t.workElapsedMs !== undefined).map((t) => t.workElapsedMs - t.scheduledMs)
  const rings = {
    n: tokenDue.length,
    measures: 'token-due dispatch loop, not the painted ring',
    late: latencyStats(ringLate),
    maxLateMs: ringLate.length > 0 ? r1(Math.max(...ringLate)) : null,
  }

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
    breath: { calls: calls.length, bySlot: breathBySlot, byVocab: breathByVocab, floor: breathFloor, skewCrossCheck },
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

  // Lead-in pad.
  //
  // `endMinusEndByMs` is NOT a basis for changing a constant any more. It
  // compares corrected audio against a planned work-axis time, so the whole
  // of OBSERVER_ONSET_SKEW_MS sits inside it and it got 95 ms worse the day
  // the ruler was corrected — with nothing about the lead-ins having changed.
  // Growing LEAD_IN_PAD_MS on that basis pays for the audio path twice.
  //
  // The gap to the section's first call is observed on both ends, so the
  // correction cancels; it is reported either way, but only the invariant
  // number can move a constant.
  const gap = leadInSummary.gapToFirstCall
  const leadShift = leadInSummary.medianEndMinusEndByMs
  if (leadShift !== null && leadInSummary.n >= 3) {
    const current = c.leads?.LEAD_IN_PAD_MS ?? null
    const overlapping = gap.overlapping > 0
    proposals.push({
      constant: 'LEAD_IN_PAD_MS',
      current,
      proposed: !overlapping || current === null || gap.minMs === null ? current : Math.round((current + Math.abs(gap.minMs)) / 10) * 10,
      status: overlapping ? undefined : 'held (skew-contaminated basis)',
      basis: overlapping
        ? `${gap.overlapping} of ${gap.n} lead-ins ran INTO their section's first call (worst ${gap.minMs} ms) — measured sound-to-sound, so the observer skew cancels`
        : `lead-in end → first call onset median ${gap.medianMs ?? '—'} ms over ${gap.n}, none overlapping. The end − endBy figure (${leadShift} ms) compares corrected audio against a planned time and carries the full ${OBSERVER_ONSET_SKEW_MS} ms skew; it is reported, not acted on.`,
      apply: overlapping,
    })
    const tech = leadInSummary.byVocab?.techniques
    if (tech !== null && tech !== undefined) {
      const cur = c.leads?.TECHNIQUE_LEADIN_LEAD_MS ?? null
      proposals.push({
        constant: 'TECHNIQUE_LEADIN_LEAD_MS',
        current: cur,
        proposed: cur,
        status: 'held (skew-contaminated basis)',
        basis: `techniques lead-ins end − endBy median ${tech} ms — same contaminated basis as LEAD_IN_PAD_MS above; a per-vocabulary lead needs a sound-to-sound measurement to move`,
        apply: false,
      })
    }
  }

  // Breath: the call ended late by d → dispatch it d earlier by growing
  // breathMs. But FIRST ask whether one number explains every slot: a uniform
  // lag is a global constant, and writing it into per-slot overrides would
  // bake a latency into exceptions and hide its single cause.
  //
  // And before either question, subtract what the audio path was ALWAYS going
  // to cost. Delivered breath is measured from the corrected onset, so every
  // bar's shortfall carries OBSERVER_ONSET_SKEW_MS whether or not anything is
  // mistuned: the status event fires ~95 ms before sound moves, and that is a
  // property of media3, not of how long the coach should be silent.
  //
  // Leaving it in produced exactly the finding this file exists to prevent.
  // On quick-six-count the five slots came back 79.8-131.3 ms short — a
  // 51.5 ms spread, 1.5 ms wider than GLOBAL_SHIFT_BAND_MS, so `uniform` was
  // false and the tool emitted five `apply: yes` per-slot overrides plus
  // DENSE_BREATH_MS 600 → 687. Net of the skew those shortfalls are −15 to
  // +36, every one inside the noise band, and the correct output is silence.
  //
  // The allowance is the analyzer's own measured constant, not the coach's
  // `DELIVERED_BREATH_SHORTFALL_MS`. Those are the same physical quantity
  // seen from opposite sides — one measures the path, the other pays for it —
  // and a proposal must be built on the measurement, so that if the two ever
  // disagree the report says so instead of quietly agreeing with itself.
  const skewAllowanceMs = OBSERVER_ONSET_SKEW_MS
  notes.push(
    `breath proposals are net of the ${skewAllowanceMs} ms observer skew — the audio path costs that on every bar by construction, and CALL_DISPATCH_LAG_MS is the constant that compensates it`,
  )
  const netLate = (s) => (s.medianEndLateMs === null ? null : r1(s.medianEndLateMs - skewAllowanceMs))
  const slotRows = Object.entries(breathBySlot).filter(
    ([, s]) => s.n >= 3 && s.medianEndLateMs !== null && s.plannedBreathMs !== null,
  )
  const lateByslot = slotRows.map(([, s]) => netLate(s))
  const uniform =
    lateByslot.length >= 2 && Math.max(...lateByslot) - Math.min(...lateByslot) <= GLOBAL_SHIFT_BAND_MS
  const globalShift = uniform ? Math.round(median(lateByslot)) : null

  if (uniform && Math.abs(globalShift) < BREATH_PROPOSAL_MIN_MS) {
    // Uniform, but too small to act on. This branch exists because the old
    // `if (uniform && big) … else per-slot` fell THROUGH to per-slot overrides
    // exactly when the slots agreed and the shift was under the floor — the
    // anti-pattern this file's own comment forbids. Speed Burst hit it:
    // slots [8.8, 13.5, 32.8, 44.5, 48.8] span 40 ms (uniform), median 33
    // (< 40), and it emitted two `apply: yes` per-slot overrides.
    proposals.push({
      constant: 'CALL_DISPATCH_LAG_MS',
      current: c.leads?.CALL_DISPATCH_LAG_MS ?? null,
      proposed: 'unchanged',
      status: 'within noise',
      basis: `every slot loses about the same ${globalShift} ms (${slotRows.length} slots spanning ${Math.round(Math.min(...lateByslot))}–${Math.round(Math.max(...lateByslot))} ms), which is under the ${BREATH_PROPOSAL_MIN_MS} ms floor — one drive cannot tell this from jitter`,
    })
  } else if (uniform && Math.abs(globalShift) >= BREATH_PROPOSAL_MIN_MS) {
    // A uniform shortfall is the DISPATCH PATH, not the breath doctrine:
    // every slot loses the same milliseconds between the scheduler deciding
    // and the audio sounding. `CALL_DISPATCH_LAG_MS` is the constant that
    // compensates it; `DENSE_BREATH_MS` is how long the coach should be
    // silent, which no measurement of the audio path should quietly rewrite.
    const lag = c.leads?.CALL_DISPATCH_LAG_MS ?? null
    const bars = Object.values(breathByVocab).reduce((n, v) => n + v.n, 0)
    proposals.push({
      constant: 'CALL_DISPATCH_LAG_MS',
      current: lag,
      proposed: lag === null ? Math.round(globalShift) : Math.round(lag + globalShift),
      basis: `EVERY slot loses the same ${globalShift} ms (${slotRows.length} slots spanning ${Math.round(Math.min(...lateByslot))}–${Math.round(Math.max(...lateByslot))} ms over ${bars} bars) — the dispatch path, not the breath doctrine`,
      apply: true,
    })
    proposals.push({
      constant: 'DENSE_BREATH_MS',
      current: JSON.stringify(c.breath?.DENSE_BREATH_MS ?? {}),
      proposed: 'unchanged',
      status: 'held',
      basis: 'how long the coach should be silent is Kyle\'s call; the uniform shortfall above is the audio path and belongs in the lag constant',
    })
    proposals.push({
      constant: 'CALL_BREATH_OVERRIDES',
      current: Object.keys(c.breath?.CALL_BREATH_OVERRIDES ?? {}).length,
      proposed: 'none',
      status: 'superseded',
      basis: `the ${slotRows.length} slots agree within ${Math.round(Math.max(...lateByslot) - Math.min(...lateByslot))} ms — the global shift above covers them; per-slot overrides are for a slot that disagrees with its neighbours`,
    })
  } else if (slotRows.length === 1) {
    // THE SINGLE-SLOT HOLE. `uniform` needs two slots to compare, so a capture
    // carrying exactly one qualifying slot can never be uniform — and fell
    // straight through to the per-slot branch below, which writes
    // `apply: true` overrides. That is the file's own anti-pattern reached
    // from the opposite direction: with one witness there is no evidence
    // distinguishing "this slot is unusual" from "the dispatch path is slow",
    // and only the first of those readings has a per-slot fix. A short drive
    // or a heavily filtered capture is enough to land here.
    const [slot, s] = slotRows[0]
    proposals.push({
      constant: `CALL_BREATH_OVERRIDES['${slot}']`,
      current: c.breath?.CALL_BREATH_OVERRIDES?.[slot] ?? `derived ${s.plannedBreathMs}`,
      proposed: 'none',
      status: 'insufficient slots',
      basis: `only one slot qualified (${s.n} bars, median ${s.medianEndLateMs} ms late, ${netLate(s)} ms net of the ${skewAllowanceMs} ms skew) — one witness cannot separate a slot-specific problem from a global dispatch lag, and a per-slot override would bake the wrong one in. Re-drive for a second slot.`,
      apply: false,
    })
  } else {
    for (const [slot, s] of slotRows) {
      const net = netLate(s)
      if (Math.abs(net) < BREATH_PROPOSAL_MIN_MS) continue
      const override = c.breath?.CALL_BREATH_OVERRIDES?.[slot] ?? null
      proposals.push({
        constant: `CALL_BREATH_OVERRIDES['${slot}']`,
        current: override ?? `derived ${s.plannedBreathMs}`,
        proposed: Math.round(s.plannedBreathMs + net),
        basis: `observed call end − planned end median ${s.medianEndLateMs} ms over ${s.n} bars, ${net} ms net of the ${skewAllowanceMs} ms skew (measured breath ${s.medianBreathMs} vs planned ${s.plannedBreathMs})`,
        apply: true,
      })
    }
    for (const [vocab, v] of Object.entries(breathByVocab)) {
      if (v.n < 10 || v.medianEndLateMs === null) continue
      const net = netLate(v)
      if (Math.abs(net) < BREATH_PROPOSAL_MIN_MS) continue
      const dense = c.breath?.DENSE_BREATH_MS?.[vocab] ?? null
      proposals.push({ constant: `DENSE_BREATH_MS.${vocab}`, current: dense, proposed: dense === null ? null : Math.round(dense + net), basis: `${vocab} calls end late by median ${v.medianEndLateMs} ms over ${v.n} bars, ${net} ms net of the ${skewAllowanceMs} ms skew`, apply: dense !== null })
    }
  }
  // The floor only needs raising when a slot's own shortfall would push it
  // below the floor — a uniform lag moves every slot together and leaves the
  // floor's job unchanged.
  //
  // WHICH constant to name depends on what the app already pays. `MIN_BREATH_MS`
  // is Kyle's comfort target: how much silence he wants before the punch, set
  // by ear. `DELIVERED_BREATH_SHORTFALL_MS` is what the clamp adds so that
  // much silence survives the audio path. A floor breach measured HERE — from
  // corrected onsets, at the ear — means the allowance is short, not that the
  // comfort target is wrong, so once the allowance exists this proposal names
  // it. Naming MIN_BREATH_MS then would raise the target Kyle tuned AND leave
  // the path cost unpaid.
  const minBreath = c.breath?.MIN_BREATH_MS ?? null
  const shortfallAllowance = c.breath?.DELIVERED_BREATH_SHORTFALL_MS ?? null
  const worstMeasured = slotRows.length > 0 ? Math.min(...slotRows.map(([, s]) => s.medianBreathMs)) : null
  if (minBreath !== null && worstMeasured !== null && worstMeasured < minBreath) {
    const deficit = Math.round(minBreath - worstMeasured)
    proposals.push(
      shortfallAllowance === null
        ? {
            constant: 'MIN_BREATH_MS',
            current: minBreath,
            proposed: minBreath + deficit,
            basis: `the tightest slot delivered ${worstMeasured} ms of breath against a ${minBreath} ms floor${uniform ? ' — but the global shift above is the real cause; revisit after applying it' : ''}`,
            apply: !uniform,
          }
        : {
            constant: 'DELIVERED_BREATH_SHORTFALL_MS',
            current: shortfallAllowance,
            proposed: shortfallAllowance + deficit,
            basis: `the tightest slot delivered ${worstMeasured} ms at the ear against a ${minBreath} ms floor — the clamp's ${shortfallAllowance} ms allowance is ${deficit} ms short${uniform ? '; but the global shift above is the real cause, revisit after applying it' : ''}. MIN_BREATH_MS is Kyle's comfort target and is not the constant at fault.`,
            apply: !uniform,
          },
    )
  }

  // Audio output latency: the armed-path onset median is the playhead's own lag.
  //
  // INERT. This proposal is kept for the measurement, not for the edit.
  // `DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS` feeds `calibratedLatencyMs`,
  // which only `dispatchAtMsForTickTime` reads — and that helper has ZERO
  // production callers today. Changing the constant changes nothing that
  // plays. Worse, the compensation it would apply is the same lateness
  // `CALL_DISPATCH_LAG_MS = 71` already pays in the click-script path, so
  // wiring it later without retiring that lag double-pays and pulls every
  // call early by the amount twice. Whoever revives the helper owns
  // reconciling the two; until then `apply` is hard `false`.
  const click = families['click-script']
  const armed = click?.byPath?.armed ?? click?.onset ?? null
  if (armed && armed.n >= 10 && armed.medianMs !== null) {
    const current = c.audio?.DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS ?? null
    proposals.push({
      constant: 'DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS',
      current,
      proposed: Math.round(armed.medianMs + (cal ?? 0)),
      basis: `armed click-script onset median ${armed.medianMs} ms (p95 ${armed.p95Ms}, jitter ${armed.jitterMs}) over ${armed.n}${cal === null ? ' — uncalibrated, playhead only' : ` + ${cal} ms calibration`}`,
      apply: false,
      inert: 'dispatchAtMsForTickTime has no production callers; CALL_DISPATCH_LAG_MS already pays this in the shipping path',
    })
  }
  const fresh = click?.byPath?.fresh ?? null
  if (fresh && fresh.n >= 10) {
    const current = c.audio?.ONE_SHOT_RELEASE_PAD_MS ?? null
    proposals.push({
      constant: 'ONE_SHOT_RELEASE_PAD_MS',
      current,
      proposed: Math.round((fresh.p95Ms + 200) / 50) * 50,
      basis: `fresh-path onset ${tailLabel(fresh)} ${fresh.p95Ms} ms over ${fresh.n} + 200 ms margin`,
      apply: enoughForTail(fresh),
    })
  }
  if (armed && armed.n >= 10) {
    const current = c.audio?.CLICK_SCRIPT_PREARM_PAD_MS ?? null
    proposals.push({
      constant: 'CLICK_SCRIPT_PREARM_PAD_MS',
      current,
      proposed: Math.round((armed.p95Ms + 50) / 10) * 10,
      basis: `armed onset ${tailLabel(armed)} ${armed.p95Ms} ms + 50 ms`,
      apply: enoughForTail(armed),
    })
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
  L.push('| slot | n | vocab | intended | delivered min | low tail | median | p95 | shortfall median |')
  L.push('|---|---|---|---|---|---|---|---|---|')
  for (const [slot, s] of Object.entries(report.breath.bySlot)) L.push(`| ${slot} | ${s.n} | ${s.vocabulary ?? '—'} | ${s.plannedBreathMs ?? '—'} | ${s.minBreathMs ?? '—'} | ${s.p5BreathMs ?? '—'} (${s.lowTail}) | ${s.medianBreathMs} | ${s.p95BreathMs} | ${s.medianEndLateMs ?? '—'} |`)
  L.push('')

  const fl = report.breath.floor
  L.push('### Floor — never late')
  L.push('')
  if (fl.floorMs === null) {
    L.push(`floor: **${fl.source}**`)
  } else {
    L.push(
      `floor ${fl.floorMs} ms · **at or past the punch: ${fl.barsAtOrPastPunch}**` +
        ` · under floor ${fl.barsUnderFloor}/${fl.n}` +
        `${fl.barsUnderFloorRatio === null ? '' : ` (${Math.round(fl.barsUnderFloorRatio * 1000) / 10}%)`}` +
        ` · min ${fl.minBreathMs ?? '—'} · ${fl.lowTail} ${fl.p5BreathMs ?? '—'}`,
    )
  }
  if (fl.worstBars.length > 0) {
    L.push('')
    L.push('| tightest bars | round | vocab | delivered | intended | dispatch late | path |')
    L.push('|---|---|---|---|---|---|---|')
    for (const w of fl.worstBars) L.push(`| ${w.slot} | ${w.roundIndex} | ${w.vocabulary ?? '—'} | ${w.deliveredBreathMs} | ${w.intendedBreathMs ?? '—'} | ${w.lateMs ?? '—'} | ${w.path ?? '—'} |`)
  }
  L.push('')
  const xc = report.breath.skewCrossCheck
  L.push(`### Skew cross-check (applied correction ${xc?.appliedSkewMs ?? '—'} ms)`)
  L.push('')
  L.push('End event vs `onset + stated duration`. Raw sits near +skew; residual should straddle zero.')
  L.push('')
  L.push('| path | n | raw median | residual median | closer to zero by |')
  L.push('|---|---|---|---|---|')
  for (const [p, a] of Object.entries(xc?.agreementByPath ?? {})) {
    const n = xc.residualByPath[p]?.n ?? 0
    L.push(`| ${p} | ${n} | ${a?.rawMedianMs ?? '—'} | ${a?.residualMedianMs ?? '—'} | ${a?.improvedByMs ?? '—'} |`)
  }
  L.push('')
  const g = report.leadIns.gapToFirstCall
  L.push(`lead-ins: n ${report.leadIns.n} · **end → first call median ${g?.medianMs ?? '—'} ms** (min ${g?.minMs ?? '—'}, n${g?.n ?? 0}, overlapping ${g?.overlapping ?? 0}) — sound-to-sound, skew-invariant`)
  L.push(`  · end − endBy median ${report.leadIns.medianEndMinusEndByMs ?? '—'} ms (p95 ${report.leadIns.p95EndMinusEndByMs ?? '—'}) · walked over ${report.leadIns.walkedOver} — carries the ${OBSERVER_ONSET_SKEW_MS} ms skew; reported, not acted on`)
  L.push(`combo announces: n ${report.announces.n} · end → first ring median ${report.announces.medianEndToRingMs ?? '—'} ms · spread ${report.announces.spreadMs ?? '—'} · tight(60) ${report.announces.tightWithin60ms ?? '—'} · cut by ring ${report.announces.cutByRing}`)
  L.push(
    `token-due dispatch loop (NOT the painted ring — the ring is a frame-callback projection in useRingBeatClock and lands within one 60 Hz frame): n ${report.rings.n} · fire − schedule median ${report.rings.late.medianMs ?? '—'} p95 ${report.rings.late.p95Ms ?? '—'} max ${report.rings.maxLateMs ?? '—'}`,
  )
  L.push('')
  L.push('## Ceremonies')
  L.push('| round | bell onset | warn end → bell | warn held open past audio | recovery end → warn | outcomes |')
  L.push('|---|---|---|---|---|---|')
  for (const r of report.ceremonies.rounds) L.push(`| ${r.roundIndex} | ${r.bellOnsetLatencyMs ?? '—'} | ${r.warnEndToBellMs ?? '—'} | ${r.warnHeldOpenPastAudioMs ?? '—'} | ${r.recoveryEndToWarnOnsetMs ?? '—'} | warn ${r.warnOutcome ?? '—'} / recovery ${r.recoveryOutcome ?? '—'} |`)
  if (report.ceremonies.intro.length) L.push(`intro: ${report.ceremonies.intro.map((i) => `onset ${i.onsetLatencyMs ?? '—'} drift ${i.driftMs ?? '—'} (${i.outcome})`).join('; ')}`)
  L.push(`metronome: n ${report.ceremonies.metronome.n} onset median ${report.ceremonies.metronome.onset.medianMs ?? '—'} · bells: n ${report.ceremonies.bells.n} onset median ${report.ceremonies.bells.onset.medianMs ?? '—'}`)
  L.push(`ducks: ${report.duck.silentBirths} silent birth(s)${report.duck.silentBirths ? ` — ${report.duck.labels.join(', ')}` : ''}`)
  const i = report.instrument
  L.push(`instrument: n ${i.n} · latency median ${i.latency.medianMs ?? '—'} p95 ${i.latency.p95Ms ?? '—'} jitter ${i.latency.jitterMs ?? '—'} · pipeline median ${i.pipeline.medianMs ?? '—'} · masked ${i.maskedRatio ?? '—'} busy ${i.busyRatio ?? '—'}`)
  L.push('')
  L.push('## Proposals (for the ear, never applied here)')
  L.push('| constant | current | proposed | apply? | basis |')
  L.push('|---|---|---|---|---|')
  for (const p of report.proposals) L.push(`| ${p.constant} | ${p.current ?? '—'} | ${p.proposed ?? '—'} | ${p.status ?? (p.inert ? 'INERT' : p.apply ? 'yes' : 'no')} | ${p.basis ?? p.note ?? ''}${p.inert ? ` — **inert:** ${p.inert}` : ''} |`)
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
