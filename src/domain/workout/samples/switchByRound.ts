/**
 * Switch by Round — stance alternates every round (M31-05).
 *
 * Exercises `BlockStance`, StanceMapper (#126/#127) and the stance-change
 * card (M32-06). Rounds alternate between the athlete's default stance and
 * its opposite by setting the block stance to `'inherit'` or `'switch'`.
 *
 * **A stance change never occurs inside a combination** (doc §11, doc §15).
 * Every block within a round carries the same stance, so a switch can only
 * happen at a round boundary — where §11 requires it to be announced. A
 * test asserts this property structurally rather than trusting the
 * authoring.
 *
 * Because the same numbered combination maps to opposite hands in opposite
 * stances, this sample is also the fixture that proves the hand sequence
 * genuinely inverts (D12's verifiable surface).
 */

import { CADENCE_PROFILES } from '../cadence'
import type { GeneratedWorkout } from '../GeneratedWorkout'
import type { BlockStance, ProgramRound } from '../WorkoutTokens'
import { defaultRecipe } from '../WorkoutRecipe'
import { GENERATOR_VERSION } from '../versions'
import { layBlocks, padBlocksToRound, roundPunchCount, type BlockSpec } from './authoring'

const BPM = CADENCE_PROFILES.technical.nominalBpm

/**
 * One block list, reused per round with a different stance.
 *
 * Deliberately technical-cadence and modest volume: the point of this
 * sample is the stance handover, and a busy round would bury it.
 */
function roundSpecs(prefix: string, stance: BlockStance): BlockSpec[] {
  return [
    {
      id: `${prefix}-b1`,
      kind: 'repeated-combo',
      notation: '1-2',
      offsets: [0, 0.8],
      gapBeats: 2,
      repeat: 8,
      stance,
      spokenPhrase: 'One, two.',
    },
    {
      id: `${prefix}-b2`,
      kind: 'repeated-combo',
      notation: '1-2-3',
      offsets: [0, 0.8, 1.7],
      gapBeats: 2,
      repeat: 6,
      stance,
      spokenPhrase: 'One, two, three.',
    },
    {
      id: `${prefix}-b3`,
      kind: 'defense-counter',
      notation: 'slip-2-3-2',
      offsets: [0, 1, 1.8, 2.6],
      gapBeats: 2.5,
      stance,
      spokenPhrase: 'Slip. Two, three, two.',
    },
    {
      id: `${prefix}-b4`,
      kind: 'volume-burst',
      notation: '1-2',
      offsets: [0, 0.8],
      gapBeats: 1.6,
      durationBeats: 45,
      targetPunches: 40,
      stance,
      spokenPhrase: 'One-twos.',
    },
    {
      id: `${prefix}-b5`,
      kind: 'active-recovery',
      notation: '1',
      offsets: [0],
      gapBeats: 3,
      durationBeats: 20,
      targetPunches: 6,
      stance,
      instruction: 'Reset. Ready to switch.',
    },
  ]
}

const ROUND_PLAN: Array<{ theme: string; stance: BlockStance }> = [
  { theme: 'Orthodox fundamentals', stance: 'inherit' },
  { theme: 'Switch-stance fundamentals', stance: 'switch' },
  { theme: 'Orthodox under pressure', stance: 'inherit' },
  { theme: 'Switch-stance under pressure', stance: 'switch' },
]

const rounds: ProgramRound[] = ROUND_PLAN.map((plan, index) => {
  const blocks = padBlocksToRound(layBlocks(roundSpecs(`sw-r${index + 1}`, plan.stance), BPM), BPM, 240_000)
  const isLast = index === ROUND_PLAN.length - 1
  return {
    id: `sw-r${index + 1}`,
    order: index + 1,
    kind: 'round',
    countsTowardGoal: true,
    theme: plan.theme,
    workDurationMs: 240_000,
    restAfterMs: isLast ? 0 : 60_000,
    targetPunches: roundPunchCount(blocks),
    blocks,
  }
})

const totalGoal = rounds.reduce((sum, r) => sum + r.targetPunches, 0)
const activeMinutes = (rounds.length * 240_000) / 60_000

export const switchByRound: GeneratedWorkout = {
  id: 'switch-by-round',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    totalPunchGoal: totalGoal,
    defaultStance: 'orthodox',
    stanceMode: 'switch-by-round',
    focus: 'balanced',
    cadenceProfile: 'technical',
    generatorVersion: GENERATOR_VERSION,
    seed: 'switch-by-round-2026-08-23',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution: { '1': 0.44, '2': 0.34, '3': 0.22 },
  estimatedActivePunchesPerMinute: Math.round(totalGoal / activeMinutes),
  warnings: [],
}
