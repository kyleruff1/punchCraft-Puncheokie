/**
 * Migration 003 — schema shape, the §18.2 rejection enum, and the cascade
 * contract, verified against a real in-memory SQLite (node:sqlite).
 *
 * The cascade assertions are the load-bearing ones: raw capture data (§12.4,
 * non-negotiable rule 1) must survive the deletion of every derived row.
 */

import { MIGRATIONS_FOR_TESTS } from '@storage/migrations'
import { PUNCH_REJECTION_REASONS } from '@storage/migrations/003_sessions'

import { createMigratedDb, type MemoryDb } from './helpers/memoryDb'

interface ColumnInfo {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
}

const columnsOf = (db: MemoryDb, table: string): string[] =>
  db.query<ColumnInfo>(`PRAGMA table_info(${table})`).map((c) => c.name)

let db: MemoryDb

beforeEach(() => {
  db = createMigratedDb()
})

afterEach(() => {
  db.close()
})

describe('migration registry', () => {
  it('registers 003_sessions with a unique, never-renumbered id', () => {
    const ids = MIGRATIONS_FOR_TESTS.map((m) => m.id)
    expect(ids).toEqual([1, 2, 3, 4, 5, 6])
    expect(new Set(ids).size).toBe(ids.length)
    expect(MIGRATIONS_FOR_TESTS.find((m) => m.id === 3)?.name).toBe('003_sessions')
    // 004 was claimed by the workouts migration (#176) and 005 by the
    // cue_results key fix (M33-08); 003 keeps its id.
    expect(MIGRATIONS_FOR_TESTS.find((m) => m.id === 4)?.name).toBe('004_workouts')
    expect(MIGRATIONS_FOR_TESTS.find((m) => m.id === 5)?.name).toBe('cue_result_repeat_index')
    expect(MIGRATIONS_FOR_TESTS.find((m) => m.id === 6)?.name).toBe('app_settings')
  })
})

describe('sessions table', () => {
  it('has exactly the §17.1 columns plus the §9.5 counters', () => {
    expect(columnsOf(db, 'sessions')).toEqual([
      'id',
      'mode',
      'status',
      'started_at',
      'ended_at',
      'started_monotonic_ms',
      'ended_monotonic_ms',
      'active_duration_ms',
      'timer_config_json',
      'generated_workout_id',
      'spotify_playlist_id',
      'left_calibration_id',
      'right_calibration_id',
      'notes',
      'duplicates_suppressed',
      'rejected_events',
      'unmatched_events',
      'malformed_events',
      'created_at',
    ])
  })

  it('carries generated_workout_id and no retired program_id', () => {
    const cols = columnsOf(db, 'sessions')
    expect(cols).toContain('generated_workout_id')
    expect(cols).not.toContain('program_id')
  })

  it('defaults every quality counter and active_duration_ms to zero', () => {
    db.execSync(
      `INSERT INTO sessions (id, mode, status, created_at)
       VALUES ('s1', 'puncheokie', 'configuring', '2026-08-23T00:00:00.000Z')`,
    )
    const row = db.query<Record<string, number>>('SELECT * FROM sessions WHERE id = ?', ['s1'])[0]!
    expect(row.active_duration_ms).toBe(0)
    expect(row.duplicates_suppressed).toBe(0)
    expect(row.rejected_events).toBe(0)
    expect(row.unmatched_events).toBe(0)
    expect(row.malformed_events).toBe(0)
  })

  it('rejects an unknown mode and an unknown status', () => {
    expect(() =>
      db.execSync(
        `INSERT INTO sessions (id, mode, status, created_at) VALUES ('bad', 'kickboxing', 'ready', 'x')`,
      ),
    ).toThrow(/CHECK constraint failed/i)
    expect(() =>
      db.execSync(
        `INSERT INTO sessions (id, mode, status, created_at) VALUES ('bad', 'puncheokie', 'sprinting', 'x')`,
      ),
    ).toThrow(/CHECK constraint failed/i)
  })
})

describe('rounds table', () => {
  it('stores both the monotonic and the wall-clock boundary of each phase', () => {
    expect(columnsOf(db, 'rounds')).toEqual([
      'id',
      'session_id',
      'round_number',
      'work_started_at',
      'work_ended_at',
      'rest_started_at',
      'rest_ended_at',
      'work_started_monotonic_ms',
      'work_ended_monotonic_ms',
      'rest_started_monotonic_ms',
      'rest_ended_monotonic_ms',
    ])
  })

  it('refuses a duplicate round number within one session', () => {
    db.execSync(
      `INSERT INTO sessions (id, mode, status, created_at) VALUES ('s1','punchcraft','work','t');
       INSERT INTO rounds (id, session_id, round_number) VALUES ('r1','s1',1);`,
    )
    expect(() =>
      db.execSync(`INSERT INTO rounds (id, session_id, round_number) VALUES ('r2','s1',1)`),
    ).toThrow(/UNIQUE constraint failed/i)
  })

  it('refuses a round pointing at a session that does not exist', () => {
    expect(() =>
      db.execSync(`INSERT INTO rounds (id, session_id, round_number) VALUES ('r1','nope',1)`),
    ).toThrow(/FOREIGN KEY constraint failed/i)
  })
})

describe('session_metrics table', () => {
  it('has the §17.1 columns including calculation_version', () => {
    expect(columnsOf(db, 'session_metrics')).toEqual([
      'id',
      'session_id',
      'round_id',
      'metric_key',
      'metric_value',
      'metric_unit',
      'calculation_version',
      'calculated_at',
    ])
  })

  it('keeps one row per scope + key + calculation version', () => {
    db.execSync(
      `INSERT INTO sessions (id, mode, status, created_at) VALUES ('s1','punchcraft','completed','t');
       INSERT INTO session_metrics (id, session_id, round_id, metric_key, metric_value, metric_unit, calculation_version, calculated_at)
         VALUES ('m1','s1',NULL,'punch_count',120,'count','1.0.0','t');`,
    )
    // Same scope + key + version collides even though round_id is NULL.
    expect(() =>
      db.execSync(
        `INSERT INTO session_metrics (id, session_id, round_id, metric_key, metric_value, metric_unit, calculation_version, calculated_at)
           VALUES ('m2','s1',NULL,'punch_count',121,'count','1.0.0','t')`,
      ),
    ).toThrow(/UNIQUE constraint failed/i)
    // A newer calculation version coexists with the old value.
    db.execSync(
      `INSERT INTO session_metrics (id, session_id, round_id, metric_key, metric_value, metric_unit, calculation_version, calculated_at)
         VALUES ('m3','s1',NULL,'punch_count',119,'count','2.0.0','t')`,
    )
    expect(db.count('SELECT COUNT(*) AS n FROM session_metrics')).toBe(2)
  })
})

describe('session_tracker_quality table', () => {
  it('holds the per-tracker §9.5 gap totals keyed by session + tracker', () => {
    expect(columnsOf(db, 'session_tracker_quality')).toEqual([
      'session_id',
      'tracker_key',
      'device_id',
      'hand',
      'gap_count',
      'gap_total_ms',
      'reconnect_count',
      'updated_at',
    ])
  })
})

describe('punch_events alterations', () => {
  it('keeps every migration-002 column and adds the session linkage', () => {
    const cols = columnsOf(db, 'punch_events')
    // Retained from 002 (§17.1 / §18.2 acceptance criteria).
    for (const kept of [
      'source_frame_id',
      'velocity_raw',
      'velocity_calibrated',
      'velocity_unit',
      'decoder_id',
      'decoder_version',
      'quality_flags',
    ]) {
      expect(cols).toContain(kept)
    }
    // Added by 003.
    expect(cols.slice(-4)).toEqual([
      'session_id',
      'round_id',
      'calibration_profile_id',
      'rejection_reason',
    ])
  })

  it('accepts NULL and every documented §18.2 reason code, and nothing else', () => {
    db.execSync(
      `INSERT INTO sessions (id, mode, status, created_at) VALUES ('s1','punchcraft','work','t')`,
    )
    const insert = (id: string, reason: string | null): void => {
      db.query(
        `INSERT INTO punch_events
           (id, source_frame_id, hand, received_monotonic_time_ms, received_wall_time_iso,
            velocity_unit, decoder_id, decoder_version, tracker_timestamp_ms,
            session_id, rejection_reason)
         VALUES (?, 'f1', 'left', 1, 't', 'tracker-unit', 'fightcamp-v1', '1.0.0', ?, 's1', ?)`,
        [id, id, reason],
      )
    }

    insert('accepted', null)
    for (const reason of PUNCH_REJECTION_REASONS) insert(reason, reason)
    expect(db.count('SELECT COUNT(*) AS n FROM punch_events')).toBe(
      PUNCH_REJECTION_REASONS.length + 1,
    )
    expect(
      db.count('SELECT COUNT(*) AS n FROM punch_events WHERE rejection_reason IS NOT NULL'),
    ).toBe(PUNCH_REJECTION_REASONS.length)

    expect(() => insert('bogus', 'because-i-said-so')).toThrow(/CHECK constraint failed/i)
  })

  it('keeps the exported enum in step with the CHECK constraint in the schema', () => {
    const sql =
      db.query<{ sql: string }>(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'punch_events'`,
      )[0]?.sql ?? ''
    const check = /rejection_reason IN \(([^)]*)\)/i.exec(sql)?.[1] ?? ''
    const inConstraint = [...check.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(inConstraint.sort()).toEqual([...PUNCH_REJECTION_REASONS].sort())
  })
})

describe('cascade contract', () => {
  const seed = (): void => {
    db.execSync(`
      INSERT INTO ble_captures (id, started_at) VALUES ('cap1', 't');
      INSERT INTO ble_frames
        (id, capture_id, monotonic_time_ms, wall_time_iso, direction, service_uuid,
         characteristic_uuid, value_base64, value_hex, connection_generation)
        VALUES ('frame1','cap1',1,'t','notification','svc','chr','AA==','00',1);
      INSERT INTO sessions (id, mode, status, created_at) VALUES ('s1','puncheokie','completed','t');
      INSERT INTO rounds (id, session_id, round_number) VALUES ('r1','s1',1);
      INSERT INTO punch_events
        (id, source_frame_id, capture_id, hand, received_monotonic_time_ms, received_wall_time_iso,
         velocity_unit, decoder_id, decoder_version, session_id, round_id)
        VALUES ('p1','frame1','cap1','left',1,'t','tracker-unit','fightcamp-v1','1.0.0','s1','r1');
      INSERT INTO session_metrics
        (id, session_id, round_id, metric_key, metric_value, metric_unit, calculation_version, calculated_at)
        VALUES ('m1','s1','r1','punch_count',10,'count','1.0.0','t');
      INSERT INTO session_tracker_quality (session_id, tracker_key, updated_at)
        VALUES ('s1','EA:69:2D:9C:FD:53','t');
    `)
  }

  it('deletes rounds, punch_events, metrics and quality counters with the session', () => {
    seed()
    db.execSync(`DELETE FROM sessions WHERE id = 's1'`)

    expect(db.count('SELECT COUNT(*) AS n FROM sessions')).toBe(0)
    expect(db.count('SELECT COUNT(*) AS n FROM rounds')).toBe(0)
    expect(db.count('SELECT COUNT(*) AS n FROM punch_events')).toBe(0)
    expect(db.count('SELECT COUNT(*) AS n FROM session_metrics')).toBe(0)
    expect(db.count('SELECT COUNT(*) AS n FROM session_tracker_quality')).toBe(0)
  })

  it('never touches ble_frames or ble_captures — raw capture outlives every derived row', () => {
    seed()
    db.execSync(`DELETE FROM sessions WHERE id = 's1'`)

    expect(db.count('SELECT COUNT(*) AS n FROM ble_frames')).toBe(1)
    expect(db.count('SELECT COUNT(*) AS n FROM ble_captures')).toBe(1)
  })

  it('declares no foreign key from any table onto ble_frames', () => {
    const tables = db
      .query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      )
      .map((r) => r.name)
    for (const table of tables) {
      const fks = db.query<{ table: string }>(`PRAGMA foreign_key_list(${table})`)
      expect(fks.map((f) => f.table)).not.toContain('ble_frames')
    }
  })

  it('deleting a round leaves the session and its punch_events source frame alone', () => {
    seed()
    db.execSync(`DELETE FROM rounds WHERE id = 'r1'`)

    expect(db.count('SELECT COUNT(*) AS n FROM sessions')).toBe(1)
    expect(db.count('SELECT COUNT(*) AS n FROM ble_frames')).toBe(1)
    // punch_events.round_id cascades, so the event goes with its round.
    expect(db.count('SELECT COUNT(*) AS n FROM punch_events')).toBe(0)
  })
})
