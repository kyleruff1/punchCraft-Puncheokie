/**
 * Shared token-offset authority chain — one place, three consumers
 * (M39-V1c ring/avatar sync fix, Kyle 2026-08-30).
 *
 * Kyle's Pass 5 rerun revealed the visual desync: `CueEngine.fireDueTokens`
 * had learned about `visualOffsetsMs` (engine-authored ring times) via
 * commit 6531e8d, but `RhythmSpine.beatsFor` (which drives the avatar
 * frame schedule and the on-screen beat structure) still read
 * `phraseTokenTimesMs ?? tokenOffsetsMs` — two clocks, two visualizers,
 * one workout. On-glass this reads as "interfering maps": rings light
 * on engine slots, avatar animates on beat-grid slots.
 *
 * This module extracts the authority chain into one helper so every
 * visual consumer walks the same order:
 *
 *     visualOffsetsMs ?? phraseTokenTimesMs ?? tokenOffsetsMs
 *
 * Legacy cues (no engine, no rail) fall through to `tokenOffsetsMs`
 * byte-for-byte with the pre-M39 chain. Engine-mode cues get their
 * `visualOffsetsMs` respected by ALL consumers uniformly.
 *
 * Pure module. No React, no audio, no clock. Same purity rules as
 * `../workout/cadence.ts`.
 */

import type { CueInstance } from './CueTimeline'

/**
 * The full per-token offset list a visual consumer should walk. Returns
 * a readonly reference into whichever field is populated — no copy —
 * so callers can iterate without allocation. When engine authoring is
 * present, this is the engine grid; otherwise the rail; otherwise the
 * beat grid.
 */
export function tokenOffsetsFor(cue: CueInstance): readonly number[] {
  if (cue.visualOffsetsMs) return cue.visualOffsetsMs
  if (cue.phraseTokenTimesMs) return cue.phraseTokenTimesMs
  return cue.tokenOffsetsMs
}

/**
 * Per-token offset lookup at `tokenIndex`, walking the same chain.
 * `visualOffsetsMs` and `phraseTokenTimesMs` are populated per-token
 * (not necessarily length-matched to `tokenOffsetsMs` during partial
 * migrations), so this walks EACH source individually rather than
 * picking one array — a partial engine fill still gets the engine slot
 * per token where present, and falls to rail or beat grid per token
 * elsewhere.
 *
 * The subtle contract vs `tokenOffsetsFor`: this helper is per-token
 * with per-source fallback; `tokenOffsetsFor` returns whichever whole
 * array is fullest. Ring engines use this; avatar span calculators
 * (which need a uniform array) use `tokenOffsetsFor`.
 */
export function tokenOffsetFor(cue: CueInstance, tokenIndex: number): number {
  return (
    cue.visualOffsetsMs?.[tokenIndex] ??
    cue.phraseTokenTimesMs?.[tokenIndex] ??
    cue.tokenOffsetsMs[tokenIndex] ??
    0
  )
}
