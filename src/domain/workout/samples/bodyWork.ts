import { CADENCE_PROFILES } from '../cadence'
import type { GeneratedWorkout } from '../GeneratedWorkout'
import type { ProgramRound } from '../WorkoutTokens'
import { buildRoundSchedule } from '../roundSchedule'
import { suggestGoal } from '../punchGoals'
import { defaultRecipe } from '../WorkoutRecipe'
import { GENERATOR_VERSION } from '../versions'
import { layBlocks, padBlocksToRound, roundPunchCount, type BlockSpec } from './authoring'

const BPM = CADENCE_PROFILES.steady.nominalBpm
const schedule = buildRoundSchedule(20)

/**
 * Body Work — four rounds downstairs. Body jabs and the cross to the
 * ribs first, hooks under the elbow next, head-to-body switches, then
 * a dig-and-finish final round.
 */
const ROUND_SPECS: Array<{ theme: string; specs: BlockSpec[] }> = [
  {
    theme: 'The body jab and the two downstairs',
    specs: [
      { id: 'bw1-b1', kind: 'repeated-combo', notation: '1-2b', offsets: [0, 0.7], gapBeats: 1.6, repeat: 10, spokenPhrase: 'Jab, body.' },
      { id: 'bw1-b2', kind: 'repeated-combo', notation: '1b-2', offsets: [0, 0.7], gapBeats: 1.6, repeat: 8, spokenPhrase: 'Body jab, cross.' },
      { id: 'bw1-b3', kind: 'volume-burst', notation: '1-2b', offsets: [0, 0.65], gapBeats: 1.3, durationBeats: 50, targetPunches: 50, spokenPhrase: 'Jab, body.' },
      { id: 'bw1-b4', kind: 'repeated-combo', notation: '1b-2b', offsets: [0, 0.7], gapBeats: 1.6, repeat: 8, spokenPhrase: 'Body jab, body cross.' },
      { id: 'bw1-b5', kind: 'defense-counter', notation: 'slip-2', offsets: [0, 1], gapBeats: 2, spokenPhrase: 'Slip. Two.' },
      { id: 'bw1-b6', kind: 'volume-burst', notation: '1b-2', offsets: [0, 0.65], gapBeats: 1.3, durationBeats: 45, targetPunches: 46, spokenPhrase: 'Body jab, cross.' },
      { id: 'bw1-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 22, targetPunches: 7, instruction: 'Breathe. Elbows in.' },
    ],
  },
  {
    theme: 'Hook off the body',
    specs: [
      { id: 'bw2-b1', kind: 'repeated-combo', notation: '1-2b-3', offsets: [0, 0.7, 1.5], gapBeats: 1.5, repeat: 8, spokenPhrase: 'Jab, body, hook.' },
      { id: 'bw2-b2', kind: 'repeated-combo', notation: '1b-2-3', offsets: [0, 0.7, 1.5], gapBeats: 1.5, repeat: 7, spokenPhrase: 'Body jab, two, three.' },
      { id: 'bw2-b3', kind: 'defense-counter', notation: 'bob and weave-3-2', offsets: [0, 1, 1.7], gapBeats: 2.2, spokenPhrase: 'Bob and weave. Three, two.' },
      { id: 'bw2-b4', kind: 'repeated-combo', notation: '1-2b-3-2', offsets: [0, 0.65, 1.35, 2], gapBeats: 1.4, repeat: 6, spokenPhrase: 'Jab, body, three, two.' },
      { id: 'bw2-b5', kind: 'volume-burst', notation: '1-2b-3', offsets: [0, 0.65, 1.4], gapBeats: 1.3, durationBeats: 55, targetPunches: 60, spokenPhrase: 'Jab, body, hook.' },
      { id: 'bw2-b6', kind: 'repeated-combo', notation: '1b-2b-3', offsets: [0, 0.65, 1.35], gapBeats: 1.4, repeat: 6, spokenPhrase: 'Body, body, hook.' },
      { id: 'bw2-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 22, targetPunches: 7, instruction: 'Reset.' },
    ],
  },
  {
    theme: 'Head-to-body switches',
    specs: [
      { id: 'bw3-b1', kind: 'repeated-combo', notation: '1-2-3b', offsets: [0, 0.65, 1.35], gapBeats: 1.5, repeat: 8, spokenPhrase: 'One, two, body hook.' },
      { id: 'bw3-b2', kind: 'repeated-combo', notation: '1-2-3b-3', offsets: [0, 0.65, 1.3, 1.95], gapBeats: 1.4, repeat: 6, spokenPhrase: 'One, two, body hook, hook.' },
      { id: 'bw3-b3', kind: 'defense-counter', notation: 'duck-2-3', offsets: [0, 1, 1.7], gapBeats: 2, spokenPhrase: 'Duck. Two, three.' },
      { id: 'bw3-b4', kind: 'repeated-combo', notation: '1-1-2-3b', offsets: [0, 0.6, 1.25, 1.9], gapBeats: 1.4, repeat: 6, spokenPhrase: 'Jab, jab, cross, body hook.' },
      { id: 'bw3-b5', kind: 'volume-burst', notation: '1-2-3b', offsets: [0, 0.6, 1.25], gapBeats: 1.25, durationBeats: 70, targetPunches: 84, spokenPhrase: 'One, two, body hook.' },
      { id: 'bw3-b6', kind: 'footwork-exit', notation: '1-2-circle', offsets: [0, 0.65, 1.5], gapBeats: 2, spokenPhrase: 'One, two. Circle out.' },
      { id: 'bw3-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 21, targetPunches: 6, instruction: 'Breathe.' },
    ],
  },
  {
    theme: 'Dig, then finish upstairs',
    specs: [
      { id: 'bw4-b1', kind: 'repeated-combo', notation: '1-2b-3-2b', offsets: [0, 0.65, 1.3, 1.95], gapBeats: 1.3, repeat: 6, spokenPhrase: 'Jab, body, hook, body.' },
      { id: 'bw4-b2', kind: 'repeated-combo', notation: '1-2-6b-3-2', offsets: [0, 0.65, 1.3, 1.95, 2.6], gapBeats: 1.4, repeat: 6, spokenPhrase: 'One, two, six body, three, two.' },
      { id: 'bw4-b3', kind: 'volume-burst', notation: '1-2b', offsets: [0, 0.6], gapBeats: 1.15, durationBeats: 55, targetPunches: 62, spokenPhrase: 'Jab, body.' },
      { id: 'bw4-b4', kind: 'repeated-combo', notation: '1-2-5b-6b-3-2', offsets: [0, 0.65, 1.3, 1.95, 2.6, 3.25], gapBeats: 1.4, repeat: 5, spokenPhrase: 'One, two, five body, six body, three, two.' },
      { id: 'bw4-b5', kind: 'open-pressure', notation: '1b-2b', offsets: [0, 0.6], gapBeats: 0.95, durationBeats: 50, targetPunches: 64, instruction: 'Final thirty. Everything downstairs.', spokenPhrase: 'Flurry. Downstairs.' },
    ],
  },
]

const rounds: ProgramRound[] = ROUND_SPECS.map((spec, index) => {
  const blocks = padBlocksToRound(layBlocks(spec.specs, BPM), BPM, 240_000)
  const isLast = index === ROUND_SPECS.length - 1
  return {
    id: `bw-r${index + 1}`,
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

export const bodyWork: GeneratedWorkout = {
  id: 'body-work',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    totalPunchGoal: totalGoal,
    focus: 'balanced',
    bias: 'balanced',
    defaultStance: 'orthodox',
    cadenceProfile: 'steady',
    generatorVersion: GENERATOR_VERSION,
    seed: 'body-work-2026-08-29',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution: {
    '1': 0.22,
    '2': 0.13,
    '3': 0.1,
    '1b': 0.1,
    '2b': 0.28,
    '3b': 0.13,
    '5b': 0.02,
    '6b': 0.02,
  },
  estimatedActivePunchesPerMinute: Math.round(totalGoal / (schedule.activeSeconds / 60)),
  warnings: [
    `Suggested Steady-tier goal for 20 minutes is ${suggestGoal(20, 'steady', 'balanced')}; this hand-authored sample prescribes ${totalGoal}.`,
  ],
}
