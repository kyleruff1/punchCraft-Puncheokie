/**
 * The runner writes the finished workout (M33-08).
 *
 * `persistWorkoutSession` has its own suite proving the transaction is
 * atomic. This one proves the runner actually *calls* it, with the right
 * things in hand — the seam where "the workout ran perfectly and nothing was
 * saved" would come from, and the kind of gap nothing surfaces until an
 * athlete opens their history and finds it empty.
 *
 * It drives the real runner with a fake clock and a fake punch source into a
 * real migrated SQLite database, so the rows asserted here are the rows the
 * tablet would hold.
 */
import React, { useImperativeHandle } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { View } from 'react-native'

import {
  useWorkoutRunner,
  TICK_INTERVAL_MS,
  type WorkoutRunner,
  type SessionEndOutcome,
} from '../useWorkoutRunner'
import { DEFAULT_COUNTDOWN_MS } from '@domain/session/WorkoutSessionClock'
import { createFakeClock, type FakeClock } from '@testing/fakeClock'
import { createMigratedDb } from '@storage/__tests__/helpers/memoryDb'
import { SessionRepository } from '@storage/repositories/SessionRepository'
import { WorkoutRepository } from '@storage/repositories/WorkoutRepository'
import { defaultRecipe } from '@domain/workout/WorkoutRecipe'
import { resetLive, useLiveStore } from '@state/useWorkoutStore'
import type { WorkoutPersistence } from '@storage/getWorkoutPersistence'
import type { GeneratedWorkout } from '@domain/workout/GeneratedWorkout'
import type { PunchEventSource } from '@domain/punch/PunchEventSource'
import type { TrackerPunchEvent, PunchHand } from '@domain/punch/PunchEvent'
import type { ProgramRound } from '@domain/workout/WorkoutTokens'

const WORK_MS = 2_000
const REST_MS = 1_000
const TARGET = 4
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
  id: 'persist-on-end-fixture',
  recipe: defaultRecipe(),
  schedule: [round(1, false), round(2, true)],
  roundPunchTargets: [TARGET, TARGET],
  expectedTechniqueDistribution: {},
  estimatedActivePunchesPerMinute: 60,
  warnings: [],
}

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

type TestPersistence = WorkoutPersistence & {
  count(table: string): number
  /** The node:sqlite handle, for assertions the repositories do not expose. */
  raw: ReturnType<typeof createMigratedDb>['raw']
}

function realPersistence(): TestPersistence {
  const db = createMigratedDb()
  return {
    db,
    raw: db.raw,
    sessions: new SessionRepository(db),
    workouts: new WorkoutRepository(db),
    count: (table: string) =>
      (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n,
  }
}

interface Harness {
  runner: WorkoutRunner
  outcomes: SessionEndOutcome[]
  step(ms: number): void
  emit(hand: PunchHand, velocityRaw?: number): void
  begin(): void
  unmount(): void
}

function mount(persistence: WorkoutPersistence | null): Harness {
  const clock = createFakeClock()
  const source = new FakeSource(clock)
  const ref = React.createRef<WorkoutRunner>()
  const outcomes: SessionEndOutcome[] = []
  const onSessionEnded = (outcome: SessionEndOutcome): void => {
    outcomes.push(outcome)
  }

  function Probe(): React.JSX.Element {
    const runner = useWorkoutRunner({
      workout: WORKOUT,
      source,
      stance: 'orthodox',
      clock,
      persistence,
      onSessionEnded,
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

  return {
    get runner() {
      return ref.current as WorkoutRunner
    },
    outcomes,
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
}

/** Run both rounds and the rest out, ending the session. */
function runToEnd(h: Harness): void {
  h.begin()
  h.step(WORK_MS + REST_MS + WORK_MS + TICK_INTERVAL_MS * 4)
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

describe('a completed workout lands in the database', () => {
  it('writes one session, one workout and its cue results', () => {
    const p = realPersistence()
    const h = mount(p)
    runToEnd(h)

    expect(p.count('sessions')).toBe(1)
    expect(p.count('generated_workouts')).toBe(1)
    expect(p.count('cue_results')).toBeGreaterThan(0)
    h.unmount()
  })

  it('reports the write back to the screen', () => {
    const p = realPersistence()
    const h = mount(p)
    runToEnd(h)

    expect(h.outcomes).toHaveLength(1)
    expect(h.outcomes[0]).toMatchObject({ status: 'persisted', cancelled: false })
    h.unmount()
  })

  it('marks it completed, under the mode punchCraft runs workouts as', () => {
    const p = realPersistence()
    const h = mount(p)
    runToEnd(h)

    const outcome = h.outcomes[0]
    if (outcome?.status !== 'persisted') throw new Error('expected a persisted session')
    const session = p.sessions.getById(outcome.session.sessionId)
    expect(session).toMatchObject({ status: 'completed', mode: 'punchcraft' })
    h.unmount()
  })

  it('records a row for every punch called, not only the ones thrown', () => {
    // The athlete answered two of the punches they were shown. The ones they
    // did not answer are exactly what a summary needs in order to say so.
    const p = realPersistence()
    const h = mount(p)
    h.begin()
    h.emit('left')
    h.step(400)
    h.emit('right')
    h.step(WORK_MS + REST_MS + WORK_MS)

    const rows = p.raw.prepare('SELECT outcome FROM cue_results').all() as Array<{
      outcome: string
    }>
    expect(rows.length).toBeGreaterThan(2)
    expect(rows.some((r) => r.outcome === 'missed')).toBe(true)
    h.unmount()
  })

  it('writes only blocks the workout actually reached (D8)', () => {
    // Recalculation replays the realized stream, so a block that never made
    // it to the stage must not appear as though it did.
    const p = realPersistence()
    const h = mount(p)
    h.begin()
    h.step(500)
    act(() => {
      h.runner.emergencyStop()
    })

    const outcome = h.outcomes[0]
    if (outcome?.status !== 'persisted') throw new Error('expected a persisted session')
    const stored = p.workouts.getWorkoutBySession(outcome.session.sessionId)
    expect(stored?.realized.map((entry) => entry.blockId)).toEqual(['r1-b1'])
    h.unmount()
  })
})

describe('a workout stopped early', () => {
  it('is written as cancelled rather than discarded', () => {
    const p = realPersistence()
    const h = mount(p)
    h.begin()
    h.emit('left')
    h.step(500)
    act(() => {
      h.runner.emergencyStop()
    })

    const outcome = h.outcomes[0]
    if (outcome?.status !== 'persisted') throw new Error('expected a persisted session')
    expect(outcome.cancelled).toBe(true)
    expect(p.sessions.getById(outcome.session.sessionId)?.status).toBe('cancelled')
    h.unmount()
  })

  it('writes nothing when it ends before a single cue reached the stage', () => {
    // There is no realized stream, and D8 makes one mandatory: a session
    // that could never be recalculated must not be stored as if it could.
    const p = realPersistence()
    const h = mount(p)
    act(() => {
      h.runner.start()
    })
    act(() => {
      h.runner.emergencyStop()
    })

    expect(h.outcomes[0]).toMatchObject({ status: 'nothing-to-persist' })
    expect(p.count('sessions')).toBe(0)
    h.unmount()
  })
})

describe('the write happens once', () => {
  it('does not write a second session when a stop follows a completion', () => {
    const p = realPersistence()
    const h = mount(p)
    runToEnd(h)
    act(() => {
      h.runner.emergencyStop()
    })

    expect(p.count('sessions')).toBe(1)
    expect(h.outcomes).toHaveLength(1)
    h.unmount()
  })
})

describe('a failed write does not take the app with it', () => {
  it('reports the failure instead of throwing out of the tick', () => {
    // The workout is over either way. Throwing here would surface as a crash
    // on the last bell — the worst possible moment for one.
    const p = realPersistence()
    const workouts = new WorkoutRepository(p.db)
    workouts.saveGeneratedWorkout = () => {
      throw new Error('disk full')
    }
    const h = mount({ db: p.db, sessions: p.sessions, workouts })

    expect(() => runToEnd(h)).not.toThrow()
    expect(h.outcomes[0]).toMatchObject({ status: 'failed' })
    // The rollback held: nothing half-written is left behind.
    expect(p.count('sessions')).toBe(0)
    h.unmount()
  })
})

describe('persistence is optional', () => {
  it('still reports an ending when the runner has no repositories', () => {
    const h = mount(null)
    runToEnd(h)
    expect(h.outcomes[0]).toMatchObject({ status: 'skipped', cancelled: false })
    h.unmount()
  })
})
