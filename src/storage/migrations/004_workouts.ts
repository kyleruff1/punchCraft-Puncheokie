/**
 * Migration 004 — the Puncheokie workout tables (#176 / M31-08, spec §17.1 as
 * amended, doc §16/§22/§24).
 *
 * What this adds:
 *
 * 1. `workout_recipes` — the parameter set a workout is generated from. The
 *    recipe object itself lives in `params_json` under `recipe_schema_version`
 *    so an older row stays readable after the type gains a field; identity
 *    (`id`, `name`, `preset_key`) belongs to the row, not to the parameter set
 *    (D14).
 *
 * 2. `generated_workouts` — one expansion of a recipe. `realized_tokens_json`
 *    is **NOT NULL** (D8): recalculation replays what actually happened —
 *    blocks inserted, shortened, or dropped by adaptation — and never re-derives
 *    the plan from the recipe. Before the first adaptation the realized stream
 *    simply equals the planned expansion, so there is no honest reason for the
 *    column to be empty.
 *
 * 3. `workout_adaptations` — an append-only decision log. Every row carries the
 *    inputs and the decision, stamped with `decided_at_monotonic_ms`, so a
 *    goal-seeking run is reconstructable step by step (doc §22). Monotonic ms
 *    is the only clock here: a wall time would be reordered by a system-clock
 *    change mid-session (spec §3.2, §18.3).
 *
 * 4. `cue_results` — one row per punch token window. Defense, footwork and
 *    coach tokens are display-only and are never scored (D4), so they never
 *    produce a row.
 *
 * **The v1.0 `punch_programs`, `program_rounds` and `punch_cues` tables are
 * superseded and are deliberately never created** (spec §17.1 note, C5/D8).
 * Editable programs were retired in favour of recipe + seeded generator, and a
 * Puncheokie session points at a generated workout instead.
 *
 * Foreign keys are declared throughout (`PRAGMA foreign_keys = ON` is set by
 * `database.ts`), with two deliberate delete policies:
 *
 * - `generated_workouts.recipe_id` is **RESTRICT**: a recipe that has already
 *   produced a run is history, and deleting it would silently take the run's
 *   provenance with it (spec §8.6).
 * - `generated_workouts.session_id` is **SET NULL**: the column is nullable
 *   until the workout is run, so a deleted session leaves an unrun plan behind
 *   rather than destroying it. `cue_results` do cascade with the session,
 *   because a result without its session is meaningless.
 *
 * SHIPPED — do not edit. Correct anything here with a new migration.
 */

import type { Migration } from '@/storage/migrations'

/**
 * Boundaries at which the pacing engine is allowed to adapt (doc §22).
 * Mid-block adaptation is excluded on purpose: changing the plan while a cue
 * window is open would invalidate the window the athlete is already inside.
 *
 * Frozen alongside the CHECK constraint below — adding a value is a new
 * migration, never an edit here.
 */
export const ADAPTATION_BOUNDARIES = ['block', 'rest', 'round'] as const
export type AdaptationBoundary = (typeof ADAPTATION_BOUNDARIES)[number]

/**
 * Outcomes for one punch cue window (spec §17.1).
 *
 * ⚠️ **`type-mismatch` is unreachable on FightCamp v1 hardware (D12).** The
 * capability tier resolves to `hand-timestamp` — H12 showed the payload's type
 * byte carries no device-portable meaning (hooks read as byte 2 on one tracker
 * and byte 1 on the other), so which technique was thrown is unobservable and
 * no code path may assert it. The value stays in this enum, and
 * `cue_results.expected_type` stays nullable, purely so a future decoder on
 * different hardware can populate both without a table rebuild. On today's
 * hardware `expected_type` is always NULL and no writer may emit
 * `type-mismatch`.
 *
 * `during-pause` records a strike that arrived while the session was paused;
 * `missed` also covers a strike below the tracker's transmit floor, which
 * simply does not exist to the app (D13).
 *
 * Frozen alongside the CHECK constraint below.
 */
export const CUE_OUTCOMES = [
  'matched',
  'hand-mismatch',
  'type-mismatch',
  'missed',
  'late',
  'during-pause',
] as const
export type CueOutcome = (typeof CUE_OUTCOMES)[number]

export const MIGRATION_004: Migration = {
  id: 4,
  name: '004_workouts',
  up(db) {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS workout_recipes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        -- Built-in preset this recipe derives from; NULL for a hand-tuned one.
        preset_key TEXT,
        default_stance TEXT NOT NULL CHECK(default_stance IN ('orthodox','southpaw')),
        -- The whole WorkoutRecipe object, versioned by the column below.
        params_json TEXT NOT NULL,
        recipe_schema_version INTEGER NOT NULL,
        -- Wall time: these two are display and export only (§18.3).
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workout_recipes_preset
        ON workout_recipes(preset_key);
      CREATE INDEX IF NOT EXISTS idx_workout_recipes_updated
        ON workout_recipes(updated_at DESC);

      CREATE TABLE IF NOT EXISTS generated_workouts (
        id TEXT PRIMARY KEY,
        recipe_id TEXT NOT NULL REFERENCES workout_recipes(id) ON DELETE RESTRICT,
        -- NULL until the workout is actually run.
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        -- Same recipe + generator_version + seed reproduces this plan (R18).
        generator_version TEXT NOT NULL,
        seed TEXT NOT NULL,
        params_snapshot_json TEXT NOT NULL,
        blocks_json TEXT NOT NULL,
        -- D8: what actually executed, never re-derived from the recipe.
        realized_tokens_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_generated_workouts_session
        ON generated_workouts(session_id);
      CREATE INDEX IF NOT EXISTS idx_generated_workouts_recipe
        ON generated_workouts(recipe_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS workout_adaptations (
        id TEXT PRIMARY KEY,
        generated_workout_id TEXT NOT NULL
          REFERENCES generated_workouts(id) ON DELETE CASCADE,
        -- Monotonic only: ordering must survive a system-clock change (§3.2).
        decided_at_monotonic_ms REAL NOT NULL,
        boundary TEXT NOT NULL CHECK(boundary IN ('block','rest','round')),
        inputs_json TEXT NOT NULL,
        decision_json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_workout_adaptations_workout
        ON workout_adaptations(generated_workout_id, decided_at_monotonic_ms);

      CREATE TABLE IF NOT EXISTS cue_results (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        generated_workout_id TEXT NOT NULL
          REFERENCES generated_workouts(id) ON DELETE CASCADE,
        block_id TEXT NOT NULL,
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
        PRIMARY KEY (session_id, generated_workout_id, block_id, token_index)
      );

      CREATE INDEX IF NOT EXISTS idx_cue_results_session
        ON cue_results(session_id);
      CREATE INDEX IF NOT EXISTS idx_cue_results_workout
        ON cue_results(generated_workout_id);
    `)
  },
}
