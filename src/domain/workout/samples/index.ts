/**
 * Hand-authored sample workouts (M31-05).
 *
 * These let the Recipe screen (M31-06) and the live screen (M32-08) ship
 * before the procedural generator (M35) exists, and they are the standing
 * fixtures for the cue-timeline and CueEngine suites.
 *
 * They are **code, not data** — persistence of saved recipes is M31-09 and
 * M36-01. Nothing here writes a `workout_recipes` row.
 */

import type { GeneratedWorkout } from '../GeneratedWorkout'
import { bodyWork } from './bodyWork'
import { diagnosticTokenSequence } from './diagnosticTokenSequence'
import { establishTheJab20 } from './establishTheJab20'
import { heavyHands } from './heavyHands'
import { pacePusher } from './pacePusher'
import { progressiveBuildup } from './progressiveBuildup'
import { pumpAndCoast } from './pumpAndCoast'
import { speedCombos } from './speedCombos'
import { switchByRound } from './switchByRound'
import { threeRoundFundamentals } from './threeRoundFundamentals'
import { uppercutClinic } from './uppercutClinic'
import {
  QUICK_WORKOUT_META,
  QUICK_WORKOUT_ORDER,
  QUICK_WORKOUTS,
  type QuickWorkoutKey,
} from './quickWorkouts'

/** Stable identifiers — binding for M31-06's sample picker. */
export type SampleWorkoutKey =
  | 'three-round-fundamentals'
  | 'establish-the-jab-20'
  | 'switch-by-round'
  | 'heavy-hands'
  | 'speed-combos'
  | 'uppercut-clinic'
  | 'progressive-buildup'
  | 'body-work'
  | 'pace-pusher'
  | 'pump-and-coast'
  | 'diagnostic-token-sequence'
  | QuickWorkoutKey

export interface SampleWorkout {
  key: SampleWorkoutKey
  name: string
  description: string
  workout: GeneratedWorkout
}

const SAMPLES: Record<SampleWorkoutKey, SampleWorkout> = {
  'three-round-fundamentals': {
    key: 'three-round-fundamentals',
    name: 'Three-Round Fundamentals',
    description:
      'Three rounds building from jab-and-cross rhythm through hooks after straights to a pressure finish.',
    workout: threeRoundFundamentals,
  },
  'establish-the-jab-20': {
    key: 'establish-the-jab-20',
    name: 'Establish the Jab',
    description:
      'Twenty minutes of jab-led work across five rounds — range, volume, the counter, the body, then pace.',
    workout: establishTheJab20,
  },
  'switch-by-round': {
    key: 'switch-by-round',
    name: 'Switch by Round',
    description:
      'Four rounds alternating between orthodox and southpaw, changing stance only at the bell.',
    workout: switchByRound,
  },
  'heavy-hands': {
    key: 'heavy-hands',
    name: 'Heavy Hands',
    description:
      'Hooks and crosses with weight behind them — four rounds of finishing shots at pressure cadence.',
    workout: heavyHands,
  },
  'speed-combos': {
    key: 'speed-combos',
    name: 'Speed Combos',
    description: 'Short straight flurries at sprint cadence — doubles, one-twos, and quick exits.',
    workout: speedCombos,
  },
  'uppercut-clinic': {
    key: 'uppercut-clinic',
    name: 'Uppercut Clinic',
    description:
      'The five and the six from first touch to full combinations, at teaching cadence.',
    workout: uppercutClinic,
  },
  'progressive-buildup': {
    key: 'progressive-buildup',
    name: 'Progressive Buildup',
    description:
      'One combination grows each round — two punches at the bell, the full ladder by the finish.',
    workout: progressiveBuildup,
  },
  'body-work': {
    key: 'body-work',
    name: 'Body Work',
    description:
      'Four rounds downstairs — body jabs, the cross to the ribs, and hooks under the elbow.',
    workout: bodyWork,
  },
  'pace-pusher': {
    key: 'pace-pusher',
    name: 'Pace Pusher',
    description: 'A volume ladder with an open flurry every round, each one longer than the last.',
    workout: pacePusher,
  },
  'pump-and-coast': {
    key: 'pump-and-coast',
    name: 'Pump & Coast',
    description:
      'Four rounds of pump bars and coast bars — empty it, then recover on your feet — at one hundred on the click.',
    workout: pumpAndCoast,
  },
  'diagnostic-token-sequence': {
    key: 'diagnostic-token-sequence',
    name: 'Diagnostic Token Sequence',
    description:
      'INTERNAL QA rig — five known-truth combos back-to-back in R1 for the verify-workout harness. Not intended as a user-facing workout.',
    workout: diagnosticTokenSequence,
  },
  // The quick catalogue (2026-09-07): two rounds × 4:00, ≈ nine minutes.
  // Names and descriptions live beside their definitions in
  // quickWorkouts.ts; the registry only binds the keys.
  ...(Object.fromEntries(
    QUICK_WORKOUT_ORDER.map((key) => [
      key,
      {
        key,
        name: QUICK_WORKOUT_META[key].name,
        description: QUICK_WORKOUT_META[key].description,
        workout: QUICK_WORKOUTS[key],
      },
    ]),
  ) as Record<QuickWorkoutKey, SampleWorkout>),
}

/** Presentation order for the "Start with a sample" list — the landing
 * grid reads left-to-right, top-to-bottom in this order: the ten full
 * workouts, then the twelve quick ones. */
const ORDER: SampleWorkoutKey[] = [
  'three-round-fundamentals',
  'establish-the-jab-20',
  'switch-by-round',
  'heavy-hands',
  'speed-combos',
  'uppercut-clinic',
  'progressive-buildup',
  'body-work',
  'pace-pusher',
  'pump-and-coast',
  ...QUICK_WORKOUT_ORDER,
]

export function listSampleWorkouts(): SampleWorkout[] {
  return ORDER.map((key) => SAMPLES[key])
}

export function getSampleWorkout(key: SampleWorkoutKey): SampleWorkout {
  return SAMPLES[key]
}

/**
 * Whether an arbitrary string names a registered sample — INCLUDING the
 * hidden diagnostic rig, which is not in `ORDER` but is a real, runnable
 * workout. The QA deep link validates its `workout` parameter with this
 * so a typo lands on an error screen, never on `+not-found`.
 */
export function isSampleWorkoutKey(key: string): key is SampleWorkoutKey {
  return Object.prototype.hasOwnProperty.call(SAMPLES, key)
}

export {
  threeRoundFundamentals,
  establishTheJab20,
  switchByRound,
  heavyHands,
  speedCombos,
  uppercutClinic,
  progressiveBuildup,
  bodyWork,
  pacePusher,
  pumpAndCoast,
}
