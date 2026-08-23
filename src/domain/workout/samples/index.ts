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
import { establishTheJab20 } from './establishTheJab20'
import { switchByRound } from './switchByRound'
import { threeRoundFundamentals } from './threeRoundFundamentals'

/** Stable identifiers — binding for M31-06's sample picker. */
export type SampleWorkoutKey =
  | 'three-round-fundamentals'
  | 'establish-the-jab-20'
  | 'switch-by-round'

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
}

/** Presentation order for the "Start with a sample" list. */
const ORDER: SampleWorkoutKey[] = [
  'three-round-fundamentals',
  'establish-the-jab-20',
  'switch-by-round',
]

export function listSampleWorkouts(): SampleWorkout[] {
  return ORDER.map((key) => SAMPLES[key])
}

export function getSampleWorkout(key: SampleWorkoutKey): SampleWorkout {
  return SAMPLES[key]
}

export { threeRoundFundamentals, establishTheJab20, switchByRound }
