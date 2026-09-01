import { CADENCE_PROFILES } from '../../cadence'
import type { GeneratedWorkout } from '../../GeneratedWorkout'
import type { ProgramRound } from '../../WorkoutTokens'
import { buildRoundSchedule } from '../../roundSchedule'
import { suggestGoal } from '../../punchGoals'
import { defaultRecipe } from '../../WorkoutRecipe'
import { GENERATOR_VERSION } from '../../versions'
import { layBlocks, padBlocksToRound, roundPunchCount, type BlockSpec } from '../authoring'

const BPM = CADENCE_PROFILES.technical.nominalBpm
const schedule = buildRoundSchedule(20)

/**
 * Uppercut Clinic — the five and the six from first touch to full
 * combinations, at teaching cadence. Each round adds one more link to
 * the uppercut chains.
 */
const ROUND_SPECS: Array<{ theme: string; specs: BlockSpec[] }> = [
  {
    theme: 'Meet the five and the six',
    specs: [
      { id: 'uc1-b1', kind: 'repeated-combo', notation: '1-5', offsets: [0, 0.7], gapBeats: 1.8, repeat: 8, spokenPhrase: 'One, five.' },
      { id: 'uc1-b2', kind: 'repeated-combo', notation: '1-6', offsets: [0, 0.7], gapBeats: 1.8, repeat: 8, spokenPhrase: 'One, six.' },
      { id: 'uc1-b3', kind: 'repeated-combo', notation: '1-5-2', offsets: [0, 0.7, 1.5], gapBeats: 1.8, repeat: 6, spokenPhrase: 'One, five, two.' },
      { id: 'uc1-b4', kind: 'repeated-combo', notation: '1-2-5', offsets: [0, 0.7, 1.5], gapBeats: 1.8, repeat: 6, spokenPhrase: 'One, two, five.' },
      { id: 'uc1-b5', kind: 'volume-burst', notation: '1-5', offsets: [0, 0.7], gapBeats: 1.5, durationBeats: 40, targetPunches: 36, spokenPhrase: 'One-fives. Stay low.' },
      { id: 'uc1-b6', kind: 'repeated-combo', notation: '1-6', offsets: [0, 0.65], gapBeats: 1.6, repeat: 8, spokenPhrase: 'One, six.' },
      { id: 'uc1-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 21, targetPunches: 6, instruction: 'Knees bent. Breathe.' },
    ],
  },
  {
    theme: 'Uppercuts meet hooks',
    specs: [
      { id: 'uc2-b1', kind: 'repeated-combo', notation: '1-6-3', offsets: [0, 0.7, 1.5], gapBeats: 1.7, repeat: 7, spokenPhrase: 'One, six, three.' },
      { id: 'uc2-b2', kind: 'repeated-combo', notation: '2-3-6', offsets: [0, 0.7, 1.5], gapBeats: 1.7, repeat: 7, spokenPhrase: 'Two, three, six.' },
      { id: 'uc2-b3', kind: 'defense-counter', notation: 'duck-2-3', offsets: [0, 1, 1.8], gapBeats: 2.2, spokenPhrase: 'Duck. Two, three.' },
      { id: 'uc2-b4', kind: 'repeated-combo', notation: '2-6-3', offsets: [0, 0.7, 1.5], gapBeats: 1.7, repeat: 6, spokenPhrase: 'Two, six, three.' },
      { id: 'uc2-b5', kind: 'repeated-combo', notation: '1-6-3-2', offsets: [0, 0.65, 1.35, 2], gapBeats: 1.6, repeat: 6, spokenPhrase: 'One, six, three, two.' },
      { id: 'uc2-b6', kind: 'volume-burst', notation: '1-6', offsets: [0, 0.65], gapBeats: 1.4, durationBeats: 40, targetPunches: 38, spokenPhrase: 'One-sixes.' },
      { id: 'uc2-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 21, targetPunches: 6, instruction: 'Breathe.' },
    ],
  },
  {
    theme: 'Build the uppercut chains',
    specs: [
      { id: 'uc3-b1', kind: 'repeated-combo', notation: '1-2-5', offsets: [0, 0.65, 1.35], gapBeats: 1.6, repeat: 6, spokenPhrase: 'One, two, five.' },
      { id: 'uc3-b2', kind: 'repeated-combo', notation: '1-2-5-6', offsets: [0, 0.65, 1.3, 1.95], gapBeats: 1.6, repeat: 6, spokenPhrase: 'One, two, five, six.' },
      { id: 'uc3-b3', kind: 'repeated-combo', notation: '1-2-5-6-3', offsets: [0, 0.65, 1.3, 1.95, 2.6], gapBeats: 1.6, repeat: 5, spokenPhrase: 'One, two, five, six, three.' },
      { id: 'uc3-b4', kind: 'defense-counter', notation: 'slip-2', offsets: [0, 1], gapBeats: 2.2, spokenPhrase: 'Slip. Two.' },
      { id: 'uc3-b5', kind: 'repeated-combo', notation: '1-2-3-6', offsets: [0, 0.65, 1.3, 1.95], gapBeats: 1.6, repeat: 6, spokenPhrase: 'One, two, three, six.' },
      { id: 'uc3-b6', kind: 'volume-burst', notation: '1-2-5', offsets: [0, 0.6, 1.25], gapBeats: 1.4, durationBeats: 45, targetPunches: 48, spokenPhrase: 'One, two, five.' },
      { id: 'uc3-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 21, targetPunches: 6, instruction: 'Loose shoulders.' },
    ],
  },
  {
    theme: 'The full clinic',
    specs: [
      { id: 'uc4-b1', kind: 'repeated-combo', notation: '1-2-5-6-3-2', offsets: [0, 0.65, 1.3, 1.95, 2.6, 3.25], gapBeats: 1.5, repeat: 5, spokenPhrase: 'One, two, five, six, three, two.' },
      { id: 'uc4-b2', kind: 'repeated-combo', notation: '1-2-3-6-3-2', offsets: [0, 0.65, 1.3, 1.95, 2.6, 3.25], gapBeats: 1.5, repeat: 5, spokenPhrase: 'One, two, three, six, three, two.' },
      { id: 'uc4-b3', kind: 'repeated-combo', notation: '1-5-2-3-2', offsets: [0, 0.65, 1.3, 1.95, 2.6], gapBeats: 1.5, repeat: 5, spokenPhrase: 'One, five, two, three, two.' },
      { id: 'uc4-b4', kind: 'defense-counter', notation: 'roll-1-2', offsets: [0, 1, 1.7], gapBeats: 2.2, spokenPhrase: 'Roll. One, two.' },
      { id: 'uc4-b5', kind: 'volume-burst', notation: '1-2-5-6', offsets: [0, 0.6, 1.2, 1.8], gapBeats: 1.3, durationBeats: 50, targetPunches: 64, spokenPhrase: 'One, two, five, six.' },
      { id: 'uc4-b6', kind: 'open-pressure', notation: '1-2-5', offsets: [0, 0.6, 1.2], gapBeats: 1.1, durationBeats: 40, targetPunches: 51, instruction: 'Last stretch. Keep the uppercuts honest.', spokenPhrase: 'Flurry.' },
    ],
  },
]

const rounds: ProgramRound[] = ROUND_SPECS.map((spec, index) => {
  const blocks = padBlocksToRound(layBlocks(spec.specs, BPM), BPM, 240_000)
  const isLast = index === ROUND_SPECS.length - 1
  return {
    id: `uc-r${index + 1}`,
    order: index + 1,
    kind: 'round',
    countsTowardGoal: true,
    theme: spec.theme,
    workDurationMs: 240_000,
    restAfterMs: isLast ? 0 : 60_000,
    targetPunches: roundPunchCount(blocks),
    blocks,
  }
})

const totalGoal = rounds.reduce((sum, r) => sum + r.targetPunches, 0)

export const uppercutClinic: GeneratedWorkout = {
  id: 'uppercut-clinic',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    totalPunchGoal: totalGoal,
    focus: 'balanced',
    bias: 'balanced',
    defaultStance: 'orthodox',
    cadenceProfile: 'technical',
    generatorVersion: GENERATOR_VERSION,
    seed: 'uppercut-clinic-2026-08-29',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution: { '1': 0.32, '2': 0.22, '3': 0.1, '5': 0.19, '6': 0.17 },
  estimatedActivePunchesPerMinute: Math.round(totalGoal / (schedule.activeSeconds / 60)),
  warnings: [
    `Suggested Technique-tier goal for 20 minutes is ${suggestGoal(20, 'technique', 'balanced')}; this hand-authored sample prescribes ${totalGoal}.`,
  ],
}
