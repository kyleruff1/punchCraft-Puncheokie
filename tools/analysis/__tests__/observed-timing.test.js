/**
 * The mic-free timing analyzer (GH #292, plan C5) on a synthetic capture
 * written in the real ConsoleSink shape. Every number below is chosen so
 * the join is provable by hand: the round's work axis sits at monotonic
 * +10 000, the call ends 50 ms late, the lead-in walks 200 ms past its
 * budget, the countdown ends 150 ms before the bell.
 */

import { analyze, fitWorkAxis, renderReport, roundWindows } from '../observed-timing.mjs'

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

function capture({ truncateCall = false, dropObservation = false } = {}) {
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
      rec('10:00:50.000', 'puncheokie.clickScript.dispatch', { kind: 'call', slot: 'call/1-2', traceId: `call/1-2#${at}`, dispatchAtMs: at, lateMs: 2, durationMs: 1000, endByMs: at + 1000, firstNodeMs: at + 1250, monotonicTimeMs: 10000 + at }),
      play('10:00:50.000', { asset: 'call-1-2', kind: 'click-script', label: 'call/1-2', playId: `p-call-${i}`, traceId: `call/1-2#${at}`, path: i === 0 ? 'fresh' : 'armed', vocabulary: 'numbers', dispatchMs: 10000 + at, durationMs: 1000 }),
      dropObservation && i === 1
        ? ''
        : observed('10:00:51.000', { playId: `p-call-${i}`, kind: 'click-script', label: 'call/1-2', path: i === 0 ? 'fresh' : 'armed', traceId: `call/1-2#${at}`, outcome: 'ok', dispatchMs: 10000 + at, onsetMs: 10000 + at + 15, endMs: 10000 + at + (truncateCall && i === 2 ? 600 : 1050), onsetLatencyMs: 15, observedDurationMs: truncateCall && i === 2 ? 585 : 1035, expectedDurationMs: 1000, silentByVolume: false }),
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
  ]
    .filter(Boolean)
    .join('\n')
}

const CONSTANTS = {
  rail: { RAIL_K_MS: 120, RAIL_K_MS_spine: 120 },
  breath: { DENSE_BREATH_MS: { numbers: 260, techniques: 320 }, MIN_BREATH_MS: 150, CALL_BREATH_OVERRIDES: {} },
  leads: { LEAD_IN_PAD_MS: 250, TECHNIQUE_LEADIN_LEAD_MS: 500 },
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
    expect(report.verdict.soft).toEqual(['1 lead-in(s) ended past endBy (median 200 ms)'])
  })

  it('measures breath per slot through the work-axis fit', () => {
    const slot = report.breath.bySlot['call/1-2']
    expect(slot).toMatchObject({ n: 3, vocabulary: 'numbers', plannedBreathMs: 250, medianBreathMs: 200, medianEndLateMs: 50 })
    expect(report.breath.byVocab.numbers).toMatchObject({ n: 3, medianBreathMs: 200, medianEndLateMs: 50 })
  })

  it('measures lead-ins against endBy', () => {
    expect(report.leadIns).toMatchObject({ n: 1, medianEndMinusEndByMs: 200, walkedOver: 1 })
  })

  it('measures the combo announce against the block’s first ring', () => {
    expect(report.announces).toMatchObject({ n: 1, withRing: 1, medianEndToRingMs: 200, cutByRing: 0 })
  })

  it('measures the ceremonies around each work-entered boundary', () => {
    expect(report.ceremonies.rounds).toEqual([
      expect.objectContaining({ roundIndex: 0, bellOnsetLatencyMs: 20, warnEndToBellMs: null, recoveryEndToWarnOnsetMs: null }),
      expect.objectContaining({ roundIndex: 1, bellOnsetLatencyMs: 50, warnEndToBellMs: 150, warnLengthVsPlannedMs: 0, recoveryEndToWarnOnsetMs: 30000 }),
    ])
    expect(report.ceremonies.bells).toMatchObject({ n: 2 })
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
    expect(by('RAIL_K_MS')).toMatchObject({ current: 120, status: 'inert', measured: { announceEndToRingMedianMs: 200 } })
  })
  it('proposes a per-slot breath override from the measured late end', () => {
    expect(by("CALL_BREATH_OVERRIDES['call/1-2']")).toMatchObject({ current: 'derived 250', proposed: 300, apply: true })
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
    for (const heading of ['## Onset latency by family', '## Work axis fit', '## Breath (3 calls)', '## Ceremonies', '## Proposals']) expect(md).toContain(heading)
    expect(md).toContain('| call/1-2 | 3 | numbers | 250 | 200 | 200 | 50 |')
    expect(md).toContain('build: release · sha abc1234')
  })
})
