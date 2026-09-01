/**
 * Pure worklet math for the ring walk (MVP v2, GH #305) — kept
 * Reanimated-free so node tests import it without the native worklets
 * runtime, exactly the split `tokenVisuals.visibleBar` uses. The
 * `'worklet'` directive makes it liftable into `useRingBeatClock`'s
 * frame callback.
 */

/** Worklet mirror of `beatOrdinalAtMs` — see module note. */
export function beatOrdinalAtMsWorklet(
  scheduledStartMs: number,
  tokenOffsetsMs: readonly number[],
  expectedTokenIndexes: readonly number[],
  workElapsedMs: number,
): number {
  'worklet'
  let ordinal = -1
  for (let i = 0; i < expectedTokenIndexes.length; i += 1) {
    const tokenIndex = expectedTokenIndexes[i]!
    const offset = tokenOffsetsMs[tokenIndex]
    if (offset === undefined) break
    if (workElapsedMs < scheduledStartMs + offset) break
    ordinal = i
  }
  return ordinal
}

