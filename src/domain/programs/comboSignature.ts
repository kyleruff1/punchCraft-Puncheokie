/**
 * Canonical combo-signature format for coach-asset lookup
 * (M39-V2 W1 Epic Slice 3-a-ii, principle #0).
 *
 * ## The rule
 *
 * The combo-announce corpus keys clips like `ca-1-1-2b-numbers`
 * (`1-1-2b`, vocabulary=numbers). The `CompiledWorkoutScore`'s
 * runtime consumer must look those clips up by the SAME string
 * the render pipeline used, so the compiler's `CoachAssetResolver`
 * receives an already-canonical signature via
 * `CoachAssetContext.comboSignature`.
 *
 * Canonical form: digits separated by `-`, body suffix as lowercase
 * `b` (`1-1-2b`). Strike tokens from the catalog use uppercase B
 * (`1B`, `2B`); this helper normalizes.
 *
 * Pure — no side effects, no I/O.
 */

import type { StrikeToken } from '../strikes/strikeCatalog'

/**
 * Convert one strike-token (`'1'`, `'2B'`, …) to its combo-signature
 * form (`'1'`, `'2b'`).
 */
export function comboSignatureTokenPart(token: StrikeToken): string {
  return token.toLowerCase()
}

/**
 * Build the canonical combo-signature from an ordered strike list —
 * the string that keys the combo-announce manifest.
 *
 *   [{token:'1'},{token:'1'},{token:'2B'}] → "1-1-2b"
 *
 * Empty list yields the empty string (no combo has zero strikes;
 * caller decides whether to treat that as a lookup miss).
 */
export function comboSignatureFromStrikes(
  strikes: readonly { token: StrikeToken }[],
): string {
  return strikes.map((s) => comboSignatureTokenPart(s.token)).join('-')
}
