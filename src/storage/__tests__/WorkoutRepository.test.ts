/**
 * WorkoutRepository — CRUD round-trips, the D8 realized-stream rule, typed
 * decode failures, and the atomicity of `writeCueResults`.
 *
 * Runs against a real in-memory SQLite (node:sqlite) so CHECK constraints,
 * foreign keys and SAVEPOINT semantics behave exactly as they do on device,
 * with no Bluetooth hardware and no native binding (§21).
 */

import { threeRoundFundamentals } from '@domain/workout/samples'
import type { GeneratedWorkout } from '@domain/workout/GeneratedWorkout'
import { defaultRecipe } from '@domain/workout/WorkoutRecipe'
import { RECIPE_SCHEMA_VERSION } from '@domain/workout/versions'
import {
  WorkoutPersistenceError,
  WorkoutRepository,
  type CueResultRow,
  type RealizedTokenStream,
} from '@storage/repositories/WorkoutRepository'
import { SessionRepository } from '@storage/repositories/SessionRepository'

import { createMigratedDb, type MemoryDb } from './helpers/memoryDb'

let db: MemoryDb
let repo: WorkoutRepository
let sessions: SessionRepository

beforeEach(() => {
  db = createMigratedDb()
  repo = new WorkoutRepository(db)
  sessions = new SessionRepository(db)
})

afterEach(() => {
  db.close()
})

/** The planned expansion, which is also the realized stream before adaptation. */
function plannedStream(workout: GeneratedWorkout): RealizedTokenStream {
  return workout.schedule.flatMap((round) =>
    round.blocks.map((block) => ({ blockId: block.id, tokens: block.tokens })),
  )
}

function cueRow(overrides: Partial<CueResultRow> = {}): CueResultRow {
  return {
    sessionId: 'ses-1',
    generatedWorkoutId: threeRoundFundamentals.id,
    blockId: 'blk-1',
    tokenIndex: 0,
    expectedHand: 'left',
    // Always null on FightCamp v1 (D12).
    expectedType: null,
    observedEventId: null,
    outcome: 'matched',
    offsetMs: 42,
    velocityRaw: 17,
    velocityCalibrated: null,
    velocityUnit: 'tracker-unit',
    capabilityTier: 'hand-timestamp',
    decoderVersion: '1.0.0',
    calculationVersion: '1.0.0',
    ...overrides,
  }
}

describe('recipes', () => {
  it('round-trips a recipe deep-equal through params_json', () => {
    const recipe = defaultRecipe()
    const saved = repo.saveRecipe('My Workout', recipe, 'preset-steady-20')

    expect(saved.name).toBe('My Workout')
    expect(saved.presetKey).toBe('preset-steady-20')
    expect(saved.recipeSchemaVersion).toBe(RECIPE_SCHEMA_VERSION)
    expect(saved.recipe).toEqual(recipe)
    expect(saved.recipe.extraPunchPolicy).toBe(recipe.extraPunchPolicy)

    const [listed] = repo.listRecipes()
    expect(listed?.recipe).toEqual(recipe)
  })

  it('denormalizes default_stance for list rendering', () => {
    repo.saveRecipe('Southpaw drill', { ...defaultRecipe(), defaultStance: 'southpaw' })
    expect(
      db.query<{ default_stance: string }>('SELECT default_stance FROM workout_recipes')[0]
        ?.default_stance,
    ).toBe('southpaw')
  })

  it('stores created_at/updated_at as ISO wall time (display and export only)', () => {
    const saved = repo.saveRecipe('Timestamps', defaultRecipe())
    expect(saved.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    expect(saved.updatedAt).toBe(saved.createdAt)
  })

  it('leaves preset_key null for a hand-tuned recipe', () => {
    expect(repo.saveRecipe('Hand-tuned', defaultRecipe()).presetKey).toBeNull()
  })

  it('raises a typed error on an unknown recipe_schema_version', () => {
    repo.saveRecipe('Future', defaultRecipe())
    db.execSync('UPDATE workout_recipes SET recipe_schema_version = 99')

    expect(() => repo.listRecipes()).toThrow(WorkoutPersistenceError)
    try {
      repo.listRecipes()
    } catch (err) {
      const e = err as WorkoutPersistenceError
      expect(e.code).toBe('unknown-recipe-schema-version')
      // The payload survives the failure — nothing is discarded.
      expect(e.rawPayload).toContain('"durationMinutes"')
    }
  })

  it('raises a typed error carrying the payload when params_json will not parse', () => {
    repo.saveRecipe('Corrupt', defaultRecipe())
    db.execSync(`UPDATE workout_recipes SET params_json = '{not json'`)

    try {
      repo.listRecipes()
      throw new Error('expected a WorkoutPersistenceError')
    } catch (err) {
      const e = err as WorkoutPersistenceError
      expect(e).toBeInstanceOf(WorkoutPersistenceError)
      expect(e.code).toBe('json-parse-failed')
      expect(e.rawPayload).toBe('{not json')
    }
  })
})

describe('generated workouts', () => {
  it('round-trips a workout and its realized stream through a session link', () => {
    const session = sessions.create({ id: 'ses-1', mode: 'puncheokie' })
    const realized = plannedStream(threeRoundFundamentals)
    repo.saveGeneratedWorkout(threeRoundFundamentals, realized, session.id)

    const found = repo.getWorkoutBySession('ses-1')
    expect(found).not.toBeNull()
    expect(found?.workout).toEqual(threeRoundFundamentals)
    expect(found?.realized).toEqual(realized)
  })

  it('returns null for a session that ran no generated workout', () => {
    sessions.create({ id: 'ses-empty', mode: 'punchcraft' })
    expect(repo.getWorkoutBySession('ses-empty')).toBeNull()
    expect(repo.getWorkoutBySession('no-such-session')).toBeNull()
  })

  it('persists generator_version and seed for deterministic replay (R18)', () => {
    repo.saveGeneratedWorkout(threeRoundFundamentals, plannedStream(threeRoundFundamentals))
    const row = db.query<{ generator_version: string; seed: string; session_id: string | null }>(
      'SELECT generator_version, seed, session_id FROM generated_workouts',
    )[0]
    expect(row?.generator_version).toBe(threeRoundFundamentals.recipe.generatorVersion)
    expect(row?.seed).toBe(threeRoundFundamentals.recipe.seed)
    // Nullable until the workout is run.
    expect(row?.session_id).toBeNull()
  })

  it('links to an already-saved recipe rather than cloning it', () => {
    const saved = repo.saveRecipe('Fundamentals', threeRoundFundamentals.recipe)
    repo.saveGeneratedWorkout(threeRoundFundamentals, plannedStream(threeRoundFundamentals))

    expect(repo.listRecipes()).toHaveLength(1)
    expect(
      db.query<{ recipe_id: string }>('SELECT recipe_id FROM generated_workouts')[0]?.recipe_id,
    ).toBe(saved.id)
  })

  it('honours an explicitly supplied recipe id', () => {
    const other = repo.saveRecipe('Explicit', defaultRecipe())
    repo.saveGeneratedWorkout(
      threeRoundFundamentals,
      plannedStream(threeRoundFundamentals),
      undefined,
      other.id,
    )
    expect(
      db.query<{ recipe_id: string }>('SELECT recipe_id FROM generated_workouts')[0]?.recipe_id,
    ).toBe(other.id)
  })

  it('rejects an empty realized stream with a typed error (D8)', () => {
    expect(() => repo.saveGeneratedWorkout(threeRoundFundamentals, [])).toThrow(
      WorkoutPersistenceError,
    )
    try {
      repo.saveGeneratedWorkout(threeRoundFundamentals, [])
    } catch (err) {
      expect((err as WorkoutPersistenceError).code).toBe('empty-realized-stream')
    }
    expect(db.count('SELECT COUNT(*) AS n FROM generated_workouts')).toBe(0)
  })

  it('rejects a foreign key violation on session_id', () => {
    expect(() =>
      repo.saveGeneratedWorkout(
        threeRoundFundamentals,
        plannedStream(threeRoundFundamentals),
        'no-such-session',
      ),
    ).toThrow(/FOREIGN KEY/i)
  })

  it('replaces the realized stream after adaptation and refuses to blank it', () => {
    sessions.create({ id: 'ses-1', mode: 'puncheokie' })
    repo.saveGeneratedWorkout(threeRoundFundamentals, plannedStream(threeRoundFundamentals), 'ses-1')

    const shortened: RealizedTokenStream = [{ blockId: 'blk-1', tokens: [] }]
    repo.updateRealizedTokens(threeRoundFundamentals.id, shortened)
    expect(repo.getWorkoutBySession('ses-1')?.realized).toEqual(shortened)

    expect(() => repo.updateRealizedTokens(threeRoundFundamentals.id, [])).toThrow(
      WorkoutPersistenceError,
    )
    expect(repo.getWorkoutBySession('ses-1')?.realized).toEqual(shortened)
  })

  it('raises a typed error rather than returning null when blocks_json is corrupt', () => {
    sessions.create({ id: 'ses-1', mode: 'puncheokie' })
    repo.saveGeneratedWorkout(threeRoundFundamentals, plannedStream(threeRoundFundamentals), 'ses-1')
    db.execSync(`UPDATE generated_workouts SET blocks_json = '{"nope": 1}'`)

    try {
      repo.getWorkoutBySession('ses-1')
      throw new Error('expected a WorkoutPersistenceError')
    } catch (err) {
      const e = err as WorkoutPersistenceError
      expect(e).toBeInstanceOf(WorkoutPersistenceError)
      expect(e.code).toBe('invalid-payload-shape')
      expect(e.rawPayload).toBe('{"nope": 1}')
    }
  })
})

describe('adaptations', () => {
  beforeEach(() => {
    sessions.create({ id: 'ses-1', mode: 'puncheokie' })
    repo.saveGeneratedWorkout(threeRoundFundamentals, plannedStream(threeRoundFundamentals), 'ses-1')
  })

  it('stores decided_at_monotonic_ms exactly as given — never a wall clock', () => {
    const monotonic = 123456.75
    repo.appendAdaptation({
      generatedWorkoutId: threeRoundFundamentals.id,
      decidedAtMonotonicMs: monotonic,
      boundary: 'round',
      inputs: { pace: 0.82 },
      decision: { action: 'shorten-block' },
    })

    const stored = db.query<{ decided_at_monotonic_ms: number }>(
      'SELECT decided_at_monotonic_ms FROM workout_adaptations',
    )[0]
    expect(stored?.decided_at_monotonic_ms).toBe(monotonic)
    // A Date.now() substitution would be ~13 digits of epoch ms.
    expect(stored?.decided_at_monotonic_ms).toBeLessThan(1e6)
  })

  it('reads decisions back in monotonic order with inputs intact', () => {
    repo.appendAdaptation({
      generatedWorkoutId: threeRoundFundamentals.id,
      decidedAtMonotonicMs: 900,
      boundary: 'rest',
      inputs: { behind: 12 },
      decision: { action: 'add-block' },
    })
    repo.appendAdaptation({
      generatedWorkoutId: threeRoundFundamentals.id,
      decidedAtMonotonicMs: 100,
      boundary: 'block',
      inputs: { behind: 3 },
      decision: { action: 'noop' },
    })

    const log = repo.listAdaptations(threeRoundFundamentals.id)
    expect(log.map((a) => a.decidedAtMonotonicMs)).toEqual([100, 900])
    expect(log[0]?.boundary).toBe('block')
    expect(log[1]?.inputs).toEqual({ behind: 12 })
  })

  it('rejects an unknown boundary with a typed error', () => {
    try {
      repo.appendAdaptation({
        generatedWorkoutId: threeRoundFundamentals.id,
        decidedAtMonotonicMs: 1,
        // Deliberately outside the CHECK enum.
        boundary: 'mid-block' as 'block',
        inputs: {},
        decision: {},
      })
      throw new Error('expected a WorkoutPersistenceError')
    } catch (err) {
      expect((err as WorkoutPersistenceError).code).toBe('invalid-enum-value')
    }
    expect(db.count('SELECT COUNT(*) AS n FROM workout_adaptations')).toBe(0)
  })
})

describe('cue results', () => {
  beforeEach(() => {
    sessions.create({ id: 'ses-1', mode: 'puncheokie' })
    repo.saveGeneratedWorkout(threeRoundFundamentals, plannedStream(threeRoundFundamentals), 'ses-1')
  })

  it('writes a batch and reads it back with velocity fields untouched', () => {
    repo.writeCueResults([
      cueRow({ tokenIndex: 0, velocityRaw: 17, velocityCalibrated: 4.25 }),
      cueRow({ tokenIndex: 1, expectedHand: 'right', outcome: 'missed', offsetMs: null }),
    ])

    const read = repo.listCueResults('ses-1')
    expect(read).toHaveLength(2)
    expect(read[0]?.velocityRaw).toBe(17)
    expect(read[0]?.velocityCalibrated).toBe(4.25)
    expect(read[0]?.velocityUnit).toBe('tracker-unit')
    expect(read[1]?.outcome).toBe('missed')
    expect(read[1]?.offsetMs).toBeNull()
  })

  it('records the hand-timestamp tier with expected_type null (D12)', () => {
    repo.writeCueResults([cueRow()])
    const row = repo.listCueResults('ses-1')[0]
    expect(row?.capabilityTier).toBe('hand-timestamp')
    expect(row?.expectedType).toBeNull()
  })

  it('is a no-op for an empty batch', () => {
    expect(() => repo.writeCueResults([])).not.toThrow()
    expect(db.count('SELECT COUNT(*) AS n FROM cue_results')).toBe(0)
  })

  it('rolls the whole batch back when one row of fifty fails', () => {
    const rows: CueResultRow[] = Array.from({ length: 50 }, (_, i) => cueRow({ tokenIndex: i }))
    // Row 37 points at a generated workout that does not exist: a foreign-key
    // failure raised by SQLite, not by our own pre-validation, so this really
    // exercises the savepoint rollback.
    rows[37] = cueRow({ tokenIndex: 37, generatedWorkoutId: 'no-such-workout' })

    expect(() => repo.writeCueResults(rows)).toThrow(/FOREIGN KEY/i)
    expect(db.count('SELECT COUNT(*) AS n FROM cue_results')).toBe(0)
  })

  it('rejects an unknown outcome before touching the database', () => {
    try {
      repo.writeCueResults([cueRow({ outcome: 'sort-of' as 'matched' })])
      throw new Error('expected a WorkoutPersistenceError')
    } catch (err) {
      expect((err as WorkoutPersistenceError).code).toBe('invalid-enum-value')
    }
    expect(db.count('SELECT COUNT(*) AS n FROM cue_results')).toBe(0)
  })

  it('composes inside an outer transaction — the savepoint never commits it early', () => {
    db.execSync('BEGIN')
    repo.writeCueResults([cueRow({ tokenIndex: 0 }), cueRow({ tokenIndex: 1 })])
    // Still inside the caller's transaction: rolling back must take the cue
    // results with it, which a BEGIN-based implementation could not do.
    db.execSync('ROLLBACK')

    expect(db.count('SELECT COUNT(*) AS n FROM cue_results')).toBe(0)
  })

  it('lets an outer transaction survive a failed batch and commit its own work', () => {
    db.execSync('BEGIN')
    sessions.create({ id: 'ses-2', mode: 'puncheokie' })
    expect(() =>
      repo.writeCueResults([cueRow({ generatedWorkoutId: 'no-such-workout' })]),
    ).toThrow()
    db.execSync('COMMIT')

    expect(db.count('SELECT COUNT(*) AS n FROM cue_results')).toBe(0)
    expect(db.count(`SELECT COUNT(*) AS n FROM sessions WHERE id = 'ses-2'`)).toBe(1)
  })

  it('rejects a duplicate (session, workout, block, token) key', () => {
    repo.writeCueResults([cueRow({ tokenIndex: 0 })])
    expect(() => repo.writeCueResults([cueRow({ tokenIndex: 0 })])).toThrow(/UNIQUE|PRIMARY/i)
    expect(db.count('SELECT COUNT(*) AS n FROM cue_results')).toBe(1)
  })
})
