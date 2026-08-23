/**
 * Migration 005 — `cue_results.repeat_index` (M33-08).
 *
 * ## The defect
 *
 * 004 keyed `cue_results` on
 * `(session_id, generated_workout_id, block_id, token_index)`. That assumes a
 * block produces one cue. It does not: a `repeated-combo` block with
 * `repeat: 2` expands into two cues on the timeline, each naming the same
 * token indexes, and `CueInstance` has carried a `repeatIndex` since the
 * timeline was written.
 *
 * So the second time through a combination, every row collided with the first
 * and the whole batch rolled back — taking the session with it, because the
 * write is one transaction. A workout that used any repeated block could not
 * be saved at all. It surfaced the moment the runner was wired to persist
 * (#194), which is the first time real rows reached the table.
 *
 * ## Why a new migration rather than a fix to 004
 *
 * 004 has already run on the development tablet, and the runner records
 * applied ids — an edited 004 would never re-run there, leaving that device
 * on the old shape while the code expected the new one. That silent
 * divergence is exactly what the append-only rule exists to prevent.
 *
 * ## Why a rebuild rather than ALTER TABLE ADD COLUMN
 *
 * The column has to join the primary key, and SQLite cannot alter a key in
 * place. Existing rows take `repeat_index = 0`, which is not a guess: under
 * the old key a `(block_id, token_index)` pair could appear only once per
 * session, so every stored row was necessarily the first pass.
 *
 * Nothing references `cue_results`, so the rename carries no foreign keys
 * with it. The runner already wraps each migration in its own transaction.
 */

import type { SQLiteDatabase } from 'expo-sqlite'

import type { Migration } from './index'

export const MIGRATION_005: Migration = {
  id: 5,
  name: 'cue_result_repeat_index',
  up(db: SQLiteDatabase): void {
    db.execSync(`
      CREATE TABLE cue_results_005 (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        generated_workout_id TEXT NOT NULL
          REFERENCES generated_workouts(id) ON DELETE CASCADE,
        block_id TEXT NOT NULL,
        -- Which pass through a repeated block this row belongs to. 0 for a
        -- block that runs once.
        repeat_index INTEGER NOT NULL DEFAULT 0,
        token_index INTEGER NOT NULL,
        expected_hand TEXT NOT NULL CHECK(expected_hand IN ('left','right')),
        -- Always NULL on FightCamp v1 (D12); kept for a future decoder.
        expected_type TEXT,
        observed_event_id TEXT REFERENCES punch_events(id) ON DELETE SET NULL,
        outcome TEXT NOT NULL CHECK(outcome IN (
          'matched','hand-mismatch','type-mismatch','missed','late','during-pause'
        )),
        -- Event time minus window open, on the monotonic clock.
        offset_ms REAL,
        -- Tracker-reported values stored as received, with the unit they were
        -- reported in. The schema states no physical unit of its own (§4.3).
        velocity_raw REAL,
        velocity_calibrated REAL,
        velocity_unit TEXT,
        capability_tier TEXT NOT NULL,
        decoder_version TEXT NOT NULL,
        calculation_version TEXT NOT NULL,
        PRIMARY KEY (session_id, generated_workout_id, block_id, repeat_index, token_index)
      );

      INSERT INTO cue_results_005
        (session_id, generated_workout_id, block_id, repeat_index, token_index,
         expected_hand, expected_type, observed_event_id, outcome, offset_ms,
         velocity_raw, velocity_calibrated, velocity_unit,
         capability_tier, decoder_version, calculation_version)
      SELECT
         session_id, generated_workout_id, block_id, 0, token_index,
         expected_hand, expected_type, observed_event_id, outcome, offset_ms,
         velocity_raw, velocity_calibrated, velocity_unit,
         capability_tier, decoder_version, calculation_version
      FROM cue_results;

      DROP TABLE cue_results;
      ALTER TABLE cue_results_005 RENAME TO cue_results;

      CREATE INDEX IF NOT EXISTS idx_cue_results_session
        ON cue_results(session_id);
      CREATE INDEX IF NOT EXISTS idx_cue_results_workout
        ON cue_results(generated_workout_id);
    `)
  },
}
