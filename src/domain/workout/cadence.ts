/**
 * Cadence profiles and beat→millisecond conversion (M31-02, doc §17).
 *
 * Beats are the authoring unit for all cue timing. A template says "the
 * third punch lands 1.55 beats in"; this module turns that into time once a
 * BPM is chosen. Keeping the two separate is what lets one combo template
 * serve every cadence profile.
 *
 * **BPM is authored, never derived (D3).** It is a plain number carried on
 * the recipe and scheduled on the spec §18.3 monotonic clock. Nothing here
 * accepts audio, track metadata, playback position or microphone input.
 *
 * ## Superseded 2026-08-30 by M39 (Timing Engine)
 *
 * The four-profile band model (technical/steady/pressure/sprint with
 * unrelated BPMs) is being replaced by a single 60 BPM master pulse with
 * four subdivisions (see `src/domain/timing/TimingEngine.ts`). The
 * doctrine "no beat sync" survives — BPM is still authored on the
 * recipe; the metronome track PLAYS the authored value, never derives
 * tempo from an external audio stream. What changes is that "the BPM"
 * becomes `baseBpm × globalSpeed × division` instead of a profile's
 * nominalBpm. `bpmForRecipe(recipe)` below is the bridge that keeps
 * legacy behaviour byte-identical while `metronome.enabled: false`, and
 * flips to the engine value the moment a recipe opts in.
 *
 * This module converts durations; it never places them on a clock.
 * Scheduling against `workElapsedMs` belongs to M32-03/M32-04.
 *
 * Pure TypeScript. No React, Expo, SQLite or BLE imports, and no wall-clock
 * reads of any kind (spec §15.1, §18.3).
 */

import type { WorkoutToken } from './WorkoutTokens'
import type { WorkoutRecipe } from './WorkoutRecipe'

export type CadenceProfileId = 'technical' | 'steady' | 'pressure' | 'sprint'

export interface CadenceProfile {
  id: CadenceProfileId
  minBpm: number
  maxBpm: number
  nominalBpm: number
}

/**
 * Doc §17 ranges, verbatim. `nominalBpm` is the implementation-chosen
 * default within each band — the midpoint, rounded to a whole BPM, so a
 * profile selected without further tuning sits centred in its range and has
 * symmetric headroom for PacingEngine's ±10–15% adjustment (M33-05).
 */
export const CADENCE_PROFILES: Record<CadenceProfileId, CadenceProfile> = {
  technical: { id: 'technical', minBpm: 80, maxBpm: 90, nominalBpm: 85 },
  steady: { id: 'steady', minBpm: 95, maxBpm: 110, nominalBpm: 100 },
  pressure: { id: 'pressure', minBpm: 110, maxBpm: 130, nominalBpm: 120 },
  sprint: { id: 'sprint', minBpm: 130, maxBpm: 150, nominalBpm: 140 },
}

/**
 * Convert beats to milliseconds at a given tempo.
 *
 * Returns **fractional** milliseconds deliberately. Rounding here would
 * accumulate: a combo whose offsets each lose half a millisecond drifts
 * measurably over a three-minute round. Callers round once, at the
 * scheduling or display edge.
 */
export function beatsToMs(beats: number, bpm: number): number {
  return (beats * 60_000) / bpm
}

/** Inverse of `beatsToMs`. Useful for expressing a measured gap in beats. */
export function msToBeats(ms: number, bpm: number): number {
  return (ms * bpm) / 60_000
}

/**
 * Millisecond offset of every token, in token order.
 *
 * Order- and length-preserving: the result index matches the input index, so
 * callers can zip it against the token array without re-deriving anything.
 */
export function tokenOffsetsMs(tokens: readonly WorkoutToken[], bpm: number): number[] {
  return tokens.map((token) => beatsToMs(token.beatOffset, bpm))
}

/** Largest `beatOffset` in a token list; 0 for an empty list. */
export function maxBeatOffset(tokens: readonly WorkoutToken[]): number {
  return tokens.reduce((max, token) => (token.beatOffset > max ? token.beatOffset : max), 0)
}

/**
 * Total duration of a block, including its trailing gap.
 *
 * The `gapBeats` gap (D5) belongs to the block that precedes it, not to the
 * one that follows. That is what keeps back-to-back blocks from overlapping
 * when they are laid end to end — if the gap belonged to the follower, the
 * last token of one block and the first of the next would share an instant.
 */
export function blockDurationMs(
  tokens: readonly WorkoutToken[],
  gapBeats: number,
  bpm: number,
): number {
  return beatsToMs(maxBeatOffset(tokens) + gapBeats, bpm)
}

/**
 * The BPM to feed every downstream compiler for this recipe.
 *
 * Two paths, chosen by `recipe.metronome.enabled`:
 *
 * - **Legacy (metronome off, the default in V1a)**: return
 *   `CADENCE_PROFILES[recipe.cadenceProfile].nominalBpm`. Byte-identical
 *   to every timeline compile before M39 — a `recipe` with the new
 *   `coachTempo`/`metronome`/`globalSpeed` fields present but
 *   `metronome.enabled: false` produces exactly the same
 *   `tokenOffsetsMs`, `blockDurationMs`, and `RhythmMap` output as a
 *   pre-M39 recipe. That is the property the new byte-identity test
 *   locks in.
 *
 * - **Engine (metronome on, V1b onward)**: return
 *   `recipe.coachTempo.baseBpm × recipe.coachTempo.division ×
 *   recipe.globalSpeed`. This turns "beats per minute" into "call slots
 *   per minute" — which is what the compiler expects when
 *   `WorkoutToken.beatOffset` values are authored in note-value multiples
 *   on the engine grid. `globalSpeed` is the future speed slider (V2).
 *
 * The bridge is the single seam that keeps the old and new models
 * coexisting through the migration window. Every other consumer stays
 * "just pass a BPM."
 */
export function bpmForRecipe(recipe: WorkoutRecipe): number {
  if (recipe.metronome.enabled) {
    return recipe.coachTempo.baseBpm * recipe.coachTempo.division * recipe.globalSpeed
  }
  return CADENCE_PROFILES[recipe.cadenceProfile].nominalBpm
}

/**
 * Bound a tempo to a profile's range.
 *
 * Consumed by PacingEngine (M33-05), whose adaptive adjustment is capped at
 * roughly ±10–15% per round — this is the hard stop that keeps a catch-up
 * adjustment from producing an unreachable cadence (§22, R13, R23).
 *
 * Idempotent: a value already inside the range is returned unchanged.
 */
export function clampToProfile(bpm: number, profile: CadenceProfile): number {
  if (bpm < profile.minBpm) return profile.minBpm
  if (bpm > profile.maxBpm) return profile.maxBpm
  return bpm
}
