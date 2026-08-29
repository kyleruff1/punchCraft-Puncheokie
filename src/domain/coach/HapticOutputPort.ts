/**
 * The port for felt feedback — a buzz the athlete gets on a good strike.
 *
 * Split from `VoiceOutputPort` on purpose: sound and touch are different
 * channels the athlete tunes separately (the `haptics` volume already exists in
 * `Volumes`), and keeping them apart means a silent-but-buzzing workout, or the
 * reverse, is expressible.
 *
 * Pure TypeScript: no React Native, no Expo (spec §15.1). The implementation
 * lives in `src/audio/HapticOutputExpo.ts`.
 */
import type { PunchHand } from '../punch/PunchEvent'

/**
 * The three things worth feeling, in ascending reward.
 *
 * - `good` — the right hand landed on the beat, in sequence. The everyday
 *   confirmation, and on FightCamp v1 the reliable one.
 * - `perfect` — the strike *type* also agreed (H12: rare on v1, a bonus when
 *   the device profile allows it), so it earns a stronger, distinct buzz.
 * - `combo` — the whole combination was completed in sequence with the correct
 *   hands. A celebratory pattern, not a single tap.
 */
export type HapticStrike = 'good' | 'perfect' | 'combo'

/**
 * The buzz tier for a tracker-reported punch, in ascending intensity.
 * Unlike `HapticStrike` (a judgement about matching), this is raw
 * physical feedback: every punch buzzes, and how hard it buzzes tracks
 * how hard the reading says the athlete hit.
 */
export type PunchBuzz = 'soft' | 'light' | 'medium' | 'heavy'

/** Map a normalized reading (0..1, see impulseScale) to its buzz tier. */
export function punchBuzzOf(v01: number): PunchBuzz {
  if (v01 >= 0.8) return 'heavy'
  if (v01 >= 0.55) return 'medium'
  if (v01 >= 0.3) return 'light'
  return 'soft'
}

export interface HapticOutputPort {
  /** Fire the felt feedback for a strike. Best-effort and non-blocking. */
  strike(kind: HapticStrike): void
  /**
   * Fire the felt feedback for one tracker punch, scaled by its raw
   * reading (`undefined` on capability-limited devices → a mid buzz).
   * Best-effort and non-blocking, like `strike`.
   */
  punch(hand: PunchHand, velocityRaw?: number): void
}
