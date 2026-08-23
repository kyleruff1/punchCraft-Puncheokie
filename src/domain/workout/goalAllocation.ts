/**
 * Round goal allocation (#192, doc §10, doc §22).
 *
 * Splits a workout's total punch goal across its scored rounds. The result
 * feeds the round targets the pacing engine chases (M33-05) and the count
 * badge grades against (M33-03).
 *
 * ## Two properties this must never lose
 *
 * **It sums exactly to the goal.** Not approximately: a plan whose round
 * targets add up to 1,198 when the athlete asked for 1,200 is quietly
 * lying about what it will ask of them. Rounding is done once, at the end,
 * by giving the remainder away one punch at a time — see `distribute`.
 *
 * **Warm-up and cooldown get zero.** They occupy session time but carry no
 * punch goal (doc §9), so `countsTowardGoal: false` rounds are excluded
 * from the weighting entirely rather than allocated a share and then
 * ignored.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import type { ProgramRound } from './WorkoutTokens'
import type { WorkoutFocus } from './punchGoals'

/**
 * How much more punching a count-scored block can absorb than an
 * enumerated one, per focus.
 *
 * Volume-burst and open-pressure blocks are how a high goal becomes
 * reachable at all (doc §14, §17): measured by tracker count rather than by
 * naming every punch, they hold far more output per minute than an exact
 * combo can. So a round built from them should carry a larger share.
 *
 * Focus enters *here* rather than as a flat per-round multiplier. Doc §10's
 * focus scaling is already applied to the total goal by `suggestGoal`, and
 * a uniform per-round weight would cancel out in the ratio and do nothing
 * at all. What focus genuinely changes is how punch-dense a burst is: under
 * a movement focus even a burst gives time to footwork, so it pulls less of
 * the round's share than the same burst would under a hands focus.
 */
const VOLUME_BLOCK_WEIGHT: Record<WorkoutFocus, number> = {
  hands: 1.8,
  balanced: 1.6,
  movement: 1.35,
}

const COUNT_SCORED_KINDS = new Set(['volume-burst', 'open-pressure'])

/**
 * Weight one round by how much punching it can actually hold: its active
 * time, scaled by how much of that time is count-scored.
 */
function roundWeight(round: ProgramRound, focus: WorkoutFocus): number {
  if (!round.countsTowardGoal) return 0

  const totalMs = round.blocks.reduce((sum, b) => sum + b.durationMs, 0)
  const volumeMs = round.blocks
    .filter((b) => COUNT_SCORED_KINDS.has(b.kind))
    .reduce((sum, b) => sum + b.durationMs, 0)

  // No blocks laid out yet: fall back to the work interval, so allocation
  // still works for a schedule that has not been expanded.
  if (totalMs <= 0) return round.workDurationMs

  const volumeShare = volumeMs / totalMs
  const density = 1 + volumeShare * (VOLUME_BLOCK_WEIGHT[focus] - 1)
  return round.workDurationMs * density
}

/**
 * Hand out `goal` in proportion to `weights`, losing nothing to rounding.
 *
 * Floor everything first, then give the remainder to the rounds with the
 * largest fractional parts — the largest-remainder method. Ties break on
 * index so the result is deterministic (spec §13.6).
 */
function distribute(goal: number, weights: readonly number[]): number[] {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  if (totalWeight <= 0) return weights.map(() => 0)

  const exact = weights.map((w) => (w / totalWeight) * goal)
  const allocated = exact.map((value) => Math.floor(value))
  let remainder = goal - allocated.reduce((sum, v) => sum + v, 0)

  const byFraction = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .filter(({ index }) => (weights[index] ?? 0) > 0)
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)

  let cursor = 0
  while (remainder > 0 && byFraction.length > 0) {
    const target = byFraction[cursor % byFraction.length]!
    allocated[target.index] = (allocated[target.index] ?? 0) + 1
    remainder -= 1
    cursor += 1
  }

  return allocated
}

/**
 * Split a total punch goal across a schedule's scored rounds.
 *
 * Deterministic: identical inputs give an identical array (spec §13.6).
 */
export function allocateRoundTargets(
  goal: number,
  schedule: readonly ProgramRound[],
  focus: WorkoutFocus,
): number[] {
  if (goal <= 0) return schedule.map(() => 0)
  const weights = schedule.map((round) => roundWeight(round, focus))
  return distribute(goal, weights)
}

// ---------------------------------------------------------------------------
// The high-goal rule (doc §17)
// ---------------------------------------------------------------------------

/**
 * The fastest distinct combinations can be called before the cues stop
 * being intelligible.
 *
 * Doc §17 is explicit that a high goal must not be met by shortening every
 * pause until commands run together. Above this rate the plan adds volume
 * blocks instead — the athlete keeps punching, but the app stops trying to
 * name every punch.
 */
export const EXACT_COMBO_DENSITY_CEILING_PER_MIN = 30

/** The shortest gap between combinations, in beats. Tuned in M36-03. */
export const MIN_GAP_BEATS = 0.75

export interface DensityAssessment {
  /** Punches per active minute this target implies. */
  impliedPacePerMin: number
  /** True when the target cannot be met with enumerated combinations alone. */
  needsVolumeBlocks: boolean
  /** Share of the round that must be count-scored to reach the target. */
  suggestedVolumeShare: number
}

/**
 * Ask whether a round target is reachable by naming every punch.
 *
 * The answer drives the generator (M35-03) and the reallocation in M33-07;
 * nothing here mutates a plan. Keeping it a question rather than an action
 * is what lets the same rule be applied at authoring time and at run time.
 */
export function assessDensity(
  targetPunches: number,
  workDurationMs: number,
  averageComboLength: number,
): DensityAssessment {
  const activeMinutes = workDurationMs / 60_000
  if (activeMinutes <= 0 || averageComboLength <= 0) {
    return { impliedPacePerMin: 0, needsVolumeBlocks: false, suggestedVolumeShare: 0 }
  }

  const impliedPacePerMin = targetPunches / activeMinutes
  const combosPerMin = impliedPacePerMin / averageComboLength
  if (combosPerMin <= EXACT_COMBO_DENSITY_CEILING_PER_MIN) {
    return { impliedPacePerMin, needsVolumeBlocks: false, suggestedVolumeShare: 0 }
  }

  // How much of the round has to become count-scored for the enumerated
  // remainder to sit at or under the ceiling.
  const reachableByCombos = EXACT_COMBO_DENSITY_CEILING_PER_MIN * averageComboLength
  const suggestedVolumeShare = Math.min(1, 1 - reachableByCombos / impliedPacePerMin)

  return { impliedPacePerMin, needsVolumeBlocks: true, suggestedVolumeShare }
}
