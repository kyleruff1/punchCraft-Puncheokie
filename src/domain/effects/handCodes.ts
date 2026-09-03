/**
 * Numeric hand codes for the backdrop bus's `handCode` field.
 *
 * The bus emits punch-hand as a small integer so downstream sinks that
 * run in a worklet (SharedValue payloads, `runOnUI` args) do not have to
 * carry a string. Kept in a tiny dedicated file so `membraneMath.ts`
 * could retire cleanly when the Skia membrane was replaced by
 * PummelDarkness (2026-09-02).
 */
export const HAND_LEFT = 0
export const HAND_RIGHT = 1
export const HAND_NEUTRAL = 2
