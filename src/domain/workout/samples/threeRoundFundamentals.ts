/**
 * Three-Round Fundamentals — the doc §4 fragment realized (M31-05).
 *
 * This is the workout M32-08's live screen runs against the simulated
 * source, and the standing fixture for the cue-timeline and CueEngine
 * suites. Round 1's first two blocks reproduce the doc §4 fragment exactly,
 * including its beat offsets and spoken phrase.
 *
 * Round shape follows the authored coaching curve: round 1 finds range with
 * singles, doubles and light one-twos; round 2 works medium combinations
 * with movement between them; round 3 pushes pace and finishes on a flurry.
 *
 * Note on `recipe.durationMinutes`: this is a short three-round
 * demonstration, so no `WorkoutDurationMinutes` value describes it exactly.
 * The nearest valid value is recorded; the schedule below is authoritative
 * for what actually runs, and the validator checks the schedule rather than
 * the recipe.
 */

import { CADENCE_PROFILES } from '../cadence'
import type { GeneratedWorkout } from '../GeneratedWorkout'
import type { ProgramRound } from '../WorkoutTokens'
import { defaultRecipe } from '../WorkoutRecipe'
import { GENERATOR_VERSION } from '../versions'
import { layBlocks, roundPunchCount, type BlockSpec } from './authoring'

const BPM = CADENCE_PROFILES.steady.nominalBpm
const WORK_MS = 240_000
const REST_MS = 60_000

/** Round 1 — the doc §4 fragment, then range-finding volume. */
const ROUND_1: BlockSpec[] = [
  {
    // Doc §4, verbatim: 1-2 x3, offsets 0 / 0.75, with its spoken phrase.
    id: 'r1-b1',
    kind: 'repeated-combo',
    notation: '1-2',
    offsets: [0, 0.75],
    gapBeats: 1.5,
    repeat: 3,
    spokenPhrase: 'One, two. Three times.',
  },
  {
    // Doc §4, verbatim: slip then 2-3-2, offsets 0 / 1 / 1.75 / 2.5.
    id: 'r1-b2',
    kind: 'defense-counter',
    notation: 'slip-2-3-2',
    offsets: [0, 1, 1.75, 2.5],
    gapBeats: 2,
    spokenPhrase: 'Slip. Two, three, two.',
  },
  {
    id: 'r1-b3',
    kind: 'repeated-combo',
    notation: '1',
    offsets: [0],
    gapBeats: 1.5,
    repeat: 8,
    spokenPhrase: 'Jab. Find the range.',
  },
  {
    id: 'r1-b4',
    kind: 'repeated-combo',
    notation: '1-1',
    offsets: [0, 0.6],
    gapBeats: 1.4,
    repeat: 6,
    spokenPhrase: 'Double jab.',
  },
  {
    id: 'r1-b5',
    kind: 'volume-burst',
    notation: '1-2',
    offsets: [0, 0.75],
    gapBeats: 1.25,
    durationBeats: 40,
    targetPunches: 48,
    spokenPhrase: 'One-twos. Keep them light.',
  },
  {
    id: 'r1-b6',
    kind: 'repeated-combo',
    notation: '1-2',
    offsets: [0, 0.7],
    gapBeats: 1.3,
    repeat: 10,
    spokenPhrase: 'One, two. Ten times.',
  },
  {
    id: 'r1-b7',
    kind: 'volume-burst',
    notation: '1-1-2',
    offsets: [0, 0.6, 1.3],
    gapBeats: 1.5,
    durationBeats: 55,
    targetPunches: 66,
    spokenPhrase: 'Jab, jab, cross.',
  },
  {
    id: 'r1-b8',
    kind: 'active-recovery',
    notation: '1',
    offsets: [0],
    gapBeats: 3,
    durationBeats: 24,
    targetPunches: 8,
    instruction: 'Light jabs. Breathe.',
  },
]

/** Round 2 — medium combinations with movement between them. */
const ROUND_2: BlockSpec[] = [
  {
    id: 'r2-b1',
    kind: 'repeated-combo',
    notation: '1-2-3',
    offsets: [0, 0.7, 1.5],
    gapBeats: 1.5,
    repeat: 6,
    spokenPhrase: 'One, two, three.',
  },
  {
    id: 'r2-b2',
    kind: 'footwork-exit',
    notation: '1-2-pivot',
    offsets: [0, 0.7, 1.6],
    gapBeats: 2,
    spokenPhrase: 'One, two. Pivot out.',
  },
  {
    id: 'r2-b3',
    kind: 'defense-counter',
    notation: 'roll-3-2',
    offsets: [0, 1, 1.75],
    gapBeats: 2,
    spokenPhrase: 'Roll. Three, two.',
  },
  {
    id: 'r2-b4',
    kind: 'volume-burst',
    notation: '1-2-3-2',
    offsets: [0, 0.7, 1.5, 2.2],
    gapBeats: 1.5,
    durationBeats: 60,
    targetPunches: 64,
    spokenPhrase: 'One, two, three, two.',
  },
  {
    id: 'r2-b5',
    kind: 'repeated-combo',
    notation: '1-2b-3',
    offsets: [0, 0.7, 1.5],
    gapBeats: 1.5,
    repeat: 8,
    spokenPhrase: 'Jab, body, hook.',
  },
  {
    id: 'r2-b6',
    kind: 'volume-burst',
    notation: '1-2',
    offsets: [0, 0.7],
    gapBeats: 1.2,
    durationBeats: 50,
    targetPunches: 60,
    spokenPhrase: 'One-twos.',
  },
  {
    id: 'r2-b7',
    kind: 'active-recovery',
    notation: '1',
    offsets: [0],
    gapBeats: 3,
    durationBeats: 20,
    targetPunches: 7,
    instruction: 'Reset. Hands up.',
  },
]

/** Round 3 — push the pace, finish on a flurry. */
const ROUND_3: BlockSpec[] = [
  {
    id: 'r3-b1',
    kind: 'repeated-combo',
    notation: '1-2-3-2',
    offsets: [0, 0.6, 1.3, 1.95],
    gapBeats: 1.2,
    repeat: 6,
    spokenPhrase: 'One, two, three, two.',
  },
  {
    id: 'r3-b2',
    kind: 'volume-burst',
    notation: '2-3-6',
    offsets: [0, 0.65, 1.35],
    gapBeats: 1.2,
    durationBeats: 55,
    targetPunches: 66,
    spokenPhrase: 'Cross, hook, uppercut.',
  },
  {
    id: 'r3-b3',
    kind: 'defense-counter',
    notation: 'slip-2-3-2',
    offsets: [0, 0.9, 1.6, 2.3],
    gapBeats: 1.5,
    spokenPhrase: 'Slip. Two, three, two.',
  },
  {
    id: 'r3-b4',
    kind: 'volume-burst',
    notation: '1-2b-3-2',
    offsets: [0, 0.6, 1.3, 1.95],
    gapBeats: 1.2,
    durationBeats: 60,
    targetPunches: 72,
    spokenPhrase: 'Jab, body, hook, cross.',
  },
  {
    id: 'r3-b5',
    kind: 'open-pressure',
    notation: '1-2',
    offsets: [0, 0.55],
    gapBeats: 0.9,
    durationBeats: 60,
    targetPunches: 80,
    instruction: 'Final thirty. Everything you have.',
    spokenPhrase: 'Flurry.',
  },
]

function buildRound(
  id: string,
  order: number,
  theme: string,
  specs: BlockSpec[],
  isLast: boolean,
): ProgramRound {
  const blocks = layBlocks(specs, BPM)
  return {
    id,
    order,
    kind: 'round',
    countsTowardGoal: true,
    theme,
    workDurationMs: WORK_MS,
    restAfterMs: isLast ? 0 : REST_MS,
    // Derived from the authored blocks rather than asserted, so the target
    // and the content can never disagree.
    targetPunches: roundPunchCount(blocks),
    blocks,
  }
}

const rounds: ProgramRound[] = [
  buildRound('tf-r1', 1, 'Jab and cross rhythm', ROUND_1, false),
  buildRound('tf-r2', 2, 'Hooks after straights', ROUND_2, false),
  buildRound('tf-r3', 3, 'Pressure and finish', ROUND_3, true),
]

const totalGoal = rounds.reduce((sum, r) => sum + r.targetPunches, 0)
const activeMinutes = (rounds.length * WORK_MS) / 60_000

export const threeRoundFundamentals: GeneratedWorkout = {
  id: 'three-round-fundamentals',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    totalPunchGoal: totalGoal,
    defaultStance: 'orthodox',
    cadenceProfile: 'steady',
    generatorVersion: GENERATOR_VERSION,
    seed: 'fundamentals-2026-08-22',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution: { '1': 0.42, '2': 0.28, '3': 0.18, '6': 0.06, '2b': 0.06 },
  estimatedActivePunchesPerMinute: Math.round(totalGoal / activeMinutes),
  warnings: [],
}
