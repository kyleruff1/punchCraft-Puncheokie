/**
 * Diagnostic Token Sequence — the reference workout for the
 * dispatch verification harness (W4, Kyle 2026-08-30).
 *
 * The 2026-08-30 on-glass QA proved that the coach audio the
 * athlete heard did not match the cue tokens on the screen. This
 * sample exists to give the autonomous verify-workout harness a
 * KNOWN-TRUTH surface: a minimal, hand-authored recipe whose
 * compiled script the analyzer can score every runtime dispatch
 * against.
 *
 * Round 1 is the diagnostic — five combos hitting the exact
 * mismatch surface Kyle observed, once each, back-to-back:
 *
 *   - `1-2`          — the per-word ordering baseline
 *   - `1-2b-3`       — fused-body + ordering + missing-body regression
 *   - `1-1-2`        — duplicate-token adoption
 *   - `slip-2-3-2`   — defense token then counter (the log's `'slip'` mixin)
 *   - `1-2b`         — fused-body pair (isolates body-shot behavior)
 *
 * Each combo is ONE rep at a slow `technical` cadence so the analyzer
 * can measure timing drift without spurious collisions. The compiled
 * script for R1 is the golden reference the harness checks.
 *
 * R2-R4 are filler `1-2 × 4` blocks to satisfy the 20-minute
 * workout duration constraint (`buildRoundSchedule(20) = 4 rounds`).
 * The verify-workout harness force-stops after R1 completes; R2-R4
 * exist only so the sample compiles + registers with `samples/index`.
 *
 * NOT registered in the presentation ORDER of `samples/index.ts` —
 * Kyle should not see this in the workout picker as a normal option;
 * it's an internal QA rig.
 */
import { CADENCE_PROFILES } from '../cadence'
import type { GeneratedWorkout } from '../GeneratedWorkout'
import type { ProgramRound } from '../WorkoutTokens'
import { buildRoundSchedule } from '../roundSchedule'
import { suggestGoal } from '../punchGoals'
import { defaultRecipe } from '../WorkoutRecipe'
import { GENERATOR_VERSION } from '../versions'
import { layBlocks, roundPunchCount, type BlockSpec } from './authoring'

const BPM = CADENCE_PROFILES.technical.nominalBpm
const ROUND_MS = 240_000
const schedule = buildRoundSchedule(20)

/**
 * R1 — the diagnostic. Five combos, one rep each, technical cadence.
 * Each combo has a leading gap so consecutive combos don't collide
 * in the analyzer.
 */
const DIAGNOSTIC_R1: BlockSpec[] = [
  { id: 'dts-r1-b1', kind: 'exact-combo', notation: '1-2', offsets: [0, 1], gapBeats: 4, spokenPhrase: 'Jab, cross.' },
  { id: 'dts-r1-b2', kind: 'exact-combo', notation: '1-2b-3', offsets: [0, 1, 2], gapBeats: 4, spokenPhrase: 'Jab, body cross, hook.' },
  { id: 'dts-r1-b3', kind: 'exact-combo', notation: '1-1-2', offsets: [0, 1, 2], gapBeats: 4, spokenPhrase: 'Double jab, cross.' },
  { id: 'dts-r1-b4', kind: 'defense-counter', notation: 'slip-2-3-2', offsets: [0, 1, 2, 3], gapBeats: 4, spokenPhrase: 'Slip. Cross, hook, cross.' },
  { id: 'dts-r1-b5', kind: 'exact-combo', notation: '1-2b', offsets: [0, 1], gapBeats: 4, spokenPhrase: 'Jab, body cross.' },
]

/**
 * Filler rounds — `1-2 × 4` at steady. Only exist because
 * `buildRoundSchedule(20)` requires 4 rounds; the harness stops
 * after R1.
 */
function fillerRound(id: string): BlockSpec[] {
  return [
    {
      id,
      kind: 'repeated-combo',
      notation: '1-2',
      offsets: [0, 1],
      gapBeats: 2,
      repeat: 4,
      spokenPhrase: 'Jab, cross.',
    },
  ]
}

const ROUND_SPECS: Array<{ theme: string; specs: BlockSpec[] }> = [
  { theme: 'Diagnostic — five known-truth combos', specs: DIAGNOSTIC_R1 },
  { theme: 'Filler R2', specs: fillerRound('dts-r2-b1') },
  { theme: 'Filler R3', specs: fillerRound('dts-r3-b1') },
  { theme: 'Filler R4', specs: fillerRound('dts-r4-b1') },
]

const rounds: ProgramRound[] = ROUND_SPECS.map((spec, index) => {
  const blocks = layBlocks(spec.specs, BPM)
  const isLast = index === ROUND_SPECS.length - 1
  return {
    id: `dts-r${index + 1}`,
    order: index + 1,
    kind: 'round',
    countsTowardGoal: true,
    theme: spec.theme,
    workDurationMs: ROUND_MS,
    restAfterMs: isLast ? 0 : 60_000,
    targetPunches: roundPunchCount(blocks),
    blocks,
  }
})

const totalGoal = rounds.reduce((sum, r) => sum + r.targetPunches, 0)

export const diagnosticTokenSequence: GeneratedWorkout = {
  id: 'diagnostic-token-sequence',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    totalPunchGoal: totalGoal,
    focus: 'balanced',
    bias: 'balanced',
    defaultStance: 'orthodox',
    cadenceProfile: 'technical',
    generatorVersion: GENERATOR_VERSION,
    seed: 'diagnostic-token-sequence-v1',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution: {
    '1': 0.5,
    '2': 0.3,
    '3': 0.1,
    '2b': 0.1,
  },
  estimatedActivePunchesPerMinute: Math.round(totalGoal / (schedule.activeSeconds / 60)),
  warnings: [
    `Diagnostic Token Sequence — internal QA rig, not a real workout. Suggested Steady-tier goal for 20 minutes is ${suggestGoal(20, 'steady', 'balanced')}; this recipe prescribes ${totalGoal}. R1 is the diagnostic surface; R2-R4 are filler to satisfy the 20-minute duration constraint. The verify-workout harness stops after R1.`,
  ],
}
