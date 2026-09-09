/**
 * One-transaction workout persistence (M33-08, spec §17.1, §19.1).
 *
 * When a workout finishes, four things must land together: the `sessions`
 * row, the `generated_workouts` row carrying the realized token stream, all
 * `cue_results`, and any adaptations the plan made. Either the whole
 * session is recorded or none of it is.
 *
 * ## Why one transaction rather than four writes
 *
 * A partial write is worse than no write. A `sessions` row with no
 * `cue_results` is a workout that looks like it happened and scored zero —
 * indistinguishable, later, from an athlete who threw nothing. A
 * `generated_workouts` row without its session is an orphan the summary
 * can never reach. Both are silent: nothing would surface them until
 * someone opened their history and found a workout that lied about them.
 *
 * `WorkoutRepository.writeCueResults` uses a SAVEPOINT precisely so it can
 * nest inside the `BEGIN` opened here.
 *
 * ## What this does NOT write
 *
 * `session_metrics` belongs to MetricsEngine (#117) and is never touched
 * here. Two writers on one table is how a metric ends up computed twice
 * with two different versions.
 *
 * No React, Expo or BLE imports — this is the storage layer (spec §15.1).
 */

import { logger, safe } from '@/diagnostics/logger'
import type { SqlPort } from './SqlPort'
import type { SessionRepository } from './repositories/SessionRepository'
import type {
  AdaptationRecord,
  CueResultRow,
  RealizedTokenStream,
  WorkoutRepository,
} from './repositories/WorkoutRepository'
import type { GeneratedWorkout } from '@domain/workout/GeneratedWorkout'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'

export interface PersistWorkoutSessionArgs {
  db: SqlPort
  sessions: SessionRepository
  workouts: WorkoutRepository
  /** The plan as actually run, after any adaptation (D8). */
  workout: GeneratedWorkout
  realized: RealizedTokenStream
  /** Rows without their session id; it is assigned here. */
  cueResults: Array<Omit<CueResultRow, 'sessionId' | 'generatedWorkoutId'>>
  /**
   * The punches the cue results name.
   *
   * `cue_results.observed_event_id` is a real foreign key into `punch_events`,
   * and `PRAGMA foreign_keys` is ON — so a result naming a punch that was
   * never written fails the insert and rolls back the entire session. These
   * are written first, inside the same transaction, which is what makes the
   * link the schema promises actually resolvable.
   */
  punchEvents?: readonly TrackerPunchEvent[]
  adaptations?: ReadonlyArray<Omit<AdaptationRecord, 'generatedWorkoutId'>>
  startedMonotonicMs: number
  endedMonotonicMs: number
  activeDurationMs: number
  /** Set when the athlete stopped early rather than finishing. */
  cancelled?: boolean
  /**
   * Wall time for the `ended_at` column — display and export only, never
   * ordering (spec §3.2). Injectable so a test can pin it.
   */
  endedAtIso?: string
}

export interface PersistedWorkoutSession {
  sessionId: string
  generatedWorkoutId: string
  cueResultCount: number
  adaptationCount: number
}

/**
 * Write a finished workout. Throws if anything fails, having rolled back.
 *
 * The caller decides what a failure means for the UI; this only guarantees
 * that a failure leaves the database as it found it.
 */
export function persistWorkoutSession(
  args: PersistWorkoutSessionArgs,
): PersistedWorkoutSession {
  const {
    db,
    sessions,
    workouts,
    workout,
    realized,
    cueResults,
    punchEvents = [],
    adaptations = [],
    startedMonotonicMs,
    endedMonotonicMs,
    activeDurationMs,
    cancelled = false,
    endedAtIso = new Date().toISOString(),
  } = args

  if (realized.length === 0) {
    // `realized_tokens_json` is NOT NULL by design (D8): recalculation
    // replays what ran, so a session with no realized stream could never be
    // recomputed and must not be stored as if it could.
    throw new Error('persistWorkoutSession: refusing to write a session with no realized stream')
  }

  db.execSync('BEGIN')
  try {
    // The session row goes first: `generated_workouts.session_id` is a real
    // foreign key, so the workout cannot be written before its session
    // exists. `sessions.generated_workout_id` has no FK (migration 003
    // predates the workouts table), so it can be set here in one pass.
    const generatedWorkoutId = workout.id
    const session = sessions.create({
      // punchCraft owns building and running workouts; the older
      // 'puncheokie' mode in #194's text predates that move.
      mode: 'punchcraft',
      status: cancelled ? 'cancelled' : 'completed',
      startedMonotonicMs,
      activeDurationMs,
      generatedWorkoutId,
    })

    workouts.saveGeneratedWorkout(workout, realized, session.id)

    sessions.markEnded({
      id: session.id,
      status: cancelled ? 'cancelled' : 'completed',
      endedAtIso,
      endedMonotonicMs,
      activeDurationMs,
    })

    // Before the cue results, so the foreign key they carry resolves.
    for (const event of punchEvents) {
      sessions.appendPunchEvent({
        sessionId: session.id,
        id: event.id,
        sourceFrameId: event.sourceFrameId,
        // A workout is not a capture and may have no device row: both columns
        // are nullable precisely so a session can record its punches without
        // one (migration 002).
        captureId: null,
        deviceId: null,
        deviceAddress: event.deviceId,
        hand: event.hand,
        receivedMonotonicTimeMs: event.receivedMonotonicTimeMs,
        receivedWallTimeIso: event.receivedWallTimeIso,
        ...(event.trackerTimestampMs !== undefined
          ? { trackerTimestampMs: event.trackerTimestampMs }
          : {}),
        ...(event.punchTypeRaw !== undefined ? { punchTypeRaw: event.punchTypeRaw } : {}),
        ...(event.punchType !== undefined ? { punchType: event.punchType } : {}),
        ...(event.accelerationRaw !== undefined
          ? { accelerationRaw: event.accelerationRaw }
          : {}),
        ...(event.velocityRaw !== undefined ? { velocityRaw: event.velocityRaw } : {}),
        velocityUnit: event.velocityUnit,
        recovered: event.recovered ?? false,
        decoderId: event.decoderId,
        decoderVersion: event.decoderVersion,
        qualityFlags: event.qualityFlags ?? [],
      })
    }

    if (cueResults.length > 0) {
      workouts.writeCueResults(
        cueResults.map((row) => ({
          ...row,
          sessionId: session.id,
          generatedWorkoutId,
        })),
      )
    }

    for (const adaptation of adaptations) {
      workouts.appendAdaptation({ ...adaptation, generatedWorkoutId })
    }

    db.execSync('COMMIT')

    logger.info('puncheokie.session.persisted', 'workout session written', {
      session: safe(session.id),
      cueResults: safe(cueResults.length),
      adaptations: safe(adaptations.length),
    })

    return {
      sessionId: session.id,
      generatedWorkoutId,
      cueResultCount: cueResults.length,
      adaptationCount: adaptations.length,
    }
  } catch (err) {
    // Roll back before rethrowing, and never let a rollback failure mask
    // the original error — that is how a real cause gets lost.
    try {
      db.execSync('ROLLBACK')
    } catch (rollbackErr) {
      logger.error('puncheokie.session.rollbackFailed', 'rollback failed after a write error', {
        error: safe(String(rollbackErr)),
      })
    }
    logger.error('puncheokie.session.persistFailed', 'workout session not written', {
      error: safe(String(err)),
    })
    throw err
  }
}
