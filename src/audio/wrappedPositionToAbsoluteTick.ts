/**
 * Translate a metronome playlist's WRAPPED position update into the
 * absolute unwrapped transport tick the observation corresponds to
 * (M39-V2 Phase W0-c-ii, Kyle amended plan 2026-08-30).
 *
 * `AudioPlaylistStatus.currentTime` reports playback position within
 * the current track (0..loopDuration, wraps on each loop). Publishing
 * a wrapped position would force every consumer to reconstruct the
 * absolute tick from `(loopCount, currentTime)` pairs — the transport
 * (see `MetronomeTransport`) does that reconstruction ONCE and
 * publishes an unwrapped absolute tick. This module is that
 * reconstruction: given a wrapped status callback and a
 * `startMonotonicMs` reference, it returns the observed absolute
 * tick to feed into `MetronomeTransport.correct`.
 *
 * ## Loop-count inference
 *
 * The wrapped position alone is ambiguous — `currentTime = 0.7s`
 * could mean loop 0 near its end, loop 3 near its end, loop 42
 * near its end. To disambiguate, we use JS-side monotonic time as
 * a coarse anchor:
 *
 *   1. Compute `nominalLoopsTotal = elapsedMs / loopDurationMs`
 *      — JS's expected total loops (fractional).
 *   2. Compute `bestIntegerLoops = round(nominalLoopsTotal -
 *      wrappedFraction)` where `wrappedFraction = wrappedPositionSec
 *      / loopDurationSec`. This picks the integer loop count that
 *      leaves the smallest residual between JS's expected total and
 *      the audio-reported partial.
 *   3. Absolute position ms = `bestIntegerLoops * loopDurationMs +
 *      wrappedPositionSec * 1000`.
 *
 * The inference is CORRECT as long as JS↔audio skew is smaller than
 * half a loop duration (500 ms for a 1 s metronome loop). Larger
 * skews would pick the wrong integer loop, adding ~loopDuration of
 * error to the observation — which then trips `transport.correct`'s
 * large-error re-anchor branch. That's safe: the re-anchor bumps
 * the generation and the next observation aligns cleanly. Over
 * time the system converges even under transient skew.
 *
 * Pure TypeScript — no clocks, no audio libs, no state. All
 * inputs supplied by the caller.
 */

export interface MetronomePositionSample {
  /** Wrapped playback position from `AudioPlaylistStatus.currentTime`, in seconds. */
  wrappedPositionSec: number
  /** Loop length in seconds (from `AudioPlaylistStatus.duration` or the loop asset). */
  loopDurationSec: number
  /** MonotonicClock timestamp when the status was sampled. */
  sampleMonotonicMs: number
}

/**
 * Reconstruct the absolute unwrapped tick from a wrapped playlist
 * status sample. `startMonotonicMs` is the monotonic timestamp at
 * which the metronome loop started (transport's anchor moment);
 * `ticksPerSecond` is the transport's rate (960 at 60 BPM).
 *
 * Returns 0 when `loopDurationSec` is non-positive (defensive —
 * an unloaded / half-torn playlist can report 0-duration status
 * before the actual asset finishes loading; that observation is
 * meaningless).
 */
export function wrappedPositionToAbsoluteTick(
  sample: MetronomePositionSample,
  startMonotonicMs: number,
  ticksPerSecond: number,
): number {
  const { wrappedPositionSec, loopDurationSec, sampleMonotonicMs } = sample
  if (!Number.isFinite(loopDurationSec) || loopDurationSec <= 0) return 0
  if (!Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) return 0
  const loopDurationMs = loopDurationSec * 1_000
  const elapsedMs = sampleMonotonicMs - startMonotonicMs
  // Below-zero elapsed: audio callback fired before the anchor —
  // treat as loop 0 partial position.
  const safeElapsed = Math.max(0, elapsedMs)
  const nominalLoopsTotal = safeElapsed / loopDurationMs
  const wrappedFraction = wrappedPositionSec / loopDurationSec
  const bestIntegerLoops = Math.max(0, Math.round(nominalLoopsTotal - wrappedFraction))
  const absolutePositionSec = bestIntegerLoops * loopDurationSec + wrappedPositionSec
  return absolutePositionSec * ticksPerSecond
}
