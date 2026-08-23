/**
 * WorkoutRepository — CRUD over the migration-004 workout tables (#177 /
 * M31-09, spec §17.1 amended, doc §16/§22/§24).
 *
 * Boundaries this file deliberately holds:
 *
 * - **The stored payload is never discarded.** A malformed `params_json` or an
 *   unrecognised `recipe_schema_version` raises {@link WorkoutPersistenceError}
 *   carrying the raw text, so a decoding bug surfaces as a loud failure with
 *   the evidence attached instead of a silent `null`. This is the storage-layer
 *   echo of non-negotiable rule 1: a parse failure never destroys data.
 * - **D8 — the realized stream is mandatory.** Recalculation replays what
 *   actually executed, never the recipe, so `saveGeneratedWorkout` refuses an
 *   empty stream rather than writing a row that cannot be recomputed (§8.6).
 * - **Monotonic in, monotonic out.** `decidedAtMonotonicMs` is stored exactly
 *   as given; nothing here substitutes `Date.now()` for it. Only `created_at`
 *   and `updated_at` are wall-clock, and those exist for display and export
 *   alone (spec §3.2, §18.3).
 * - **Tracker-reported velocity passes straight through** with whatever
 *   `velocityUnit` the decoder supplied — no conversion, no relabeling (§4.3).
 * - **No imports from `src/ble/**`, React, or `src/app/**`** (spec §15.1).
 *
 * Talks to SQLite through `SqlPort` rather than `SQLiteDatabase` so the suite
 * runs on the Windows workstation without the native binding (§21). A real
 * `SQLiteDatabase` satisfies the port structurally, so callers pass one
 * unchanged.
 */

import { logger, safe } from '@/diagnostics/logger'
import type { GeneratedWorkout } from '@/domain/workout/GeneratedWorkout'
import type { ProgramRound, WorkoutToken } from '@/domain/workout/WorkoutTokens'
import { RECIPE_SCHEMA_VERSION } from '@/domain/workout/versions'
import type { WorkoutRecipe } from '@/domain/workout/WorkoutRecipe'
import { ADAPTATION_BOUNDARIES, CUE_OUTCOMES } from '@/storage/migrations/004_workouts'
import type { AdaptationBoundary, CueOutcome } from '@/storage/migrations/004_workouts'
import type { SqlBindValue, SqlPort } from '@/storage/SqlPort'

export type { CueOutcome, AdaptationBoundary }

/* ------------------------------------------------------------------ errors */

export type WorkoutPersistenceErrorCode =
  /** `params_json`, `blocks_json` or `realized_tokens_json` was not valid JSON. */
  | 'json-parse-failed'
  /** The row's `recipe_schema_version` is not one this build can decode. */
  | 'unknown-recipe-schema-version'
  /** JSON parsed, but the value is not the shape the column promises. */
  | 'invalid-payload-shape'
  /** D8 — a generated workout was saved without a realized token stream. */
  | 'empty-realized-stream'
  /** A CHECK-constrained value was rejected before it reached SQLite. */
  | 'invalid-enum-value'

/**
 * The single failure type this repository raises.
 *
 * `rawPayload` carries the stored text verbatim whenever the failure came from
 * decoding one, so a caller (or a bug report) still has the bytes that could
 * not be read.
 */
export class WorkoutPersistenceError extends Error {
  constructor(
    readonly code: WorkoutPersistenceErrorCode,
    message: string,
    readonly rawPayload?: string,
  ) {
    super(message)
    this.name = 'WorkoutPersistenceError'
  }
}

/* ------------------------------------------------------------------- types */

/** The realized token stream, per block, as it actually executed (D8). */
export type RealizedTokenStream = Array<{ blockId: string; tokens: WorkoutToken[] }>

export interface WorkoutRecipeRow {
  id: string
  name: string
  presetKey: string | null
  recipe: WorkoutRecipe
  recipeSchemaVersion: number
  /** ISO wall time — display and export only. */
  createdAt: string
  updatedAt: string
}

export interface CueResultRow {
  sessionId: string
  generatedWorkoutId: string
  blockId: string
  /**
   * Which pass through a repeated block this row belongs to; 0 for a block
   * that runs once. Part of the key — a `repeat: 2` block expands into two
   * cues naming the same token indexes (migration 005).
   */
  repeatIndex: number
  tokenIndex: number
  expectedHand: 'left' | 'right'
  /**
   * Always `null` on FightCamp v1 (D12) — the payload's type byte carries no
   * device-portable meaning, so which technique was thrown is unobservable.
   * The field exists for a future decoder on different hardware.
   */
  expectedType: string | null
  observedEventId: string | null
  /** `'type-mismatch'` is unreachable on this hardware for the same reason. */
  outcome: CueOutcome
  offsetMs: number | null
  /** Tracker-reported values, stored as received with their own unit (§4.3). */
  velocityRaw: number | null
  velocityCalibrated: number | null
  velocityUnit: string | null
  capabilityTier: string
  decoderVersion: string
  calculationVersion: string
}

export interface AdaptationRecord {
  generatedWorkoutId: string
  /** Monotonic ms, stored exactly as given (§3.2, §18.3). */
  decidedAtMonotonicMs: number
  boundary: AdaptationBoundary
  inputs: unknown
  decision: unknown
}

/**
 * What `blocks_json` holds.
 *
 * Deviation from spec §17.1, recorded deliberately: the column is described as
 * "generated `WorkoutBlock[]` / `WorkoutToken[]`", but a `GeneratedWorkout`
 * also carries four derived fields that no other column has room for. Storing
 * them beside the schedule is what lets `getWorkoutBySession` hand back the
 * exact object the generator produced instead of a lossy reconstruction. The
 * schedule is still the first key, so the column remains readable as "the
 * generated blocks".
 */
interface BlocksPayload {
  schedule: ProgramRound[]
  roundPunchTargets: number[]
  expectedTechniqueDistribution: Record<string, number>
  estimatedActivePunchesPerMinute: number
  warnings: string[]
}

/* ------------------------------------------------------------- row mapping */

interface RawRecipe {
  id: string
  name: string
  preset_key: string | null
  default_stance: string
  params_json: string
  recipe_schema_version: number
  created_at: string
  updated_at: string
}

interface RawWorkout {
  id: string
  recipe_id: string
  session_id: string | null
  generator_version: string
  seed: string
  params_snapshot_json: string
  blocks_json: string
  realized_tokens_json: string
  created_at: string
}

/** Versions of `params_json` this build knows how to read. */
const KNOWN_RECIPE_SCHEMA_VERSIONS: readonly number[] = [RECIPE_SCHEMA_VERSION]

function parseJson<T>(raw: string, column: string): T {
  try {
    return JSON.parse(raw) as T
  } catch (err) {
    throw new WorkoutPersistenceError(
      'json-parse-failed',
      `${column} is not valid JSON (${String(err)}); the stored text is attached unmodified`,
      raw,
    )
  }
}

function assertKnownRecipeVersion(version: number, raw: string): void {
  if (!KNOWN_RECIPE_SCHEMA_VERSIONS.includes(version)) {
    throw new WorkoutPersistenceError(
      'unknown-recipe-schema-version',
      `recipe_schema_version ${version} is not readable by this build ` +
        `(known: ${KNOWN_RECIPE_SCHEMA_VERSIONS.join(', ')}); refusing to guess at the payload`,
      raw,
    )
  }
}

function mapRecipe(r: RawRecipe): WorkoutRecipeRow {
  assertKnownRecipeVersion(r.recipe_schema_version, r.params_json)
  return {
    id: r.id,
    name: r.name,
    presetKey: r.preset_key,
    recipe: parseJson<WorkoutRecipe>(r.params_json, 'workout_recipes.params_json'),
    recipeSchemaVersion: r.recipe_schema_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function parseRealized(raw: string, workoutId: string): RealizedTokenStream {
  const parsed = parseJson<unknown>(raw, 'generated_workouts.realized_tokens_json')
  if (!Array.isArray(parsed)) {
    throw new WorkoutPersistenceError(
      'invalid-payload-shape',
      `realized_tokens_json for workout ${workoutId} decoded to ${typeof parsed}, expected an array`,
      raw,
    )
  }
  return parsed as RealizedTokenStream
}

/** RN-safe id generator; the schema needs uniqueness, not RFC-4122 UUIDs. */
function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${Date.now().toString(36)}_${rand}`
}

/* -------------------------------------------------------------- repository */

export class WorkoutRepository {
  constructor(private readonly db: SqlPort) {}

  /* -- recipes ---------------------------------------------------------- */

  /**
   * Persist a recipe under a display name. `default_stance` is denormalized
   * out of the recipe so the recipe list can be rendered without decoding
   * every `params_json`.
   */
  saveRecipe(name: string, recipe: WorkoutRecipe, presetKey?: string): WorkoutRecipeRow {
    const id = newId('rcp')
    const nowIso = new Date().toISOString()
    this.run(
      `INSERT INTO workout_recipes
         (id, name, preset_key, default_stance, params_json, recipe_schema_version,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        presetKey ?? null,
        recipe.defaultStance,
        JSON.stringify(recipe),
        RECIPE_SCHEMA_VERSION,
        nowIso,
        nowIso,
      ],
    )
    logger.info('storage.workout.recipe.save', 'workout recipe saved', {
      id: safe(id),
      presetKey: safe(presetKey ?? null),
    })
    const row = this.getRecipeById(id)
    if (!row) throw new Error(`workout_recipes row missing after insert: ${id}`)
    return row
  }

  /** Most recently updated first. */
  listRecipes(): WorkoutRecipeRow[] {
    return this.select<RawRecipe>(
      'SELECT * FROM workout_recipes ORDER BY updated_at DESC, id ASC',
      [],
    ).map(mapRecipe)
  }

  getRecipeById(id: string): WorkoutRecipeRow | null {
    const row = this.select<RawRecipe>('SELECT * FROM workout_recipes WHERE id = ?', [id])[0]
    return row ? mapRecipe(row) : null
  }

  /* -- generated workouts ----------------------------------------------- */

  /**
   * Persist one expansion of a recipe together with the token stream that was
   * (or is about to be) executed.
   *
   * `recipeId` is an additive fourth parameter, not in #177's Interfaces block:
   * `generated_workouts.recipe_id` is NOT NULL but `GeneratedWorkout` carries
   * the recipe object rather than its row id, so the link has to come from
   * somewhere. Callers that already hold the row id should pass it. Omitted, we
   * reuse the recipe row whose stored parameters are identical, and only insert
   * a snapshot row when no such recipe exists — so generating from a saved
   * recipe links back to it instead of cloning it.
   *
   * Rejects an empty realized stream (D8): before any adaptation the realized
   * stream simply equals the planned expansion, so the caller always has one.
   */
  saveGeneratedWorkout(
    w: GeneratedWorkout,
    realized: RealizedTokenStream,
    sessionId?: string,
    recipeId?: string,
  ): void {
    if (!Array.isArray(realized) || realized.length === 0) {
      throw new WorkoutPersistenceError(
        'empty-realized-stream',
        `generated workout ${w.id} was saved without a realized token stream; ` +
          `recalculation replays what executed, never the recipe (D8, §8.6)`,
      )
    }

    const resolvedRecipeId = recipeId ?? this.resolveRecipeId(w.recipe)
    const blocks: BlocksPayload = {
      schedule: w.schedule,
      roundPunchTargets: w.roundPunchTargets,
      expectedTechniqueDistribution: w.expectedTechniqueDistribution,
      estimatedActivePunchesPerMinute: w.estimatedActivePunchesPerMinute,
      warnings: w.warnings,
    }

    this.run(
      `INSERT INTO generated_workouts
         (id, recipe_id, session_id, generator_version, seed,
          params_snapshot_json, blocks_json, realized_tokens_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        w.id,
        resolvedRecipeId,
        sessionId ?? null,
        w.recipe.generatorVersion,
        w.recipe.seed,
        JSON.stringify(w.recipe),
        JSON.stringify(blocks),
        JSON.stringify(realized),
        new Date().toISOString(),
      ],
    )
    logger.info('storage.workout.generated.save', 'generated workout saved', {
      id: safe(w.id),
      recipeId: safe(resolvedRecipeId),
      sessionId: safe(sessionId ?? null),
      blockCount: safe(realized.length),
    })
  }

  /**
   * The workout linked to a session, with the stream that actually executed.
   * `null` when the session ran no generated workout — that is a legitimate
   * miss, not a decode failure, which is why every decode failure throws.
   */
  getWorkoutBySession(
    sessionId: string,
  ): { workout: GeneratedWorkout; realized: RealizedTokenStream } | null {
    const row = this.select<RawWorkout>(
      'SELECT * FROM generated_workouts WHERE session_id = ? ORDER BY created_at DESC, id ASC',
      [sessionId],
    )[0]
    if (!row) return null
    return this.hydrate(row)
  }

  getWorkoutById(id: string): { workout: GeneratedWorkout; realized: RealizedTokenStream } | null {
    const row = this.select<RawWorkout>('SELECT * FROM generated_workouts WHERE id = ?', [id])[0]
    if (!row) return null
    return this.hydrate(row)
  }

  /**
   * Replace the realized stream after the pacing engine mutated the plan
   * (M33-07). Still refuses an empty stream — D8 holds after adaptation too.
   */
  updateRealizedTokens(generatedWorkoutId: string, realized: RealizedTokenStream): void {
    if (!Array.isArray(realized) || realized.length === 0) {
      throw new WorkoutPersistenceError(
        'empty-realized-stream',
        `refusing to blank the realized token stream of ${generatedWorkoutId} (D8, §8.6)`,
      )
    }
    this.run('UPDATE generated_workouts SET realized_tokens_json = ? WHERE id = ?', [
      JSON.stringify(realized),
      generatedWorkoutId,
    ])
  }

  /* -- adaptations ------------------------------------------------------ */

  /**
   * Append one pacing decision. `decidedAtMonotonicMs` is written verbatim:
   * substituting a wall clock here would make the decision log unorderable
   * across a system-clock change (§3.2, §18.3).
   */
  appendAdaptation(a: AdaptationRecord): void {
    if (!(ADAPTATION_BOUNDARIES as readonly string[]).includes(a.boundary)) {
      throw new WorkoutPersistenceError(
        'invalid-enum-value',
        `unknown adaptation boundary "${String(a.boundary)}" — expected one of ` +
          `${ADAPTATION_BOUNDARIES.join(', ')}`,
      )
    }
    this.run(
      `INSERT INTO workout_adaptations
         (id, generated_workout_id, decided_at_monotonic_ms, boundary, inputs_json, decision_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        newId('adp'),
        a.generatedWorkoutId,
        a.decidedAtMonotonicMs,
        a.boundary,
        JSON.stringify(a.inputs ?? null),
        JSON.stringify(a.decision ?? null),
      ],
    )
  }

  /** Decisions in monotonic order — the order they were actually made. */
  listAdaptations(generatedWorkoutId: string): AdaptationRecord[] {
    interface RawAdaptation {
      generated_workout_id: string
      decided_at_monotonic_ms: number
      boundary: AdaptationBoundary
      inputs_json: string
      decision_json: string
    }
    return this.select<RawAdaptation>(
      `SELECT * FROM workout_adaptations WHERE generated_workout_id = ?
        ORDER BY decided_at_monotonic_ms ASC, id ASC`,
      [generatedWorkoutId],
    ).map((r) => ({
      generatedWorkoutId: r.generated_workout_id,
      decidedAtMonotonicMs: r.decided_at_monotonic_ms,
      boundary: r.boundary,
      inputs: parseJson<unknown>(r.inputs_json, 'workout_adaptations.inputs_json'),
      decision: parseJson<unknown>(r.decision_json, 'workout_adaptations.decision_json'),
    }))
  }

  /* -- cue results ------------------------------------------------------ */

  /**
   * Write a batch of cue results all-or-nothing.
   *
   * Uses SAVEPOINT rather than BEGIN so M33-08 can call this inside its own
   * outer transaction that also writes the `sessions` row: a nested BEGIN
   * would raise, while a savepoint composes. A failing row rolls the batch back
   * to the savepoint and rethrows, leaving whatever the outer transaction had
   * already done untouched.
   *
   * Velocity fields are bound exactly as supplied, unit included (§4.3).
   */
  writeCueResults(rows: CueResultRow[]): void {
    if (rows.length === 0) return

    for (const row of rows) {
      if (!(CUE_OUTCOMES as readonly string[]).includes(row.outcome)) {
        throw new WorkoutPersistenceError(
          'invalid-enum-value',
          `unknown cue outcome "${String(row.outcome)}" — expected one of ${CUE_OUTCOMES.join(', ')}`,
        )
      }
    }

    const savepoint = 'workout_cue_results'
    this.db.execSync(`SAVEPOINT ${savepoint}`)
    try {
      for (const row of rows) {
        this.run(
          `INSERT INTO cue_results
             (session_id, generated_workout_id, block_id, repeat_index, token_index,
              expected_hand, expected_type, observed_event_id, outcome, offset_ms,
              velocity_raw, velocity_calibrated, velocity_unit,
              capability_tier, decoder_version, calculation_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.sessionId,
            row.generatedWorkoutId,
            row.blockId,
            row.repeatIndex,
            row.tokenIndex,
            row.expectedHand,
            row.expectedType,
            row.observedEventId,
            row.outcome,
            row.offsetMs,
            row.velocityRaw,
            row.velocityCalibrated,
            row.velocityUnit,
            row.capabilityTier,
            row.decoderVersion,
            row.calculationVersion,
          ],
        )
      }
      this.db.execSync(`RELEASE ${savepoint}`)
    } catch (err) {
      this.db.execSync(`ROLLBACK TO ${savepoint}`)
      this.db.execSync(`RELEASE ${savepoint}`)
      logger.error('storage.workout.cueResults.rollback', 'cue result batch rolled back', {
        rowCount: safe(rows.length),
        error: safe(String(err)),
      })
      throw err
    }
    logger.info('storage.workout.cueResults.write', 'cue results written', {
      rowCount: safe(rows.length),
    })
  }

  /** Results in cue order for one session. */
  listCueResults(sessionId: string): CueResultRow[] {
    interface RawCueResult {
      session_id: string
      generated_workout_id: string
      block_id: string
      repeat_index: number
      token_index: number
      expected_hand: 'left' | 'right'
      expected_type: string | null
      observed_event_id: string | null
      outcome: CueOutcome
      offset_ms: number | null
      velocity_raw: number | null
      velocity_calibrated: number | null
      velocity_unit: string | null
      capability_tier: string
      decoder_version: string
      calculation_version: string
    }
    return this.select<RawCueResult>(
      `SELECT * FROM cue_results WHERE session_id = ?
        ORDER BY generated_workout_id ASC, block_id ASC, repeat_index ASC, token_index ASC`,
      [sessionId],
    ).map((r) => ({
      sessionId: r.session_id,
      generatedWorkoutId: r.generated_workout_id,
      blockId: r.block_id,
      repeatIndex: r.repeat_index,
      tokenIndex: r.token_index,
      expectedHand: r.expected_hand,
      expectedType: r.expected_type,
      observedEventId: r.observed_event_id,
      outcome: r.outcome,
      offsetMs: r.offset_ms,
      velocityRaw: r.velocity_raw,
      velocityCalibrated: r.velocity_calibrated,
      velocityUnit: r.velocity_unit,
      capabilityTier: r.capability_tier,
      decoderVersion: r.decoder_version,
      calculationVersion: r.calculation_version,
    }))
  }

  /* -- internals -------------------------------------------------------- */

  private hydrate(row: RawWorkout): {
    workout: GeneratedWorkout
    realized: RealizedTokenStream
  } {
    const recipe = parseJson<WorkoutRecipe>(
      row.params_snapshot_json,
      'generated_workouts.params_snapshot_json',
    )
    const blocks = parseJson<BlocksPayload>(row.blocks_json, 'generated_workouts.blocks_json')
    if (blocks === null || typeof blocks !== 'object' || !Array.isArray(blocks.schedule)) {
      throw new WorkoutPersistenceError(
        'invalid-payload-shape',
        `blocks_json for workout ${row.id} has no schedule array`,
        row.blocks_json,
      )
    }
    return {
      workout: {
        id: row.id,
        recipe,
        schedule: blocks.schedule,
        roundPunchTargets: blocks.roundPunchTargets ?? [],
        expectedTechniqueDistribution: blocks.expectedTechniqueDistribution ?? {},
        estimatedActivePunchesPerMinute: blocks.estimatedActivePunchesPerMinute ?? 0,
        warnings: blocks.warnings ?? [],
      },
      realized: parseRealized(row.realized_tokens_json, row.id),
    }
  }

  /**
   * Find the recipe row whose stored parameters match this recipe, inserting a
   * snapshot row if there is none. See {@link saveGeneratedWorkout}.
   */
  private resolveRecipeId(recipe: WorkoutRecipe): string {
    const paramsJson = JSON.stringify(recipe)
    const existing = this.select<{ id: string }>(
      `SELECT id FROM workout_recipes
        WHERE params_json = ? AND recipe_schema_version = ?
        ORDER BY created_at ASC, id ASC`,
      [paramsJson, RECIPE_SCHEMA_VERSION],
    )[0]
    if (existing) return existing.id

    const snapshot = this.saveRecipe(`Generated ${new Date().toISOString()}`, recipe)
    logger.info('storage.workout.recipe.snapshot', 'captured an unsaved recipe for a workout', {
      id: safe(snapshot.id),
    })
    return snapshot.id
  }

  private select<TRow>(sql: string, params: SqlBindValue[]): TRow[] {
    const stmt = this.db.prepareSync(sql)
    try {
      return stmt.executeSync<TRow>(params).getAllSync()
    } finally {
      stmt.finalizeSync()
    }
  }

  private run(sql: string, params: SqlBindValue[]): void {
    const stmt = this.db.prepareSync(sql)
    try {
      stmt.executeSync(params)
    } finally {
      stmt.finalizeSync()
    }
  }
}
