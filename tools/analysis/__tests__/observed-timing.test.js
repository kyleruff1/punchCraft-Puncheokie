/**
 * The mic-free timing analyzer (GH #292, plan C5) on a synthetic capture
 * written in the real ConsoleSink shape. Every number below is chosen so
 * the join is provable by hand: the round's work axis sits at monotonic
 * +10 000, each call's audio ends 15 ms later than its intended breath
 * allows (while its END EVENT arrives a further 35 ms late — the two must
 * not be confused), the lead-in's audio runs 30 ms past its budget, and the
 * countdown ends 150 ms before the bell.
 */

import { analyze, fitWorkAxis, OBSERVER_ONSET_SKEW_MS, renderReport, roundWindows, SKEW_CROSS_CHECK_MIN_SAMPLES } from '../observed-timing.mjs'

const PID = '( 8286)'
// The REAL ConsoleSink shape (src/diagnostics/logger.ts), copied from a
// device capture: `'[INFO] puncheokie.voice.play', 'clip playing', { … }`.
// The brackets hold the LEVEL, not the event code.
const rec = (time, tag, fields) => {
  const entries = Object.entries(fields)
  const [first, ...rest] = entries
  const fmt = (v) => (typeof v === 'string' ? `'${v}'` : String(v))
  return [
    `08-31 ${time} I/ReactNativeJS${PID}: '[INFO] ${tag}', 'message', { ${first[0]}: ${fmt(first[1])},`,
    ...rest.map(([k, v]) => `08-31 ${time} I/ReactNativeJS${PID}:   ${k}: ${fmt(v)},`),
    `08-31 ${time} I/ReactNativeJS${PID}: }`,
  ].join('\n')
}

const play = (time, fields) => rec(time, 'puncheokie.voice.play', fields)
const observed = (time, fields) => rec(time, 'puncheokie.voice.observed', fields)

/**
 * `shortfallMs` delays each call's ONSET so the audible end lands that much
 * later than intended, across two slots — the shape that proves a uniform
 * loss is blamed on the dispatch path rather than on the breath doctrine.
 * Delivered breath = 250 − (shortfall − 15) − 15; see the breath test.
 */
/**
 * `extraLeadIns` adds two more lead-ins so the pad proposal's `n >= 3` guard
 * opens. Opt-in rather than baked in, because the single-lead-in fixture is
 * what pins `medianEndMinusEndByMs` and the `walked over` warning above.
 *
 * The second one is placed to END 300 ms before the first call sounds, so the
 * skew-invariant gap has a real pair to measure; the third sits far from any
 * call and must be left unpaired rather than reaching across a section.
 */
function leadInAt({ id, dispatchAtMs, monotonicTimeMs, durationMs, endByMs, onsetMs }) {
  return [
    rec('10:00:40.000', 'puncheokie.clickScript.dispatch', { kind: 'lead-in', slot: `lead-in/x/${id}`, traceId: `lead-in/x/${id}#${dispatchAtMs}`, dispatchAtMs, lateMs: 3, durationMs, endByMs, firstNodeMs: endByMs + 500, monotonicTimeMs }),
    play('10:00:40.000', { asset: `li-${id}`, kind: 'click-script', label: `lead-in/x/${id}`, playId: `p-li-${id}`, traceId: `lead-in/x/${id}#${dispatchAtMs}`, path: 'armed', vocabulary: 'numbers', dispatchMs: monotonicTimeMs, durationMs }),
    observed('10:00:48.000', { playId: `p-li-${id}`, kind: 'click-script', label: `lead-in/x/${id}`, path: 'armed', traceId: `lead-in/x/${id}#${dispatchAtMs}`, outcome: 'ok', dispatchMs: monotonicTimeMs, onsetMs, endMs: onsetMs + durationMs + 170, onsetLatencyMs: onsetMs - monotonicTimeMs, observedDurationMs: durationMs + 170, expectedDurationMs: durationMs, silentByVolume: false }),
  ]
}

function capture({ truncateCall = false, dropObservation = false, shortfallMs = null, extraLeadIns = false, leadInStretchMs = 0 } = {}) {
  const extra = shortfallMs === null ? 0 : shortfallMs - 15
  const secondSlot = shortfallMs === null
    ? []
    : [55000, 58000, 61000].flatMap((at, i) => [
        rec('10:01:10.000', 'puncheokie.clickScript.dispatch', { kind: 'call', slot: 'call/3-4', traceId: `call/3-4#${at}`, dispatchAtMs: at, lateMs: 2, durationMs: 1000, endByMs: at + 1750, firstNodeMs: at + 1250, breathMs: 250, lagMs: 71, monotonicTimeMs: 10000 + at }),
        play('10:01:10.000', { asset: 'call-3-4', kind: 'click-script', label: 'call/3-4', playId: `p-call2-${i}`, traceId: `call/3-4#${at}`, path: 'armed', vocabulary: 'numbers', dispatchMs: 10000 + at, durationMs: 1000 }),
        observed('10:01:11.000', { playId: `p-call2-${i}`, kind: 'click-script', label: 'call/3-4', path: 'armed', traceId: `call/3-4#${at}`, outcome: 'ok', dispatchMs: 10000 + at, onsetMs: 10000 + at + 15 + extra, endMs: 10000 + at + 1050 + extra, onsetLatencyMs: 15 + extra, observedDurationMs: 1035, expectedDurationMs: 1000, silentByVolume: false }),
      ])
  const moreLeadIns = !extraLeadIns
    ? []
    : [
        // Ends audibly at 46715 + 95 + 3000 = 49810, and the first call sounds
        // at 50015 + 95 = 50110 — a 300 ms gap, measured sound to sound.
        // `leadInStretchMs` lengthens only this one, to push its audio INTO
        // the call it precedes.
        ...leadInAt({ id: 'a', dispatchAtMs: 36700, monotonicTimeMs: 46700, durationMs: 3000 + leadInStretchMs, endByMs: 39800, onsetMs: 46715 }),
        // Ends audibly at 22125, 28 s from the nearest call: unpaired.
        ...leadInAt({ id: 'b', dispatchAtMs: 10000, monotonicTimeMs: 20000, durationMs: 2000, endByMs: 12000, onsetMs: 20030 }),
      ]
  return captureLines({ truncateCall, dropObservation, extra, secondSlot: [...secondSlot, ...moreLeadIns] })
}

function captureLines({ truncateCall, dropObservation, extra, secondSlot }) {
  return [
    rec('10:00:00.000', 'puncheokie.qa.run', { workout: 'quick-one-two', vocab: 'numbers', dev: false, gitSha: 'abc1234' }),
    rec('10:00:05.000', 'puncheokie.round.boundary', { transition: 'countdown-entered', roundIndex: 0, workElapsedMs: 0, monotonicTimeMs: 1000 }),
    // Round 0 opens at monotonic 10 000 with workElapsed 0 → offset 10 000.
    rec('10:00:10.000', 'puncheokie.round.boundary', { transition: 'work-entered', roundIndex: 0, workElapsedMs: 0, monotonicTimeMs: 10000 }),
    play('10:00:10.000', { asset: 'bell', kind: 'instruction', label: 'bell', playId: 'p-bell-1', dispatchMs: 9990, durationMs: 1000 }),
    observed('10:00:11.000', { playId: 'p-bell-1', kind: 'instruction', label: 'bell', outcome: 'ok', dispatchMs: 9990, onsetMs: 10020, endMs: 11000, onsetLatencyMs: 30, observedDurationMs: 980, expectedDurationMs: 1000, silentByVolume: false }),
    rec('10:00:15.000', 'puncheokie.cue.tokenDue', { roundIndex: 0, cueId: 'q12-b1#0', combination: '1-2', tokenIndex: 0, ordinal: 0, workElapsedMs: 5000, monotonicTimeMs: 15000, scheduledMs: 4990 }),
    rec('10:00:16.000', 'puncheokie.cue.tokenDue', { roundIndex: 0, cueId: 'q12-b1#0', combination: '1-2', tokenIndex: 1, ordinal: 1, workElapsedMs: 6000, monotonicTimeMs: 16000, scheduledMs: 5995 }),
    rec('10:00:17.000', 'puncheokie.cue.tokenDue', { roundIndex: 0, cueId: 'q12-b1#1', combination: '1-2', tokenIndex: 0, ordinal: 2, workElapsedMs: 7000, monotonicTimeMs: 17000, scheduledMs: 7000 }),
    // Lead-in budgeted to end at work 28 000 (monotonic 38 000); it ends at 38 200.
    rec('10:00:40.000', 'puncheokie.clickScript.dispatch', { kind: 'lead-in', slot: 'lead-in/quick-one-two/r1s2', traceId: 'lead-in/quick-one-two/r1s2#20000', dispatchAtMs: 20000, lateMs: 3, durationMs: 8000, endByMs: 28000, firstNodeMs: 28500, monotonicTimeMs: 30000 }),
    play('10:00:40.000', { asset: 'li-1', kind: 'click-script', label: 'lead-in/quick-one-two/r1s2', playId: 'p-li-1', traceId: 'lead-in/quick-one-two/r1s2#20000', path: 'armed', vocabulary: 'numbers', dispatchMs: 30000, durationMs: 8000 }),
    observed('10:00:48.000', { playId: 'p-li-1', kind: 'click-script', label: 'lead-in/quick-one-two/r1s2', path: 'armed', traceId: 'lead-in/quick-one-two/r1s2#20000', outcome: 'ok', dispatchMs: 30000, onsetMs: 30030, endMs: 38200, onsetLatencyMs: 30, observedDurationMs: 8170, expectedDurationMs: 8000, silentByVolume: false }),
    // Three bars of the same call, each planned to end at work +1000 with the
    // first punch at +1250 (planned breath 250); each ends 50 ms late.
    ...[40000, 43000, 46000].flatMap((at, i) => [
      // `breathMs` is the INTENDED breath the runner logs; `endByMs` is the
      // give-up time, and `dispatchAtMs` already carries the lag compensation.
      rec('10:00:50.000', 'puncheokie.clickScript.dispatch', { kind: 'call', slot: 'call/1-2', traceId: `call/1-2#${at}`, dispatchAtMs: at, lateMs: 2, durationMs: 1000, endByMs: at + 1750, firstNodeMs: at + 1250, breathMs: 250, lagMs: 71, monotonicTimeMs: 10000 + at }),
      play('10:00:50.000', { asset: 'call-1-2', kind: 'click-script', label: 'call/1-2', playId: `p-call-${i}`, traceId: `call/1-2#${at}`, path: i === 0 ? 'fresh' : 'armed', vocabulary: 'numbers', dispatchMs: 10000 + at, durationMs: 1000 }),
      dropObservation && i === 1
        ? ''
        : observed('10:00:51.000', { playId: `p-call-${i}`, kind: 'click-script', label: 'call/1-2', path: i === 0 ? 'fresh' : 'armed', traceId: `call/1-2#${at}`, outcome: 'ok', dispatchMs: 10000 + at, onsetMs: 10000 + at + 15 + extra, endMs: 10000 + at + (truncateCall && i === 2 ? 600 : 1050) + extra, onsetLatencyMs: 15 + extra, observedDurationMs: truncateCall && i === 2 ? 585 : 1035, expectedDurationMs: 1000, silentByVolume: false }),
    ]),
    // A combo announce whose block's first ring lands 200 ms after its end.
    rec('10:01:00.000', 'puncheokie.comboAnnounce.dispatch', { slotId: 'sp1-b4#0:rep-0:combo-announce:before:e1,e2', assetId: 'ca-1-2', atTick: 1200, monotonicTimeMs: 60000, traceId: 'sp1-b4#0:rep-0:combo-announce:before:e1,e2', durationMs: 900 }),
    play('10:01:00.000', { asset: 'ca-1-2', kind: 'combo-announce', label: '1-2', playId: 'p-ann-1', traceId: 'sp1-b4#0:rep-0:combo-announce:before:e1,e2', dispatchMs: 60000, durationMs: 900 }),
    observed('10:01:01.000', { playId: 'p-ann-1', kind: 'combo-announce', label: '1-2', traceId: 'sp1-b4#0:rep-0:combo-announce:before:e1,e2', outcome: 'ok', dispatchMs: 60000, onsetMs: 60040, endMs: 61000, onsetLatencyMs: 40, observedDurationMs: 960, expectedDurationMs: 900, silentByVolume: false }),
    rec('10:01:01.200', 'puncheokie.cue.tokenDue', { roundIndex: 0, cueId: 'sp1-b4#0', combination: '1-2', tokenIndex: 0, ordinal: 3, workElapsedMs: 51200, monotonicTimeMs: 61200, scheduledMs: 51200 }),
    // Rest: recovery, then the warning ending 150 ms before the round-2 bell.
    rec('10:04:10.000', 'puncheokie.round.boundary', { transition: 'rest-entered', roundIndex: 0, workElapsedMs: 240000, monotonicTimeMs: 250000 }),
    observed('10:04:30.000', { playId: 'recovery-1', kind: 'recovery', label: 'R-1', outcome: 'ok', dispatchMs: 250990, onsetMs: 251000, endMs: 270000, onsetLatencyMs: 10, observedDurationMs: 19000, expectedDurationMs: 19000, silentByVolume: false }),
    observed('10:05:10.000', { playId: 'warn-1', kind: 'round-warning', label: 'warn-round-2', outcome: 'ok', dispatchMs: 299980, onsetMs: 300000, endMs: 309900, onsetLatencyMs: 20, observedDurationMs: 9900, expectedDurationMs: 9900, silentByVolume: false }),
    rec('10:05:10.000', 'puncheokie.round.boundary', { transition: 'work-entered', roundIndex: 1, workElapsedMs: 0, monotonicTimeMs: 310000 }),
    play('10:05:10.000', { asset: 'bell', kind: 'instruction', label: 'bell', playId: 'p-bell-2', dispatchMs: 309990, durationMs: 1000 }),
    observed('10:05:11.000', { playId: 'p-bell-2', kind: 'instruction', label: 'bell', outcome: 'ok', dispatchMs: 309990, onsetMs: 310050, endMs: 311050, onsetLatencyMs: 60, observedDurationMs: 1000, expectedDurationMs: 1000, silentByVolume: false }),
    rec('10:05:12.000', 'puncheokie.cue.tokenDue', { roundIndex: 1, cueId: 'q12-b1#0', combination: '1-2', tokenIndex: 0, ordinal: 0, workElapsedMs: 2000, monotonicTimeMs: 312000, scheduledMs: 2000 }),
    rec('10:05:13.000', 'puncheokie.instrument.observed', { eventId: 'e1', hand: 'left', keys: 'stab-60', outcome: 'ok', latencyMs: 1.1, pipelineMs: 4, peak: 40 }),
    rec('10:05:13.100', 'puncheokie.instrument.observed', { eventId: 'e2', hand: 'right', keys: 'stab-62', outcome: 'masked', latencyMs: null, pipelineMs: 4, peak: 38 }),
    rec('10:09:20.000', 'puncheokie.round.boundary', { transition: 'completed', roundIndex: 1, workElapsedMs: 240000, monotonicTimeMs: 550000 }),
    rec('10:09:21.000', 'puncheokie.observer.stats', { watched: 9, openAtRelease: 0, maxHandlerMs: 0.4 }),
    ...secondSlot,
  ]
    .filter(Boolean)
    .join('\n')
}

const CONSTANTS = {
  rail: { RAIL_K_MS: 120, RAIL_K_MS_spine: 120 },
  breath: { DENSE_BREATH_MS: { numbers: 260, techniques: 320 }, MIN_BREATH_MS: 150, CALL_BREATH_OVERRIDES: {} },
  leads: { LEAD_IN_PAD_MS: 250, TECHNIQUE_LEADIN_LEAD_MS: 500, CALL_DISPATCH_LAG_MS: 71 },
  audio: { DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS: 40, ONE_SHOT_RELEASE_PAD_MS: 1500, CLICK_SCRIPT_PREARM_PAD_MS: 200 },
  calibration: null,
}

describe('work axis fit', () => {
  it('takes the median tokenDue offset per round and checks it against the boundary', () => {
    const report = analyze(capture(), CONSTANTS)
    const r0 = report.fit.find((r) => r.roundIndex === 0)
    expect(r0).toMatchObject({ offsetMs: 10000, n: 4, spreadMs: 0, boundaryOffsetMs: 10000, disagreementMs: 0, source: 'tokenDue' })
    const r1 = report.fit.find((r) => r.roundIndex === 1)
    expect(r1).toMatchObject({ offsetMs: 310000, boundaryOffsetMs: 310000, disagreementMs: 0 })
  })
  it('falls back to the boundary when a round has no tokenDue', () => {
    const fit = fitWorkAxis([], [{ transition: 'work-entered', roundIndex: 0, workElapsedMs: 0, monotonicTimeMs: 500 }])
    expect(fit.get(0)).toMatchObject({ offsetMs: 500, n: 0, source: 'boundary' })
  })
  it('builds round windows on the monotonic clock', () => {
    const windows = roundWindows([
      { transition: 'work-entered', roundIndex: 0, monotonicTimeMs: 10 },
      { transition: 'rest-entered', roundIndex: 0, monotonicTimeMs: 250 },
      { transition: 'work-entered', roundIndex: 1, monotonicTimeMs: 310 },
    ])
    expect(windows).toEqual([
      { roundIndex: 0, startMs: 10, endMs: 250 },
      { roundIndex: 1, startMs: 310, endMs: Number.POSITIVE_INFINITY },
    ])
  })
})

describe('joins', () => {
  const report = analyze(capture(), CONSTANTS)

  it('covers every play with a playId and labels the build', () => {
    expect(report.build).toEqual({ dev: false, gitSha: 'abc1234', workout: 'quick-one-two', vocab: 'numbers' })
    expect(report.coverage).toMatchObject({ playsWithId: 7, observed: 7, ratio: 1 })
    // Nothing hard: the one soft line is the fixture's deliberate 200 ms
    // lead-in overrun, which is exactly the finding this analyzer exists for.
    expect(report.verdict.exit).toBe(2)
    expect(report.verdict.hard).toEqual([])
    expect(report.verdict.soft).toEqual([
      // The floor gate. Every one of the fixture's three bars delivers 140 ms
      // against a 150 ms floor, so 100% breach — soft, not hard, because none
      // of them reached the punch.
      '3/3 bars (100%) delivered under the 150 ms breath floor — min 140 ms',
      '1 lead-in(s) ended past endBy (median 125 ms)',
    ])
  })

  it('gates the floor on the constant, and never-late separately from comfort', () => {
    // Two gates, different severities, and the fixture proves they are not
    // the same test: 140 ms of delivered breath is under the 150 ms comfort
    // floor (soft) but nowhere near the punch (hard, and clean here).
    expect(report.breath.floor).toMatchObject({
      floorMs: 150,
      source: 'callPlacement.ts MIN_BREATH_MS',
      n: 3,
      barsAtOrPastPunch: 0,
      barsUnderFloor: 3,
      barsUnderFloorRatio: 1,
      minBreathMs: 140,
    })
    expect(report.verdict.hard).toEqual([])
    // The floor is read from the app's own constants, never a literal here.
    // With it unreadable the block must gate NOTHING rather than fall back to
    // a number this tool invented — a capture scored against a floor the app
    // does not use is worse than no floor at all.
    const noFloor = analyze(capture(), { ...CONSTANTS, breath: { ...CONSTANTS.breath, MIN_BREATH_MS: null } })
    expect(noFloor.breath.floor.floorMs).toBeNull()
    expect(noFloor.breath.floor.barsUnderFloor).toBe(0)
    expect(noFloor.verdict.soft.filter((s) => s.includes('breath floor'))).toEqual([])
    // ...but never-late still gates: it needs no constant to be true.
    expect(noFloor.breath.floor.barsAtOrPastPunch).toBe(0)
  })

  it('is HARD when a call was still sounding at the punch', () => {
    // Never-late is the one guarantee with no tolerance. `shortfallMs: 250`
    // eats the fixture's whole 250 ms intended breath, putting the audible
    // end on the first punch — delivered breath ≤ 0 on all six bars of both
    // slots this variant carries.
    const late = analyze(capture({ shortfallMs: 250 }), CONSTANTS)
    expect(late.breath.floor.n).toBe(6)
    expect(late.breath.floor.barsAtOrPastPunch).toBe(6)
    expect(late.breath.floor.minBreathMs).toBeLessThanOrEqual(0)
    expect(late.verdict.hard.some((h) => h.includes('still sounding at the punch'))).toBe(true)
    expect(late.verdict.exit).toBe(1)
    // and the tightest bars are named, so the next question is answerable
    // without re-reading the logcat
    expect(late.breath.floor.worstBars).toHaveLength(5)
    // `path` earns its place in this row: the tightest bar here is the
    // cold-start `fresh` play, not one of the armed ones. That is the first
    // thing to know about a floor breach and it is right in the table.
    expect(late.breath.floor.worstBars[0]).toMatchObject({ vocabulary: 'numbers', intendedBreathMs: 250, path: 'fresh' })
    // sorted tightest-first, so the worst bar is the one to look at
    expect(late.breath.floor.worstBars[0].deliveredBreathMs).toBe(late.breath.floor.minBreathMs)
  })

  it('scores breath against the AUDIBLE end and the logged intent, not the end event', () => {
    // The fixture's observation ends 1050 ms after onset while the clip is
    // 1000 ms long — 50 ms of end-event lag, which must NOT count against
    // the breath. Delivered = firstNode − (onset + stated duration) = 235;
    // intended = the logged `breathMs` of 250; shortfall = 15.
    const slot = report.breath.bySlot['call/1-2']
    expect(slot).toMatchObject({ n: 3, vocabulary: 'numbers', plannedBreathMs: 250, medianBreathMs: 140, medianEndLateMs: 110 })
    expect(report.breath.byVocab.numbers).toMatchObject({ n: 3, medianBreathMs: 140, medianEndLateMs: 110 })
    // The lag is reported on its own, in the cross-check block.
    expect(report.breath.skewCrossCheck.residualByPath.armed.medianMs).toBe(-60)
  })

  it('reports the skew cross-check in BOTH domains, raw exactly one skew above residual', () => {
    // This is the tool's own corroboration of OBSERVER_ONSET_SKEW_MS, so it
    // has to be legible without the reader recomputing anything. `raw` is the
    // end-event lag this tool used to publish as "reporting lag": the armed
    // calls' end event lands 1050 ms after the RAW onset on a 1000 ms clip,
    // so raw = +35. Corrected, the same event lands 60 ms EARLY, so the
    // residual is −60 and the pair differs by exactly the applied 95.
    const xc = report.breath.skewCrossCheck
    expect(xc.appliedSkewMs).toBe(OBSERVER_ONSET_SKEW_MS)
    expect(xc.rawByPath.armed.medianMs).toBe(35)
    expect(xc.residualByPath.armed.medianMs).toBe(-60)
    expect(xc.rawByPath.armed.medianMs - xc.residualByPath.armed.medianMs).toBe(OBSERVER_ONSET_SKEW_MS)
    // The fixture is small enough (n < SKEW_CROSS_CHECK_MIN_SAMPLES) that the
    // −60 must NOT raise the staleness warning — one slow teardown in a
    // handful of plays is noise, and warning on it would train the reader to
    // ignore the line that matters.
    expect(report.verdict.soft.filter((s) => s.startsWith('skew cross-check'))).toEqual([])
  })

  it('measures a lead-in sound-to-sound so the skew cancels', () => {
    // `endMinusEndByMs` compares a corrected audible end against a PLANNED
    // work-axis time, so the full 95 ms correction sits inside it — the
    // fixture's lead-in reads 125 ms over budget where it read 30 before,
    // with nothing about the lead-in having changed.
    //
    // The gap to the section's first call is observed on BOTH ends, so the
    // correction cancels and the number survives any future re-calibration.
    // The fixture's lead-in ends audibly at 30030 + 95 + 8000 = 38125 and the
    // next call sounds at 60040 + 95 — far past the pairing window, so this
    // capture has no pair and the metric says so rather than reporting a
    // 22-second "gap" as a placement finding.
    expect(report.leadIns.medianEndMinusEndByMs).toBe(125)
    expect(report.leadIns.gapToFirstCall).toMatchObject({ n: 0, medianMs: null, overlapping: 0 })
  })

  it('measures lead-ins against endBy, on the audible end', () => {
    // onset 30030 + 8000 stated = 38030 audible end, against an endBy of
    // 38000 → 30 ms over. The end EVENT at 38200 would have said 200.
    expect(report.leadIns).toMatchObject({ n: 1, medianEndMinusEndByMs: 125, walkedOver: 1 })
  })

  it('measures the combo announce against the block’s first ring, on the audible end', () => {
    // onset 60040 + 900 stated = 60940 audible end, first ring 61200 → 260.
    // The end EVENT at 61000 would have said 200 — the announce rail was the
    // last join still scoring reporting lag as the coach overrunning.
    expect(report.announces).toMatchObject({ n: 1, withRing: 1, medianEndToRingMs: 165, cutByRing: 0 })
  })

  it('measures the ceremonies around each work-entered boundary', () => {
    // The bells are `instruction` plays, so their latency against the round
    // boundary — a CLOCK event — is corrected: raw 20 and 50 become 115/145.
    expect(report.ceremonies.rounds).toEqual([
      expect.objectContaining({ roundIndex: 0, bellOnsetLatencyMs: 115, warnEndToBellMs: null, recoveryEndToWarnOnsetMs: null }),
      expect.objectContaining({ roundIndex: 1, bellOnsetLatencyMs: 145, warnEndToBellMs: 150, warnHeldOpenPastAudioMs: 0, recoveryEndToWarnOnsetMs: 30000 }),
    ])
    expect(report.ceremonies.bells).toMatchObject({ n: 2 })
  })

  it('never subtracts a corrected time from a raw one', () => {
    // The trap this pins. The bell is a PLAYER (corrected); the round warning
    // is a `createAudioPlaylist` ceremony the ruler never measured (raw). Had
    // `warnEndToBellMs` used the corrected bell onset it would have read 245
    // — the countdown apparently finishing a quarter-second early — and the
    // whole of that 95 would have been the correction showing up as a finding
    // in a comparison where it cancels. Both operands raw, the gap is 150.
    const round1 = report.ceremonies.rounds[1]
    expect(round1.warnEndToBellMs).toBe(150)
    expect(round1.warnEndToBellDomain).toBe('raw (playlist uncalibrated)')
    // The two views of the same bell must therefore DIFFER by exactly the
    // skew — that difference is the boundary, and it is deliberate.
    expect(round1.bellOnsetLatencyMs - 50).toBe(OBSERVER_ONSET_SKEW_MS)
    expect(report.ceremonies.domain).toMatchObject({ bells: 'corrected', metronome: 'raw (playlist uncalibrated)' })
  })

  it('reports rings against their own schedule and the instrument tap', () => {
    expect(report.rings).toMatchObject({ n: 5, maxLateMs: 10 })
    expect(report.instrument).toMatchObject({ n: 2, maskedRatio: 0.5 })
    expect(report.instrument.latency.medianMs).toBe(1.1)
    expect(report.observer).toEqual({ watched: 9, openAtRelease: 0, maxHandlerMs: 0.4 })
  })

  it('splits onset latency by path', () => {
    const click = report.families['click-script']
    expect(click.plays).toBe(4)
    expect(click.byPath.fresh.n).toBe(1)
    expect(click.byPath.armed.n).toBe(3)
  })
})

describe('proposals', () => {
  const report = analyze(capture(), CONSTANTS)
  const by = (name) => report.proposals.find((p) => p.constant === name)

  it('flags the rail constant as inert and measures the announce stand-in', () => {
    expect(by('RAIL_K_MS')).toMatchObject({ current: 120, status: 'inert', measured: { announceEndToRingMedianMs: 165 } })
  })
  it('refuses to write a per-slot override from a single slot', () => {
    // The fixture's shortfall is 110 ms, well past the 40 ms floor, and it
    // has exactly one qualifying slot. `uniform` needs two slots to compare,
    // so this capture can never take the global-shift branch — and used to
    // fall through to per-slot overrides with `apply: true`. One witness
    // cannot tell "this slot is unusual" from "the dispatch path is slow",
    // and only the first has a per-slot fix.
    expect(by("CALL_BREATH_OVERRIDES['call/1-2']")).toMatchObject({
      apply: false,
      status: 'insufficient slots',
      proposed: 'none',
    })
  })

  it('never proposes growing the breath by the observer skew', () => {
    // The trap this closes, with the numbers that sprang it. On the real
    // quick-six-count capture the five slots came back 79.8-131.3 ms short.
    // That is a 51.5 ms spread — 1.5 ms wider than GLOBAL_SHIFT_BAND_MS — so
    // `uniform` was false and the tool emitted five `apply: yes` per-slot
    // CALL_BREATH_OVERRIDES plus DENSE_BREATH_MS 600 → 687, writing the audio
    // path into the breath doctrine on every one of them.
    //
    // Delivered breath is measured from the CORRECTED onset, so every bar
    // carries the ~95 ms skew whether or not anything is mistuned. Net of it
    // those shortfalls are −15 to +36, all inside the noise band.
    //
    // The fixture's single slot is 110 ms short, 15 ms net — under the 40 ms
    // floor, so no override is proposed at all, and no DENSE_BREATH_MS
    // proposal either.
    expect(by("CALL_BREATH_OVERRIDES['call/1-2']")).toMatchObject({ status: 'insufficient slots', apply: false })
    expect(by('DENSE_BREATH_MS.numbers')).toBeUndefined()
    expect(report.notes.some((n) => n.includes('net of the 95 ms observer skew'))).toBe(true)
  })

  it('holds the lead-in pad rather than paying for the audio path twice', () => {
    // The other trap. `end − endBy` got 95 ms worse the day the ruler was
    // corrected, and the pad proposal used to grow on exactly that basis —
    // here it reads 125 ms over budget with nothing about the lead-ins having
    // changed. Sound to sound they are fine: 300 ms of air before the call.
    const three = analyze(capture({ extraLeadIns: true }), CONSTANTS)
    const pad = three.proposals.find((p) => p.constant === 'LEAD_IN_PAD_MS')
    expect(three.leadIns.n).toBe(3)
    expect(three.leadIns.medianEndMinusEndByMs).toBe(125)
    expect(three.leadIns.gapToFirstCall).toMatchObject({ n: 1, medianMs: 300, minMs: 300, overlapping: 0 })
    expect(pad).toMatchObject({ current: 250, proposed: 250, apply: false, status: 'held (skew-contaminated basis)' })
    expect(pad.basis).toContain('carries the full 95 ms skew')
  })

  it('DOES move the pad when a lead-in genuinely runs into its call', () => {
    // The gate must still fire on the thing it exists for. Stretching the
    // paired lead-in by 500 ms puts its audio 200 ms INTO the call — an
    // overlap measured sound-to-sound, where the skew cancels and the finding
    // is real however the ruler is calibrated.
    const over = analyze(capture({ extraLeadIns: true, leadInStretchMs: 500 }), CONSTANTS)
    expect(over.leadIns.gapToFirstCall).toMatchObject({ n: 1, minMs: -200, overlapping: 1 })
    const pad = over.proposals.find((p) => p.constant === 'LEAD_IN_PAD_MS')
    expect(pad).toMatchObject({ current: 250, proposed: 450, apply: true })
    expect(pad.basis).toContain('ran INTO')
  })

  it('blames the dispatch path, not the breath doctrine, when every slot loses the same time', () => {
    const uniform = analyze(capture({ shortfallMs: 120 }), CONSTANTS)
    const lag = uniform.proposals.find((p) => p.constant === 'CALL_DISPATCH_LAG_MS')
    expect(lag).toMatchObject({ current: 71, apply: true })
    expect(lag.proposed).toBeGreaterThan(71)
    expect(lag.basis).toMatch(/dispatch path, not the breath doctrine/)
    // The breath doctrine is held, and per-slot overrides are superseded.
    expect(uniform.proposals.find((p) => p.constant === 'DENSE_BREATH_MS')).toMatchObject({ status: 'held' })
    expect(uniform.proposals.find((p) => p.constant === 'CALL_BREATH_OVERRIDES')).toMatchObject({ status: 'superseded' })
    expect(uniform.proposals.some((p) => p.constant.startsWith("CALL_BREATH_OVERRIDES['"))).toBe(false)
  })
  it('does not propose a lead-in pad from fewer than three lead-ins, and says so when uncalibrated', () => {
    expect(by('LEAD_IN_PAD_MS')).toBeUndefined()
    expect(report.notes.some((n) => n.startsWith('uncalibrated'))).toBe(true)
  })
})

describe('verdicts', () => {
  it('a play cut short is hard', () => {
    const report = analyze(capture({ truncateCall: true }), CONSTANTS)
    expect(report.verdict.exit).toBe(1)
    expect(report.verdict.hard[0]).toMatch(/cut short/)
    expect(report.families['click-script'].truncated).toEqual([expect.objectContaining({ playId: 'p-call-2', expectedMs: 1000, observedMs: 585 })])
  })
  it('a missing observation breaks coverage — hard', () => {
    const report = analyze(capture({ dropObservation: true }), CONSTANTS)
    expect(report.coverage).toMatchObject({ playsWithId: 7, observed: 6 })
    expect(report.verdict.exit).toBe(1)
    expect(report.verdict.hard[0]).toMatch(/coverage/)
    expect(report.coverage.unobserved).toEqual([{ playId: 'p-call-1', kind: 'click-script', label: 'call/1-2' }])
  })
  it('a capture without observer records is soft, never a crash', () => {
    const report = analyze(rec('10:00:00.000', 'puncheokie.voice.play', { asset: 'a', kind: 'clip' }), CONSTANTS)
    expect(report.present).toBe(false)
    expect(report.verdict.exit).toBe(2)
    expect(report.verdict.soft[0]).toMatch(/no observer records/)
  })
  it('a rail constant that drifted between its two copies is soft', () => {
    const report = analyze(capture(), { ...CONSTANTS, rail: { RAIL_K_MS: 120, RAIL_K_MS_spine: 90 } })
    expect(report.verdict.soft).toContainEqual(expect.stringMatching(/RAIL_K_MS differs between RhythmMap \(120\) and RhythmSpine \(90\)/))
  })
})

describe('report', () => {
  it('renders every section', () => {
    const md = renderReport(analyze(capture(), CONSTANTS), 'fixture')
    for (const heading of ['## Onset latency by family', '## Work axis fit', '## Breath (3 calls)', '### Floor — never late', '### Skew cross-check', '## Ceremonies', '## Proposals']) expect(md).toContain(heading)
    // slot | n | vocab | intended | min | low tail | median | p95 | shortfall.
    // The low tail is labelled `min (n=3, …)` in the cell itself: with three
    // samples `percentile(v, 5)` IS the minimum, and printing a bare "140"
    // under a p5 heading would dress one bar as a distribution.
    expect(md).toContain('| call/1-2 | 3 | numbers | 250 | 140 | 140 (min (n=3, too few for a p5)) | 140 | 140 | 110 |')
    expect(md).toContain('floor 150 ms · **at or past the punch: 0** · under floor 3/3 (100%)')
    expect(md).toContain('build: release · sha abc1234')
  })
})
