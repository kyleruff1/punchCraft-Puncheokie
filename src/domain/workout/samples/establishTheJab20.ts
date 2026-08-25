/**
 * Establish the Jab — a 20-minute jab-led workout (M31-05).
 *
 * Sits on the real `buildRoundSchedule(20)` shape: four 4:00 rounds, three
 * 1:00 rests, a 1:00 cooldown (D21). Every round is built from jab-led motifs
 * (1 · 1-1 · 1-2 · 1-1-2), so the workout demonstrates doc §15's rule that
 * 60-80% of structured combinations open with a jab.
 *
 * The four rounds walk the authored coaching curve — find range, add the
 * counter, mix the body, then push — rather than repeating one block list four
 * times. It was five rounds under the 3:00 structure; the counter round folded
 * into the double-jab round rather than any stage being dropped, and each round
 * gained blocks for the extra minute.
 *
 * Every notation here is already in the rendered phrase corpus, so re-authoring
 * this sample does not force a voice re-render — see
 * `tools/voice/make-phrase-clips.mjs`, which scans these files.
 */

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

/** Every structured combination here opens with a jab. */
const ROUND_SPECS: Array<{ theme: string; specs: BlockSpec[] }> = [
  {
    theme: 'Establish the jab',
    specs: [
      { id: 'j1-b1', kind: 'repeated-combo', notation: '1', offsets: [0], gapBeats: 1.6, repeat: 10, spokenPhrase: 'Jab.' },
      { id: 'j1-b2', kind: 'repeated-combo', notation: '1-1', offsets: [0, 0.6], gapBeats: 1.5, repeat: 8, spokenPhrase: 'Double jab.' },
      { id: 'j1-b3', kind: 'volume-burst', notation: '1', offsets: [0], gapBeats: 1.3, durationBeats: 50, targetPunches: 40, spokenPhrase: 'Jabs. Keep the range.' },
      { id: 'j1-b4', kind: 'repeated-combo', notation: '1-2', offsets: [0, 0.7], gapBeats: 1.5, repeat: 10, spokenPhrase: 'One, two.' },
      { id: 'j1-b5', kind: 'volume-burst', notation: '1-1', offsets: [0, 0.6], gapBeats: 1.3, durationBeats: 45, targetPunches: 48, spokenPhrase: 'Double jabs.' },
      { id: 'j1-b6', kind: 'repeated-combo', notation: '1-2', offsets: [0, 0.65], gapBeats: 1.3, repeat: 10, spokenPhrase: 'One, two.' },
      { id: 'j1-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 24, targetPunches: 8, instruction: 'Light. Breathe.' },
    ],
  },
  {
    theme: 'Double jabs into the counter',
    specs: [
      { id: 'j2-b1', kind: 'repeated-combo', notation: '1-1-2', offsets: [0, 0.6, 1.3], gapBeats: 1.5, repeat: 8, spokenPhrase: 'Jab, jab, cross.' },
      { id: 'j2-b2', kind: 'volume-burst', notation: '1-1', offsets: [0, 0.6], gapBeats: 1.2, durationBeats: 55, targetPunches: 60, spokenPhrase: 'Double jabs.' },
      { id: 'j2-b3', kind: 'footwork-exit', notation: '1-1-step off', offsets: [0, 0.6, 1.5], gapBeats: 2, spokenPhrase: 'Double jab. Step off.' },
      { id: 'j2-b4', kind: 'defense-counter', notation: 'slip-1-2', offsets: [0, 1, 1.7], gapBeats: 2, spokenPhrase: 'Slip. One, two.' },
      { id: 'j2-b5', kind: 'repeated-combo', notation: '1-2-3', offsets: [0, 0.7, 1.5], gapBeats: 1.5, repeat: 8, spokenPhrase: 'One, two, three.' },
      { id: 'j2-b6', kind: 'defense-counter', notation: 'roll-1-2', offsets: [0, 1, 1.7], gapBeats: 2, spokenPhrase: 'Roll. One, two.' },
      { id: 'j2-b7', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.65], gapBeats: 1.2, durationBeats: 60, targetPunches: 66, spokenPhrase: 'One-twos.' },
      { id: 'j2-b8', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 22, targetPunches: 7, instruction: 'Reset.' },
    ],
  },
  {
    theme: 'Body-to-head changes',
    specs: [
      { id: 'j3-b1', kind: 'repeated-combo', notation: '1-2b-3', offsets: [0, 0.7, 1.5], gapBeats: 1.5, repeat: 8, spokenPhrase: 'Jab, body, hook.' },
      { id: 'j3-b2', kind: 'repeated-combo', notation: '1b-2-3-2', offsets: [0, 0.65, 1.35, 2], gapBeats: 1.4, repeat: 6, spokenPhrase: 'Body jab, two, three, two.' },
      { id: 'j3-b3', kind: 'volume-burst', notation: '1-2b', offsets: [0, 0.65], gapBeats: 1.2, durationBeats: 60, targetPunches: 64, spokenPhrase: 'Jab, body.' },
      { id: 'j3-b4', kind: 'repeated-combo', notation: '1-1-2', offsets: [0, 0.6, 1.3], gapBeats: 1.4, repeat: 8, spokenPhrase: 'Jab, jab, cross.' },
      { id: 'j3-b5', kind: 'repeated-combo', notation: '1-2b-3', offsets: [0, 0.65, 1.4], gapBeats: 1.3, repeat: 8, spokenPhrase: 'Jab, body, hook.' },
      { id: 'j3-b6', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.6], gapBeats: 1.15, durationBeats: 50, targetPunches: 58, spokenPhrase: 'One-twos.' },
      { id: 'j3-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 20, targetPunches: 6, instruction: 'Breathe.' },
    ],
  },
  {
    theme: 'Final high-volume round',
    specs: [
      { id: 'j4-b1', kind: 'repeated-combo', notation: '1-2-3-2', offsets: [0, 0.6, 1.25, 1.9], gapBeats: 1.2, repeat: 8, spokenPhrase: 'One, two, three, two.' },
      { id: 'j4-b2', kind: 'volume-burst', notation: '1-1-2', offsets: [0, 0.55, 1.2], gapBeats: 1.1, durationBeats: 65, targetPunches: 78, spokenPhrase: 'Jab, jab, cross.' },
      { id: 'j4-b3', kind: 'repeated-combo', notation: '1-2-3', offsets: [0, 0.6, 1.25], gapBeats: 1.15, repeat: 10, spokenPhrase: 'One, two, three.' },
      { id: 'j4-b4', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.55], gapBeats: 1, durationBeats: 55, targetPunches: 70, spokenPhrase: 'One-twos. Push.' },
      { id: 'j4-b5', kind: 'open-pressure', notation: '1-2', offsets: [0, 0.5], gapBeats: 0.85, durationBeats: 55, targetPunches: 76, instruction: 'Final thirty. Everything you have.', spokenPhrase: 'Flurry.' },
    ],
  },
]

const rounds: ProgramRound[] = ROUND_SPECS.map((spec, index) => {
  const blocks = layBlocks(spec.specs, BPM)
  const isLast = index === ROUND_SPECS.length - 1
  return {
    id: `etj-r${index + 1}`,
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

export const establishTheJab20: GeneratedWorkout = {
  id: 'establish-the-jab-20',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    // The Steady-tier suggestion is what the recipe ASKS for; the authored
    // blocks are what it actually prescribes. Both are recorded — a gap
    // between them is exactly what the generator (M35-03) exists to close.
    totalPunchGoal: totalGoal,
    focus: 'balanced',
    bias: 'lead',
    defaultStance: 'orthodox',
    cadenceProfile: 'steady',
    generatorVersion: GENERATOR_VERSION,
    seed: 'establish-the-jab-2026-08-23',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution: { '1': 0.52, '2': 0.3, '3': 0.12, '1b': 0.03, '2b': 0.03 },
  estimatedActivePunchesPerMinute: Math.round(totalGoal / (schedule.activeSeconds / 60)),
  warnings: [
    `Suggested Steady-tier goal for 20 minutes is ${suggestGoal(20, 'steady', 'balanced')}; this hand-authored sample prescribes ${totalGoal}.`,
  ],
}
