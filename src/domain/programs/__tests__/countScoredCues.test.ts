/**
 * Count-scored cues (#192, doc §14).
 *
 * `volume-burst` and `open-pressure` blocks are judged on how much the
 * athlete threw, not on whether they followed a script. Before this they
 * were deferred, which left rounds silent through them — a large share of
 * every shipped sample.
 *
 * The rules worth guarding: a burst produces no expectations to miss, its
 * punches are counted rather than reported as extras, and falling short is
 * a result rather than a failure.
 */
import { CueEngine, DEFAULT_LEAD_TIMES } from '../CueEngine'
import { LiveCueMatcher, type LiveMatcherEvent } from '../LiveCueMatcher'
import { allCues, expandTimeline, type CueInstance, type RoundTimeline } from '../CueTimeline'
import { CADENCE_PROFILES } from '../../workout/cadence'
import { threeRoundFundamentals } from '../../workout/samples'
import { createFakeClock } from '@testing/fakeClock'
import type { CueEvent } from '../CueState'
import type { GeneratedWorkout } from '../../workout/GeneratedWorkout'
import type { ProgramRound, WorkoutBlock, WorkoutToken } from '../../workout/WorkoutTokens'
import type { TrackerPunchEvent } from '../../punch/PunchEvent'

const STEADY_BPM = CADENCE_PROFILES.steady.nominalBpm

const PATTERN: WorkoutToken[] = [
  { kind: 'punch', number: 1, body: false, beatOffset: 0 },
  { kind: 'punch', number: 2, body: false, beatOffset: 0.7 },
]

function block(over: Partial<WorkoutBlock> = {}): WorkoutBlock {
  return {
    id: 'burst',
    kind: 'volume-burst',
    startOffsetMs: 10_000,
    durationMs: 30_000,
    stance: 'inherit',
    tokens: PATTERN,
    gapBeats: 1,
    targetPunches: 40,
    ...over,
  }
}

function timelineFor(blocks: WorkoutBlock[], workDurationMs = 180_000): RoundTimeline[] {
  const round: ProgramRound = {
    id: 'r1',
    order: 1,
    kind: 'round',
    countsTowardGoal: true,
    theme: 'Test',
    workDurationMs,
    restAfterMs: 60_000,
    targetPunches: 0,
    blocks,
  }
  const workout: GeneratedWorkout = {
    ...threeRoundFundamentals,
    id: 'test',
    schedule: [round],
    roundPunchTargets: [0],
  }
  return expandTimeline(workout, 'orthodox', STEADY_BPM)
}

let nextId = 0
function punch(over: Partial<TrackerPunchEvent> = {}): TrackerPunchEvent {
  nextId += 1
  return {
    id: `e${nextId}`,
    sourceFrameId: `f${nextId}`,
    deviceId: 'D7:34',
    hand: 'left',
    receivedMonotonicTimeMs: 12_000,
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

beforeEach(() => {
  nextId = 0
})

// ---------------------------------------------------------------------------

describe('expansion (doc §14)', () => {
  const cue = timelineFor([block()])[0]!.cues[0]!

  it('produces one cue for the whole block, not one per punch', () => {
    // Slicing a burst into per-punch cues would reintroduce exactly the
    // enumeration the block exists to avoid.
    expect(timelineFor([block()])[0]!.cues).toHaveLength(1)
    expect(cue.scoring).toBe('count')
  })

  it('spans the block rather than a combination', () => {
    expect(cue.scheduledStartMs).toBe(10_000)
    expect(cue.scheduledEndMs).toBe(40_000)
  })

  it('carries the target and a countdown', () => {
    expect(cue.countScored?.targetPunches).toBe(40)
    expect(cue.countScored?.countdownMs).toBeGreaterThan(0)
  })

  it('shows the allowed pattern', () => {
    expect(cue.countScored?.allowedPattern).toBe('1-2')
  })

  it('creates no expectations to miss', () => {
    // Nothing in a burst can be "missed": the athlete was never told to
    // throw a particular punch at a particular moment.
    expect(cue.expectedPunches).toEqual([])
    expect(cue.displayOnlyTokenIndexes).toEqual([0, 1])
  })

  it('still clamps its window to the work interval (spec §18.2)', () => {
    const late = timelineFor([block({ startOffsetMs: 170_000, durationMs: 30_000 })], 180_000)[0]!
      .cues[0]!
    expect(late.windowEndMs).toBeLessThanOrEqual(180_000)
    expect(late.windowStartMs).toBeGreaterThanOrEqual(0)
  })

  it('renders a body shot in the pattern with the lowercase b (D10)', () => {
    const tokens: WorkoutToken[] = [
      { kind: 'punch', number: 1, body: false, beatOffset: 0 },
      { kind: 'punch', number: 2, body: true, beatOffset: 0.7 },
    ]
    const withBody = timelineFor([block({ tokens })])[0]!.cues[0]!
    expect(withBody.countScored?.allowedPattern).toBe('1-2b')
  })
})

describe('open pressure carries a finishing constraint', () => {
  it('takes the constraint from the block\'s last punch', () => {
    // "Punch freely, but finish every exchange with this" (doc §14).
    const cue = timelineFor([block({ kind: 'open-pressure' })])[0]!.cues[0]!
    expect(cue.countScored?.constraint).toEqual({ finisher: 2, hand: 'rear' })
  })

  it('leaves a volume burst without one', () => {
    // A burst is "keep throwing this", which is a pattern, not a rule.
    const cue = timelineFor([block({ kind: 'volume-burst' })])[0]!.cues[0]!
    expect(cue.countScored?.constraint).toBeUndefined()
  })

  it('is display-only: nothing verifies a finisher at this tier (D12)', () => {
    const cue = timelineFor([block({ kind: 'open-pressure' })])[0]!.cues[0]!
    // The constraint exists to be shown; it produces no expectation, so it
    // can never be scored against.
    expect(cue.expectedPunches).toEqual([])
  })
})

describe('the shipped samples no longer go quiet', () => {
  it('expands every authored block', () => {
    const timelines = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)
    expect(timelines.flatMap((t) => t.deferredBlockIds)).toEqual([])
  })

  it('produces count-scored cues in every round that has a burst', () => {
    const timelines = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)
    const counted = allCues(timelines).filter((c) => c.scoring === 'count')
    expect(counted.length).toBeGreaterThan(0)
    for (const cue of counted) expect(cue.countScored?.targetPunches).toBeGreaterThan(0)
  })

  it('keeps every sequence cue unchanged', () => {
    const timelines = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)
    for (const cue of allCues(timelines)) {
      if (cue.scoring !== 'sequence') continue
      expect(cue.expectedPunches.length).toBeGreaterThan(0)
    }
  })
})

describe('engine completion on count (doc §21)', () => {
  function run(counts: number, target = 40): { engine: CueEngine; cue: CueInstance } {
    const timeline = timelineFor([block({ targetPunches: target })])
    const cue = timeline[0]!.cues[0]!
    const clock = createFakeClock()
    const engine = new CueEngine(timeline, { leadTimes: DEFAULT_LEAD_TIMES, clock })
    engine.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })

    // Into the burst, then feed it counts, then past its window.
    for (let t = 0; t <= 12_000; t += 50) {
      clock.advance(50)
      engine.tick(t)
    }
    for (let i = 0; i < counts; i++) engine.notifyCount(cue.id, 12_000)
    for (let t = 12_050; t <= 45_000; t += 50) {
      clock.advance(50)
      engine.tick(t)
    }
    return { engine, cue }
  }

  it('completes a burst that reaches its target', () => {
    const { engine } = run(40)
    expect(engine.results()[0]?.outcome).toBe('completed')
  })

  it('expires a burst that falls short, recording what landed', () => {
    // Short is a result, not a failure — the count is preserved.
    const { engine } = run(25)
    const result = engine.results()[0]!
    expect(result.outcome).toBe('expired')
    expect(result.countedPunches).toBe(25)
    expect(result.expectedCount).toBe(40)
  })

  it('completes a burst that overshoots', () => {
    const { engine } = run(55)
    expect(engine.results()[0]?.outcome).toBe('completed')
    expect(engine.results()[0]?.countedPunches).toBe(55)
  })

  it('completes a burst with no target rather than failing it', () => {
    const { engine } = run(0, 0)
    expect(engine.results()[0]?.outcome).toBe('completed')
  })

  it('fires no token-due events for a burst', () => {
    // There is nothing to call: the pattern is shown once and repeated.
    const timeline = timelineFor([block()])
    const clock = createFakeClock()
    const engine = new CueEngine(timeline, { leadTimes: DEFAULT_LEAD_TIMES, clock })
    const seen: CueEvent[] = []
    engine.subscribe((e) => seen.push(e))
    engine.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })
    for (let t = 0; t <= 45_000; t += 50) {
      clock.advance(50)
      engine.tick(t)
    }
    expect(seen.filter((e) => e.type === 'token-due')).toEqual([])
  })

  it('ignores a count aimed at a sequence cue', () => {
    const timeline = timelineFor([
      { ...block(), id: 'combo', kind: 'exact-combo', targetPunches: undefined },
    ])
    const cue = timeline[0]!.cues[0]!
    const clock = createFakeClock()
    const engine = new CueEngine(timeline, { leadTimes: DEFAULT_LEAD_TIMES, clock })
    engine.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })
    expect(() => engine.notifyCount(cue.id, 1_000)).not.toThrow()
  })
})

describe('the matcher counts rather than reporting extras', () => {
  function harness() {
    const timeline = timelineFor([block()])
    const cue = timeline[0]!.cues[0]!
    const matcher = new LiveCueMatcher({ tier: 'hand-timestamp', extraPunchPolicy: 'encouraged' })
    const events: LiveMatcherEvent[] = []
    matcher.subscribe((e) => events.push(e))
    const open = (): void => {
      matcher.onCueEvent({
        type: 'cue-window-opened',
        cue,
        status: 'active',
        timestamps: {} as never,
        workElapsedMs: 0,
        nowMs: 0,
      })
    }
    const close = (): void => {
      matcher.onCueEvent({
        type: 'cue-window-closed',
        cue,
        status: 'accepting',
        timestamps: {} as never,
        workElapsedMs: 0,
        nowMs: 0,
      })
    }
    return { matcher, events, open, close, cue }
  }

  it('reports a burst punch as a count, never as an extra', () => {
    // Calling a burst punch an "extra" would be exactly backwards: output
    // is the whole point of the block.
    const h = harness()
    h.open()
    h.matcher.onPunchEvent(punch())
    expect(h.events.filter((e) => e.type === 'count')).toHaveLength(1)
    expect(h.events.filter((e) => e.type === 'extra')).toHaveLength(0)
  })

  it('counts either hand', () => {
    const h = harness()
    h.open()
    h.matcher.onPunchEvent(punch({ hand: 'left' }))
    h.matcher.onPunchEvent(punch({ hand: 'right' }))
    expect(h.events.filter((e) => e.type === 'count')).toHaveLength(2)
  })

  it('carries tracker-reported velocity on the count', () => {
    const h = harness()
    h.open()
    h.matcher.onPunchEvent(punch({ velocityRaw: 14 }))
    const counted = h.events.find((e) => e.type === 'count')
    expect(counted?.type === 'count' ? counted.count.velocityRaw : undefined).toBe(14)
  })

  it('settles with no assignments and no misses', () => {
    const h = harness()
    h.open()
    h.matcher.onPunchEvent(punch())
    h.matcher.onPunchEvent(punch())
    h.close()

    const settled = h.events.find((e) => e.type === 'cue-settled')
    if (settled?.type !== 'cue-settled') throw new Error('expected a settled cue')
    expect(settled.result.assignments).toEqual([])
    expect(settled.result.missedExpectedIndexes).toEqual([])
    // Every punch stays visible in the settled record.
    expect(settled.result.extras).toHaveLength(2)
  })

  it('reports no completion percentage against zero expectations', () => {
    const h = harness()
    h.open()
    h.close()
    const settled = h.events.find((e) => e.type === 'cue-settled')
    if (settled?.type !== 'cue-settled') throw new Error('expected a settled cue')
    // A burst has no sequence to complete; grading it is M33-03's job
    // against the count, not this percentage.
    expect(settled.score.expectedCount).toBe(0)
  })
})
