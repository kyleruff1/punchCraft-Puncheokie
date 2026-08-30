import { CADENCE_PROFILES } from '../cadence'
import type { GeneratedWorkout } from '../GeneratedWorkout'
import type { ProgramRound } from '../WorkoutTokens'
import { buildRoundSchedule } from '../roundSchedule'
import { suggestGoal } from '../punchGoals'
import { defaultRecipe } from '../WorkoutRecipe'
import { GENERATOR_VERSION } from '../versions'
import { layBlocks, padBlocksToRound, roundPunchCount, withVoicePolicy, type BlockSpec } from './authoring'

const BPM = CADENCE_PROFILES.sprint.nominalBpm
const schedule = buildRoundSchedule(20)

/**
 * Speed Combos — short straight flurries at sprint cadence. Doubles and
 * one-twos thrown quick, with fast exits, ending in a flurry finish.
 */
const ROUND_SPECS: Array<{ theme: string; specs: BlockSpec[] }> = [
  {
    theme: 'Doubles at speed',
    specs: [
      { id: 'sp1-b1', kind: 'repeated-combo', notation: '1', offsets: [0], gapBeats: 1.5, repeat: 12, spokenPhrase: 'Jab.' },
      { id: 'sp1-b2', kind: 'repeated-combo', notation: '1-1', offsets: [0, 0.55], gapBeats: 1.5, repeat: 10, spokenPhrase: 'Double jab.' },
      { id: 'sp1-b3', kind: 'volume-burst', notation: '1-1', offsets: [0, 0.55], gapBeats: 1.2, durationBeats: 55, targetPunches: 62, spokenPhrase: 'Double jabs. Quick.' },
      { id: 'sp1-b4', kind: 'repeated-combo', notation: '1-2', offsets: [0, 0.6], gapBeats: 1.5, repeat: 10, spokenPhrase: 'One, two.' },
      { id: 'sp1-b5', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.55], gapBeats: 1.15, durationBeats: 60, targetPunches: 70, spokenPhrase: 'One-twos.' },
      { id: 'sp1-b6', kind: 'footwork-exit', notation: '1-1-step off', offsets: [0, 0.6, 1.5], gapBeats: 2, spokenPhrase: 'Double jab. Step off.' },
      { id: 'sp1-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 24, targetPunches: 8, instruction: 'Loose. Breathe.' },
    ],
  },
  {
    theme: 'The one-two, sharper',
    specs: [
      { id: 'sp2-b1', kind: 'repeated-combo', notation: '1-2', offsets: [0, 0.55], gapBeats: 1.4, repeat: 12, spokenPhrase: 'One, two.' },
      { id: 'sp2-b2', kind: 'repeated-combo', notation: '1-2-1', offsets: [0, 0.6, 1.2], gapBeats: 1.5, repeat: 8, spokenPhrase: 'One, two, one.' },
      { id: 'sp2-b3', kind: 'defense-counter', notation: 'slip-1-2', offsets: [0, 1, 1.6], gapBeats: 2, spokenPhrase: 'Slip. One, two.' },
      { id: 'sp2-b4', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.55], gapBeats: 1.1, durationBeats: 65, targetPunches: 78, spokenPhrase: 'One-twos. Snap them.' },
      { id: 'sp2-b5', kind: 'defense-counter', notation: 'pull-1-2', offsets: [0, 1, 1.6], gapBeats: 2, spokenPhrase: 'Pull. One, two.' },
      { id: 'sp2-b6', kind: 'repeated-combo', notation: '1-1-2', offsets: [0, 0.55, 1.15], gapBeats: 1.4, repeat: 8, spokenPhrase: 'Jab, jab, cross.' },
      { id: 'sp2-b7', kind: 'volume-burst', notation: '1-1', offsets: [0, 0.5], gapBeats: 1.05, durationBeats: 50, targetPunches: 64, spokenPhrase: 'Double jabs.' },
      { id: 'sp2-b8', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 22, targetPunches: 7, instruction: 'Shake them out.' },
    ],
  },
  {
    theme: 'Four straight punches',
    specs: [
      { id: 'sp3-b1', kind: 'repeated-combo', notation: '1-2-1-2', offsets: [0, 0.55, 1.15, 1.7], gapBeats: 1.4, repeat: 8, spokenPhrase: 'One, two, one, two.' },
      { id: 'sp3-b2', kind: 'repeated-combo', notation: '1-1-2', offsets: [0, 0.55, 1.15], gapBeats: 1.3, repeat: 8, spokenPhrase: 'Jab, jab, cross.' },
      { id: 'sp3-b3', kind: 'footwork-exit', notation: '1-2-circle', offsets: [0, 0.6, 1.5], gapBeats: 2, spokenPhrase: 'One, two. Circle out.' },
      { id: 'sp3-b4', kind: 'volume-burst', notation: '1-2-1-2', offsets: [0, 0.55, 1.1, 1.65], gapBeats: 1.15, durationBeats: 70, targetPunches: 100, spokenPhrase: 'One, two, one, two.' },
      { id: 'sp3-b5', kind: 'defense-counter', notation: 'slip-2', offsets: [0, 1], gapBeats: 2, spokenPhrase: 'Slip. Two.' },
      { id: 'sp3-b6', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.5], gapBeats: 1, durationBeats: 55, targetPunches: 72, spokenPhrase: 'One-twos.' },
      { id: 'sp3-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 21, targetPunches: 7, instruction: 'Breathe.' },
    ],
  },
  {
    theme: 'Flurry finish',
    specs: [
      { id: 'sp4-b1', kind: 'repeated-combo', notation: '1-2', offsets: [0, 0.5], gapBeats: 1.2, repeat: 12, spokenPhrase: 'One, two.' },
      { id: 'sp4-b2', kind: 'volume-burst', notation: '1-1-2', offsets: [0, 0.5, 1.05], gapBeats: 1, durationBeats: 65, targetPunches: 93, spokenPhrase: 'Jab, jab, cross.' },
      { id: 'sp4-b3', kind: 'repeated-combo', notation: '1-2-1', offsets: [0, 0.55, 1.1], gapBeats: 1.2, repeat: 8, spokenPhrase: 'One, two, one.' },
      { id: 'sp4-b4', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.5], gapBeats: 0.95, durationBeats: 60, targetPunches: 82, spokenPhrase: 'One-twos. Push the pace.' },
      { id: 'sp4-b5', kind: 'open-pressure', notation: '1-2', offsets: [0, 0.45], gapBeats: 0.8, durationBeats: 60, targetPunches: 96, instruction: 'Final thirty. Nothing held back.', spokenPhrase: 'Flurry.' },
    ],
  },
]

const rounds: ProgramRound[] = ROUND_SPECS.map((spec, index) => {
  // M39-V1c: sprint samples flip to announce-then-work — the coach
  // speaks the whole combo ONCE at rep 0, silent on interior reps.
  const blocks = withVoicePolicy(
    padBlocksToRound(layBlocks(spec.specs, BPM), BPM, 240_000),
    'announce-then-work',
  )
  const isLast = index === ROUND_SPECS.length - 1
  return {
    id: `sp-r${index + 1}`,
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

export const speedCombos: GeneratedWorkout = {
  id: 'speed-combos',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    totalPunchGoal: totalGoal,
    focus: 'balanced',
    bias: 'lead',
    defaultStance: 'orthodox',
    cadenceProfile: 'sprint',
    // M39-V1c full engine mode (Kyle 2026-08-30, Pass 5 verdict): sprint
    // maps to division 4 (240 slots/min at the 60 BPM master pulse), swing
    // 0.54 for character. The audible click track ships with the audio-only
    // fix — the whole workout rides ONE stable clock instead of the legacy
    // nominalBpm=140 with irregular intra/inter-combo spacing.
    coachTempo: { baseBpm: 60, division: 4, swing: 0.54 },
    // volume 0: engine BPM (bpmForRecipe path) applies for grid math,
    // but no audible click track (Kyle 2026-08-30: the metronome is a
    // MEASUREMENT reference for ring / voice components, never audible
    // to the user in production).
    metronome: { enabled: true, volume: 0 },
    generatorVersion: GENERATOR_VERSION,
    seed: 'speed-combos-2026-08-29',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution: { '1': 0.62, '2': 0.38 },
  estimatedActivePunchesPerMinute: Math.round(totalGoal / (schedule.activeSeconds / 60)),
  warnings: [
    `Suggested Hard-tier goal for 20 minutes is ${suggestGoal(20, 'hard', 'balanced')}; this hand-authored sample prescribes ${totalGoal}.`,
  ],
}
