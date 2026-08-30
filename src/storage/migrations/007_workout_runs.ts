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
 * ## Rebuild instead of ALTER TABLE DROP COLUMN
 *
 * `DROP COLUMN` needs SQLite 3.35+ and every supported target ships that,
 * but we already have a precedent for the rebuild-copy-drop-rename pattern
 * in 005 (`cue_result_repeat_index`) so this migration matches its shape.
 * `PRAGMA defer_foreign_keys` is set for the duration of the transaction —
 * `cue_results.generated_workout_id` FKs against `generated_workouts(id)`,
 * and the FK check would otherwise fire the instant we drop the old table.
 * The check runs at COMMIT, by which time the new `generated_workouts`
 * table exists with the same id column and every referenced id is present.
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
      PRAGMA defer_foreign_keys = ON;

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

      INSERT OR IGNORE INTO workout_runs
        (session_id, generated_workout_id, realized_tokens_json, created_at)
      SELECT session_id, id, realized_tokens_json, created_at
      FROM generated_workouts
      WHERE session_id IS NOT NULL;

      CREATE TABLE generated_workouts_007 (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL REFERENCES workout_recipes(id) ON DELETE RESTRICT,
        generator_version TEXT NOT NULL,
        seed TEXT NOT NULL,
        params_snapshot_json TEXT NOT NULL,
        blocks_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      INSERT INTO generated_workouts_007
        (id, recipe_id, generator_version, seed,
         params_snapshot_json, blocks_json, created_at)
      SELECT id, recipe_id, generator_version, seed,
             params_snapshot_json, blocks_json, created_at
      FROM generated_workouts;

      DROP TABLE generated_workouts;
      ALTER TABLE generated_workouts_007 RENAME TO generated_workouts;

      CREATE INDEX IF NOT EXISTS idx_generated_workouts_recipe
        ON generated_workouts(recipe_id, created_at DESC);
    `)
  },
}
