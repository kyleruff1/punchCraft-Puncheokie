/**
 * Recipe summary text (M31-04, doc §8.2).
 *
 * Doc §8.2 requires the setup screen to show a generated summary **before**
 * the workout starts (R15), so the athlete sees what they actually
 * configured rather than discovering it mid-round.
 *
 * Terminology, per spec §4.3: punches 2/4/6 are "rear-hand punches" and
 * heavier techniques are "heavy punches". Velocity, if ever mentioned here,
 * is "tracker-reported velocity" in tracker units — never force, output or
 * exertion.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import { CADENCE_PROFILES } from './cadence'
import { impliedTargets, intensityLabel } from './punchGoals'
import type { RoundSchedule } from './roundSchedule'
import { isLeadNumber } from '../programs/StanceMapper'
import type { PunchNumber } from './WorkoutTokens'
import type { WorkoutRecipe } from './WorkoutRecipe'

export interface RecipeSummary {
  lines: string[]
  /** Punches per active minute, rounded for display. */
  expectedActivePace: number
}

/** Human names for the six numbers (doc §2). */
const PUNCH_NAMES: Record<PunchNumber, string> = {
  1: 'Jab',
  2: 'Cross',
  3: 'Lead hook',
  4: 'Rear hook',
  5: 'Lead uppercut',
  6: 'Rear uppercut',
}

/** Rough per-round call counts for each frequency band (doc §12). */
const FREQUENCY_CALLS: Record<WorkoutRecipe['defenseFrequency'], string> = {
  off: 'none',
  light: '2-3 calls/round',
  moderate: '5-8 calls/round',
  heavy: '9-14 calls/round',
}

const BIAS_LABELS: Record<WorkoutRecipe['bias'], string> = {
  balanced: 'Balanced',
  lead: 'Lead-hand bias',
  rear: 'Rear-hand bias',
  left: 'Physical-left bias',
  right: 'Physical-right bias',
}

const STANCE_MODE_LABELS: Record<WorkoutRecipe['stanceMode'], string> = {
  fixed: '',
  'switch-by-round': ' with switch rounds',
  'switch-on-command': ' with switch on command',
}

const ADAPTATION_LABELS: Record<WorkoutRecipe['adaptationMode'], string> = {
  fixed: 'Fixed plan',
  adaptive: 'Adaptive pace',
  'goal-seeking': 'Goal-seeking',
}

const VOICE_LABELS: Record<WorkoutRecipe['voiceMode'], string> = {
  off: 'Voice Coach off',
  minimal: 'Minimal Voice Coach',
  standard: 'Standard Voice Coach',
  full: 'Full Voice Coach',
}

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Estimated share of each enabled punch.
 *
 * A rough weighting only, shown so the athlete can sanity-check their
 * enablement choices before generating. The real distribution comes from
 * the generator (M35-03) once templates are selected; this deliberately
 * does not try to predict template behaviour it cannot see.
 *
 * The jab is weighted heaviest because doc §15 asks for 35-55% of punches
 * to be jabs; bias then shifts weight between lead and rear.
 */
function estimateDistribution(recipe: WorkoutRecipe): Array<[PunchNumber, number]> {
  const weights = new Map<PunchNumber, number>()
  for (const n of recipe.enabledPunches) {
    let weight = n === 1 ? 3 : 1
    if (recipe.bias === 'lead' && isLeadNumber(n)) weight *= 1.4
    if (recipe.bias === 'rear' && !isLeadNumber(n)) weight *= 1.4
    weights.set(n, weight)
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return []
  return [...weights.entries()]
    .map(([n, w]) => [n, w / total] as [PunchNumber, number])
    .sort((a, b) => b[1] - a[1])
}

/**
 * Build the doc §8.2 summary.
 *
 * Line classes, in order: duration/rounds/goal · focus + stance + bias ·
 * estimated technique distribution · body and command frequencies ·
 * cadence + adaptation + voice · expected active pace.
 */
export function summarizeRecipe(recipe: WorkoutRecipe, schedule: RoundSchedule): RecipeSummary {
  const targets = impliedTargets(recipe.totalPunchGoal, schedule)
  const intensity = intensityLabel(recipe.totalPunchGoal, recipe.durationMinutes)
  const expectedActivePace = Math.round(targets.activePunchesPerMinute)

  const lines: string[] = []

  lines.push(
    `${recipe.durationMinutes} minutes · ${schedule.scoredRoundCount} rounds · ${recipe.totalPunchGoal.toLocaleString('en-US')}-punch target (${intensity.label})`,
  )

  lines.push(
    `${capitalize(recipe.focus)} · ${capitalize(recipe.defaultStance)}${STANCE_MODE_LABELS[recipe.stanceMode]} · ${BIAS_LABELS[recipe.bias]}`,
  )

  const distribution = estimateDistribution(recipe)
  if (distribution.length > 0) {
    lines.push(
      distribution.map(([n, share]) => `${PUNCH_NAMES[n]} ${Math.round(share * 100)}%`).join(' · '),
    )
  }

  lines.push(
    `Body shots ${recipe.bodyShotPercent}% · Defense ${FREQUENCY_CALLS[recipe.defenseFrequency]} · Footwork ${FREQUENCY_CALLS[recipe.footworkFrequency]}`,
  )

  const cadence = CADENCE_PROFILES[recipe.cadenceProfile]
  lines.push(
    `${capitalize(recipe.cadenceProfile)} cadence (${cadence.minBpm}-${cadence.maxBpm} BPM) · ${ADAPTATION_LABELS[recipe.adaptationMode]} · ${VOICE_LABELS[recipe.voiceMode]}`,
  )

  // R15 — the summary always ends with the pace, so the athlete sees the
  // number that actually determines how hard the session will feel.
  lines.push(`Expected active pace: ${expectedActivePace} punches/minute`)

  if (intensity.warning) lines.push(intensity.warning)

  return { lines, expectedActivePace }
}
