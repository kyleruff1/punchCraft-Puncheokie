/**
 * Cue engine lifecycle (M32-04).
 *
 * Driven by scripted `tick()` values rather than real time, so every test
 * states exactly where on the work clock it is. The fake monotonic clock is
 * advanced independently — that separation is what lets the "work clock
 * frozen, wall clock running" case be tested at all.
 */
import { CueEngine, DEFAULT_LEAD_TIMES, type CueEngineOptions } from '../CueEngine'
import { expandTimeline, type CueInstance, type RoundTimeline } from '../CueTimeline'
import type { CueEvent, CueEventType } from '../CueState'
import { CADENCE_PROFILES } from '../../workout/cadence'
import { threeRoundFundamentals } from '../../workout/samples'
import { createFakeClock, type FakeClock } from '@testing/fakeClock'
import type { GeneratedWorkout } from '../../workout/GeneratedWorkout'
import type { ProgramRound, WorkoutBlock, WorkoutToken } from '../../workout/WorkoutTokens'

const STEADY_BPM = CADENCE_PROFILES.steady.nominalBpm

// ---------------------------------------------------------------------------

function block(over: Partial<WorkoutBlock> = {}): WorkoutBlock {
  const tokens: WorkoutToken[] = [
    { kind: 'punch', number: 1, body: false, beatOffset: 0 },
    { kind: 'punch', number: 2, body: false, beatOffset: 1 },
  ]
  return {
    id: 'b1',
    kind: 'exact-combo',
    startOffsetMs: 10_000,
    durationMs: 1_200,
    stance: 'inherit',
    tokens,
    gapBeats: 1,
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

interface Harness {
  engine: CueEngine
  clock: FakeClock
  events: CueEvent[]
  types: () => Array<CueEvent['type']>
  cue: CueInstance
  /** Enter work and advance the work clock to `t`. */
  runTo: (t: number, stepMs?: number) => void
}

function harness(
  timeline: RoundTimeline[] = timelineFor([block()]),
  opts: Partial<CueEngineOptions> = {},
): Harness {
  const clock = createFakeClock()
  const engine = new CueEngine(timeline, {
    leadTimes: DEFAULT_LEAD_TIMES,
    clock,
    ...opts,
  })
  const events: CueEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })

  let at = 0
  const runTo = (t: number, stepMs = 50): void => {
    while (at < t) {
      at = Math.min(t, at + stepMs)
      clock.advance(stepMs)
      engine.tick(at)
    }
  }

  return {
    engine,
    clock,
    events,
    types: () => events.map((e) => e.type),
    cue: timeline[0]!.cues[0]!,
    runTo,
  }
}

/** Lifecycle types only, dropping the high-frequency token-due events. */
function lifecycle(h: Harness): CueEventType[] {
  return h.types().filter((t): t is CueEventType => t !== 'token-due')
}

// ---------------------------------------------------------------------------

describe('load-time assertions', () => {
  it('rejects a timeline whose window escapes the work interval', () => {
    const bad: RoundTimeline[] = [
      {
        roundIndex: 0,
        workDurationMs: 1_000,
        deferredBlockIds: [],
        stanceChanges: [],
        cues: [
          {
            ...timelineFor([block()])[0]!.cues[0]!,
            windowStartMs: 0,
            windowEndMs: 5_000,
          },
        ],
      },
    ]
    // Quietly re-clamping here would hide a broken expansion while letting
    // events be accepted during rest (spec §18.2).
    expect(() => new CueEngine(bad, { leadTimes: DEFAULT_LEAD_TIMES, clock: createFakeClock() }))
      .toThrow(/outside the round work interval/)
  })

  it('accepts the real sample timelines', () => {
    const timeline = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)
    expect(
      () => new CueEngine(timeline, { leadTimes: DEFAULT_LEAD_TIMES, clock: createFakeClock() }),
    ).not.toThrow()
  })
})

describe('the work clock is the only time base', () => {
  it('produces no transitions while workElapsedMs is held constant', () => {
    const h = harness()
    h.engine.tick(0)
    const before = h.events.length

    // Five seconds of wall time, no work time.
    for (let i = 0; i < 100; i++) {
      h.clock.advance(50)
      h.engine.tick(0)
    }
    expect(h.events).toHaveLength(before)
  })

  it('ignores a backwards tick rather than throwing', () => {
    const h = harness()
    h.runTo(9_000)
    const before = h.events.length
    expect(() => h.engine.tick(1_000)).not.toThrow()
    expect(h.events).toHaveLength(before)
  })

  it('is idempotent for a repeated tick value', () => {
    const h = harness()
    h.runTo(10_000)
    const before = h.events.length
    h.engine.tick(10_000)
    h.engine.tick(10_000)
    expect(h.events).toHaveLength(before)
  })
})

describe('the full lifecycle walk (doc §20)', () => {
  it('carries one exact-combo cue from preview to completion', () => {
    const h = harness()
    // All expectations matched, so the cue should complete rather than expire.
    // previewAt is 10_000 - 1_500 = 8_500.
    h.runTo(8_600)
    expect(lifecycle(h)).toEqual(['cue-previewing'])

    h.runTo(9_300)
    expect(lifecycle(h)).toContain('cue-announcing')

    h.runTo(9_850)
    expect(lifecycle(h)).toContain('cue-window-opened')

    h.runTo(9_950)
    expect(lifecycle(h)).toContain('cue-ready')

    h.runTo(10_050)
    expect(lifecycle(h)).toContain('cue-active')

    h.engine.notifyMatch(h.cue.id, 0, 10_010)
    h.engine.notifyMatch(h.cue.id, 1, 10_620)

    h.runTo(12_000)
    expect(lifecycle(h)).toContain('cue-window-closed')
    expect(lifecycle(h)).toContain('cue-completed')
    expect(lifecycle(h)).not.toContain('cue-expired')
  })

  it('emits the lifecycle in doc §18.3 order', () => {
    const h = harness()
    h.engine.notifyMatch(h.cue.id, 0, 10_000)
    h.engine.notifyMatch(h.cue.id, 1, 10_600)
    h.runTo(13_000)
    expect(lifecycle(h)).toEqual([
      'cue-previewing',
      'cue-announcing',
      'cue-window-opened',
      'cue-ready',
      'cue-active',
      'cue-window-closed',
      'cue-completed',
    ])
  })

  it('carries a coarse tick through several states at once', () => {
    // A dropped frame must not strand a cue in an earlier status.
    const h = harness()
    h.engine.tick(11_000)
    expect(lifecycle(h)).toEqual(
      expect.arrayContaining(['cue-previewing', 'cue-announcing', 'cue-active']),
    )
  })

  it('ends in gap, preserving the outcome separately', () => {
    const h = harness()
    h.engine.notifyMatch(h.cue.id, 0, 10_000)
    h.engine.notifyMatch(h.cue.id, 1, 10_600)
    h.runTo(13_000)
    expect(h.engine.snapshot().status).toBe('gap')
    expect(h.engine.results()[0]?.outcome).toBe('completed')
  })
})

describe('token-due', () => {
  it('fires exactly once per token, in event-time order', () => {
    const h = harness()
    h.runTo(13_000)
    const due = h.events.filter((e) => e.type === 'token-due')
    expect(due).toHaveLength(h.cue.tokens.length)
    expect(due.map((e) => (e.type === 'token-due' ? e.tokenIndex : -1))).toEqual([0, 1])
  })

  it('fires each token no earlier than its offset', () => {
    const h = harness()
    h.runTo(13_000, 10)
    for (const event of h.events) {
      if (event.type !== 'token-due') continue
      const offset = h.cue.tokenOffsetsMs[event.tokenIndex]!
      expect(event.workElapsedMs).toBeGreaterThanOrEqual(h.cue.scheduledStartMs + offset)
    }
  })

  it('does NOT fire a rest — a padded bar injects no phantom ring events', () => {
    // A rest holds a slot and a beat but is never thrown. It reaches
    // `fireDueTokens` like any other token, so without an explicit skip it
    // would publish `token-due` — polluting `puncheokie.cue.tokenDue` (the
    // cadence-lab drift signal) and the viz forensics recorder with ring
    // fires for punches that do not exist (GH #305).
    const padded: WorkoutToken[] = [
      { kind: 'punch', number: 1, body: false, beatOffset: 0 },
      { kind: 'punch', number: 2, body: false, beatOffset: 1 },
      { kind: 'rest', beatOffset: 2 },
      { kind: 'rest', beatOffset: 3 },
    ]
    const h = harness(timelineFor([block({ tokens: padded })]))
    h.runTo(20_000)
    const due = h.events.filter((e) => e.type === 'token-due')
    // Four slots, two punches, two fires.
    expect(h.cue.tokens).toHaveLength(4)
    expect(due).toHaveLength(2)
    expect(due.map((e) => (e.type === 'token-due' ? e.tokenIndex : -1))).toEqual([0, 1])
  })

  it('fires every token of a repeated-combo across its instances', () => {
    const timeline = timelineFor([block({ kind: 'repeated-combo', repeat: 3 })])
    const h = harness(timeline)
    h.runTo(20_000)
    const due = h.events.filter((e) => e.type === 'token-due')
    expect(due).toHaveLength(3 * 2)
    expect(timeline[0]!.cues.map((c) => c.repeatIndex)).toEqual([0, 1, 2])
  })
})

describe('partial completion is not failure (doc §21)', () => {
  it('expires with a partial count when only some expectations matched', () => {
    const tokens: WorkoutToken[] = [
      { kind: 'punch', number: 1, body: false, beatOffset: 0 },
      { kind: 'punch', number: 2, body: false, beatOffset: 1 },
      { kind: 'punch', number: 3, body: false, beatOffset: 2 },
    ]
    const h = harness(timelineFor([block({ tokens })]))
    h.engine.notifyMatch(h.cue.id, 0, 10_000)
    h.engine.notifyMatch(h.cue.id, 1, 10_600)
    h.runTo(15_000)

    expect(lifecycle(h)).toContain('cue-expired')
    const result = h.engine.results()[0]!
    expect(result.outcome).toBe('expired')
    expect(result.matchedCount).toBe(2)
    expect(result.expectedCount).toBe(3)
  })

  it('completes a cue with no expected punches rather than expiring it', () => {
    // A display-only block has nothing to miss.
    const tokens: WorkoutToken[] = [{ kind: 'coach', command: 'breathe', beatOffset: 0 }]
    const h = harness(timelineFor([block({ tokens })]))
    h.runTo(15_000)
    expect(h.engine.results()[0]?.outcome).toBe('completed')
  })

  it('records credited tracker event times on the cue', () => {
    const h = harness()
    h.engine.notifyMatch(h.cue.id, 0, 10_011)
    h.engine.notifyMatch(h.cue.id, 1, 10_622)
    h.runTo(13_000)
    expect(h.engine.results()[0]?.timestamps.trackerEventTimesMs).toEqual([10_011, 10_622])
  })

  it('ignores a match for an unknown cue id', () => {
    const h = harness()
    expect(() => h.engine.notifyMatch('nope', 0, 1)).not.toThrow()
  })
})

describe('pause and resume', () => {
  it('suspends an accepting cue and restores the same status', () => {
    const h = harness()
    h.runTo(10_700)
    expect(h.engine.snapshot().status).toBe('accepting')

    h.clock.advance(100)
    h.engine.onSessionPhase({ type: 'paused', nowMs: h.clock.now() })
    expect(h.engine.snapshot().status).toBe('suspended')
    expect(lifecycle(h)).toContain('cue-suspended')

    h.clock.advance(5_000)
    h.engine.onSessionPhase({ type: 'resumed', nowMs: h.clock.now() })
    expect(h.engine.snapshot().status).toBe('accepting')
    expect(lifecycle(h)).toContain('cue-resumed')
  })

  it('appends a suspension record spanning real elapsed time', () => {
    const h = harness()
    h.runTo(10_700)
    h.clock.advance(100)
    h.engine.onSessionPhase({ type: 'paused', nowMs: h.clock.now() })
    const pausedAt = h.clock.now()
    h.clock.advance(4_000)
    h.engine.onSessionPhase({ type: 'resumed', nowMs: h.clock.now() })

    h.runTo(13_000)
    const suspensions = h.engine.results()[0]!.timestamps.suspensions
    expect(suspensions).toHaveLength(1)
    expect(suspensions[0]!.atMs).toBe(pausedAt)
    // Monotonic, not work-elapsed — a work-elapsed span would be zero,
    // because the work clock is frozen for exactly this interval.
    expect(suspensions[0]!.resumedAtMs! - suspensions[0]!.atMs).toBe(4_000)
  })

  it('does not advance while suspended even if a tick arrives', () => {
    const h = harness()
    h.runTo(10_700)
    h.engine.onSessionPhase({ type: 'paused', nowMs: h.clock.now() })
    const before = h.events.length
    h.engine.tick(20_000)
    expect(h.events).toHaveLength(before)
    expect(h.engine.snapshot().status).toBe('suspended')
  })

  it('leaves a queued cue queued rather than suspending it', () => {
    const h = harness()
    h.runTo(5_000)
    h.engine.onSessionPhase({ type: 'paused', nowMs: h.clock.now() })
    expect(lifecycle(h)).not.toContain('cue-suspended')
  })
})

describe('tracker fault', () => {
  it('suspends and clears like a pause', () => {
    const h = harness()
    h.runTo(10_700)
    h.engine.notifyTrackerFault(true)
    expect(h.engine.snapshot().status).toBe('suspended')

    h.engine.notifyTrackerFault(false)
    expect(h.engine.snapshot().status).toBe('accepting')
  })

  it('stays suspended until both the pause and the fault clear', () => {
    const h = harness()
    h.runTo(10_700)
    h.engine.onSessionPhase({ type: 'paused', nowMs: h.clock.now() })
    h.engine.notifyTrackerFault(true)

    h.engine.onSessionPhase({ type: 'resumed', nowMs: h.clock.now() })
    expect(h.engine.snapshot().status).toBe('suspended')

    h.engine.notifyTrackerFault(false)
    expect(h.engine.snapshot().status).toBe('accepting')
  })
})

describe('immediate stop (doc §25)', () => {
  it.each(['rest-entered', 'finishing', 'cancelled'] as const)(
    '%s cancels every remaining cue exactly once',
    (phase) => {
      const timeline = timelineFor([block({ kind: 'repeated-combo', repeat: 4 })])
      const h = harness(timeline)
      h.runTo(10_500)

      h.engine.onSessionPhase({ type: phase, nowMs: h.clock.now() })
      const cancels = h.types().filter((t) => t === 'cue-cancelled')
      expect(cancels.length).toBe(timeline[0]!.cues.length)

      // A second phase event must not re-cancel anything.
      h.engine.onSessionPhase({ type: phase, nowMs: h.clock.now() })
      expect(h.types().filter((t) => t === 'cue-cancelled')).toHaveLength(cancels.length)
    },
  )

  it('leaves an already-finished cue alone', () => {
    const h = harness()
    h.engine.notifyMatch(h.cue.id, 0, 10_000)
    h.engine.notifyMatch(h.cue.id, 1, 10_600)
    h.runTo(13_000)
    h.engine.onSessionPhase({ type: 'rest-entered', nowMs: h.clock.now() })
    expect(h.engine.results()[0]?.outcome).toBe('completed')
    expect(h.types()).not.toContain('cue-cancelled')
  })
})

describe('athlete controls', () => {
  it('skipCue cancels the current cue and moves on', () => {
    const timeline = timelineFor([block({ kind: 'repeated-combo', repeat: 3 })])
    const h = harness(timeline)
    h.runTo(10_100)
    h.engine.skipCue()

    expect(h.types().filter((t) => t === 'cue-cancelled')).toHaveLength(1)
    expect(h.engine.results()[0]?.outcome).toBe('cancelled')
  })

  it('repeatCue enqueues a copy with the next repeatIndex, after the current window', () => {
    const h = harness()
    h.runTo(10_100)
    const original = h.engine.snapshot().current!
    h.engine.repeatCue()

    const next = h.engine.snapshot().next!
    expect(next.repeatIndex).toBe(original.repeatIndex + 1)
    expect(next.scheduledStartMs).toBeGreaterThanOrEqual(original.windowEndMs)
    expect(next.blockId).toBe(original.blockId)
    expect(next.id).not.toBe(original.id)
  })

  it('runs the repeated copy through its own lifecycle', () => {
    const h = harness()
    h.runTo(10_100)
    h.engine.repeatCue()
    h.runTo(20_000)
    expect(h.engine.results()).toHaveLength(2)
  })

  it('does nothing when there is no cue in flight', () => {
    const h = harness()
    expect(() => h.engine.skipCue()).not.toThrow()
    expect(() => h.engine.repeatCue()).not.toThrow()
  })
})

describe('invariants', () => {
  it('never has two cues active or accepting at once', () => {
    // Asserted inside tick(); running the real sample end to end exercises it.
    const timeline = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)
    const clock = createFakeClock()
    const engine = new CueEngine(timeline, { leadTimes: DEFAULT_LEAD_TIMES, clock })
    engine.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })

    expect(() => {
      for (let t = 0; t <= timeline[0]!.workDurationMs; t += 50) {
        clock.advance(50)
        engine.tick(t)
      }
    }).not.toThrow()
  })

  it('emits events monotonic in workElapsedMs', () => {
    const h = harness(expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM))
    h.runTo(60_000)
    let previous = -Infinity
    for (const event of h.events) {
      expect(event.workElapsedMs).toBeGreaterThanOrEqual(previous)
      previous = event.workElapsedMs
    }
  })

  it('carries scheduled timestamps from load and actual timestamps at emission', () => {
    const h = harness()
    h.runTo(13_000)
    const active = h.events.find((e) => e.type === 'cue-active')!
    if (active.type === 'token-due') throw new Error('unreachable')

    expect(active.timestamps.previewScheduledMs).toBe(h.cue.previewAt)
    expect(active.timestamps.voiceScheduledMs).toBe(h.cue.announceAt)
    expect(active.timestamps.executionScheduledMs).toBe(h.cue.scheduledStartMs)
    expect(active.timestamps.windowCloseMs).toBe(h.cue.windowEndMs)
    expect(active.timestamps.executionActualMs).toBeGreaterThan(0)
  })

  it('gives every non-token event a status and a monotonic nowMs', () => {
    const h = harness()
    h.runTo(13_000)
    for (const event of h.events) {
      if (event.type === 'token-due') continue
      expect(typeof event.status).toBe('string')
      expect(typeof event.nowMs).toBe('number')
    }
  })

  it('unsubscribes cleanly', () => {
    const clock = createFakeClock()
    const engine = new CueEngine(timelineFor([block()]), {
      leadTimes: DEFAULT_LEAD_TIMES,
      clock,
    })
    const seen: CueEvent[] = []
    const off = engine.subscribe((e) => seen.push(e))
    engine.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })
    engine.tick(10_000)
    const before = seen.length
    expect(before).toBeGreaterThan(0)

    off()
    engine.tick(13_000)
    expect(seen).toHaveLength(before)
  })
})

describe('snapshot', () => {
  it('reports the next queued cue while the current one runs', () => {
    const h = harness(timelineFor([block({ kind: 'repeated-combo', repeat: 3 })]))
    h.runTo(10_100)
    const snap = h.engine.snapshot()
    expect(snap.current).toBeDefined()
    expect(snap.next).toBeDefined()
    expect(snap.next!.repeatIndex).toBe(1)
  })

  it('counts down to the window close while accepting', () => {
    const h = harness()
    h.runTo(10_700)
    const snap = h.engine.snapshot()
    expect(snap.status).toBe('accepting')
    expect(snap.remainingMs).toBe(h.cue.windowEndMs - 10_700)
  })

  it('starts queued before anything has previewed', () => {
    const h = harness()
    expect(h.engine.snapshot().status).toBe('queued')
  })
})
