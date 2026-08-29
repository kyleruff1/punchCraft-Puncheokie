import { CADENCE_PROFILES } from '../cadence'
import type { GeneratedWorkout } from '../GeneratedWorkout'
import type { ProgramRound } from '../WorkoutTokens'
import { buildRoundSchedule } from '../roundSchedule'
import { suggestGoal } from '../punchGoals'
import { defaultRecipe } from '../WorkoutRecipe'
import { GENERATOR_VERSION } from '../versions'
import { layBlocks, roundPunchCount, type BlockSpec } from './authoring'

const BPM = CADENCE_PROFILES.steady.nominalBpm
const schedule = buildRoundSchedule(20)

/**
 * Progressive Buildup — one combination grows each round. Two punches
 * at the first bell; by the final round the full ladder runs
 * 1-2 → 1-2-3 → 1-2-3-6 → 1-2-3-6-3 → 1-2-3-6-3-2 → 1-2-3-6-3-2-3-2.
 */
const ROUND_SPECS: Array<{ theme: string; specs: BlockSpec[] }> = [
  {
    theme: 'The base: one, two, three',
    specs: [
      { id: 'pb1-b1', kind: 'repeated-combo', notation: '1-2', offsets: [0, 0.65], gapBeats: 1.6, repeat: 10, spokenPhrase: 'One, two.' },
      { id: 'pb1-b2', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.6], gapBeats: 1.2, durationBeats: 45, targetPunches: 48, spokenPhrase: 'One-twos.' },
      { id: 'pb1-b3', kind: 'repeated-combo', notation: '1-2-3', offsets: [0, 0.65, 1.3], gapBeats: 1.5, repeat: 8, spokenPhrase: 'One, two, three.' },
      { id: 'pb1-b4', kind: 'defense-counter', notation: 'slip-1-2', offsets: [0, 1, 1.7], gapBeats: 2, spokenPhrase: 'Slip. One, two.' },
      { id: 'pb1-b5', kind: 'volume-burst', notation: '1-2-3', offsets: [0, 0.6, 1.25], gapBeats: 1.3, durationBeats: 50, targetPunches: 57, spokenPhrase: 'One-two-threes.' },
      { id: 'pb1-b6', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 22, targetPunches: 7, instruction: 'Easy. Reset.' },
    ],
  },
  {
    theme: 'Add the six',
    specs: [
      { id: 'pb2-b1', kind: 'repeated-combo', notation: '1-2-3', offsets: [0, 0.65, 1.3], gapBeats: 1.5, repeat: 6, spokenPhrase: 'One, two, three.' },
      { id: 'pb2-b2', kind: 'repeated-combo', notation: '1-2-3-6', offsets: [0, 0.65, 1.3, 1.95], gapBeats: 1.5, repeat: 8, spokenPhrase: 'One, two, three, six.' },
      { id: 'pb2-b3', kind: 'footwork-exit', notation: '1-2-pivot', offsets: [0, 0.65, 1.5], gapBeats: 2, spokenPhrase: 'One, two. Pivot.' },
      { id: 'pb2-b4', kind: 'volume-burst', notation: '1-2-3-6', offsets: [0, 0.6, 1.2, 1.8], gapBeats: 1.3, durationBeats: 55, targetPunches: 68, spokenPhrase: 'One, two, three, six.' },
      { id: 'pb2-b5', kind: 'repeated-combo', notation: '1-2-3', offsets: [0, 0.6, 1.25], gapBeats: 1.3, repeat: 6, spokenPhrase: 'One, two, three.' },
      { id: 'pb2-b6', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.6], gapBeats: 1.2, durationBeats: 40, targetPunches: 44, spokenPhrase: 'One-twos.' },
      { id: 'pb2-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 22, targetPunches: 7, instruction: 'Breathe.' },
    ],
  },
  {
    theme: 'Add the hook behind it',
    specs: [
      { id: 'pb3-b1', kind: 'repeated-combo', notation: '1-2-3-6', offsets: [0, 0.65, 1.3, 1.95], gapBeats: 1.4, repeat: 6, spokenPhrase: 'One, two, three, six.' },
      { id: 'pb3-b2', kind: 'repeated-combo', notation: '1-2-3-6-3', offsets: [0, 0.65, 1.3, 1.95, 2.6], gapBeats: 1.4, repeat: 7, spokenPhrase: 'One, two, three, six, three.' },
      { id: 'pb3-b3', kind: 'defense-counter', notation: 'roll-3-2', offsets: [0, 1, 1.7], gapBeats: 2, spokenPhrase: 'Roll. Three, two.' },
      { id: 'pb3-b4', kind: 'volume-burst', notation: '1-2-3-6-3', offsets: [0, 0.6, 1.2, 1.8, 2.4], gapBeats: 1.3, durationBeats: 60, targetPunches: 80, spokenPhrase: 'One, two, three, six, three.' },
      { id: 'pb3-b5', kind: 'repeated-combo', notation: '1-2', offsets: [0, 0.6], gapBeats: 1.2, repeat: 8, spokenPhrase: 'One, two.' },
      { id: 'pb3-b6', kind: 'volume-burst', notation: '1-2-3', offsets: [0, 0.6, 1.25], gapBeats: 1.2, durationBeats: 45, targetPunches: 54, spokenPhrase: 'One-two-threes.' },
      { id: 'pb3-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 21, targetPunches: 6, instruction: 'Reset.' },
    ],
  },
  {
    theme: 'The full ladder',
    specs: [
      { id: 'pb4-b1', kind: 'repeated-combo', notation: '1-2-3-6-3-2', offsets: [0, 0.65, 1.3, 1.95, 2.6, 3.25], gapBeats: 1.4, repeat: 6, spokenPhrase: 'One, two, three, six, three, two.' },
      { id: 'pb4-b2', kind: 'volume-burst', notation: '1-2-3-6-3-2', offsets: [0, 0.6, 1.2, 1.8, 2.4, 3], gapBeats: 1.2, durationBeats: 65, targetPunches: 90, spokenPhrase: 'One, two, three, six, three, two.' },
      { id: 'pb4-b3', kind: 'defense-counter', notation: 'slip-2-3-2', offsets: [0, 1, 1.75, 2.5], gapBeats: 2, spokenPhrase: 'Slip. Two, three, two.' },
      { id: 'pb4-b4', kind: 'repeated-combo', notation: '1-2-3-6-3-2-3-2', offsets: [0, 0.65, 1.3, 1.95, 2.6, 3.25, 3.9, 4.55], gapBeats: 1.4, repeat: 4, spokenPhrase: 'One, two, three, six, three, two, three, two.' },
      { id: 'pb4-b5', kind: 'open-pressure', notation: '1-2-3', offsets: [0, 0.55, 1.15], gapBeats: 1, durationBeats: 50, targetPunches: 69, instruction: 'Final thirty. All of it together.', spokenPhrase: 'Flurry.' },
    ],
  },
]

const rounds: ProgramRound[] = ROUND_SPECS.map((spec, index) => {
  const blocks = layBlocks(spec.specs, BPM)
  const isLast = index === ROUND_SPECS.length - 1
  return {
    id: `pb-r${index + 1}`,
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

export const progressiveBuildup: GeneratedWorkout = {
  id: 'progressive-buildup',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    totalPunchGoal: totalGoal,
    focus: 'balanced',
    bias: 'balanced',
    defaultStance: 'orthodox',
    cadenceProfile: 'steady',
    generatorVersion: GENERATOR_VERSION,
    seed: 'progressive-buildup-2026-08-29',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution: { '1': 0.27, '2': 0.3, '3': 0.28, '6': 0.15 },
  estimatedActivePunchesPerMinute: Math.round(totalGoal / (schedule.activeSeconds / 60)),
  warnings: [
    `Suggested Steady-tier goal for 20 minutes is ${suggestGoal(20, 'steady', 'balanced')}; this hand-authored sample prescribes ${totalGoal}.`,
  ],
}
