/**
 * Recipe conflict detection (M31-04, doc §12).
 *
 * The governing rule from doc §12: **a conflict is always surfaced, never
 * silently resolved.** Disabling the jab while asking for a jab-led workout
 * must produce a visible conflict rather than the generator quietly ignoring
 * one of the two preferences — the athlete asked for both, and only they can
 * decide which to drop.
 *
 * Every conflict therefore carries a `resolution`: naming the problem
 * without saying what to change leaves the athlete stuck in the same screen.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import { GOAL_TIERS, impliedTargets } from './punchGoals'
import { buildRoundSchedule } from './roundSchedule'
import type { WorkoutRecipe } from './WorkoutRecipe'

export interface RecipeConflict {
  code: string
  fields: Array<keyof WorkoutRecipe>
  /** `error` blocks generation; `warning` lets it proceed with the caveat shown. */
  severity: 'error' | 'warning'
  message: string
  /** What the athlete can change. Never empty. */
  resolution: string
}

/**
 * Roughly the fastest sustainable rate of *distinct combinations*, used only
 * to spot a goal that cannot be reached with the chosen combo length.
 *
 * 30/minute is one combination every two seconds including its gap. Beyond
 * that the cues stop being intelligible (doc §17: "It should not simply
 * shorten every pause until commands become unintelligible"), so a goal
 * needing more is flagged rather than silently producing an unusable plan.
 */
const MAX_SUSTAINABLE_COMBOS_PER_MINUTE = 30

export function validateRecipe(recipe: WorkoutRecipe): RecipeConflict[] {
  const conflicts: RecipeConflict[] = []

  // (a) No punches at all.
  if (recipe.enabledPunches.length === 0) {
    conflicts.push({
      code: 'no-punches-enabled',
      fields: ['enabledPunches'],
      severity: 'error',
      message: 'No punches are enabled, so no combination can be generated.',
      resolution: 'Enable at least one punch number.',
    })
  }

  // (b) The doc §12 worked example: jab disabled in a jab-led configuration.
  //
  // Doc §15 asks for 60-80% of structured combinations to open with a jab,
  // so removing it always costs something. It is an error only when the
  // recipe also asks for a lead-hand bias, where the two settings directly
  // contradict; otherwise it is a warning, because a deliberate no-jab drill
  // is a legitimate thing to want.
  if (recipe.enabledPunches.length > 0 && !recipe.enabledPunches.includes(1)) {
    const leadBiased = recipe.bias === 'lead'
    conflicts.push({
      code: leadBiased ? 'jab-disabled-with-lead-bias' : 'jab-disabled',
      fields: leadBiased ? ['enabledPunches', 'bias'] : ['enabledPunches'],
      severity: leadBiased ? 'error' : 'warning',
      message: leadBiased
        ? 'The jab is disabled while the workout asks for a lead-hand bias. These two settings contradict each other.'
        : 'The jab is disabled. Most structured combinations open with a jab, so variety will be reduced.',
      resolution: leadBiased
        ? 'Enable the jab, or change the bias away from lead-hand.'
        : 'Enable the jab, or continue if a no-jab drill is intended.',
    })
  }

  // (c) A command frequency is set but its vocabulary is empty.
  const enablementPairs: Array<{
    frequency: WorkoutRecipe['defenseFrequency']
    list: readonly string[]
    freqField: keyof WorkoutRecipe
    listField: keyof WorkoutRecipe
    label: string
  }> = [
    {
      frequency: recipe.defenseFrequency,
      list: recipe.enabledDefense,
      freqField: 'defenseFrequency',
      listField: 'enabledDefense',
      label: 'defensive movements',
    },
    {
      frequency: recipe.footworkFrequency,
      list: recipe.enabledFootwork,
      freqField: 'footworkFrequency',
      listField: 'enabledFootwork',
      label: 'footwork commands',
    },
  ]

  for (const pair of enablementPairs) {
    if (pair.frequency !== 'off' && pair.list.length === 0) {
      conflicts.push({
        code: `${String(pair.listField)}-empty-with-frequency`,
        fields: [pair.freqField, pair.listField],
        severity: 'error',
        message: `The workout asks for ${pair.frequency} ${pair.label} but none are enabled.`,
        resolution: `Enable at least one, or set the frequency to off.`,
      })
    }
  }

  // (d) Goal above the top tier for this duration.
  const extremeGoal = GOAL_TIERS.extreme[recipe.durationMinutes]
  if (recipe.totalPunchGoal > extremeGoal) {
    conflicts.push({
      code: 'goal-above-extreme-tier',
      fields: ['totalPunchGoal', 'durationMinutes'],
      severity: 'warning',
      message: `A goal of ${recipe.totalPunchGoal} is above the Extreme tier for ${recipe.durationMinutes} minutes (${extremeGoal}). Extreme already requires sustained flurry blocks throughout.`,
      resolution: `Lower the goal toward ${extremeGoal}, or choose a longer session.`,
    })
  }

  // (e) Goal unreachable at the chosen combo length.
  if (recipe.enabledPunches.length > 0 && recipe.maximumComboPunches > 0) {
    const schedule = buildRoundSchedule(recipe.durationMinutes)
    const { activePunchesPerMinute } = impliedTargets(recipe.totalPunchGoal, schedule)
    const combosPerMinute = activePunchesPerMinute / recipe.maximumComboPunches
    if (combosPerMinute > MAX_SUSTAINABLE_COMBOS_PER_MINUTE) {
      conflicts.push({
        code: 'goal-unreachable-at-combo-length',
        fields: ['totalPunchGoal', 'maximumComboPunches'],
        severity: 'warning',
        message: `Reaching ${recipe.totalPunchGoal} punches with combinations of at most ${recipe.maximumComboPunches} needs about ${Math.round(combosPerMinute)} combinations a minute, which leaves too little room between cues.`,
        resolution: 'Raise the maximum combination length, or lower the goal.',
      })
    }
  }

  // (f) Body-shot share out of range.
  //
  // The advanced panel (M31-07) gates this behind a Body variations switch,
  // so 0 is a normal value meaning "head shots only". Anything outside 0-100
  // is not a preference, it is a broken recipe.
  if (recipe.bodyShotPercent < 0 || recipe.bodyShotPercent > 100) {
    conflicts.push({
      code: 'body-shot-percent-out-of-range',
      fields: ['bodyShotPercent'],
      severity: 'error',
      message: `A body-shot share of ${recipe.bodyShotPercent}% is not a valid proportion.`,
      resolution: 'Set the body-shot share between 0 and 100 percent.',
    })
  }

  // (g) Every enabled punch would be thrown to the body.
  //
  // A warning rather than an error: a body-only round is a legitimate drill,
  // but at 100% the head-shot variety doc §15 asks for disappears entirely,
  // and the athlete should know that is what they chose.
  if (recipe.bodyShotPercent === 100) {
    conflicts.push({
      code: 'body-shots-only',
      fields: ['bodyShotPercent'],
      severity: 'warning',
      message: 'Every punch will be called to the body, so no head-shot variety remains.',
      resolution: 'Lower the body-shot share, or continue if a body-only drill is intended.',
    })
  }

  return conflicts
}

/** True when nothing blocks generation. Warnings do not block. */
export function canGenerate(conflicts: readonly RecipeConflict[]): boolean {
  return !conflicts.some((c) => c.severity === 'error')
}
