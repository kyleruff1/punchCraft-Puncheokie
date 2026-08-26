/**
 * Procedural workout generator (M35).
 *
 * Turns a `WorkoutRecipe` into a runnable `GeneratedWorkout` — the piece that
 * makes "Build a workout" mean something. It fills the fixed round schedule
 * with combinations drawn from the curated `comboLibrary`, escalating across
 * the workout the way a coach builds a session: singles and doubles to find
 * the range, longer combinations with movement in the middle, high-volume
 * pressure at the finish.
 *
 * **Deterministic (D8).** Every choice comes from a seeded RNG keyed on the
 * recipe's `seed` and `generatorVersion`, so the same recipe reproduces the
 * same plan — no `Math.random`, no clock reads (the domain-purity test
 * enforces both).
 *
 * **Voice-safe.** Combos are emitted from the library *verbatim* (only the
 * repeat count, gap and interleaving vary), never composed as fresh digit
 * strings — so every combination the generator can produce is one the Voice
 * Coach has a whole-phrase clip for.
 *
 * **Reuses the existing machinery** rather than re-deriving it: the schedule
 * (`buildRoundSchedule`), the exact-sum goal split (`allocateRoundTargets`),
 * the high-goal density rule (`assessDensity`), and the block layout / count
 * helpers (`layBlocks`, `roundPunchCount`, `blocksSpanMs`). The output is
 * gated by `validateGeneratedWorkout`, the same check the samples pass.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import { buildRoundSchedule, type RoundScheduleEntry } from './roundSchedule'
import { CADENCE_PROFILES } from './cadence'
import { allocateRoundTargets } from './goalAllocation'
import { layBlocks, roundPunchCount, blockPunchCount, type BlockSpec } from './samples/authoring'
import { makeRng } from './seededRandom'
import { fillScoredRound, type FillOptions } from './roundFill'
import { coverageAudit } from '../programs/mapValidation'
import type { GeneratedWorkout } from './GeneratedWorkout'
import type { WorkoutRecipe } from './WorkoutRecipe'
import type { ProgramRound, WorkoutBlock } from './WorkoutTokens'

/** A round's position in the workout, 0 at the first scored round, 1 at the last. */
type CurvePosition = number

/** A light auxiliary round (warm-up or cooldown) — shadow jabs, no goal. */
function buildAuxRound(
  order: number,
  entry: RoundScheduleEntry,
  recipe: WorkoutRecipe,
  bpm: number,
): ProgramRound {
  const jab = recipe.enabledPunches[0] ?? 1
  const isWarmUp = entry.kind === 'warm-up'
  const blockCount = isWarmUp ? 2 : 1
  const specs: BlockSpec[] = []
  for (let i = 0; i < blockCount; i++) {
    specs.push({
      id: `gen-${entry.kind}-b${i}`,
      kind: 'active-recovery',
      notation: String(jab),
      gapBeats: 1,
      durationBeats: 20,
      targetPunches: 8,
    })
  }
  const blocks = layBlocks(specs, bpm)
  return {
    id: `gen-${entry.kind}`,
    order,
    kind: entry.kind,
    countsTowardGoal: false,
    theme: isWarmUp ? 'Warm-up' : 'Cool down',
    workDurationMs: entry.workDurationMs,
    restAfterMs: entry.restAfterMs,
    targetPunches: roundPunchCount(blocks),
    blocks,
  }
}

// ---------------------------------------------------------------------------
// Distribution and assembly
// ---------------------------------------------------------------------------

/** Fold a round's realized punches into the running technique tally. */
function accumulateDistribution(blocks: readonly WorkoutBlock[], tally: Map<string, number>): void {
  for (const block of blocks) {
    const punchTokens = block.tokens.filter((t) => t.kind === 'punch')
    if (punchTokens.length === 0) continue
    // Spread the block's total punches across its distinct punch tokens — a
    // volume burst of '1-2' targeting 48 is 24 jabs and 24 crosses.
    const per = blockPunchCount(block) / punchTokens.length
    for (const token of punchTokens) {
      if (token.kind !== 'punch') continue
      const key = `${token.number}${token.body ? 'b' : ''}`
      tally.set(key, (tally.get(key) ?? 0) + per)
    }
  }
}

/**
 * Generate a runnable workout from a recipe.
 *
 * Deterministic in `(recipe, seed, generatorVersion)`. The result always
 * passes `validateGeneratedWorkout`; any compromise it had to make — volume
 * blocks to hit a high goal, a realized count that drifts from the goal, a
 * vocabulary too narrow to fill a round — is surfaced in `warnings` rather
 * than hidden.
 */
export function generateWorkout(
  recipe: WorkoutRecipe,
  options: FillOptions = {},
): GeneratedWorkout {
  const schedule = buildRoundSchedule(recipe.durationMinutes)
  const bpm = CADENCE_PROFILES[recipe.cadenceProfile].nominalBpm
  const rng = makeRng(`${recipe.seed}|${recipe.generatorVersion}`)

  const scoredCount = schedule.scoredRoundCount

  // Even split up front: equal-length rounds with no blocks yet weight equally,
  // and the largest-remainder split still sums to the goal exactly.
  const scoredShells: ProgramRound[] = schedule.entries
    .filter((e) => e.countsTowardGoal)
    .map((e, i) => ({
      id: `shell-${i}`,
      order: i,
      kind: 'round' as const,
      countsTowardGoal: true,
      theme: '',
      workDurationMs: e.workDurationMs,
      restAfterMs: e.restAfterMs,
      targetPunches: 0,
      blocks: [],
    }))
  const roundPunchTargets = allocateRoundTargets(recipe.totalPunchGoal, scoredShells, recipe.focus)

  const rounds: ProgramRound[] = []
  const warnings: string[] = []
  const tally = new Map<string, number>()
  let scoredIndex = 0
  let realizedTotal = 0
  let fallbackRounds = 0
  let uncoveredRounds = 0

  schedule.entries.forEach((entry, order) => {
    if (!entry.countsTowardGoal) {
      rounds.push(buildAuxRound(order, entry, recipe, bpm))
      return
    }
    const p: CurvePosition = scoredCount <= 1 ? 0 : scoredIndex / (scoredCount - 1)
    const target = roundPunchTargets[scoredIndex] ?? 0
    // D26: the round fills to the bell on the build-up template; its punch
    // target is an OUTPUT of that fill, not an input.
    const { round, usedFallback } = fillScoredRound(order, target, p, entry, recipe, bpm, rng, options)
    rounds.push(round)
    accumulateDistribution(round.blocks, tally)
    realizedTotal += round.targetPunches
    if (usedFallback) fallbackRounds += 1
    if (!coverageAudit(round.blocks, round.workDurationMs).ok) uncoveredRounds += 1
    scoredIndex += 1
  })

  // Normalize the realized distribution to shares.
  const distribution: Record<string, number> = {}
  const grand = [...tally.values()].reduce((sum, v) => sum + v, 0)
  if (grand > 0) {
    for (const [key, value] of tally) distribution[key] = Math.round((value / grand) * 1000) / 1000
  }

  const activeMinutes = schedule.activeSeconds / 60

  if (fallbackRounds > 0) {
    warnings.push(
      `No build-up ladder fit the recipe in ${fallbackRounds} round${fallbackRounds === 1 ? '' : 's'} (narrow vocabulary, tight combo cap, or clips still rendering) — legacy selection filled them.`,
    )
  }
  if (uncoveredRounds > 0) {
    warnings.push(
      `${uncoveredRounds} round${uncoveredRounds === 1 ? '' : 's'} could not be filled to the bell (D26) — the content pool is too narrow for the round length.`,
    )
  }
  if (recipe.totalPunchGoal > 0) {
    const drift = Math.abs(realizedTotal - recipe.totalPunchGoal) / recipe.totalPunchGoal
    // D26: round content fills the clock; punch targets are outputs. The
    // goal stays directional, so only a real departure is worth a warning.
    if (drift > 0.15) {
      warnings.push(
        `Prescribed punches (${realizedTotal}) differ from the goal (${recipe.totalPunchGoal}) by ${Math.round(drift * 100)}% — D26 fills the clock first; adjust duration or cadence to chase the goal.`,
      )
    }
  }

  return {
    id: `gen-${recipe.seed}`,
    recipe,
    schedule: rounds,
    roundPunchTargets,
    expectedTechniqueDistribution: distribution,
    estimatedActivePunchesPerMinute: activeMinutes > 0 ? Math.round(realizedTotal / activeMinutes) : 0,
    warnings,
  }
}
