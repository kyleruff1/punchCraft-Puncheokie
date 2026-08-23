/**
 * Process-wide workout repositories, wired to the app database.
 *
 * Mirrors `getCaptureService`: the repositories stay constructor-injected
 * and unit-testable, while a screen gets a one-call accessor instead of
 * assembling them by hand.
 *
 * The override exists so the live screen's tests never open a real
 * database — `openDatabase()` pulls in expo-sqlite's native binding, which
 * does not exist on the Windows workstation (spec §21.1).
 */

import { openDatabase } from './database'
import { SessionRepository } from './repositories/SessionRepository'
import { WorkoutRepository } from './repositories/WorkoutRepository'
import type { SqlPort } from './SqlPort'

export interface WorkoutPersistence {
  db: SqlPort
  sessions: SessionRepository
  workouts: WorkoutRepository
}

let instance: WorkoutPersistence | null = null
let override: WorkoutPersistence | null = null

/** Lazily assemble the shared workout repositories. */
export function getWorkoutPersistence(): WorkoutPersistence {
  if (override) return override
  if (instance) return instance
  const db = openDatabase()
  instance = {
    db,
    sessions: new SessionRepository(db),
    workouts: new WorkoutRepository(db),
  }
  return instance
}

/**
 * Substitute the repositories, for tests and for the in-memory harness.
 * Pass `null` to restore the real ones.
 */
export function __setWorkoutPersistenceForTests(next: WorkoutPersistence | null): void {
  override = next
}
