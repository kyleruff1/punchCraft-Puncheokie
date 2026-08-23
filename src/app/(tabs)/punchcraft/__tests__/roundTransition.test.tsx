/**
 * Round transition wiring (M33-04, doc §23, D6).
 *
 * The component suite proves the rest screen renders a frozen result; this
 * one proves the result actually freezes. It drives the real runner with a
 * fake clock and a fake punch source, so the thing under test is the wiring
 * between the session clock, the freeze and the store — the seam where "the
 * number kept moving during rest" would come from.
 *
 * Rounds are deliberately tiny. The freeze rule is about ordering, not
 * duration, and a three-minute round at 50 ms ticks would buy nothing.
 */
import React, { useImperativeHandle } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { View } from 'react-native'

import { useWorkoutRunner, TICK_INTERVAL_MS, type WorkoutRunner } from '../useWorkoutRunner'
import { DEFAULT_COUNTDOWN_MS } from '@domain/session/WorkoutSessionClock'
import { createFakeClock, type FakeClock } from '@testing/fakeClock'
import { defaultRecipe } from '@domain/workout/WorkoutRecipe'
import { getLive, resetLive, useLiveStore } from '@state/useWorkoutStore'
import type { GeneratedWorkout } from '@domain/workout/GeneratedWorkout'
import type { PunchEventSource } from '@domain/punch/PunchEventSource'
import type { TrackerPunchEvent, PunchHand } from '@domain/punch/PunchEvent'
import type { ProgramRound } from '@domain/workout/WorkoutTokens'

const WORK_MS = 2_000
const REST_MS = 1_000
const TARGET = 4
/** `WorkoutSessionClock`'s default lead-in; the runner does not override it. */
const COUNTDOWN_MS = DEFAULT_COUNTDOWN_MS

function round(order: number, isLast: boolean): ProgramRound {
  return {
    id: `r${order}`,
    order,
    kind: 'round',
    countsTowardGoal: true,
    theme: `Round ${order}`,
    workDurationMs: WORK_MS,
    restAfterMs: isLast ? 0 : REST_MS,
    targetPunches: TARGET,
    blocks: [
      {
        id: `r${order}-b1`,
        kind: 'repeated-combo',
        stance: 'inherit',
        startOffsetMs: 0,
        durationMs: 1_000,
        gapBeats: 1,
        repeat: 2,
        tokens: [
          { kind: 'punch', number: 1, body: false, beatOffset: 0 },
          { kind: 'punch', number: 2, body: false, beatOffset: 0.6 },
        ],
      },
    ],
  }
}

const WORKOUT: GeneratedWorkout = {
  id: 'round-transition-fixture',
  recipe: defaultRecipe(),
  schedule: [round(1, false), round(2, true)],
  roundPunchTargets: [TARGET, TARGET],
  expectedTechniqueDistribution: {},
  estimatedActivePunchesPerMinute: 60,
  warnings: [],
}

/** A source the test emits into by hand — no timers of its own. */
class FakeSource implements PunchEventSource {
  readonly id = 'fake'
  readonly capability = {
    hand: true,
    timestamp: true,
    punchType: 'none' as const,
    velocity: true,
  }
  private listeners: Array<(event: TrackerPunchEvent) => void> = []
  private seq = 0

  constructor(private readonly clock: FakeClock) {}

  subscribe(listener: (event: TrackerPunchEvent) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  start(): void {}
  stop(): void {}

  emit(hand: PunchHand, velocityRaw = 50): void {
    this.seq += 1
    const event: TrackerPunchEvent = {
      id: `e${this.seq}`,
      sourceFrameId: `f${this.seq}`,
      deviceId: hand === 'left' ? 'LEFT' : 'RIGHT',
      hand,
      receivedMonotonicTimeMs: this.clock.now(),
      receivedWallTimeIso: new Date(0).toISOString(),
      velocityRaw,
      velocityUnit: 'tracker-unit',
      recovered: false,
      decoderId: 'fake',
      decoderVersion: '1',
      qualityFlags: [],
    }
    for (const listener of [...this.listeners]) listener(event)
  }
}

interface Harness {
  runner: WorkoutRunner
  source: FakeSource
  clock: FakeClock
  /** Advance both the interval timer and the monotonic clock together. */
  step(ms: number): void
  emit(hand: PunchHand, velocityRaw?: number): void
  /** Start and run out the lead-in, leaving the session in round 1's work. */
  begin(): void
  unmount(): void
}

function mount(): Harness {
  const clock = createFakeClock()
  const source = new FakeSource(clock)
  const ref = React.createRef<WorkoutRunner>()

  function Probe(): React.JSX.Element {
    const runner = useWorkoutRunner({
      workout: WORKOUT,
      source,
      stance: 'orthodox',
      clock,
    })
    useImperativeHandle(ref, () => runner, [runner])
    return <View />
  }

  let tree!: ReactTestRenderer
  act(() => {
    tree = create(<Probe />)
  })

  const step = (ms: number): void => {
    act(() => {
      for (let elapsed = 0; elapsed < ms; elapsed += TICK_INTERVAL_MS) {
        clock.advance(TICK_INTERVAL_MS)
        jest.advanceTimersByTime(TICK_INTERVAL_MS)
      }
    })
  }

  const harness: Harness = {
    get runner() {
      return ref.current as WorkoutRunner
    },
    source,
    clock,
    step,
    emit: (hand, velocityRaw) => {
      act(() => {
        source.emit(hand, velocityRaw)
      })
    },
    begin: () => {
      act(() => {
        ;(ref.current as WorkoutRunner).start()
      })
      step(COUNTDOWN_MS + TICK_INTERVAL_MS)
    },
    unmount: () => {
      act(() => {
        tree.unmount()
      })
    },
  }
  return harness
}

beforeEach(() => {
  jest.useFakeTimers()
  resetLive()
})

afterEach(() => {
  jest.useRealTimers()
  act(() => {
    useLiveStore.getState().resetLive()
  })
})

// ---------------------------------------------------------------------------

describe('the bell freezes the round result (doc §23)', () => {
  it('publishes the round the moment rest begins', () => {
    const h = mount()
    h.begin()
    expect(getLive().phase).toBe('work')
    expect(getLive().frozenRoundResult).toBeUndefined()

    h.emit('left', 40)
    h.emit('right', 60)
    h.step(WORK_MS + TICK_INTERVAL_MS)

    expect(getLive().phase).toBe('rest')
    expect(getLive().frozenRoundResult).toMatchObject({
      roundIndex: 0,
      actual: 2,
      target: TARGET,
      left: 1,
      right: 1,
    })
    expect(getLive().frozenRoundResult?.avgVelocity?.value).toBe(50)
    h.unmount()
  })

  it('does not move for punches that land during rest', () => {
    const h = mount()
    h.begin()
    h.emit('left')
    h.step(WORK_MS + TICK_INTERVAL_MS)

    const atBell = getLive().frozenRoundResult
    expect(atBell?.actual).toBe(1)

    // Stray punches at the bag, and time passing, through the whole rest.
    for (let i = 0; i < 10; i++) h.emit('right', 99)
    h.step(REST_MS / 2)
    for (let i = 0; i < 10; i++) h.emit('left', 99)

    expect(getLive().frozenRoundResult).toEqual(atBell)
    // The live counter keeps counting — the punches are not discarded
    // (spec §13.6); only the frozen result is fixed.
    expect(getLive().counts.total).toBe(21)
    h.unmount()
  })

  it('counts only the round it belongs to, not the session so far', () => {
    const h = mount()
    h.begin()
    h.emit('left')
    h.emit('left')
    h.step(WORK_MS + TICK_INTERVAL_MS)
    expect(getLive().frozenRoundResult?.actual).toBe(2)

    act(() => {
      h.runner.skipRest()
    })
    h.emit('right')
    h.step(WORK_MS + TICK_INTERVAL_MS)

    // Round 2 threw one punch; the session has thrown three.
    expect(getLive().counts.total).toBe(3)
    expect(getLive().phase).toBe('completed')
    h.unmount()
  })

  it('clears the previous result when the next round starts', () => {
    const h = mount()
    h.begin()
    h.step(WORK_MS + TICK_INTERVAL_MS)
    expect(getLive().frozenRoundResult).toBeDefined()

    act(() => {
      h.runner.skipRest()
    })
    expect(getLive().frozenRoundResult).toBeUndefined()
    h.unmount()
  })
})

describe('skip rest leaves the rest state entirely (D6)', () => {
  it('enters the next round immediately', () => {
    const h = mount()
    h.begin()
    h.step(WORK_MS + TICK_INTERVAL_MS)
    expect(getLive().phase).toBe('rest')

    act(() => {
      h.runner.skipRest()
    })
    expect(getLive().phase).toBe('work')
    expect(getLive().roundIndex).toBe(1)
    h.unmount()
  })

  it('does nothing during work, so it cannot shorten a round', () => {
    const h = mount()
    h.begin()
    h.step(TICK_INTERVAL_MS * 2)
    expect(getLive().phase).toBe('work')

    act(() => {
      h.runner.skipRest()
    })
    expect(getLive().phase).toBe('work')
    expect(getLive().roundIndex).toBe(0)
    h.unmount()
  })
})

describe('the session machine gains no states (spec §18.1, D6)', () => {
  it('reports plain rest for the whole interval', () => {
    const h = mount()
    h.begin()
    h.step(WORK_MS + TICK_INTERVAL_MS)

    // Driven by the clock the store publishes rather than by a count of
    // steps, so an overflow tick at the round boundary cannot walk the loop
    // past the end of the rest.
    let ticks = 0
    while (getLive().roundRemainingMs > 200) {
      expect(getLive().phase).toBe('rest')
      h.step(100)
      ticks += 1
      if (ticks > 100) throw new Error('rest never ended')
    }
    expect(ticks).toBeGreaterThan(5)
    expect(getLive().phase).toBe('rest')
    h.unmount()
  })
})
