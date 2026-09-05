/**
 * Compose a new click workout by LINKING choreographed chunks (Kyle,
 * 2026-09-03: "create new workouts using sections that are fully
 * choreographed chunks").
 *
 * An author writes rounds as ordered lists of chunk ids (`ClickRoundRef`)
 * + the bespoke lead-in copy per spot. This resolves them into the exact
 * `ClickMap` shape and lowers it through the SAME path the hand-authored
 * samples use (`clickSpecs` -> `layBlocks`), so a composed workout is
 * indistinguishable downstream from a literal one.
 *
 * Round budget: a 4:00 round holds `bpm` measures (4 beats/measure ×
 * 4 min × bpm/60 = bpm), and the self-check requires an EXACT fill —
 * `sum(chunkMeasures) + SETUP_GAP_MEASURES × (sections − 1) === bpm`.
 * `roundBudget` reports what a set of sections uses and what remains, so
 * an author can fit chunks before the workout is ever compiled; `compose`
 * throws with that arithmetic if a round is mis-filled.
 */
import type { GeneratedWorkout } from '../GeneratedWorkout'
import type { ProgramRound } from '../WorkoutTokens'
import { parseCombo, punchTokens } from '../WorkoutTokens'
import { buildRoundSchedule, type WorkoutDurationMinutes } from '../roundSchedule'
import { defaultRecipe, type WorkoutRecipe } from '../WorkoutRecipe'
import { GENERATOR_VERSION } from '../versions'
import { layBlocks, roundPunchCount } from './authoring'
import { clickSpecs, rowMeasures, SETUP_GAP_MEASURES, type ClickMap } from './clickMaps'
import { getChunk, resolveRound, type ClickRoundRef } from './chunks'

export interface ComposedWorkoutDef {
  /** Workout id (register in samples/index.ts to make it runnable + renderable). */
  id: string
  /** Block-id short-code prefix, e.g. 'rw' -> 'rw1-b1' (must be unique among samples). */
  prefix: string
  bpm: number
  /** Total session length; the schedule's active-seconds basis (20/30/40/60). */
  durationMinutes: WorkoutDurationMinutes
  rounds: ClickRoundRef[]
  /** Recipe overrides merged over the click-workout defaults. */
  recipe?: Partial<WorkoutRecipe>
}

/** Measures a round's linked sections occupy, what the 4:00 round budgets, and the gap. */
export function roundBudget(
  bpm: number,
  sections: readonly { chunk: string; setupMeasures?: number }[],
): { usedMeasures: number; budgetMeasures: number; remainingMeasures: number } {
  const rows = sections.map((s) => {
    const c = getChunk(s.chunk)
    return rowMeasures({ motif: c.motif, rate: c.rate, reps: c.reps, leadIn: '' })
  })
  // Per-section setup pad: explicit setupMeasures wins, else the legacy
  // default (2 measures on every section after the first, 0 on the opener).
  const setupGaps = sections.reduce(
    (a, s, i) => a + (s.setupMeasures ?? (i > 0 ? SETUP_GAP_MEASURES : 0)),
    0,
  )
  const usedMeasures = rows.reduce((a, m) => a + m, 0) + setupGaps
  return { usedMeasures, budgetMeasures: bpm, remainingMeasures: bpm - usedMeasures }
}

/** Resolve chunk-referencing rounds into a plain ClickMap (identical to a literal map). */
export function resolveToClickMap(def: ComposedWorkoutDef): ClickMap {
  return { bpm: def.bpm, rounds: def.rounds.map(resolveRound) }
}

/**
 * Compose the GeneratedWorkout. Assembled exactly like the sample wrappers
 * (buildRoundSchedule + clickSpecs + layBlocks + computed tallies), so it
 * drops straight into the sample registry.
 */
export function compose(def: ComposedWorkoutDef): GeneratedWorkout {
  // Fail loudly on a mis-filled round BEFORE compiling — the same exact-fill
  // invariant clickMapsSelfCheck enforces for the literal maps.
  def.rounds.forEach((round, i) => {
    const b = roundBudget(def.bpm, round.sections)
    if (b.remainingMeasures !== 0) {
      throw new Error(
        `composed round ${i + 1} ("${round.theme}") uses ${b.usedMeasures}/${b.budgetMeasures} measures ` +
          `(${b.remainingMeasures > 0 ? `${b.remainingMeasures} short` : `${-b.remainingMeasures} over`}); ` +
          `a 4:00 round must fill exactly to ${b.budgetMeasures}.`,
      )
    }
  })

  const map = resolveToClickMap(def)
  const durationMinutes = def.durationMinutes
  const scheduleInfo = buildRoundSchedule(durationMinutes)

  const rounds: ProgramRound[] = map.rounds.map((round, index) => {
    const blocks = layBlocks(clickSpecs(def.prefix, index, round), map.bpm)
    const isLast = index === map.rounds.length - 1
    return {
      id: `${def.prefix}-r${index + 1}`,
      order: index + 1,
      kind: 'round',
      countsTowardGoal: true,
      theme: round.theme,
      workDurationMs: 240_000,
      restAfterMs: isLast ? 0 : 60_000,
      targetPunches: roundPunchCount(blocks),
      blocks,
    }
  })

  const totalGoal = rounds.reduce((sum, r) => sum + r.targetPunches, 0)

  const tally: Record<string, number> = {}
  for (const round of map.rounds) {
    for (const row of round.rows) {
      for (const t of punchTokens(parseCombo(row.motif))) {
        const key = `${t.number}${t.body ? 'b' : ''}`
        tally[key] = (tally[key] ?? 0) + row.reps
      }
    }
  }
  const tallyTotal = Object.values(tally).reduce((a, b) => a + b, 0) || 1
  const expectedTechniqueDistribution = Object.fromEntries(
    Object.entries(tally).map(([k, v]) => [k, Math.round((v / tallyTotal) * 100) / 100]),
  )

  return {
    id: def.id,
    recipe: {
      ...defaultRecipe(),
      durationMinutes,
      totalPunchGoal: totalGoal,
      defaultStance: 'orthodox',
      cadenceProfile: 'steady',
      voiceMode: 'minimal',
      coachTempo: { baseBpm: 60, division: 2, swing: 0.5 },
      metronome: { enabled: true, volume: 0.6 },
      generatorVersion: GENERATOR_VERSION,
      seed: `composed-${def.id}`,
      ...def.recipe,
    },
    schedule: rounds,
    roundPunchTargets: rounds.map((r) => r.targetPunches),
    expectedTechniqueDistribution,
    estimatedActivePunchesPerMinute: Math.round(totalGoal / (scheduleInfo.activeSeconds / 60)),
    warnings: [],
  }
}
