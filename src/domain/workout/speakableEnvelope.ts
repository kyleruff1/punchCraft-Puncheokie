/**
 * The speakable envelope — can the coach actually say this every rep?
 *
 * GH #305 fix #17. Speed Combos on-glass exposed a physics problem rather
 * than a timing bug: at 240 BPM a `1-2` block repeats every 525 ms while
 * the clip naming it needs ~1000-1400 ms to speak. No dispatch strategy
 * fixes that. The repeat-thinning gate silently dropped whatever could not
 * fit, so the athlete heard bursts separated by long silences — measured
 * 31 audible clips against 107 strikes.
 *
 * A block outside the envelope should be spoken ONCE at block start and
 * then worked to the rings (`announce-then-work`), which is a policy the
 * app already has. This module decides which blocks those are.
 *
 * ## Authored wins; this is the fallback
 *
 * `WorkoutBlock.voicePolicy` is always authoritative when set. Kyle
 * (2026-08-31): hand-author the difficult segments individually, and let
 * a derived rule cover the rest. A future deterministic matrix of
 * per-condition outcomes can replace `derivedVoicePolicy` without
 * touching callers — the seam is this one function.
 *
 * ## Why a duration ESTIMATE by default
 *
 * `clipMsFor` is injectable so a caller holding the rendered
 * combo-announce manifest can supply measured durations. The default is a
 * per-token estimate matching `PER_TOKEN_PHRASE_ESTIMATE_MS` in
 * `RhythmMap` — deliberately the same number the thinning gate uses, so
 * the envelope rule and the gate that would otherwise drop these calls
 * share one notion of "how long the coach takes". Keeping the default
 * estimate-based also keeps this module pure domain: no audio-manifest
 * import, so the answer is available before any asset loads.
 *
 * An audit of all ten samples found 50 of 96 repeating blocks outside the
 * envelope — a clean cadence split (85 BPM: none; 180+ BPM: all). So this
 * is not a rare exception path; it materially shapes the coach's voice at
 * fast cadences, which is exactly why the authored override matters.
 *
 * Pure TypeScript — no clock, no I/O.
 */

import type { VoicePolicy } from '../timing/TimingEngine'
import { beatsToMs, maxBeatOffset } from './cadence'
import type { WorkoutBlock, WorkoutToken } from './WorkoutTokens'

/**
 * Milliseconds one spoken token needs. Matches
 * `PER_TOKEN_PHRASE_ESTIMATE_MS` in `RhythmMap` on purpose — see the
 * module note.
 */
export const SPOKEN_TOKEN_MS = 500

/**
 * Clearance between a clip's audible tail and the next call. Without it
 * two calls abut and the second's onset lands on the first's release.
 */
export const SPEAKABLE_CLEARANCE_MS = 150

/**
 * Tokens that produce audio — coach tokens have no clip (doc §18.2), and
 * a rest is silence by definition (GH #305). Counting a rest would inflate
 * the estimate by `SPOKEN_TOKEN_MS` per padded slot and push blocks out of
 * the envelope purely because their bar was padded.
 */
export function spokenTokenCount(tokens: readonly WorkoutToken[]): number {
  let count = 0
  for (const token of tokens) if (token.kind !== 'coach' && token.kind !== 'rest') count += 1
  return count
}

/** Default estimate: every spoken token costs `SPOKEN_TOKEN_MS`. */
export function estimatedClipMs(tokens: readonly WorkoutToken[]): number {
  return spokenTokenCount(tokens) * SPOKEN_TOKEN_MS
}

export interface SpeakableEnvelopeOptions {
  /**
   * Measured clip length for this block's combination, when the caller
   * has the rendered manifest. Falls back to `estimatedClipMs`.
   */
  clipMsFor?: (tokens: readonly WorkoutToken[]) => number | undefined
}

/**
 * How long the coach needs to name this combination once, plus clearance
 * before the next call may begin.
 */
export function requiredSpeechMs(
  tokens: readonly WorkoutToken[],
  opts: SpeakableEnvelopeOptions = {},
): number {
  const measured = opts.clipMsFor?.(tokens)
  const clipMs = measured !== undefined && measured > 0 ? measured : estimatedClipMs(tokens)
  return clipMs + SPEAKABLE_CLEARANCE_MS
}

/** Milliseconds between the start of one repetition and the next. */
export function repetitionStrideMs(block: WorkoutBlock, bpm: number): number {
  return beatsToMs(maxBeatOffset(block.tokens), bpm) + beatsToMs(block.gapBeats, bpm)
}

/**
 * Can the coach name this combination on EVERY repetition at this tempo?
 *
 * A block that never repeats is spoken once, so the stride is irrelevant
 * and it always fits.
 */
export function fitsSpeakableEnvelope(
  block: WorkoutBlock,
  bpm: number,
  opts: SpeakableEnvelopeOptions = {},
): boolean {
  const repeats = Math.max(1, block.repeat ?? 1)
  if (repeats <= 1) return true
  return repetitionStrideMs(block, bpm) >= requiredSpeechMs(block.tokens, opts)
}

/**
 * The voice policy for a block, resolving the authored value first.
 *
 * Returns `undefined` when nothing needs to be imposed — the caller keeps
 * whatever default it already applies. Only a repeating block that cannot
 * be spoken every rep is forced to `announce-then-work`.
 *
 * This is the seam a future per-condition matrix replaces.
 */
export function resolveVoicePolicy(
  block: WorkoutBlock,
  bpm: number,
  opts: SpeakableEnvelopeOptions = {},
): VoicePolicy | undefined {
  // Hand-authored intent always wins — including a deliberate choice to
  // call every rep of a fast block.
  if (block.voicePolicy !== undefined) return block.voicePolicy
  if (fitsSpeakableEnvelope(block, bpm, opts)) return undefined
  return 'announce-then-work'
}
