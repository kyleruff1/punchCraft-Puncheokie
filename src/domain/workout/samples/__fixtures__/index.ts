/**
 * FROZEN pre-click-track samples (MVP v2 Part B, GH #305) — test fixtures.
 *
 * The live library was rewritten to the 4-slot bar / click-track format
 * on 2026-08-31. A dozen ENGINE test suites had been borrowing the live
 * samples as convenient fixtures — their assertions encode the OLD
 * shapes (bursts, count-scored recovery blocks, specific block ids and
 * expectation counts). Pointing those suites at the new library would
 * have silently weakened them into tests of whatever the library
 * happens to contain.
 *
 * These are byte-frozen copies from the last pre-rewrite commit. They
 * exercise every engine feature the new library deliberately dropped
 * (volume-burst, open-pressure, active-recovery count scoring,
 * defense-counter, sustained-strike) — which is exactly why the engine
 * tests must keep them: the features still exist and future workouts
 * may use them. Do NOT "update" these to match the live library.
 */
export { threeRoundFundamentals as legacyThreeRoundFundamentals } from './legacy_threeRoundFundamentals'
export { establishTheJab20 as legacyEstablishTheJab20 } from './legacy_establishTheJab20'
export { heavyHands as legacyHeavyHands } from './legacy_heavyHands'
export { speedCombos as legacySpeedCombos } from './legacy_speedCombos'
export { pacePusher as legacyPacePusher } from './legacy_pacePusher'
export { bodyWork as legacyBodyWork } from './legacy_bodyWork'
export { pumpAndCoast as legacyPumpAndCoast } from './legacy_pumpAndCoast'
export { switchByRound as legacySwitchByRound } from './legacy_switchByRound'
export { uppercutClinic as legacyUppercutClinic } from './legacy_uppercutClinic'
export { progressiveBuildup as legacyProgressiveBuildup } from './legacy_progressiveBuildup'

import { threeRoundFundamentals } from './legacy_threeRoundFundamentals'
import { establishTheJab20 } from './legacy_establishTheJab20'
import { heavyHands } from './legacy_heavyHands'
import { speedCombos } from './legacy_speedCombos'
import { pacePusher } from './legacy_pacePusher'
import { bodyWork } from './legacy_bodyWork'
import { pumpAndCoast } from './legacy_pumpAndCoast'
import { switchByRound } from './legacy_switchByRound'
import { uppercutClinic } from './legacy_uppercutClinic'
import { progressiveBuildup } from './legacy_progressiveBuildup'
import type { GeneratedWorkout } from '../../GeneratedWorkout'

/** listSampleWorkouts-shaped view over the frozen set. */
export function listLegacySampleWorkouts(): Array<{ key: string; workout: GeneratedWorkout }> {
  return [
    { key: 'three-round-fundamentals', workout: threeRoundFundamentals },
    { key: 'establish-the-jab-20', workout: establishTheJab20 },
    { key: 'switch-by-round', workout: switchByRound },
    { key: 'heavy-hands', workout: heavyHands },
    { key: 'speed-combos', workout: speedCombos },
    { key: 'uppercut-clinic', workout: uppercutClinic },
    { key: 'progressive-buildup', workout: progressiveBuildup },
    { key: 'body-work', workout: bodyWork },
    { key: 'pace-pusher', workout: pacePusher },
    { key: 'pump-and-coast', workout: pumpAndCoast },
  ]
}
