/**
 * Live cue matching (#188).
 *
 * The interesting cases are the ones where provisional and settled
 * disagree, because that is the whole reason this adapter exists. A
 * recovered event arriving late can reorder a cue after the athlete has
 * already seen feedback, and the design commitment is that the settled
 * result wins *and says so* rather than quietly rewriting history.
 */
import { LiveCueMatcher, type LiveMatcherEvent } from '../LiveCueMatcher'
import { expandTimeline, type CueInstance } from '../CueTimeline'
import { CADENCE_PROFILES } from '../../workout/cadence'
import { threeRoundFundamentals } from '../../workout/samples'
import type { CueEvent } from '../CueState'
import type { ExtraPunchPolicy } from '../../workout/WorkoutRecipe'
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

/** Minimal CueEngine events — only the two the matcher listens for. */
const windowOpened = (): CueEvent =>
  ({ type: 'cue-window-opened', cue: CUE, status: 'active', timestamps: {} as never, workElapsedMs: 0, nowMs: 0 })
const windowClosed = (): CueEvent =>
  ({ type: 'cue-window-closed', cue: CUE, status: 'accepting', timestamps: {} as never, workElapsedMs: 0, nowMs: 0 })
const cueCancelled = (): CueEvent =>
  ({ type: 'cue-cancelled', cue: CUE, status: 'cancelled', timestamps: {} as never, workElapsedMs: 0, nowMs: 0 })

function harness(policy: ExtraPunchPolicy = 'neutral') {
  const matcher = new LiveCueMatcher({ tier: 'hand-timestamp', extraPunchPolicy: policy })
  const events: LiveMatcherEvent[] = []
  matcher.subscribe((e) => events.push(e))
  return {
    matcher,
    events,
    matches: () => events.flatMap((e) => (e.type === 'match' ? [e.match] : [])),
    extras: () => events.flatMap((e) => (e.type === 'extra' ? [e.extra] : [])),
    settled: () => events.flatMap((e) => (e.type === 'cue-settled' ? [e] : [])),
  }
}

beforeEach(() => {
  nextId = 0
})

// ---------------------------------------------------------------------------

describe('provisional feedback (doc §21)', () => {
  it('credits a punch the moment it lands, before the window closes', () => {
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onPunchEvent(onToken(0))

    // No window-closed yet: the token must already have brightened.
    expect(h.matches()).toHaveLength(1)
    expect(h.matches()[0]).toMatchObject({ cueId: CUE.id, expectedIndex: 0, outcome: 'matched' })
    expect(h.settled()).toHaveLength(0)
  })

  it('fills expectations in order', () => {
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onPunchEvent(onToken(0))
    h.matcher.onPunchEvent(onToken(1))
    expect(h.matches().map((m) => m.expectedIndex)).toEqual([0, 1])
  })

  it('reports a wrong hand as a mismatch without discarding the punch', () => {
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onPunchEvent(event({ hand: 'right' }))
    expect(h.matches()[0]?.outcome).toBe('hand-mismatch')
  })

  it('carries tracker-reported velocity through when the source has it', () => {
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onPunchEvent(onToken(0, { velocityRaw: 13 }))
    expect(h.matches()[0]?.velocityRaw).toBe(13)
  })

  it('omits velocity when the unit is unknown rather than reporting a bare number', () => {
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onPunchEvent(onToken(0, { velocityUnit: 'unknown', velocityRaw: 13 }))
    expect(h.matches()[0]?.velocityRaw).toBeUndefined()
  })

  it('holds a recovered event back rather than crediting the wrong slot', () => {
    // Its position depends on a tracker timestamp the settled pass orders
    // properly; guessing now could brighten a token the punch did not fill.
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onPunchEvent(
      onToken(0, { recovered: true, trackerTimestampMs: CUE.scheduledStartMs }),
    )
    expect(h.matches()).toHaveLength(0)

    h.matcher.onCueEvent(windowClosed())
    // It still counts — it was just settled rather than guessed.
    expect(h.settled()[0]?.result.assignments).toHaveLength(1)
  })
})

describe('extras are always emitted (spec §13.6)', () => {
  it('emits a punch thrown between combinations', () => {
    const h = harness()
    h.matcher.onPunchEvent(event())
    expect(h.extras()).toHaveLength(1)
    expect(h.extras()[0]?.cueId).toBeUndefined()
  })

  it('emits a punch beyond the last expectation, attributed to the open cue', () => {
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onPunchEvent(onToken(0))
    h.matcher.onPunchEvent(onToken(1))
    const surplus = onToken(1, { receivedMonotonicTimeMs: CUE.scheduledStartMs + 120 })
    h.matcher.onPunchEvent(surplus)

    expect(h.extras()).toHaveLength(1)
    expect(h.extras()[0]).toMatchObject({ cueId: CUE.id, eventId: surplus.id })
  })

  it('emits a punch outside the window', () => {
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onPunchEvent(event({ receivedMonotonicTimeMs: CUE.windowEndMs + 200 }))
    expect(h.extras()).toHaveLength(1)
    expect(h.matches()).toHaveLength(0)
  })

  it.each(['encouraged', 'neutral', 'discouraged'] as const)(
    'carries the %s policy so the surface can present it',
    (policy) => {
      const h = harness(policy)
      h.matcher.onPunchEvent(event())
      expect(h.extras()[0]?.policy).toBe(policy)
    },
  )

  it('never withholds an extra under any policy', () => {
    // The policy changes presentation, never whether the punch is reported.
    for (const policy of ['encouraged', 'neutral', 'discouraged'] as const) {
      const h = harness(policy)
      h.matcher.onPunchEvent(event())
      expect(h.extras()).toHaveLength(1)
    }
  })
})

describe('settling on window close', () => {
  it('emits the authoritative result and its score', () => {
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onPunchEvent(onToken(0))
    h.matcher.onPunchEvent(onToken(1))
    h.matcher.onCueEvent(windowClosed())

    const settled = h.settled()[0]!
    expect(settled.result.cueId).toBe(CUE.id)
    expect(settled.result.assignments).toHaveLength(2)
    expect(settled.score.completionPct).toBe(100)
    expect(settled.score.label).toBe('hand-sequence match')
  })

  it('reports no corrections when provisional and settled agree', () => {
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onPunchEvent(onToken(0))
    h.matcher.onPunchEvent(onToken(1))
    h.matcher.onCueEvent(windowClosed())
    expect(h.settled()[0]?.corrections).toEqual([])
  })

  it('reports a correction when a recovered event reorders the cue', () => {
    // The live punch is credited to slot 0 immediately. A recovered event
    // then turns up with an earlier tracker timestamp, so the settled pass
    // puts it first and pushes the live punch to slot 1.
    const h = harness()
    h.matcher.onCueEvent(windowOpened())

    const live = onToken(1, { receivedMonotonicTimeMs: CUE.scheduledStartMs + 300 })
    h.matcher.onPunchEvent(live)
    expect(h.matches()[0]?.expectedIndex).toBe(0)

    h.matcher.onPunchEvent(
      onToken(0, { recovered: true, trackerTimestampMs: CUE.scheduledStartMs }),
    )
    h.matcher.onCueEvent(windowClosed())

    const settled = h.settled()[0]!
    const liveAssignment = settled.result.assignments.find((a) => a.eventId === live.id)
    expect(liveAssignment?.expectedIndex).toBe(1)
    // The disagreement is reported rather than silently smoothed over.
    expect(settled.corrections.map((c) => c.eventId)).toEqual([live.id])
  })

  it('accumulates settled results for persistence', () => {
    const h = harness()
    for (let i = 0; i < 3; i++) {
      h.matcher.onCueEvent(windowOpened())
      h.matcher.onPunchEvent(onToken(0))
      h.matcher.onCueEvent(windowClosed())
    }
    expect(h.matcher.results()).toHaveLength(3)
  })

  it('settles an empty cue as fully missed rather than skipping it', () => {
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onCueEvent(windowClosed())
    const settled = h.settled()[0]!
    expect(settled.result.missedExpectedIndexes).toEqual([0, 1])
    expect(settled.score.completionPct).toBe(0)
  })
})

describe('a cancelled cue is not graded (doc §25)', () => {
  it('settles nothing when the cue is cancelled', () => {
    // The athlete was told to stop, so there is nothing to grade.
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onPunchEvent(onToken(0))
    h.matcher.onCueEvent(cueCancelled())

    expect(h.settled()).toHaveLength(0)
    expect(h.matcher.results()).toHaveLength(0)
  })

  it('treats a later punch as an unattributed extra', () => {
    const h = harness()
    h.matcher.onCueEvent(windowOpened())
    h.matcher.onCueEvent(cueCancelled())
    h.matcher.onPunchEvent(event())
    expect(h.extras()[0]?.cueId).toBeUndefined()
  })
})

describe('display-only tokens never enter scoring (D4)', () => {
  it('scores only the punch expectations of a defense-counter cue', () => {
    const defenseCue = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)[0]!.cues.find(
      (c) => c.displayOnlyTokenIndexes.length > 0,
    )!
    // The cue has more tokens than expectations: the slip is shown, never
    // scored, and never auto-failed.
    expect(defenseCue.tokens.length).toBeGreaterThan(defenseCue.expectedPunches.length)

    const h = harness()
    h.matcher.onCueEvent({ ...windowOpened(), cue: defenseCue } as CueEvent)
    h.matcher.onCueEvent({ ...windowClosed(), cue: defenseCue } as CueEvent)

    const settled = h.settled()[0]!
    expect(settled.score.expectedCount).toBe(defenseCue.expectedPunches.length)
  })
})

describe('unsubscribe', () => {
  it('stops delivering events', () => {
    const matcher = new LiveCueMatcher({ tier: 'hand-timestamp', extraPunchPolicy: 'neutral' })
    const seen: LiveMatcherEvent[] = []
    const off = matcher.subscribe((e) => seen.push(e))
    matcher.onPunchEvent(event())
    expect(seen).toHaveLength(1)

    off()
    matcher.onPunchEvent(event())
    expect(seen).toHaveLength(1)
  })
})
