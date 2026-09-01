/**
 * Measured combo-announce clip durations, as a provider the domain can
 * consume without importing the manifest.
 *
 * GH #305 fix #17. The speakable-envelope rule
 * (`src/domain/workout/speakableEnvelope.ts`) decides whether the coach
 * can name a combination on every repetition at a given tempo. That
 * answer is only as good as its notion of how long the clip takes, and
 * the margins are thin — Three-Round Fundamentals' `r1-b1` misses the
 * envelope by 25 ms on a 1125 ms stride under a per-token estimate.
 * Kyle (2026-08-31) chose measured durations with the estimate as
 * fallback.
 *
 * ## Why a provider rather than a domain import
 *
 * `speakableEnvelope` is pure domain and must not reach into
 * `src/audio/`. This mirrors `RhythmMap.CompileOptions`, which already
 * takes `durationFor` / `wordMarksFor` / `instructionClipFor` callbacks
 * for exactly this reason: audio facts are injected at the edge, so the
 * domain rule stays testable with fabricated numbers and the app supplies
 * truth at wiring time.
 *
 * ## Vocabulary
 *
 * Numbers and techniques renderings of the same combination differ in
 * length ("Two-bee" vs "Body cross"), and the athlete can switch mid
 * workout. The envelope must hold for whichever is playing, so the
 * provider reports the LONGER of the two — the conservative choice,
 * matching the compiler's conservative reservation window (principle #4).
 */

import { findComboAnnounce } from './comboAnnounceManifest'
import { formatCombo, type WorkoutToken } from '@domain/workout/WorkoutTokens'

/**
 * Measured duration for the combination these tokens spell, or
 * `undefined` when the library has no rendering for it (the caller then
 * falls back to its estimate).
 *
 * Returns the longer of the numbers and techniques renderings: a block
 * that only fits in one vocabulary does not fit, because the athlete may
 * be listening to the other.
 */
export function comboClipDurationMs(
  tokens: readonly WorkoutToken[],
): number | undefined {
  const combination = formatCombo(tokens)
  if (combination.length === 0) return undefined
  const numbers = findComboAnnounce(combination, 'numbers')?.durationMs
  const techniques = findComboAnnounce(combination, 'techniques')?.durationMs
  if (numbers === undefined && techniques === undefined) return undefined
  return Math.max(numbers ?? 0, techniques ?? 0)
}
