// ENGINE-BEHAVIOR SUITE — pinned to the FROZEN pre-click-track samples
// (samples/__fixtures__), NOT the live library. The live sets were
// rewritten to the 4-slot click-track format (MVP v2, GH #305) and no
// longer exercise bursts / count scoring / defense-counters; these
// assertions encode engine semantics those shapes exist to test.
/**
 * Cue matching (#130).
 *
 * The assertions worth having are the restraint ones: that no extra is ever
 * dropped, that a window is used verbatim rather than recomputed, and that
 * no technique claim survives a tier that cannot support it.
 */
import { CueMatcher, matchedCount, type CueMatchResult } from '../CueMatcher'
import { expandTimeline, type CueInstance } from '../CueTimeline'
import { CADENCE_PROFILES } from '../../workout/cadence'
import { legacyThreeRoundFundamentals as threeRoundFundamentals } from '../../workout/samples/__fixtures__'
import type { CapabilityTier } from '../../workout/capabilityTier'
import type { PunchType, TrackerPunchEvent } from '../../punch/PunchEvent'

const STEADY_BPM = CADENCE_PROFILES.steady.nominalBpm
const TIMELINE = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)

/**
 * Round 1 block 1: the doc §4 fragment, a 1-2 (left then right).
 *
 * The *second* repeat, not the first: the first starts at t=0, where the
 * window is clamped at the bell and "early" is not representable. Timing
 * tests need a cue with room on both sides.
 */
const CUE: CueInstance = TIMELINE[0]!.cues[1]!

let nextId = 0

function event(over: Partial<TrackerPunchEvent> = {}): TrackerPunchEvent {
  nextId += 1
  return {
    id: `e${nextId}`,
    sourceFrameId: `f${nextId}`,
    deviceId: 'D7:34:B4:27:D5:84',
    hand: 'left',
    receivedMonotonicTimeMs: CUE.scheduledStartMs,
    receivedWallTimeIso: '2026-08-23T00:00:00.000Z',
    recovered: false,
    decoderId: 'fightcamp-v1',
    decoderVersion: '1',
    velocityUnit: 'tracker-unit',
    velocityRaw: 9,
    qualityFlags: [],
    ...over,
  }
}

/** A punch landing exactly on the nth expected token of the cue. */
function onToken(n: number, over: Partial<TrackerPunchEvent> = {}): TrackerPunchEvent {
  const expected = CUE.expectedPunches[n]!
  return event({
    hand: expected.hand,
    receivedMonotonicTimeMs: CUE.scheduledStartMs + (CUE.tokenOffsetsMs[expected.tokenIndex] ?? 0),
    ...over,
  })
}

const matcher = (tier: CapabilityTier = 'hand-timestamp'): CueMatcher => new CueMatcher(tier)

beforeEach(() => {
  nextId = 0
})

// ---------------------------------------------------------------------------

describe('the sample cue under test', () => {
  it('is a two-punch left-right combination', () => {
    expect(CUE.expectedPunches.map((p) => p.hand)).toEqual(['left', 'right'])
  })
})

describe('a clean run', () => {
  it('matches every expectation in order', () => {
    const result = matcher().match(CUE, [onToken(0), onToken(1)])
    expect(result.assignments.map((a) => a.expectedIndex)).toEqual([0, 1])
    expect(result.assignments.every((a) => a.outcome === 'matched')).toBe(true)
    expect(result.missedExpectedIndexes).toEqual([])
    expect(result.extras).toEqual([])
    expect(matchedCount(result)).toBe(2)
  })

  it('reports a zero offset for a punch landing on the token', () => {
    const result = matcher().match(CUE, [onToken(0)])
    expect(result.assignments[0]?.offsetMs).toBe(0)
  })

  it('signs the offset — negative early, positive late', () => {
    const early = matcher().match(CUE, [onToken(0, { receivedMonotonicTimeMs: CUE.scheduledStartMs - 100 })])
    expect(early.assignments[0]?.offsetMs).toBe(-100)

    const late = matcher().match(CUE, [onToken(0, { receivedMonotonicTimeMs: CUE.scheduledStartMs + 120 })])
    expect(late.assignments[0]?.offsetMs).toBe(120)
  })

  it('carries the cue id and tier through', () => {
    const result = matcher('hand-timestamp').match(CUE, [onToken(0)])
    expect(result.cueId).toBe(CUE.id)
    expect(result.capabilityTier).toBe('hand-timestamp')
  })

  it('collects every contributing decoder version', () => {
    const result = matcher().match(CUE, [
      onToken(0, { decoderVersion: '2' }),
      onToken(1, { decoderVersion: '1' }),
    ])
    expect(result.decoderVersions).toEqual(['1', '2'])
  })
})

describe('windows are used verbatim (spec §18.2)', () => {
  it('accepts a punch at the very edges of the window', () => {
    const atStart = event({ receivedMonotonicTimeMs: CUE.windowStartMs })
    const atEnd = event({ hand: 'right', receivedMonotonicTimeMs: CUE.windowEndMs })
    const result = matcher().match(CUE, [atStart, atEnd])
    expect(result.assignments).toHaveLength(2)
    expect(result.extras).toEqual([])
  })

  it('rejects a punch one millisecond outside either edge', () => {
    const before = event({ receivedMonotonicTimeMs: CUE.windowStartMs - 1 })
    const after = event({ hand: 'right', receivedMonotonicTimeMs: CUE.windowEndMs + 1 })
    const result = matcher().match(CUE, [before, after])
    expect(result.assignments).toEqual([])
    expect(result.extras.map((e) => e.eventId)).toEqual([before.id, after.id])
  })

  it('applies no grace of its own — a wider window is the timeline\'s job', () => {
    // Rebuilding with a huge grace should change what matches; the matcher
    // itself must contribute nothing.
    const wide = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM, {
      graceBeforeMs: 5_000,
      graceAfterMs: 5_000,
    })[0]!.cues[1]!
    const early = event({ receivedMonotonicTimeMs: CUE.windowStartMs - 1 })

    expect(matcher().match(CUE, [early]).assignments).toEqual([])
    expect(matcher().match(wide, [early]).assignments).toHaveLength(1)
  })
})

describe('one event fills at most one slot', () => {
  it('never assigns the same event twice', () => {
    const result = matcher().match(CUE, [onToken(0), onToken(1)])
    const ids = result.assignments.map((a) => a.eventId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never fills the same slot twice', () => {
    const result = matcher().match(CUE, [onToken(0), onToken(0), onToken(0)])
    const slots = result.assignments.map((a) => a.expectedIndex)
    expect(new Set(slots).size).toBe(slots.length)
  })

  it('matches in event-time order regardless of array order', () => {
    const first = onToken(0)
    const second = onToken(1)
    const result = matcher().match(CUE, [second, first])
    expect(result.assignments[0]?.eventId).toBe(first.id)
    expect(result.assignments[1]?.eventId).toBe(second.id)
  })
})

describe('extras are never dropped (doc §21, spec §13.6)', () => {
  it('surfaces a punch thrown after every slot is filled', () => {
    // Three punches, two slots. Slots fill in event-time order, so the
    // LAST punch is the surplus one — not whichever was appended last.
    const first = onToken(0, { receivedMonotonicTimeMs: CUE.scheduledStartMs })
    const second = onToken(1, { receivedMonotonicTimeMs: CUE.scheduledStartMs + 50 })
    const third = onToken(1, { receivedMonotonicTimeMs: CUE.scheduledStartMs + 100 })
    const result = matcher().match(CUE, [first, second, third])
    expect(result.assignments).toHaveLength(2)
    expect(result.assignments.map((a) => a.eventId)).toEqual([first.id, second.id])
    expect(result.extras.map((e) => e.eventId)).toEqual([third.id])
  })

  it('surfaces a punch outside the window with its event time', () => {
    const stray = event({ receivedMonotonicTimeMs: CUE.windowEndMs + 500 })
    const result = matcher().match(CUE, [stray])
    expect(result.extras).toEqual([{ eventId: stray.id, eventTimeMs: CUE.windowEndMs + 500 }])
  })

  it('accounts for every event exactly once, as an assignment or an extra', () => {
    // Nothing may vanish: a punch the athlete threw happened.
    const events = [
      onToken(0),
      onToken(1),
      event({ receivedMonotonicTimeMs: CUE.windowEndMs + 10 }),
      event({ hand: 'right', receivedMonotonicTimeMs: CUE.scheduledStartMs + 20 }),
      event({ receivedMonotonicTimeMs: CUE.windowStartMs - 10 }),
    ]
    const result = matcher().match(CUE, events)
    const accounted = [
      ...result.assignments.map((a) => a.eventId),
      ...result.extras.map((e) => e.eventId),
    ]
    expect(accounted.sort()).toEqual(events.map((e) => e.id).sort())
  })
})

describe('hand mismatch is not type mismatch (doc §6)', () => {
  it('records a wrong glove as an extra carrying its reason, never discarded', () => {
    // The first expectation is a left jab; a right punch answers it with the
    // wrong glove. Since D18 that does not fill the slot — but the punch is
    // still reported, with the reason, so it stays distinguishable from a
    // punch that simply had no slot left.
    const wrong = event({ hand: 'right', receivedMonotonicTimeMs: CUE.scheduledStartMs })
    const result = matcher().match(CUE, [wrong])
    expect(result.assignments).toEqual([])
    expect(result.extras).toHaveLength(1)
    expect(result.extras[0]?.reason).toBe('hand-mismatch')
  })

  it('leaves the ordinal open, so the correct hand can still answer it', () => {
    // The whole point of D18: a hand error is recoverable. The right hand
    // arriving next fills expectation 0, not expectation 1.
    const wrong = event({ hand: 'right', receivedMonotonicTimeMs: CUE.scheduledStartMs })
    const result = matcher().match(CUE, [wrong, onToken(0)])
    expect(result.assignments.map((a) => a.expectedIndex)).toEqual([0])
    expect(result.assignments[0]?.outcome).toBe('matched')
  })

  it('treats an unknown hand as a mismatch, never as a match', () => {
    const unknown = event({ hand: 'unknown', receivedMonotonicTimeMs: CUE.scheduledStartMs })
    const result = matcher().match(CUE, [unknown])
    expect(result.assignments).toEqual([])
    expect(result.extras[0]?.reason).toBe('hand-mismatch')
  })
})

describe('technique claims are gated by the tier (D12)', () => {
  const withType = (type: PunchType): TrackerPunchEvent =>
    onToken(0, { punchType: type })

  it.each(['hand-only', 'hand-timestamp'] as const)(
    'never reports type-mismatch at the %s tier',
    (tier) => {
      // Even if a decoder somehow reported a contradicting technique, a tier
      // that cannot verify technique may not claim a technique error.
      const result = matcher(tier).match(CUE, [withType('hook')])
      expect(result.assignments[0]?.outcome).toBe('matched')
    },
  )

  it('reports type-mismatch at a type-capable tier when the family disagrees', () => {
    // The first expectation is a jab, so its implied family is 'straight'.
    const result = matcher('hand-broad-type').match(CUE, [withType('hook')])
    expect(result.assignments[0]?.outcome).toBe('type-mismatch')
  })

  it('matches at a type-capable tier when the family agrees', () => {
    expect(
      matcher('hand-broad-type').match(CUE, [withType('straight')]).assignments[0]?.outcome,
    ).toBe('matched')
  })

  it('treats an unreported or unknown technique as no disagreement', () => {
    // FightCamp v1 decodes every type byte to 'unknown' (H12), so this is
    // the real-hardware path even at a type-capable tier.
    expect(
      matcher('hand-broad-type').match(CUE, [withType('unknown')]).assignments[0]?.outcome,
    ).toBe('matched')
    expect(matcher('hand-broad-type').match(CUE, [onToken(0)]).assignments[0]?.outcome).toBe(
      'matched',
    )
  })

  it('never contradicts a prescription with the vendor power flag', () => {
    // 'power' is a vendor classification, not a technique family.
    expect(
      matcher('hand-broad-type').match(CUE, [withType('power')]).assignments[0]?.outcome,
    ).toBe('matched')
  })

  it('prefers hand-mismatch over type-mismatch when both are wrong', () => {
    // A hand error outranks a technique error, so the punch leaves the ordinal
    // open (D18) rather than filling it with a type-mismatch assignment.
    const wrong = onToken(0, { hand: 'right', punchType: 'hook' })
    const result = matcher('hand-broad-type').match(CUE, [wrong])
    expect(result.assignments).toEqual([])
    expect(result.extras[0]?.reason).toBe('hand-mismatch')
  })
})

describe('recovered events (H12, doc §6)', () => {
  it('is assignable when its tracker timestamp orders reliably', () => {
    // Delivered long after the fact, but the tracker says when it happened.
    const recovered = event({
      recovered: true,
      trackerTimestampMs: CUE.scheduledStartMs,
      receivedMonotonicTimeMs: CUE.windowEndMs + 60_000,
    })
    const result = matcher().match(CUE, [recovered])
    expect(result.assignments[0]?.outcome).toBe('matched')
    expect(result.assignments[0]?.offsetMs).toBe(0)
  })

  it('becomes an extra when it carries no usable timestamp', () => {
    // Without a tracker timestamp there is nothing to order it by, and
    // guessing from arrival time would place it wherever the radio happened
    // to deliver it.
    const recovered = event({
      recovered: true,
      receivedMonotonicTimeMs: CUE.scheduledStartMs,
    })
    const result = matcher().match(CUE, [recovered])
    expect(result.assignments).toEqual([])
    expect(result.extras.map((e) => e.eventId)).toEqual([recovered.id])
  })

  it('is ordered by its tracker timestamp, not its arrival', () => {
    const late = event({
      hand: 'right',
      recovered: true,
      trackerTimestampMs: CUE.scheduledStartMs + 400,
      receivedMonotonicTimeMs: CUE.scheduledStartMs + 1,
    })
    const onTime = onToken(0, { receivedMonotonicTimeMs: CUE.scheduledStartMs + 5 })
    const result = matcher().match(CUE, [late, onTime])
    // The on-time left punch takes slot 0 even though the recovered event
    // arrived first.
    expect(result.assignments[0]?.eventId).toBe(onTime.id)
  })
})

describe('missed expectations', () => {
  it('lists the slots nothing filled', () => {
    const result = matcher().match(CUE, [onToken(0)])
    expect(result.missedExpectedIndexes).toEqual([1])
  })

  it('lists every slot when nothing landed', () => {
    expect(matcher().match(CUE, []).missedExpectedIndexes).toEqual([0, 1])
  })

  it('counts a hand mismatch as missed, since the expectation went unanswered', () => {
    // It used to be counted as filled. Under D18 the ordinal stays open, so an
    // unretried hand error leaves the expectation genuinely missed — which is
    // the honest reading of a punch that was never landed correctly.
    const wrong = event({ hand: 'right', receivedMonotonicTimeMs: CUE.scheduledStartMs })
    const result = matcher().match(CUE, [wrong])
    expect(result.missedExpectedIndexes).toEqual([0, 1])
    expect(matchedCount(result)).toBe(0)
  })
})

describe('determinism (spec §13.6)', () => {
  it('produces a deep-equal result for the same inputs', () => {
    const events = [onToken(0), onToken(1), event({ receivedMonotonicTimeMs: CUE.windowEndMs + 5 })]
    const a = matcher().match(CUE, events)
    const b = matcher().match(CUE, events)
    expect(b).toEqual(a)
  })

  it('does not depend on input array order', () => {
    const events = [onToken(0), onToken(1)]
    const forward = matcher().match(CUE, events)
    const reversed = matcher().match(CUE, [...events].reverse())
    expect(reversed.assignments).toEqual(forward.assignments)
  })

  it('breaks a timestamp tie deterministically', () => {
    // Two punches at the identical instant must not depend on arrival order.
    const a = event({ id: 'zzz', receivedMonotonicTimeMs: CUE.scheduledStartMs })
    const b = event({ id: 'aaa', hand: 'right', receivedMonotonicTimeMs: CUE.scheduledStartMs })
    const forward = matcher().match(CUE, [a, b])
    const reversed = matcher().match(CUE, [b, a])
    expect(reversed).toEqual(forward)
  })

  it('mutates neither the cue nor the events', () => {
    const events = [onToken(0), onToken(1)]
    const cueBefore = JSON.stringify(CUE)
    const eventsBefore = JSON.stringify(events)
    matcher().match(CUE, events)
    expect(JSON.stringify(CUE)).toBe(cueBefore)
    expect(JSON.stringify(events)).toBe(eventsBefore)
  })
})

describe('velocity passes through unrelabelled (spec §4.3)', () => {
  it('reads no velocity field and invents no unit', () => {
    // The matcher is about hand and timing; velocity belongs to scoring
    // (#131). Nothing in the result should carry a converted value.
    const result: CueMatchResult = matcher().match(CUE, [onToken(0, { velocityRaw: 14 })])
    expect(JSON.stringify(result)).not.toMatch(/m\/s|mph|newton/i)
  })
})
