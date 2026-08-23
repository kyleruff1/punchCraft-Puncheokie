/**
 * One-transaction workout persistence (M33-08).
 *
 * The test that matters is the atomicity one. A partial write is worse than
 * no write: a `sessions` row with no `cue_results` is a workout that looks
 * like it happened and scored zero, which is indistinguishable later from an
 * athlete who threw nothing. Nothing would surface it until they opened
 * their history and found a workout that lied about them.
 *
 * Runs against real SQLite through the `node:sqlite` helper, so the FK and
 * CHECK behaviour here is the behaviour on device.
 */
import { createMigratedDb } from './helpers/memoryDb'
import { persistWorkoutSession } from '../persistWorkoutSession'
import { SessionRepository } from '../repositories/SessionRepository'
import { WorkoutRepository, type CueResultRow } from '../repositories/WorkoutRepository'
import { threeRoundFundamentals } from '@domain/workout/samples'
import type { RealizedTokenStream } from '../repositories/WorkoutRepository'

const WORKOUT = threeRoundFundamentals

function realizedStream(): RealizedTokenStream {
  return WORKOUT.schedule[0]!.blocks.slice(0, 2).map((block) => ({
    blockId: block.id,
    tokens: block.tokens,
  }))
}

type PendingCueResult = Omit<CueResultRow, 'sessionId' | 'generatedWorkoutId'>

function cueRow(over: Partial<PendingCueResult> = {}): PendingCueResult {
  return {
    blockId: WORKOUT.schedule[0]!.blocks[0]!.id,
    repeatIndex: 0,
    tokenIndex: 0,
    expectedHand: 'left',
    expectedType: null,
    observedEventId: null,
    outcome: 'matched',
    offsetMs: 12,
    velocityRaw: 10,
    velocityCalibrated: 17,
    velocityUnit: 'tracker-unit',
    capabilityTier: 'hand-timestamp',
    decoderVersion: '1.0.0',
    calculationVersion: '1.0.0',
    ...over,
  }
}

function harness() {
  const db = createMigratedDb()
  const sessions = new SessionRepository(db)
  const workouts = new WorkoutRepository(db)
  const count = (table: string): number =>
    (db.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  return { db, sessions, workouts, count }
}

const persist = (
  h: ReturnType<typeof harness>,
  over: Partial<Parameters<typeof persistWorkoutSession>[0]> = {},
) =>
  persistWorkoutSession({
    db: h.db,
    sessions: h.sessions,
    workouts: h.workouts,
    workout: WORKOUT,
    realized: realizedStream(),
    cueResults: [cueRow(), cueRow({ tokenIndex: 1, expectedHand: 'right' })],
    startedMonotonicMs: 1_000,
    endedMonotonicMs: 601_000,
    activeDurationMs: 540_000,
    endedAtIso: '2026-08-23T10:00:00.000Z',
    ...over,
  })

// ---------------------------------------------------------------------------

describe('a successful write lands everything together', () => {
  it('writes the session, the workout and the cue results', () => {
    const h = harness()
    const result = persist(h)

    expect(h.count('sessions')).toBe(1)
    expect(h.count('generated_workouts')).toBe(1)
    expect(h.count('cue_results')).toBe(2)
    expect(result.cueResultCount).toBe(2)
  })

  it('links the workout to its session in both directions', () => {
    const h = harness()
    const result = persist(h)

    const session = h.sessions.getById(result.sessionId)!
    expect(session.generatedWorkoutId).toBe(result.generatedWorkoutId)

    const linked = h.workouts.getWorkoutBySession(result.sessionId)
    expect(linked?.workout.id).toBe(WORKOUT.id)
  })

  it('records the mode punchCraft actually runs workouts under', () => {
    // #194's text says 'puncheokie'; that predates punchCraft taking
    // ownership of building and running workouts.
    const h = harness()
    const session = h.sessions.getById(persist(h).sessionId)!
    expect(session.mode).toBe('punchcraft')
  })

  it('marks a finished workout completed and a stopped one cancelled', () => {
    const finished = harness()
    expect(finished.sessions.getById(persist(finished).sessionId)!.status).toBe('completed')

    const stopped = harness()
    expect(
      stopped.sessions.getById(persist(stopped, { cancelled: true }).sessionId)!.status,
    ).toBe('cancelled')
  })

  it('stores adaptations against the workout', () => {
    const h = harness()
    const result = persist(h, {
      adaptations: [
        { decidedAtMonotonicMs: 180_000, boundary: 'rest', inputs: { a: 1 }, decision: { b: 2 } },
        { decidedAtMonotonicMs: 360_000, boundary: 'rest', inputs: {}, decision: {} },
      ],
    })
    expect(result.adaptationCount).toBe(2)
    expect(h.workouts.listAdaptations(result.generatedWorkoutId)).toHaveLength(2)
  })

  it('keeps monotonic time exactly as given (spec §3.2, §18.3)', () => {
    const h = harness()
    const result = persist(h, {
      adaptations: [
        { decidedAtMonotonicMs: 123_456, boundary: 'round', inputs: {}, decision: {} },
      ],
    })
    expect(h.workouts.listAdaptations(result.generatedWorkoutId)[0]?.decidedAtMonotonicMs).toBe(
      123_456,
    )
  })

  it('writes no session_metrics — #117 owns that table exclusively', () => {
    // Two writers on one table is how a metric ends up computed twice with
    // two different versions.
    const h = harness()
    persist(h)
    expect(h.count('session_metrics')).toBe(0)
  })
})

describe('a failure leaves nothing behind (spec §19.1)', () => {
  it('rolls back the session when a cue result is invalid', () => {
    const h = harness()
    expect(() =>
      persist(h, {
        // 'nonsense' violates the outcome CHECK constraint.
        cueResults: [cueRow(), cueRow({ tokenIndex: 1, outcome: 'nonsense' as never })],
      }),
    ).toThrow()

    // Not "a session with one cue result" — nothing at all.
    expect(h.count('sessions')).toBe(0)
    expect(h.count('generated_workouts')).toBe(0)
    expect(h.count('cue_results')).toBe(0)
  })

  it('rolls back when an adaptation is invalid', () => {
    const h = harness()
    expect(() =>
      persist(h, {
        adaptations: [
          { decidedAtMonotonicMs: 1, boundary: 'not-a-boundary' as never, inputs: {}, decision: {} },
        ],
      }),
    ).toThrow()
    expect(h.count('sessions')).toBe(0)
    expect(h.count('generated_workouts')).toBe(0)
  })

  it('leaves an earlier successful session untouched by a later failure', () => {
    const h = harness()
    persist(h)
    expect(h.count('sessions')).toBe(1)

    expect(() =>
      persist(h, { cueResults: [cueRow({ outcome: 'nonsense' as never })] }),
    ).toThrow()

    // The first workout is still whole.
    expect(h.count('sessions')).toBe(1)
    expect(h.count('cue_results')).toBe(2)
  })

  it('can write again after a failure — the connection is not left in a transaction', () => {
    const h = harness()
    expect(() =>
      persist(h, { cueResults: [cueRow({ outcome: 'nonsense' as never })] }),
    ).toThrow()

    expect(() => persist(h)).not.toThrow()
    expect(h.count('sessions')).toBe(1)
  })
})

describe('the realized stream is not optional (D8)', () => {
  it('refuses to write a session with no realized stream', () => {
    // Recalculation replays what ran, so a session that could never be
    // recomputed must not be stored as if it could.
    const h = harness()
    expect(() => persist(h, { realized: [] })).toThrow(/realized stream/i)
    expect(h.count('sessions')).toBe(0)
  })

  it('round-trips the realized stream it was given', () => {
    const h = harness()
    const result = persist(h)
    const back = h.workouts.getWorkoutBySession(result.sessionId)
    expect(back?.realized).toEqual(realizedStream())
  })
})

describe('an empty but valid workout', () => {
  it('writes a session with no cue results rather than failing', () => {
    // Someone who started a workout and stopped before throwing anything
    // still had a session; it is simply an empty one.
    const h = harness()
    const result = persist(h, { cueResults: [], cancelled: true })
    expect(h.count('sessions')).toBe(1)
    expect(result.cueResultCount).toBe(0)
  })
})
