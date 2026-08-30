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
import type { CoachTempo } from '../timing/TimingEngine'

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
  /**
   * @deprecated (M39-V1c prep, 2026-08-30) — superseded by `coachTempo`
   * once every sample opts into the engine. Still read while
   * `metronome.enabled: false` (the `bpmForRecipe` bridge selects
   * `CADENCE_PROFILES[cadenceProfile].nominalBpm` for legacy recipes),
   * and still stored on every recipe because samples migrate one at a
   * time. Remove after the corpus re-render + full sample flip lands.
   */
  cadenceProfile: CadenceProfile
  /**
   * Content tier (Rhythm Map M1). Selects VOCABULARY — which combination
   * families, defense density and build-up ladders the athlete trains —
   * not merely combo length; a beginner gets beginner patterns, not just
   * short ones. Optional: legacy recipes derive a default from
   * `comboComplexity` via `tierFor`.
   */
  tier?: 'beginner' | 'intermediate' | 'advanced'
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

  // -- Timing Engine (M39, Kyle's spec 2026-08-30) ---------------------------
  /**
   * Master pulse + subdivision + swing. Present on every recipe from V1a
   * onward; consumed by the runtime only when `metronome.enabled` is true
   * (V1b). Legacy behaviour (byte-identical to the pre-M39 pipeline)
   * remains as long as `metronome.enabled` is `false` — `bpmForRecipe`
   * bridges to `CADENCE_PROFILES[cadenceProfile].nominalBpm` in that case.
   *
   * Defaults: baseBpm 60 (Kyle's target), division derived from
   * `cadenceProfile` (technical=1, steady=2, pressure=3, sprint=4) so a
   * recipe migrated forward preserves the same rate expectations, and
   * swing 0.54 (rolling cornerman default within Kyle's 0.54–0.57 band).
   */
  coachTempo: CoachTempo
  /**
   * Metronome track — the boxing-flavored 3rd audio track (V1b).
   * `enabled: false` on every recipe today; V1b flips
   * `threeRoundFundamentals` first, V1c flips the rest.
   */
  metronome: {
    enabled: boolean
    /** 0..1, mixer channel. Default 0.6 — hot enough to sit under both coach and chime-ins. */
    volume: number
  }
  /**
   * Runtime speed scalar (V2). Multiplies `coachTempo.baseBpm` — 1.0 leaves
   * the grid untouched; 0.75 slows every ring/voice/click; 1.25 speeds them
   * up together. UI slider ships in V2; the recipe field lands here so the
   * V1a byte-identity test also covers the future scaling path.
   */
  globalSpeed: number

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
/**
 * The tier a recipe trains at — the explicit field when set, otherwise the
 * legacy derivation from `comboComplexity` (1-2 → beginner, 3 →
 * intermediate, 4-5 → advanced). The shim keeps every stored recipe valid
 * while the tier picker rolls out.
 */
export function tierFor(recipe: WorkoutRecipe): 'beginner' | 'intermediate' | 'advanced' {
  if (recipe.tier) return recipe.tier
  if (recipe.comboComplexity <= 2) return 'beginner'
  if (recipe.comboComplexity === 3) return 'intermediate'
  return 'advanced'
}

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

    // Timing Engine (M39/#278). Default `metronome.enabled: false` keeps
    // every existing timeline compile byte-identical — `bpmForRecipe`
    // falls through to the legacy nominalBpm path (see cadence.ts). The
    // steady profile picks division 2 = 120 slots/min at baseBpm 60.
    coachTempo: { baseBpm: 60, division: 2, swing: 0.54 },
    metronome: { enabled: false, volume: 0.6 },
    globalSpeed: 1.0,

    generatorVersion: GENERATOR_VERSION,
    seed: 'default-seed',
  }
}

/**
 * Map a legacy `cadenceProfile` name to its natural `BeatDivision` on the
 * new 60 BPM grid. Kept as a helper (not a `switch` inlined at call sites)
 * so a future recipe migration or fixture rewrite has one place to touch.
 * The mapping is Kyle's spec verbatim: 4 profiles are 4 subdivisions of ONE
 * clock, not four unrelated BPMs.
 */
export function divisionForCadenceProfile(
  cadence: CadenceProfile,
): CoachTempo['division'] {
  switch (cadence) {
    case 'technical': return 1
    case 'steady':    return 2
    case 'pressure':  return 3
    case 'sprint':    return 4
  }
}
