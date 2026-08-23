/**
 * Migration 004 — the four Puncheokie workout tables, their CHECK enums, the
 * D8 NOT NULL on the realized stream, and the foreign keys, verified against a
 * real in-memory SQLite (node:sqlite).
 *
 * The load-bearing assertions here are the ones a later branch could quietly
 * break: `realized_tokens_json` must stay NOT NULL (recalculation replays what
 * happened, never the recipe), and the retired v1.0 program tables must stay
 * uncreated.
 */

import type { SQLiteDatabase } from 'expo-sqlite'

import { MIGRATIONS_FOR_TESTS, runMigrations } from '@storage/migrations'
import { ADAPTATION_BOUNDARIES, CUE_OUTCOMES } from '@storage/migrations/004_workouts'

import { createMigratedDb, MemoryDb } from './helpers/memoryDb'

interface ColumnInfo {
  name: string
  type: string
  notnull: number
  dflt_value: string | null
}

const columnsOf = (db: MemoryDb, table: string): string[] =>
  db.query<ColumnInfo>(`PRAGMA table_info(${table})`).map((c) => c.name)

const columnInfo = (db: MemoryDb, table: string, column: string): ColumnInfo | undefined =>
  db.query<ColumnInfo>(`PRAGMA table_info(${table})`).find((c) => c.name === column)

const tableNames = (db: MemoryDb): string[] =>
  db
    .query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .map((t) => t.name)

/** A recipe row + a workout row the other tables can point at. */
function seedWorkout(db: MemoryDb, opts: { sessionId?: string | null } = {}): void {
  db.execSync(`
    INSERT INTO workout_recipes
      (id, name, preset_key, default_stance, params_json, recipe_schema_version, created_at, updated_at)
    VALUES ('r1', 'Fundamentals', NULL, 'orthodox', '{}', 1,
            '2026-08-23T00:00:00.000Z', '2026-08-23T00:00:00.000Z');
  `)
  const sessionId = opts.sessionId === undefined ? null : opts.sessionId
  const stmt = db.raw.prepare(
    `INSERT INTO generated_workouts
       (id, recipe_id, session_id, generator_version, seed,
        params_snapshot_json, blocks_json, realized_tokens_json, created_at)
     VALUES ('w1', 'r1', ?, '1.0.0', 'seed-1', '{}', '[]', '[]', '2026-08-23T00:00:00.000Z')`,
  )
  stmt.run(sessionId)
}

function seedSession(db: MemoryDb, id = 's1'): void {
  db.execSync(
    `INSERT INTO sessions (id, mode, status, created_at)
     VALUES ('${id}', 'puncheokie', 'configuring', '2026-08-23T00:00:00.000Z')`,
  )
}

let db: MemoryDb

beforeEach(() => {
  db = createMigratedDb()
})

afterEach(() => {
  db.close()
})

describe('migration registry', () => {
  it('registers 004_workouts with a unique, ascending, never-renumbered id', () => {
    const ids = MIGRATIONS_FOR_TESTS.map((m) => m.id)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
    expect(new Set(ids).size).toBe(ids.length)
    expect(MIGRATIONS_FOR_TESTS.find((m) => m.id === 4)?.name).toBe('004_workouts')
  })
})

describe('schema shape', () => {
  it('creates workout_recipes with the §17.1 columns', () => {
    expect(columnsOf(db, 'workout_recipes')).toEqual([
      'id',
      'name',
      'preset_key',
      'default_stance',
      'params_json',
      'recipe_schema_version',
      'created_at',
      'updated_at',
    ])
  })

  it('creates generated_workouts with the §17.1 columns', () => {
    expect(columnsOf(db, 'generated_workouts')).toEqual([
      'id',
      'recipe_id',
      'session_id',
      'generator_version',
      'seed',
      'params_snapshot_json',
      'blocks_json',
      'realized_tokens_json',
      'created_at',
    ])
  })

  it('creates workout_adaptations with the §17.1 columns', () => {
    expect(columnsOf(db, 'workout_adaptations')).toEqual([
      'id',
      'generated_workout_id',
      'decided_at_monotonic_ms',
      'boundary',
      'inputs_json',
      'decision_json',
    ])
  })

  it('creates cue_results with the §17.1 columns', () => {
    // `repeat_index` is 005's addition, and the fixture runs every migration
    // — this asserts the shape a device actually ends up with.
    expect(columnsOf(db, 'cue_results')).toEqual([
      'session_id',
      'generated_workout_id',
      'block_id',
      'repeat_index',
      'token_index',
      'expected_hand',
      'expected_type',
      'observed_event_id',
      'outcome',
      'offset_ms',
      'velocity_raw',
      'velocity_calibrated',
      'velocity_unit',
      'capability_tier',
      'decoder_version',
      'calculation_version',
    ])
  })

  it('keys cue_results on (session, workout, block, repeat, token index)', () => {
    const pk = db
      .query<{ name: string; pk: number }>('PRAGMA table_info(cue_results)')
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
    // The repeat is part of the key: one block can run several times, each
    // pass naming the same token indexes (migration 005).
    expect(pk).toEqual([
      'session_id',
      'generated_workout_id',
      'block_id',
      'repeat_index',
      'token_index',
    ])
  })

  it('indexes cue_results by session and by generated workout', () => {
    const names = db
      .query<{ name: string }>(`PRAGMA index_list(cue_results)`)
      .map((i) => i.name)
    expect(names).toContain('idx_cue_results_session')
    expect(names).toContain('idx_cue_results_workout')
  })

  it('never creates the superseded v1.0 program tables', () => {
    const names = tableNames(db)
    expect(names).not.toContain('punch_programs')
    expect(names).not.toContain('program_rounds')
    expect(names).not.toContain('punch_cues')
  })
})

describe('D8 — realized_tokens_json is NOT NULL', () => {
  it('declares the column NOT NULL', () => {
    expect(columnInfo(db, 'generated_workouts', 'realized_tokens_json')?.notnull).toBe(1)
  })

  it('rejects an insert that leaves the realized stream null', () => {
    db.execSync(`
      INSERT INTO workout_recipes
        (id, name, preset_key, default_stance, params_json, recipe_schema_version, created_at, updated_at)
      VALUES ('r1', 'Fundamentals', NULL, 'orthodox', '{}', 1, 'now', 'now');
    `)
    expect(() =>
      db.execSync(`
        INSERT INTO generated_workouts
          (id, recipe_id, session_id, generator_version, seed,
           params_snapshot_json, blocks_json, realized_tokens_json, created_at)
        VALUES ('w1', 'r1', NULL, '1.0.0', 'seed-1', '{}', '[]', NULL, 'now')
      `),
    ).toThrow(/NOT NULL/i)
  })
})

describe('CHECK constraints', () => {
  it('accepts every declared adaptation boundary and rejects anything else', () => {
    seedWorkout(db)
    ADAPTATION_BOUNDARIES.forEach((boundary, i) => {
      db.execSync(
        `INSERT INTO workout_adaptations
           (id, generated_workout_id, decided_at_monotonic_ms, boundary, inputs_json, decision_json)
         VALUES ('a${i}', 'w1', ${1000 + i}, '${boundary}', '{}', '{}')`,
      )
    })
    expect(db.count('SELECT COUNT(*) AS n FROM workout_adaptations')).toBe(
      ADAPTATION_BOUNDARIES.length,
    )

    expect(() =>
      db.execSync(
        `INSERT INTO workout_adaptations
           (id, generated_workout_id, decided_at_monotonic_ms, boundary, inputs_json, decision_json)
         VALUES ('bad', 'w1', 5000, 'mid-block', '{}', '{}')`,
      ),
    ).toThrow(/CHECK/i)
  })

  it('accepts every declared cue outcome and rejects anything else', () => {
    seedSession(db)
    seedWorkout(db, { sessionId: 's1' })
    CUE_OUTCOMES.forEach((outcome, i) => {
      db.execSync(
        `INSERT INTO cue_results
           (session_id, generated_workout_id, block_id, token_index, expected_hand,
            outcome, capability_tier, decoder_version, calculation_version)
         VALUES ('s1', 'w1', 'b1', ${i}, 'left', '${outcome}', 'hand-timestamp', '1.0.0', '1.0.0')`,
      )
    })
    expect(db.count('SELECT COUNT(*) AS n FROM cue_results')).toBe(CUE_OUTCOMES.length)

    expect(() =>
      db.execSync(
        `INSERT INTO cue_results
           (session_id, generated_workout_id, block_id, token_index, expected_hand,
            outcome, capability_tier, decoder_version, calculation_version)
         VALUES ('s1', 'w1', 'b1', 99, 'left', 'sort-of', 'hand-timestamp', '1.0.0', '1.0.0')`,
      ),
    ).toThrow(/CHECK/i)
  })

  it('rejects an expected_hand outside left/right', () => {
    seedSession(db)
    seedWorkout(db, { sessionId: 's1' })
    expect(() =>
      db.execSync(
        `INSERT INTO cue_results
           (session_id, generated_workout_id, block_id, token_index, expected_hand,
            outcome, capability_tier, decoder_version, calculation_version)
         VALUES ('s1', 'w1', 'b1', 0, 'unknown', 'matched', 'hand-timestamp', '1.0.0', '1.0.0')`,
      ),
    ).toThrow(/CHECK/i)
  })

  it('rejects a default_stance outside orthodox/southpaw (D2 retired the third value)', () => {
    expect(() =>
      db.execSync(`
        INSERT INTO workout_recipes
          (id, name, preset_key, default_stance, params_json, recipe_schema_version, created_at, updated_at)
        VALUES ('r9', 'Bad', NULL, 'square', '{}', 1, 'now', 'now')
      `),
    ).toThrow(/CHECK/i)
  })
})

describe('D12 — the type rungs are stored but unreachable on this hardware', () => {
  it('keeps expected_type nullable so a future decoder can populate it', () => {
    expect(columnInfo(db, 'cue_results', 'expected_type')?.notnull).toBe(0)
  })

  it('keeps type-mismatch in the enum even though no writer may emit it today', () => {
    expect(CUE_OUTCOMES).toContain('type-mismatch')
  })
})

describe('foreign keys', () => {
  it('rejects a generated workout pointing at a missing recipe', () => {
    expect(() =>
      db.execSync(`
        INSERT INTO generated_workouts
          (id, recipe_id, session_id, generator_version, seed,
           params_snapshot_json, blocks_json, realized_tokens_json, created_at)
        VALUES ('w9', 'nope', NULL, '1.0.0', 's', '{}', '[]', '[]', 'now')
      `),
    ).toThrow(/FOREIGN KEY/i)
  })

  it('rejects a cue result pointing at a missing generated workout', () => {
    seedSession(db)
    expect(() =>
      db.execSync(
        `INSERT INTO cue_results
           (session_id, generated_workout_id, block_id, token_index, expected_hand,
            outcome, capability_tier, decoder_version, calculation_version)
         VALUES ('s1', 'nope', 'b1', 0, 'left', 'matched', 'hand-timestamp', '1.0.0', '1.0.0')`,
      ),
    ).toThrow(/FOREIGN KEY/i)
  })

  it('refuses to delete a recipe that already produced a run (RESTRICT)', () => {
    seedWorkout(db)
    expect(() => db.execSync(`DELETE FROM workout_recipes WHERE id = 'r1'`)).toThrow(/FOREIGN KEY/i)
  })

  it('cascades cue results and adaptations away with their session/workout', () => {
    seedSession(db)
    seedWorkout(db, { sessionId: 's1' })
    db.execSync(
      `INSERT INTO cue_results
         (session_id, generated_workout_id, block_id, token_index, expected_hand,
          outcome, capability_tier, decoder_version, calculation_version)
       VALUES ('s1', 'w1', 'b1', 0, 'left', 'matched', 'hand-timestamp', '1.0.0', '1.0.0')`,
    )
    db.execSync(
      `INSERT INTO workout_adaptations
         (id, generated_workout_id, decided_at_monotonic_ms, boundary, inputs_json, decision_json)
       VALUES ('a1', 'w1', 1000, 'round', '{}', '{}')`,
    )

    db.execSync(`DELETE FROM sessions WHERE id = 's1'`)

    expect(db.count('SELECT COUNT(*) AS n FROM cue_results')).toBe(0)
    // The plan itself survives: session_id is SET NULL, not CASCADE.
    expect(db.count('SELECT COUNT(*) AS n FROM generated_workouts')).toBe(1)
    expect(
      db.query<{ session_id: string | null }>('SELECT session_id FROM generated_workouts')[0]
        ?.session_id,
    ).toBeNull()
    expect(db.count('SELECT COUNT(*) AS n FROM workout_adaptations')).toBe(1)

    db.execSync(`DELETE FROM generated_workouts WHERE id = 'w1'`)
    expect(db.count('SELECT COUNT(*) AS n FROM workout_adaptations')).toBe(0)
  })
})

describe('runner idempotence', () => {
  it('applies 004 once and treats a second run as a no-op', () => {
    const fresh = new MemoryDb()
    const asSqliteDatabase = fresh as unknown as SQLiteDatabase
    runMigrations(asSqliteDatabase)

    const applied = fresh
      .query<{ id: number }>('SELECT id FROM schema_migrations ORDER BY id')
      .map((r) => r.id)
    expect(applied).toContain(4)

    fresh.execSync(`
      INSERT INTO workout_recipes
        (id, name, preset_key, default_stance, params_json, recipe_schema_version, created_at, updated_at)
      VALUES ('keep', 'Survivor', NULL, 'orthodox', '{}', 1, 'now', 'now');
    `)

    // Re-running must neither raise nor touch data.
    expect(() => runMigrations(asSqliteDatabase)).not.toThrow()
    expect(
      fresh.query<{ id: number }>('SELECT id FROM schema_migrations ORDER BY id').map((r) => r.id),
    ).toEqual(applied)
    expect(fresh.count(`SELECT COUNT(*) AS n FROM workout_recipes WHERE id = 'keep'`)).toBe(1)

    fresh.close()
  })
})
