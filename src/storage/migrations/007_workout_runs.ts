/**
 * Migration 007 — split per-session realized streams off `generated_workouts`
 * into their own table `workout_runs` (A21 v2 / #274 architectural fix).
 *
 * ## The defect the split addresses
 *
 * 004 put `session_id` and `realized_tokens_json` on `generated_workouts`, on
 * the model of "one workout, one session, one realized stream". The generator
 * is deterministic per `(recipe, seed)`, though, so running the same recipe
 * twice produces the same generated-workout id both times — and the second
 * save collided with the first row on the UNIQUE(`id`) constraint, failing
 * the whole session persist path with `endWriteFailed`.
 *
 * Kyle observed this on-glass 2026-08-30 while running pass 2 of the
 * 11-round test protocol. A first attempt fixed it with
 * `INSERT ... ON CONFLICT DO UPDATE` — that unblocked the persist path,
 * but only by overwriting the earlier run's realized stream on
 * generated_workouts. Two SESSIONS through the same plan still shared one
 * `realized_tokens_json`, and the earlier one was silently rewritten. So
 * the invariant "the row I saved is the row I read back" only held for the
 * MOST RECENT session on any given plan.
 *
 * This migration models the shape the code always meant: a `generated_workout`
 * is the IMMUTABLE plan (recipe expansion, one per id), and a `workout_run`
 * is the per-SESSION record of what actually executed. Two sessions through
 * the same plan produce two run rows and one plan row. Each session's stream
 * is preserved.
 *
 * ## Shape after this migration
 *
 * - `generated_workouts` — id, recipe_id, generator_version, seed,
 *   params_snapshot_json, blocks_json, created_at.
 *   `session_id` and `realized_tokens_json` are GONE (moved).
 *
 * - `workout_runs` — session_id PRIMARY KEY, generated_workout_id (FK to
 *   plans), realized_tokens_json (what actually ran), created_at.
 *   One row per session. `cue_results` (keyed on session + workout + block +
 *   repeat + token) unchanged.
 *
 * ## ALTER TABLE DROP COLUMN, not the copy-drop-rename dance
 *
 * A previous cut of this migration followed 005's pattern: create a new
 * `generated_workouts_007` shape, copy rows, DROP the old table, RENAME.
 * That works in-memory but fails on the tablet at
 * `NativeDatabase.execSync ... FOREIGN KEY constraint failed`, because
 * `cue_results.generated_workout_id`, `workout_adaptations.generated_workout_id`,
 * and (the newly created) `workout_runs.generated_workout_id` all FK against
 * `generated_workouts(id)`. Dropping the referenced table hits those FK
 * checks the instant it runs — `PRAGMA defer_foreign_keys = ON` looked
 * like the right escape hatch, but expo-sqlite does not honour deferred
 * FKs across statements inside `execSync` the way the docs describe.
 *
 * `ALTER TABLE DROP COLUMN` avoids the entire dance: the table stays put,
 * every FK stays valid, and only the two moved columns disappear. It needs
 * SQLite 3.35+ (which both expo-sqlite and node-sqlite ship well past),
 * and the only prep the columns need is dropping any index that references
 * them — SQLite refuses to drop a column that's still indexed.
 *
 * ## Backfill correctness
 *
 * Existing rows on the dev tablet: one `generated_workouts` row per unique
 * `(recipe, seed)` (there were duplicates rejected before A21's ON CONFLICT
 * UPDATE landed, so the survivor was always the FIRST insert with the ORIGINAL
 * realized stream). After A21 v1, later runs overwrote that stream, so the
 * survivor is the MOST RECENT run's stream. Either way: the surviving row
 * carries A realized stream that belongs to A session — safe to lift into
 * `workout_runs` as that session's record. Older sessions whose streams were
 * already lost are not recoverable; those sessions still have their
 * `cue_results` and their `sessions` row, and their per-token detail lives
 * there — the realized-tokens gap is the pre-fix loss, not something this
 * migration introduces.
 *
 * ## Row-hydration semantics
 *
 * `WorkoutRepository.getWorkoutBySession(sessionId)` reads from `workout_runs`
 * and joins onto `generated_workouts`. `getWorkoutById(id)` returns the plan
 * only — a plan without a chosen session has no single realized stream, and
 * asking "the realized" without naming a session was always ambiguous under
 * multi-run semantics.
 */

import type { SQLiteDatabase } from 'expo-sqlite'

import type { Migration } from './index'

export const MIGRATION_007: Migration = {
  id: 7,
  name: '007_workout_runs',
  up(db: SQLiteDatabase): void {
    db.execSync(`
      CREATE TABLE workout_runs (
        session_id TEXT PRIMARY KEY
          REFERENCES sessions(id) ON DELETE CASCADE,
        generated_workout_id TEXT NOT NULL
          REFERENCES generated_workouts(id) ON DELETE RESTRICT,
        realized_tokens_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workout_runs_workout
        ON workout_runs(generated_workout_id, created_at DESC);

      -- Backfill: any generated_workouts row that was actually run gets a
      -- workout_runs row carrying its realized stream. Unrun plans do not
      -- produce a run row; their realized_tokens_json is not recoverable
      -- after the DROP COLUMN below, but under the pre-007 semantics that
      -- column held the planned expansion (D8), which is derivable from
      -- blocks_json.schedule if any consumer ever needs it.
      INSERT OR IGNORE INTO workout_runs
        (session_id, generated_workout_id, realized_tokens_json, created_at)
      SELECT session_id, id, realized_tokens_json, created_at
      FROM generated_workouts
      WHERE session_id IS NOT NULL;

      -- SQLite refuses to drop a column that is still indexed; the
      -- session-id index went with the column semantically anyway.
      DROP INDEX IF EXISTS idx_generated_workouts_session;

      ALTER TABLE generated_workouts DROP COLUMN session_id;
      ALTER TABLE generated_workouts DROP COLUMN realized_tokens_json;
    `)
  },
}
