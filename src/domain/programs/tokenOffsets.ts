/**
 * Per-token offset lookup — the V1c beat-grid path (M39-V2 Phase 5-ii).
 *
 * V1c had a THREE-source fallback chain
 * (`visualOffsetsMs ?? phraseTokenTimesMs ?? tokenOffsetsMs`) so
 * engine-authored ring times and phrase-rail overrides could shadow
 * the beat grid. Phase 5-ii retires the transitional fields: engine
 * authoring now lives in the `CompiledCueTimeline` per cue
 * (see `SpineSchedule.compiled`), and the rail's placement math
 * moves with it. The V1c fallback collapses to the beat grid alone.
 *
 * These two helpers stay as one-liners so consumers can be migrated
 * to `compiled.strikes[i].startTick` in Phase 5-iii without touching
 * their call sites in the same commit. Once that migration is done,
 * this module goes away.
 *
 * Pure module. No React, no audio, no clock. Same purity rules as
 * `../workout/cadence.ts`.
 */

import type { CueInstance } from './CueTimeline'

/** The full per-token offset list — the beat-grid `tokenOffsetsMs`. */
export function tokenOffsetsFor(cue: CueInstance): readonly number[] {
  return cue.tokenOffsetsMs
}

/**
 * Per-token offset lookup at `tokenIndex`. Falls back to 0 for an
 * out-of-range index — the pre-M39 behavior a legacy consumer might
 * still depend on during the Phase 5 migration.
 */
export function tokenOffsetFor(cue: CueInstance, tokenIndex: number): number {
  return cue.tokenOffsetsMs[tokenIndex] ?? 0
}
