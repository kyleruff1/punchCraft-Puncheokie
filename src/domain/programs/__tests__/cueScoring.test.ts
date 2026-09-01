// ENGINE-BEHAVIOR SUITE — pinned to the FROZEN pre-click-track samples
// (samples/__fixtures__), NOT the live library. The live sets were
// rewritten to the 4-slot click-track format (MVP v2, GH #305) and no
// longer exercise bursts / count scoring / defense-counters; these
// assertions encode engine semantics those shapes exist to test.
/**
 * Cue scoring (#131).
 *
 * Two rules carry the weight here and both are about honesty rather than
 * arithmetic: the label may never claim technique accuracy at a tier that
 * cannot verify it (D4), and a dimension the tier cannot supply is omitted
 * with an explanation rather than scored zero (D11).
 */
import { CueMatcher } from '../CueMatcher'
import { TIMING_TIGHT_MS, scoreCue, scoreRound } from '../cueScoring'
import { expandTimeline, type CueInstance } from '../CueTimeline'
import { CADENCE_PROFILES } from '../../workout/cadence'
import { legacyThreeRoundFundamentals as threeRoundFundamentals } from '../../workout/samples/__fixtures__'
import { CALCULATION_VERSION } from '../../workout/versions'
import type { CapabilityTier } from '../../workout/capabilityTier'
import type { TrackerPunchEvent } from '../../punch/PunchEvent'

const STEADY_BPM = CADENCE_PROFILES.steady.nominalBpm
const CUE: CueInstance = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)[0]!
  .cues[1]!

let nextId = 0

function event(over: Partial<TrackerPunchEvent> = {}): TrackerPunchEvent {
  nextId += 1
  return {
    id: `e${nextId}`,
    sourceFrameId: `f${nextId}`,
    deviceId: 'D7:34',
    hand: 'left',
    receivedMonotonicTimeMs: CUE.scheduledStartMs,
    receivedWallTimeIso: '2026-08-23T00:00:00.000Z',
    recovered: false,
    decoderId: 'fightcamp-v1',
    decoderVersion: '1',
    velocityUnit: 'tracker-unit',
    velocityRaw: 10,
    qualityFlags: [],
    ...over,
  }
}

function onToken(n: number, over: Partial<TrackerPunchEvent> = {}): TrackerPunchEvent {
  const expected = CUE.expectedPunches[n]!
  return event({
    hand: expected.hand,
    receivedMonotonicTimeMs: CUE.scheduledStartMs + (CUE.tokenOffsetsMs[expected.tokenIndex] ?? 0),
    ...over,
  })
}

function score(
  events: TrackerPunchEvent[],
  tier: CapabilityTier = 'hand-timestamp',
  options: Parameters<typeof scoreCue>[2] = {},
) {
  const result = new CueMatcher(tier).match(CUE, events)
  return scoreCue(result, tier, options)
}

beforeEach(() => {
  nextId = 0
})

// ---------------------------------------------------------------------------

describe('the label rule (D4, spec §13.3)', () => {
  it.each([
    ['hand-only', 'hand-sequence match'],
    ['hand-timestamp', 'hand-sequence match'],
    ['hand-broad-type', 'hand-sequence match'],
    ['hand-distinct-type', 'technique match'],
  ] as const)('labels a %s score as %s', (tier, expected) => {
    expect(score([onToken(0)], tier).label).toBe(expected)
  })

  it('says hand-sequence match at the tier this hardware actually reaches', () => {
    expect(score([onToken(0), onToken(1)], 'hand-timestamp').label).toBe('hand-sequence match')
  })
})

describe('completion and correct hand', () => {
  it('scores a clean two-punch cue at 100%', () => {
    const result = score([onToken(0), onToken(1)])
    expect(result.completionPct).toBe(100)
    expect(result.correctHandPct).toBe(100)
    expect(result.expectedCount).toBe(2)
  })

  it('scores a half-completed cue at 50%', () => {
    const result = score([onToken(0)])
    expect(result.completionPct).toBe(50)
  })

  it('counts a wrong-hand punch against hand accuracy, and completes nothing', () => {
    // Something landed, so the athlete responded; it was the wrong glove.
    // Those are still different facts and the score still keeps them apart —
    // but since D18 a wrong hand no longer fills the expectation, so nothing
    // completed. Hand accuracy is measured among the punches that answered an
    // expectation, so one wrong glove and nothing else is 0%.
    const wrong = event({ hand: 'right', receivedMonotonicTimeMs: CUE.scheduledStartMs })
    const result = score([wrong])
    expect(result.completionPct).toBe(0)
    expect(result.correctHandPct).toBe(0)
  })

  it('scores hand accuracy against attempts, not against what was called', () => {
    // A set half-thrown, correctly: 100% of what was attempted used the right
    // glove, while completion honestly reports that half the set went unthrown.
    const right = event({ hand: 'left', receivedMonotonicTimeMs: CUE.scheduledStartMs })
    const result = score([right])
    expect(result.completionPct).toBe(50)
    expect(result.correctHandPct).toBe(100)
  })

  it('scores an empty cue at zero without dividing by zero', () => {
    const result = score([])
    expect(result.completionPct).toBe(0)
    expect(result.correctHandPct).toBe(0)
    expect(result.timingWindowPct).toBe(0)
  })
})

describe('timing', () => {
  it('counts a punch on the token as on time', () => {
    expect(score([onToken(0)]).timingWindowPct).toBe(100)
  })

  it('counts a punch outside the tight band as late', () => {
    const late = onToken(0, {
      receivedMonotonicTimeMs: CUE.scheduledStartMs + TIMING_TIGHT_MS + 20,
    })
    expect(score([late]).timingWindowPct).toBe(0)
  })

  it('measures timing against what landed, not what was called', () => {
    // An unthrown punch is a completion problem. Counting it as bad timing
    // would penalise the same miss twice.
    const result = score([onToken(0)])
    expect(result.completionPct).toBe(50)
    expect(result.timingWindowPct).toBe(100)
  })
})

describe('technique is absent, not zero, below a type-capable tier (D11)', () => {
  it('omits broad-type agreement and explains why', () => {
    const result = score([onToken(0)], 'hand-timestamp')
    expect(result.broadTypeAgreementPct).toBeUndefined()
    expect(result.broadTypeCaveat).toBeUndefined()
    expect(result.capabilityGaps.join(' ')).toContain('no usable technique')
  })

  it('never reports a zero for a dimension nothing measured', () => {
    const result = score([onToken(0)], 'hand-only')
    expect(result.broadTypeAgreementPct).not.toBe(0)
    expect(result.targetZonePct).not.toBe(0)
  })

  it('reports broad-type agreement with a caveat at a type-capable tier', () => {
    const result = score([onToken(0, { punchType: 'straight' })], 'hand-broad-type')
    expect(result.broadTypeAgreementPct).toBe(100)
    expect(result.broadTypeCaveat).toMatch(/not verified/i)
  })
})

describe('velocity is absent, not zero, when unmeasured (D11, spec §4.3)', () => {
  it('omits velocity dimensions when no events are supplied', () => {
    const result = score([onToken(0)])
    expect(result.averageVelocity).toBeUndefined()
    expect(result.targetZonePct).toBeUndefined()
    expect(result.capabilityGaps.join(' ')).toContain('no tracker-reported velocity')
  })

  it('omits them when the source reports an unknown unit', () => {
    const events = [onToken(0, { velocityUnit: 'unknown', velocityRaw: 9 })]
    const result = score(events, 'hand-timestamp', { events })
    expect(result.averageVelocity).toBeUndefined()
  })

  it('averages tracker-reported velocity when it is available', () => {
    const events = [onToken(0, { velocityRaw: 8 }), onToken(1, { velocityRaw: 12 })]
    const result = score(events, 'hand-timestamp', { events })
    expect(result.averageVelocity).toBe(10)
  })

  it('scores the target zone only when a range is requested', () => {
    const events = [onToken(0, { velocityRaw: 8 }), onToken(1, { velocityRaw: 12 })]
    const without = score(events, 'hand-timestamp', { events })
    expect(without.targetZonePct).toBeUndefined()
    expect(without.capabilityGaps.join(' ')).toContain('No target velocity zone')

    const withRange = score(events, 'hand-timestamp', {
      events,
      targetVelocityRange: { min: 10, max: 15 },
    })
    expect(withRange.targetZonePct).toBe(50)
  })

  it('never relabels velocity with a physical unit', () => {
    const events = [onToken(0, { velocityRaw: 11 })]
    const result = score(events, 'hand-timestamp', { events })
    expect(JSON.stringify(result)).not.toMatch(/m\/s|mph|newton|joule/i)
  })
})

describe('extras', () => {
  it('counts extras without letting them raise completion', () => {
    const events = [
      onToken(0),
      onToken(1),
      onToken(1, { receivedMonotonicTimeMs: CUE.scheduledStartMs + 100 }),
    ]
    const result = score(events)
    expect(result.completionPct).toBe(100)
    expect(result.extraCount).toBe(1)
  })
})

describe('recalculability (spec §13.6)', () => {
  it('stamps the tier, decoder versions and calculation version', () => {
    const result = score([onToken(0, { decoderVersion: '3' })])
    expect(result.capabilityTier).toBe('hand-timestamp')
    expect(result.decoderVersions).toEqual(['3'])
    expect(result.calculationVersion).toBe(CALCULATION_VERSION)
  })

  it('is deterministic', () => {
    const events = [onToken(0), onToken(1)]
    expect(score(events)).toEqual(score(events))
  })
})

describe('scoreRound', () => {
  it('recomputes from counts rather than averaging percentages', () => {
    // A one-punch cue must not weigh as much as a four-punch cue. Averaging
    // the two percentages would give 50%; the honest answer is 20%.
    const oneOfOne = score([onToken(0)])
    const cueScores = [
      { ...oneOfOne, completionPct: 100, expectedCount: 1 },
      { ...oneOfOne, completionPct: 0, expectedCount: 4 },
    ]
    const round = scoreRound(cueScores, 'hand-timestamp')
    expect(round.expectedCount).toBe(5)
    expect(round.completionPct).toBe(20)
  })

  it('carries the same label rule as a single cue', () => {
    expect(scoreRound([], 'hand-timestamp').label).toBe('hand-sequence match')
    expect(scoreRound([], 'hand-distinct-type').label).toBe('technique match')
  })

  it('sums extras across cues', () => {
    const base = score([onToken(0)])
    const round = scoreRound([{ ...base, extraCount: 2 }, { ...base, extraCount: 3 }], 'hand-only')
    expect(round.extraCount).toBe(5)
  })

  it('handles an empty round without dividing by zero', () => {
    const round = scoreRound([], 'hand-timestamp')
    expect(round.completionPct).toBe(0)
    expect(round.expectedCount).toBe(0)
  })
})
