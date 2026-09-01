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
 * Pace Pusher — a volume ladder with an open flurry every round, each
 * window a little longer than the last (40 → 45 → 50 → 45 + 55 beats),
 * so the round you have the least left for asks the most.
 */
const ROUND_SPECS: Array<{ theme: string; specs: BlockSpec[] }> = [
  {
    theme: 'Set the pace',
    specs: [
      { id: 'pp1-b1', kind: 'repeated-combo', notation: '1-2', offsets: [0, 0.6], gapBeats: 1.5, repeat: 10, spokenPhrase: 'One, two.' },
      { id: 'pp1-b2', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.6], gapBeats: 1.2, durationBeats: 55, targetPunches: 60, spokenPhrase: 'One-twos.' },
      { id: 'pp1-b3', kind: 'repeated-combo', notation: '1-1-2', offsets: [0, 0.55, 1.2], gapBeats: 1.4, repeat: 8, spokenPhrase: 'Jab, jab, cross.' },
      { id: 'pp1-b4', kind: 'volume-burst', notation: '1-1', offsets: [0, 0.55], gapBeats: 1.15, durationBeats: 45, targetPunches: 52, spokenPhrase: 'Double jabs.' },
      { id: 'pp1-b5', kind: 'open-pressure', notation: '1-2', offsets: [0, 0.55], gapBeats: 1, durationBeats: 40, targetPunches: 50, instruction: 'Open round. Keep punching.', spokenPhrase: 'Flurry.' },
      { id: 'pp1-b6', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 24, targetPunches: 8, instruction: 'Breathe. More coming.' },
    ],
  },
  {
    theme: 'Hold it there',
    specs: [
      { id: 'pp2-b1', kind: 'repeated-combo', notation: '1-2-3', offsets: [0, 0.6, 1.25], gapBeats: 1.4, repeat: 8, spokenPhrase: 'One, two, three.' },
      { id: 'pp2-b2', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.55], gapBeats: 1.1, durationBeats: 60, targetPunches: 72, spokenPhrase: 'One-twos.' },
      { id: 'pp2-b3', kind: 'defense-counter', notation: 'slip-1-2', offsets: [0, 1, 1.6], gapBeats: 2, spokenPhrase: 'Slip. One, two.' },
      { id: 'pp2-b4', kind: 'volume-burst', notation: '1-1-2', offsets: [0, 0.55, 1.15], gapBeats: 1.1, durationBeats: 50, targetPunches: 66, spokenPhrase: 'Jab, jab, cross.' },
      { id: 'pp2-b5', kind: 'open-pressure', notation: '1-2', offsets: [0, 0.5], gapBeats: 0.95, durationBeats: 45, targetPunches: 62, instruction: 'Open window. Stay busy.', spokenPhrase: 'Flurry.' },
      { id: 'pp2-b6', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 22, targetPunches: 7, instruction: 'Quick reset.' },
    ],
  },
  {
    theme: 'Push past comfortable',
    specs: [
      { id: 'pp3-b1', kind: 'repeated-combo', notation: '1-2-3-2', offsets: [0, 0.6, 1.25, 1.9], gapBeats: 1.3, repeat: 8, spokenPhrase: 'One, two, three, two.' },
      { id: 'pp3-b2', kind: 'volume-burst', notation: '1-2-3', offsets: [0, 0.6, 1.2], gapBeats: 1.1, durationBeats: 60, targetPunches: 78, spokenPhrase: 'One-two-threes.' },
      { id: 'pp3-b3', kind: 'footwork-exit', notation: '1-2-circle', offsets: [0, 0.6, 1.5], gapBeats: 2, spokenPhrase: 'One, two. Circle out.' },
      { id: 'pp3-b4', kind: 'volume-burst', notation: '3-2', offsets: [0, 0.6], gapBeats: 1.05, durationBeats: 45, targetPunches: 54, spokenPhrase: 'Three-twos.' },
      { id: 'pp3-b5', kind: 'open-pressure', notation: '1-2', offsets: [0, 0.5], gapBeats: 0.9, durationBeats: 50, targetPunches: 70, instruction: 'Longer window. Do not slow down.', spokenPhrase: 'Flurry.' },
      { id: 'pp3-b6', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 21, targetPunches: 7, instruction: 'Last rest coming.' },
    ],
  },
  {
    theme: 'Empty the tank',
    specs: [
      { id: 'pp4-b1', kind: 'volume-burst', notation: '1-2', offsets: [0, 0.55], gapBeats: 1.05, durationBeats: 55, targetPunches: 68, spokenPhrase: 'One-twos.' },
      { id: 'pp4-b2', kind: 'repeated-combo', notation: '1-2-1-2', offsets: [0, 0.55, 1.15, 1.7], gapBeats: 1.3, repeat: 7, spokenPhrase: 'One, two, one, two.' },
      { id: 'pp4-b3', kind: 'volume-burst', notation: '1-1-2', offsets: [0, 0.5, 1.05], gapBeats: 1, durationBeats: 55, targetPunches: 78, spokenPhrase: 'Jab, jab, cross.' },
      { id: 'pp4-b4', kind: 'open-pressure', notation: '1-2', offsets: [0, 0.5], gapBeats: 0.85, durationBeats: 45, targetPunches: 66, instruction: 'First flurry. Another after.', spokenPhrase: 'Flurry.' },
      { id: 'pp4-b5', kind: 'open-pressure', notation: '1-2', offsets: [0, 0.45], gapBeats: 0.75, durationBeats: 55, targetPunches: 90, instruction: 'Final thirty. Give it everything left.', spokenPhrase: 'Flurry. Go.' },
    ],
  },
]

// A3 (#258): the hand-authored blocks only fill ~100 s of a 240 s round —
// measured on tape as 124-139 s of free-work tail per round with dead
// rings and no coach. Each round now tops itself off with a count-scored
// pressure repetition of a natural closing motif for that round, so the
// coach and the ring row keep working to the bell.
const PAD_MOTIFS = [
  { id: 'pp1-pad', notation: '1-2', offsets: [0, 0.55], gapBeats: 1.15,
    spokenPhrase: 'One-twos.', instruction: 'Keep the pace to the bell.' },
  { id: 'pp2-pad', notation: '1-2-3', offsets: [0, 0.55, 1.15], gapBeats: 1.15,
    spokenPhrase: 'One-two-threes.', instruction: 'Hold it there.' },
  { id: 'pp3-pad', notation: '1-2-3-2', offsets: [0, 0.55, 1.15, 1.75], gapBeats: 1.1,
    spokenPhrase: 'One, two, three, two.', instruction: 'Push past comfortable.' },
  { id: 'pp4-pad', notation: '1-2', offsets: [0, 0.5], gapBeats: 0.85,
    spokenPhrase: 'One-twos.', instruction: 'Empty the tank.' },
] as const

const rounds: ProgramRound[] = ROUND_SPECS.map((spec, index) => {
  const laid = layBlocks(spec.specs, BPM)
  // M39-V1c: pressure samples flip to announce-then-work — the coach
  // speaks the whole combo ONCE at rep 0, silent on interior reps.
  const blocks = withVoicePolicy(
    padBlocksToRound(laid, BPM, 240_000, PAD_MOTIFS[index]!),
    'announce-then-work',
  )
  const isLast = index === ROUND_SPECS.length - 1
  return {
    id: `pp-r${index + 1}`,
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

export const pacePusher: GeneratedWorkout = {
  id: 'pace-pusher',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    totalPunchGoal: totalGoal,
    focus: 'balanced',
    bias: 'balanced',
    defaultStance: 'orthodox',
    cadenceProfile: 'pressure',
    // M39-V1c full engine mode (Kyle 2026-08-30): pressure maps to
    // division 3 (180 slots/min at the 60 BPM master pulse), swing 0.54.
    coachTempo: { baseBpm: 60, division: 3, swing: 0.54 },
    // volume 0: engine BPM applies; click never plays (measurement-only).
    metronome: { enabled: true, volume: 0 },
    generatorVersion: GENERATOR_VERSION,
    seed: 'pace-pusher-2026-08-29',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution: { '1': 0.51, '2': 0.42, '3': 0.07 },
  estimatedActivePunchesPerMinute: Math.round(totalGoal / (schedule.activeSeconds / 60)),
  warnings: [
    `Suggested High-volume-tier goal for 20 minutes is ${suggestGoal(20, 'high-volume', 'balanced')}; this hand-authored sample prescribes ${totalGoal}.`,
  ],
}
