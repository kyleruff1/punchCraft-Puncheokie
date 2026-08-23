/**
 * Settled matches → `cue_results` rows (M33-08).
 *
 * The rule under test is the one that is easy to get wrong and impossible
 * to notice afterwards: **a row per expectation, including the ones nothing
 * answered.** Drop the unanswered rows and a workout where the athlete
 * threw four of eight punches becomes indistinguishable, in the database,
 * from one where only four were ever asked of them.
 */
import { toCueResultRows } from '../cueResultRows'
import type { CueMatchResult } from '@domain/programs/CueMatcher'
import type { CueInstance } from '@domain/programs/CueTimeline'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'

function event(id: string, over: Partial<TrackerPunchEvent> = {}): TrackerPunchEvent {
  return {
    id,
    sourceFrameId: `f-${id}`,
    deviceId: 'DEV',
    hand: 'left',
    receivedMonotonicTimeMs: 1_000,
    receivedWallTimeIso: new Date(0).toISOString(),
    velocityRaw: 42,
    velocityUnit: 'tracker-unit',
    recovered: false,
    decoderId: 'fightcamp-v1',
    decoderVersion: '2.1.0',
    qualityFlags: [],
    ...over,
  }
}

/** Fully typed rather than cast, so a change to `CueInstance` fails here. */
function cue(over: Partial<CueInstance> = {}): CueInstance {
  return {
    id: 'cue-1',
    blockId: 'block-1',
    repeatIndex: 0,
    scoring: 'sequence',
    tokens: [
      { kind: 'punch', number: 1, body: false, beatOffset: 0 },
      { kind: 'punch', number: 2, body: false, beatOffset: 1 },
    ],
    tokenOffsetsMs: [0, 400],
    expectedPunches: [
      { tokenIndex: 0, hand: 'left' },
      { tokenIndex: 1, hand: 'right' },
    ],
    displayOnlyTokenIndexes: [],
    previewAt: -1_500,
    announceAt: -750,
    scheduledStartMs: 1_000,
    scheduledEndMs: 1_400,
    windowStartMs: 800,
    windowEndMs: 1_700,
    ...over,
  }
}

function result(over: Partial<CueMatchResult> = {}): CueMatchResult {
  return {
    cueId: 'cue-1',
    capabilityTier: 'hand-timestamp',
    decoderVersions: ['2.1.0'],
    assignments: [],
    missedExpectedIndexes: [],
    extras: [],
    ...over,
  }
}

function assigned(
  expectedIndex: number,
  eventId: string,
  offsetMs: number,
): CueMatchResult['assignments'] {
  return [{ expectedIndex, eventId, outcome: 'matched', offsetMs }]
}

// ---------------------------------------------------------------------------

describe('every expectation produces a row', () => {
  it('writes a row for a punch nobody threw', () => {
    const rows = toCueResultRows({ cue: cue(), result: result() })

    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.outcome)).toEqual(['missed', 'missed'])
    // The token index is what makes the row placeable in the combination.
    expect(rows.map((r) => r.tokenIndex)).toEqual([0, 1])
  })

  it('keeps the expected hand on a missed row', () => {
    // Without this, a missed row could not say which glove was called for,
    // and the left/right split would silently only count what landed.
    const rows = toCueResultRows({ cue: cue(), result: result() })
    expect(rows.map((r) => r.expectedHand)).toEqual(['left', 'right'])
  })

  it('carries the outcome and offset of a match', () => {
    const rows = toCueResultRows({
      cue: cue(),
      result: result({ assignments: assigned(0, 'e1', -35), missedExpectedIndexes: [1] }),
      events: [event('e1')],
    })

    expect(rows[0]).toMatchObject({ outcome: 'matched', offsetMs: -35, observedEventId: 'e1' })
    expect(rows[1]).toMatchObject({ outcome: 'missed', offsetMs: null, observedEventId: null })
  })
})

describe('what the hardware cannot say is left null (D11, D12)', () => {
  it('never writes an expected type', () => {
    // The type byte is not device-portable (H12), so a stored expectation
    // would be a claim the tracker could never be checked against.
    const rows = toCueResultRows({ cue: cue(), result: result() })
    expect(rows.every((r) => r.expectedType === null)).toBe(true)
  })

  it('leaves velocity null when no event answered', () => {
    // Absent, not zero — a zero would read as a punch thrown with no speed.
    const rows = toCueResultRows({ cue: cue(), result: result() })
    expect(rows[0]?.velocityRaw).toBeNull()
    expect(rows[0]?.velocityUnit).toBeNull()
  })

  it('passes velocity through exactly as received (spec §4.3)', () => {
    const rows = toCueResultRows({
      cue: cue(),
      result: result({ assignments: assigned(0, 'e1', 0), missedExpectedIndexes: [1] }),
      events: [event('e1', { velocityRaw: 77, velocityCalibrated: 88 })],
    })
    expect(rows[0]).toMatchObject({
      velocityRaw: 77,
      velocityCalibrated: 88,
      velocityUnit: 'tracker-unit',
    })
  })
})

describe('event lookup is by id, not by position', () => {
  it('finds its event inside a window holding other cues punches too', () => {
    // The runner hands over a bounded recent window rather than exactly this
    // cue's events; attribution has to come from the match.
    const rows = toCueResultRows({
      cue: cue(),
      result: result({ assignments: assigned(1, 'e9', 5), missedExpectedIndexes: [0] }),
      events: [event('e7', { velocityRaw: 1 }), event('e9', { velocityRaw: 99 }), event('e8')],
    })
    expect(rows[1]?.velocityRaw).toBe(99)
  })

  it('still writes the row when the event has fallen out of the window', () => {
    // The match is the record; the velocity is a nicety. Losing the second
    // must not lose the first.
    const rows = toCueResultRows({
      cue: cue(),
      result: result({ assignments: assigned(0, 'gone', 5), missedExpectedIndexes: [1] }),
      events: [],
    })
    expect(rows[0]).toMatchObject({ outcome: 'matched', observedEventId: 'gone', velocityRaw: null })
  })
})

describe('a count-scored burst', () => {
  it('produces no rows at all (doc §14)', () => {
    // A burst asks for volume, not a named sequence. Rows here would invent
    // expectations the athlete was never given.
    const rows = toCueResultRows({
      cue: cue({
        scoring: 'count',
        countScored: { targetPunches: 8, countdownMs: 3_000 },
      }),
      result: result(),
    })
    expect(rows).toEqual([])
  })
})
