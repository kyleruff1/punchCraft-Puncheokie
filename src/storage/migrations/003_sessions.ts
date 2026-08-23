/**
 * Migration 003 — sessions, rounds, session_metrics, and the punch_events
 * session linkage (spec §17.1, §18.2, §9.5).
 *
 * What this adds:
 *
 * 1. `sessions` — one row per training session in any of the three modes,
 *    carrying the §17.1 columns plus the §9.5 session-wide quality counters.
 *    `generated_workout_id` is nullable and intentionally has NO foreign key:
 *    `generated_workouts` arrives in migration 004 (#176), and SQLite cannot
 *    add a constraint to an existing table afterwards without a table rebuild.
 *    The same applies to `left_calibration_id` / `right_calibration_id`, whose
 *    `calibration_profiles` table is not created yet either. Both are stored
 *    as plain ids and resolved by the repository layer.
 *
 *    The old §17.1 `program_id` column is deliberately absent: editable
 *    programs were retired by the §17.1 amendment (Puncheokie plan C5/D8), and
 *    a Puncheokie session points at a generated workout instead.
 *
 * 2. `rounds` — work/rest boundaries per round. Every boundary is stored twice:
 *    the monotonic value is authoritative for ordering and duration, the ISO
 *    value exists only for display and export (§18.3).
 *
 * 3. `session_metrics` — computed metrics, versioned by `calculation_version`
 *    so a metric recomputed under a newer engine does not overwrite history.
 *    MetricsEngine (M22-03) is the exclusive writer; `SessionRepository`
 *    exposes reads only.
 *
 * 4. `session_tracker_quality` — the per-tracker half of the §9.5 counters
 *    (notification gaps and reconnects), which cannot live on `sessions`
 *    because a session has two trackers.
 *
 * 5. `punch_events` ALTERs — migration 002 already created the table with the
 *    source-frame reference, raw + calibrated values, unit, decoder id and
 *    version, and quality flags, so this migration only adds what was missing:
 *    the session/round linkage, the calibration profile actually applied to
 *    that event's hand, and the §18.2 rejection reason.
 *
 * Cascade contract: deleting a session removes its rounds, its punch_events,
 * its session_metrics and its quality counters, and never touches `ble_frames`
 * — punch_events references its source frame by id with no foreign key, so raw
 * capture data outlives every derived row (§12.4, non-negotiable rule 1).
 *
 * SHIPPED — do not edit. Correct anything here with a new migration.
 */

import type { Migration } from '@/storage/migrations'

/**
 * Rejection reason codes for `punch_events.rejection_reason` (§18.2).
 *
 * NULL means the event was accepted into default metrics. Every other value
 * names exactly one failed acceptance condition, so a rejected event stays
 * queryable instead of being dropped.
 *
 * - `unexpected-tracker`   — the event did not come from a tracker enrolled in
 *                            this session.
 * - `duplicate`            — confirmed or likely duplicate of an event already
 *                            accepted (compound-key dedup, migration 002).
 * - `decoder-invalid`      — failed the decoder's validity checks; this is the
 *                            code behind the §9.5 `malformed_events` counter.
 * - `outside-work-interval`— arrived outside an active work interval (during
 *                            countdown, rest, pause, or after the last round).
 * - `user-discarded`       — the athlete marked it discarded in review.
 * - `calibration-invalid`  — a calibration transformation was required and did
 *                            not produce a usable value.
 *
 * This list is frozen alongside the CHECK constraint below. Adding a code is a
 * new migration, never an edit here — `003_sessions.migration.test.ts` asserts
 * the two stay in step.
 */
export const PUNCH_REJECTION_REASONS = [
  'unexpected-tracker',
  'duplicate',
  'decoder-invalid',
  'outside-work-interval',
  'user-discarded',
  'calibration-invalid',
] as const

export type PunchRejectionReason = (typeof PUNCH_REJECTION_REASONS)[number]

/** Session modes (§17.1). */
export const SESSION_MODES = ['velocity-test', 'punchcraft', 'puncheokie'] as const
export type SessionMode = (typeof SESSION_MODES)[number]

/** Session status values — the §18.1 state machine, persisted verbatim. */
export const SESSION_STATUSES = [
  'configuring',
  'ready',
  'countdown',
  'work',
  'paused',
  'rest',
  'finishing',
  'completed',
  'cancelled',
] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

export const MIGRATION_003: Migration = {
  id: 3,
  name: '003_sessions',
  up(db) {
    db.execSync(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK(mode IN ('velocity-test','punchcraft','puncheokie')),
        status TEXT NOT NULL CHECK(status IN (
          'configuring','ready','countdown','work','paused','rest','finishing','completed','cancelled'
        )),

        -- Wall time is display/export only (§18.3); the monotonic pair below
        -- is what orders and measures the session.
        started_at TEXT,
        ended_at TEXT,
        started_monotonic_ms REAL,
        ended_monotonic_ms REAL,
        active_duration_ms REAL NOT NULL DEFAULT 0,

        timer_config_json TEXT,
        generated_workout_id TEXT,
        spotify_playlist_id TEXT,
        left_calibration_id TEXT,
        right_calibration_id TEXT,
        notes TEXT,

        -- §9.5 session-wide quality counters.
        duplicates_suppressed INTEGER NOT NULL DEFAULT 0,
        rejected_events INTEGER NOT NULL DEFAULT 0,
        unmatched_events INTEGER NOT NULL DEFAULT 0,
        malformed_events INTEGER NOT NULL DEFAULT 0,

        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_started
        ON sessions(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_mode
        ON sessions(mode, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_sessions_generated_workout
        ON sessions(generated_workout_id);

      CREATE TABLE IF NOT EXISTS rounds (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        round_number INTEGER NOT NULL,

        work_started_at TEXT,
        work_ended_at TEXT,
        rest_started_at TEXT,
        rest_ended_at TEXT,

        work_started_monotonic_ms REAL,
        work_ended_monotonic_ms REAL,
        rest_started_monotonic_ms REAL,
        rest_ended_monotonic_ms REAL,

        UNIQUE(session_id, round_number)
      );

      CREATE INDEX IF NOT EXISTS idx_rounds_session
        ON rounds(session_id, round_number);

      CREATE TABLE IF NOT EXISTS session_metrics (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        round_id TEXT REFERENCES rounds(id) ON DELETE CASCADE,
        metric_key TEXT NOT NULL,
        metric_value REAL,
        metric_unit TEXT,
        calculation_version TEXT NOT NULL,
        calculated_at TEXT NOT NULL
      );

      -- One value per (scope, key, calculation version). COALESCE keeps the
      -- session-scoped rows (round_id NULL) from defeating the index, since
      -- NULLs never compare equal.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_session_metrics_scope_key
        ON session_metrics(session_id, COALESCE(round_id, ''), metric_key, calculation_version);
      CREATE INDEX IF NOT EXISTS idx_session_metrics_session
        ON session_metrics(session_id, metric_key);

      -- Per-tracker half of the §9.5 counters. tracker_key is the transport
      -- address when known, matching punch_events.device_address; device_id is
      -- the resolved surrogate key and may be null.
      CREATE TABLE IF NOT EXISTS session_tracker_quality (
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        tracker_key TEXT NOT NULL,
        device_id TEXT REFERENCES tracker_devices(id) ON DELETE SET NULL,
        hand TEXT NOT NULL DEFAULT 'unknown' CHECK(hand IN ('left','right','unknown')),
        gap_count INTEGER NOT NULL DEFAULT 0,
        gap_total_ms REAL NOT NULL DEFAULT 0,
        reconnect_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, tracker_key)
      );
    `)

    // punch_events already exists (migration 002). ALTER, never re-create.
    // Each added foreign key defaults to NULL, which is the only form SQLite
    // accepts for ADD COLUMN while foreign keys are enforced.
    db.execSync(`
      ALTER TABLE punch_events ADD COLUMN session_id TEXT
        REFERENCES sessions(id) ON DELETE CASCADE;
      ALTER TABLE punch_events ADD COLUMN round_id TEXT
        REFERENCES rounds(id) ON DELETE CASCADE;
      ALTER TABLE punch_events ADD COLUMN calibration_profile_id TEXT;
      ALTER TABLE punch_events ADD COLUMN rejection_reason TEXT
        CHECK(rejection_reason IS NULL OR rejection_reason IN (
          'unexpected-tracker','duplicate','decoder-invalid',
          'outside-work-interval','user-discarded','calibration-invalid'
        ));

      CREATE INDEX IF NOT EXISTS idx_punch_events_session_time
        ON punch_events(session_id, received_monotonic_time_ms);
      CREATE INDEX IF NOT EXISTS idx_punch_events_round
        ON punch_events(round_id);
      CREATE INDEX IF NOT EXISTS idx_punch_events_rejection
        ON punch_events(session_id, rejection_reason);
    `)
  },
}
