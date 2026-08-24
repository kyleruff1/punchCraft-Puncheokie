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

export interface HapticOutputPort {
  /** Fire the felt feedback for a strike. Best-effort and non-blocking. */
  strike(kind: HapticStrike): void
}
