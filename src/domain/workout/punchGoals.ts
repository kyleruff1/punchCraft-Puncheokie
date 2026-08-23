/**
 * Punch-goal tiers and implied rates (M31-03, doc §10).
 *
 * A goal is a **count of punches**. It is never a measure of force, output
 * or exertion, and nothing here may label it as one (spec §4.3).
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import type { RoundSchedule, WorkoutDurationMinutes } from './roundSchedule'

export type IntensityTier = 'technique' | 'steady' | 'hard' | 'high-volume' | 'extreme'
export type WorkoutFocus = 'hands' | 'movement' | 'balanced'

/** Doc §10 matrix, cell for cell. */
export const GOAL_TIERS: Record<IntensityTier, Record<WorkoutDurationMinutes, number>> = {
  technique: { 20: 800, 30: 1_200, 40: 1_600, 60: 2_400 },
  steady: { 20: 1_000, 30: 1_500, 40: 2_000, 60: 3_000 },
  hard: { 20: 1_200, 30: 1_800, 40: 2_400, 60: 3_600 },
  'high-volume': { 20: 1_500, 30: 2_250, 40: 3_000, 60: 4_500 },
  extreme: { 20: 2_000, 30: 3_000, 40: 4_000, 60: 6_000 },
}

/** Display names from doc §10. */
export const TIER_LABELS: Record<IntensityTier, string> = {
  technique: 'Technique',
  steady: 'Steady',
  hard: 'Hard',
  'high-volume': 'High Volume',
  extreme: 'Extreme',
}

const TIER_ORDER: IntensityTier[] = ['technique', 'steady', 'hard', 'high-volume', 'extreme']

/**
 * Focus scaling factors.
 *
 * Doc §10 gives bands rather than values — balanced ≈ 85–95% of the hands
 * tier, movement ≈ 65–80% — so these are implementation-chosen constants
 * near the middle of each band. Results round to the nearest 50 so the goal
 * shown to the athlete is a round number; a test asserts that every cell in
 * the matrix stays inside its documented band *after* that rounding, which
 * is the property that could otherwise break silently at the small end.
 */
const FOCUS_FACTORS: Record<WorkoutFocus, number> = {
  hands: 1,
  balanced: 0.9,
  movement: 0.725,
}

/** Doc §10 bands, kept next to the factors so the test can assert against them. */
export const FOCUS_BANDS: Record<WorkoutFocus, { min: number; max: number }> = {
  hands: { min: 1, max: 1 },
  balanced: { min: 0.85, max: 0.95 },
  movement: { min: 0.65, max: 0.8 },
}

const roundTo50 = (n: number): number => Math.round(n / 50) * 50

/**
 * Suggested punch goal for a duration, tier and focus.
 *
 * A movement-focused workout spends real time on defense and footwork, so
 * the same intensity tier implies fewer punches — the goal scales rather
 * than the athlete being expected to hit a hands-focused number while also
 * moving.
 */
export function suggestGoal(
  minutes: WorkoutDurationMinutes,
  tier: IntensityTier,
  focus: WorkoutFocus,
): number {
  return roundTo50(GOAL_TIERS[tier][minutes] * FOCUS_FACTORS[focus])
}

export interface ImpliedTargets {
  perScoredRound: number
  activePunchesPerMinute: number
}

/**
 * What a goal works out to per round and per active minute.
 *
 * Both are computed against **scored rounds only** (doc §9's active work
 * time), because warm-up and cooldown carry no goal. Values are unrounded;
 * the recipe summary (M31-04) rounds for display.
 */
export function impliedTargets(goal: number, schedule: RoundSchedule): ImpliedTargets {
  return {
    perScoredRound: goal / schedule.scoredRoundCount,
    activePunchesPerMinute: goal / (schedule.activeSeconds / 60),
  }
}

export interface IntensityDescription {
  tier: IntensityTier
  label: string
  /** Present only for tiers needing an explicit caution (doc §10, §25). */
  warning?: string
}

/**
 * Describe a goal by the tier it sits nearest at that duration.
 *
 * The Extreme tier always carries a warning. Doc §10 calls it a specialized
 * high-volume target requiring sustained flurry blocks, and §25 requires
 * high-volume targets to be labelled clearly — an athlete should not arrive
 * at 400 punches per minute without having been told that is what they
 * selected.
 */
export function intensityLabel(
  goal: number,
  minutes: WorkoutDurationMinutes,
): IntensityDescription {
  let nearest: IntensityTier = TIER_ORDER[0] as IntensityTier
  let smallestDistance = Number.POSITIVE_INFINITY

  for (const tier of TIER_ORDER) {
    const distance = Math.abs(GOAL_TIERS[tier][minutes] - goal)
    // Strictly-less keeps the LOWER tier on an exact tie, so a goal midway
    // between two tiers is described conservatively rather than flattering.
    if (distance < smallestDistance) {
      smallestDistance = distance
      nearest = tier
    }
  }

  const description: IntensityDescription = { tier: nearest, label: TIER_LABELS[nearest] }
  if (nearest === 'extreme') {
    description.warning =
      'Extreme is a specialized high-volume target. It requires sustained flurry blocks throughout every round.'
  }
  return description
}
