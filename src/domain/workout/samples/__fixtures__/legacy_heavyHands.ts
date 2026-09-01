import { CADENCE_PROFILES } from '../../cadence'
import type { GeneratedWorkout } from '../../GeneratedWorkout'
import type { ProgramRound } from '../../WorkoutTokens'
import { buildRoundSchedule } from '../../roundSchedule'
import { suggestGoal } from '../../punchGoals'
import { defaultRecipe } from '../../WorkoutRecipe'
import { GENERATOR_VERSION } from '../../versions'
import { layBlocks, padBlocksToRound, roundPunchCount, withVoicePolicy, type BlockSpec } from '../authoring'

const BPM = CADENCE_PROFILES.pressure.nominalBpm
const schedule = buildRoundSchedule(20)

/**
 * Heavy Hands — hooks and crosses with weight behind them. Four rounds
 * of finishing shots at pressure cadence, building from the cross to
 * doubled-up hooks and a heavy final flurry.
 */
const ROUND_SPECS: Array<{ theme: string; specs: BlockSpec[] }> = [
  {
    theme: 'Sit down on the cross',
    specs: [
      { id: 'hh1-b1', kind: 'repeated-combo', notation: '1-2', offsets: [0, 0.65], gapBeats: 1.6, repeat: 10, spokenPhrase: 'One, two.' },
      { id: 'hh1-b2', kind: 'repeated-combo', notation: '1-1-2', offsets: [0, 0.6, 1.3], gapBeats: 1.5, repeat: 8, spokenPhrase: 'Jab, jab, cross.' },
      { id: 'hh1-b3', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.6], gapBeats: 1.2, durationBeats: 55, targetPunches: 60, spokenPhrase: 'One-twos. Sit down.' },
      { id: 'hh1-b4', kind: 'defense-counter', notation: 'slip-2', offsets: [0, 1], gapBeats: 2, spokenPhrase: 'Slip. Two.' },
      { id: 'hh1-b5', kind: 'repeated-combo', notation: '1-2-1-2', offsets: [0, 0.6, 1.25, 1.9], gapBeats: 1.4, repeat: 8, spokenPhrase: 'One, two, one, two.' },
      { id: 'hh1-b6', kind: 'volume-burst', notation: '1-1-2', offsets: [0, 0.55, 1.2], gapBeats: 1.1, durationBeats: 60, targetPunches: 75, spokenPhrase: 'Jab, jab, cross.' },
      { id: 'hh1-b7', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 24, targetPunches: 8, instruction: 'Light. Breathe.' },
    ],
  },
  {
    theme: 'Hooks off the cross',
    specs: [
      { id: 'hh2-b1', kind: 'repeated-combo', notation: '1-2-3', offsets: [0, 0.6, 1.25], gapBeats: 1.5, repeat: 8, spokenPhrase: 'One, two, three.' },
      { id: 'hh2-b2', kind: 'repeated-combo', notation: '2-3-2', offsets: [0, 0.65, 1.3], gapBeats: 1.5, repeat: 8, spokenPhrase: 'Two, three, two.' },
      { id: 'hh2-b3', kind: 'defense-counter', notation: 'roll-3-2', offsets: [0, 1, 1.7], gapBeats: 2, spokenPhrase: 'Roll. Three, two.' },
      { id: 'hh2-b4', kind: 'volume-burst', notation: '1-2-3', offsets: [0, 0.6, 1.25], gapBeats: 1.2, durationBeats: 60, targetPunches: 72, spokenPhrase: 'One-two-threes.' },
      { id: 'hh2-b5', kind: 'repeated-combo', notation: '1-2-3-2', offsets: [0, 0.6, 1.25, 1.9], gapBeats: 1.4, repeat: 8, spokenPhrase: 'One, two, three, two.' },
      { id: 'hh2-b6', kind: 'footwork-exit', notation: '1-2-3-pivot', offsets: [0, 0.65, 1.3, 2.2], gapBeats: 2, spokenPhrase: 'One, two, three. Pivot.' },
      { id: 'hh2-b7', kind: 'volume-burst', notation: '3-2', offsets: [0, 0.65], gapBeats: 1.15, durationBeats: 50, targetPunches: 54, spokenPhrase: 'Three-twos.' },
      { id: 'hh2-b8', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 22, targetPunches: 7, instruction: 'Reset.' },
    ],
  },
  {
    theme: 'Double up the hooks',
    specs: [
      { id: 'hh3-b1', kind: 'repeated-combo', notation: '1-2-3-2-3', offsets: [0, 0.65, 1.3, 1.95, 2.6], gapBeats: 1.4, repeat: 6, spokenPhrase: 'One, two, three, two, three.' },
      { id: 'hh3-b2', kind: 'repeated-combo', notation: '3-2', offsets: [0, 0.65], gapBeats: 1.6, repeat: 10, spokenPhrase: 'Three, two.' },
      { id: 'hh3-b3', kind: 'defense-counter', notation: 'duck-2-3', offsets: [0, 1, 1.7], gapBeats: 2, spokenPhrase: 'Duck. Two, three.' },
      { id: 'hh3-b4', kind: 'repeated-combo', notation: '1-4-2-3', offsets: [0, 0.6, 1.25, 1.9], gapBeats: 1.4, repeat: 7, spokenPhrase: 'One, four, two, three.' },
      { id: 'hh3-b5', kind: 'volume-burst', notation: '2-3', offsets: [0, 0.65], gapBeats: 1.15, durationBeats: 55, targetPunches: 60, spokenPhrase: 'Two-threes.' },
      { id: 'hh3-b6', kind: 'defense-counter', notation: 'bob and weave-3-2', offsets: [0, 1, 1.7], gapBeats: 2.3, spokenPhrase: 'Bob and weave. Three, two.' },
      { id: 'hh3-b7', kind: 'volume-burst', notation: '1-2-3', offsets: [0, 0.6, 1.25], gapBeats: 1.15, durationBeats: 55, targetPunches: 66, spokenPhrase: 'One-two-threes.' },
      { id: 'hh3-b8', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 22, targetPunches: 7, instruction: 'Hands up. Breathe.' },
    ],
  },
  {
    theme: 'Heavy finish',
    specs: [
      { id: 'hh4-b1', kind: 'repeated-combo', notation: '1-2-4-3-2', offsets: [0, 0.65, 1.3, 1.95, 2.6], gapBeats: 1.3, repeat: 6, spokenPhrase: 'One, two, four, three, two.' },
      { id: 'hh4-b2', kind: 'repeated-combo', notation: '1-2-3-2-1', offsets: [0, 0.65, 1.3, 1.95, 2.6], gapBeats: 1.4, repeat: 6, spokenPhrase: 'One, two, three, two, one.' },
      { id: 'hh4-b3', kind: 'volume-burst', notation: '1-2-3-2', offsets: [0, 0.6, 1.2, 1.8], gapBeats: 1.2, durationBeats: 60, targetPunches: 80, spokenPhrase: 'One, two, three, two.' },
      { id: 'hh4-b4', kind: 'defense-counter', notation: 'slip-2-3-2', offsets: [0, 1, 1.75, 2.5], gapBeats: 2, spokenPhrase: 'Slip. Two, three, two.' },
      { id: 'hh4-b5', kind: 'volume-burst', notation: '2-3-2', offsets: [0, 0.6, 1.2], gapBeats: 1.1, durationBeats: 50, targetPunches: 63, spokenPhrase: 'Two, three, two.' },
      { id: 'hh4-b6', kind: 'open-pressure', notation: '3-2', offsets: [0, 0.55], gapBeats: 0.9, durationBeats: 55, targetPunches: 74, instruction: 'Final thirty. Empty the tank.', spokenPhrase: 'Flurry.' },
    ],
  },
]

const rounds: ProgramRound[] = ROUND_SPECS.map((spec, index) => {
  // M39-V1c: pressure samples flip to announce-then-work — the coach
  // speaks the whole combo ONCE at rep 0, silent on interior reps.
  const blocks = withVoicePolicy(
    padBlocksToRound(layBlocks(spec.specs, BPM), BPM, 240_000),
    'announce-then-work',
  )
  const isLast = index === ROUND_SPECS.length - 1
  return {
    id: `hh-r${index + 1}`,
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

export const heavyHands: GeneratedWorkout = {
  id: 'heavy-hands',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    totalPunchGoal: totalGoal,
    focus: 'balanced',
    bias: 'rear',
    defaultStance: 'orthodox',
    cadenceProfile: 'pressure',
    // M39-V1c full engine mode (Kyle 2026-08-30): pressure maps to
    // division 3 (180 slots/min at the 60 BPM master pulse), swing 0.54.
    coachTempo: { baseBpm: 60, division: 3, swing: 0.54 },
    // volume 0: engine BPM applies; click never plays (measurement-only).
    metronome: { enabled: true, volume: 0 },
    generatorVersion: GENERATOR_VERSION,
    seed: 'heavy-hands-2026-08-29',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution: { '1': 0.28, '2': 0.42, '3': 0.27, '4': 0.03 },
  estimatedActivePunchesPerMinute: Math.round(totalGoal / (schedule.activeSeconds / 60)),
  warnings: [
    `Suggested Hard-tier goal for 20 minutes is ${suggestGoal(20, 'hard', 'balanced')}; this hand-authored sample prescribes ${totalGoal}.`,
  ],
}
