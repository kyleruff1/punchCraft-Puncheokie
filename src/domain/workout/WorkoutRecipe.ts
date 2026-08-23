/**
 * WorkoutRecipe — the parameter set a workout is generated from (doc §26, §8).
 *
 * Type-only at M31-01 so `GeneratedWorkout.recipe` typechecks. M31-04 owns
 * its behaviour — defaults, conflict validation and the summary text — and
 * must not rename these fields.
 *
 * Two deliberate departures from the doc §26 declaration, both resolved by
 * **D14**:
 *
 *  1. `id` and `name` are NOT here. They live on the `workout_recipes` row,
 *     because a recipe's identity belongs to storage, not to the parameter
 *     set the generator consumes.
 *  2. The seven §8.2 advanced controls the §26 snippet omitted are typed
 *     fields rather than being buried in `params_json`. Keeping them in the
 *     type is what makes the generator's inputs statically checkable;
 *     `params_json` then persists this whole object under
 *     `recipe_schema_version`.
 *
 * And one from **D15**: voice has two independent axes — how much it speaks
 * (`voiceMode`) and which words it uses (`voiceVocabulary`). Collapsing them
 * into a single enum is what left §18.1 and §26 disagreeing.
 */

import type { PunchNumber, Stance, DefenseCommand, FootworkCommand, CoachCommand } from './WorkoutTokens'
import { suggestGoal } from './punchGoals'
import { GENERATOR_VERSION } from './versions'

/** Nominal cadence bands from doc §17. Beats become milliseconds via M31-02. */
export type CadenceProfile = 'technical' | 'steady' | 'pressure' | 'sprint'

export type Frequency = 'off' | 'light' | 'moderate' | 'heavy'

/** How much the coach speaks (D15). Orthogonal to vocabulary. */
export type VoiceMode = 'off' | 'minimal' | 'standard' | 'full'

/**
 * Which words the coach uses (D15).
 *
 * `numbers` speaks the digits — "one, two, three" — matching how a coach
 * calls combos in a gym. `names` speaks techniques — "jab, cross, left hook".
 *
 * This is not only preference: phrase duration competes with the cue window,
 * so at high cadence `numbers` is the only vocabulary that fits, and the
 * announcer downgrades to it rather than letting speech overrun the beat.
 */
export type VoiceVocabulary = 'numbers' | 'names'

/** Whether extras are encouraged, ignored, or counted against precision (§8.2). */
export type ExtraPunchPolicy = 'encouraged' | 'neutral' | 'discouraged'

export interface WorkoutRecipe {
  // -- §8.1 primary controls -------------------------------------------------
  durationMinutes: 20 | 30 | 40 | 60
  totalPunchGoal: number
  focus: 'hands' | 'movement' | 'balanced'
  defaultStance: Stance
  stanceMode: 'fixed' | 'switch-by-round' | 'switch-on-command'
  /**
   * Lead/rear bias is preferred over physical-left/right because it stays
   * meaningful when the athlete switches stance (doc §11). Implemented as a
   * generator *weight*, never a hard constraint on every combination.
   */
  bias: 'balanced' | 'lead' | 'rear' | 'left' | 'right'
  adaptationMode: 'fixed' | 'adaptive' | 'goal-seeking'

  // -- §12 enablement --------------------------------------------------------
  enabledPunches: PunchNumber[]
  bodyShotPercent: number
  enabledDefense: DefenseCommand[]
  enabledFootwork: FootworkCommand[]
  enabledCoachCalls: CoachCommand[]

  // -- §8.2 advanced ---------------------------------------------------------
  maximumComboPunches: number
  defenseFrequency: Frequency
  footworkFrequency: Frequency
  cadenceProfile: CadenceProfile
  /** Added by D14 — the seven controls §26 omitted. */
  comboComplexity: 1 | 2 | 3 | 4 | 5
  cueRhythmProfile: 'even' | 'syncopated' | 'burst'
  velocityZoneEmphasis: 1 | 2 | 3 | 4 | null
  metricAnnouncementFrequency: 'off' | 'round' | 'periodic'
  visualLeadTimeMs: number
  commandVocabularyStyle: 'numbers' | 'names' | 'mixed'
  extraPunchPolicy: ExtraPunchPolicy

  // -- voice (D15) -----------------------------------------------------------
  voiceMode: VoiceMode
  voiceVocabulary: VoiceVocabulary

  // -- determinism (D8, R18) -------------------------------------------------
  /** Same recipe + generatorVersion + seed must reproduce an identical plan. */
  generatorVersion: string
  seed: string
}

// ---------------------------------------------------------------------------
// Defaults (M31-04)
// ---------------------------------------------------------------------------


/**
 * A clean, useful workout with no further input (doc §8 — the athlete should
 * be training inside a minute).
 *
 * Choices and why: 20 minutes and the Steady tier because that is the
 * shortest schedule and the middle intensity, so neither dimension biases a
 * first run; balanced focus and bias so nothing is over-represented; all six
 * punches and every command enabled so the generator has its full vocabulary
 * and no enablement conflict fires; `visualLeadTimeMs` 1500 to match doc
 * §18.3's T−1.50s preview; `maximumComboPunches` 5, the upper end of the
 * authored combo-length rule.
 *
 * `seed` is a fixed placeholder so this function stays pure and testable —
 * the Recipe screen replaces it with a fresh seed per generated workout, and
 * the seed is what makes a workout reproducible (R18).
 */
export function defaultRecipe(): WorkoutRecipe {
  return {
    durationMinutes: 20,
    totalPunchGoal: suggestGoal(20, 'steady', 'balanced'),
    focus: 'balanced',
    defaultStance: 'orthodox',
    stanceMode: 'fixed',
    bias: 'balanced',
    adaptationMode: 'fixed',

    enabledPunches: [1, 2, 3, 4, 5, 6],
    bodyShotPercent: 18,
    enabledDefense: ['duck', 'bob-weave', 'slip', 'roll', 'pull'],
    enabledFootwork: ['pivot', 'step-off', 'circle', 'cut-off-ring', 'reset'],
    enabledCoachCalls: ['double-up', 'put-it-on-em', 'touch-and-go', 'breathe', 'hands-up'],

    maximumComboPunches: 5,
    defenseFrequency: 'light',
    footworkFrequency: 'light',
    cadenceProfile: 'steady',
    comboComplexity: 3,
    cueRhythmProfile: 'even',
    velocityZoneEmphasis: null,
    metricAnnouncementFrequency: 'round',
    visualLeadTimeMs: 1_500,
    commandVocabularyStyle: 'numbers',
    extraPunchPolicy: 'neutral',

    voiceMode: 'standard',
    voiceVocabulary: 'numbers',

    generatorVersion: GENERATOR_VERSION,
    seed: 'default-seed',
  }
}
