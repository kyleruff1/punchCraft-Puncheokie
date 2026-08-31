/**
 * Compact worklet-safe mirror of the metronome transport (M39-V2
 * Phase W0-b-i, Kyle amended plan 2026-08-30, principles #3 + #5).
 *
 * ## Why a mirror instead of calling the transport directly
 *
 * `useFrameCallback` from `react-native-reanimated` runs on the UI
 * thread and is automatically workletized. A worklet cannot safely
 * call an ordinary JavaScript class such as
 * `MetronomeTransport.snapshot()` — worklets execute in a separate
 * JS runtime with only worklet-safe values shared across the
 * boundary. Reading the transport's live state from a frame
 * callback therefore has to go through a Reanimated shared value.
 *
 * The `SharedTransportAnchor` is that shared value's SHAPE — a
 * small struct of plain primitives (numbers + booleans) that the
 * JS thread publishes atomically whenever the transport's state
 * changes (start / stop / pause / resume / generation bump). The
 * frame callback then does pure arithmetic against the anchor:
 *
 *   tick = anchorTick +
 *          (frame.timestamp - anchorFrameTimestampMs) *
 *          ticksPerMillisecond
 *
 * No class calls; no cross-runtime state; no per-frame allocation.
 *
 * ## Clock domain
 *
 * `anchorFrameTimestampMs` and the `frameTimestampMs` fed to
 * `sharedAnchorCurrentTick` MUST live in the same clock domain.
 * The publisher decides what that domain is (typically the same
 * one Reanimated's `useFrameCallback` frameInfo carries). The
 * consumer (worklet) just does arithmetic and does not care about
 * absolute epochs. Reconciling native monotonic vs Reanimated
 * frame timestamp is the publisher's job (W0-b-ii concern).
 *
 * ## Atomic updates
 *
 * Reanimated shared values guarantee atomicity per assignment. To
 * update the anchor, the publisher assigns a NEW frozen struct in
 * one call — never a field-by-field mutation. Field-wise updates
 * would let the worklet observe a torn state where, say, `running`
 * flipped to true but `ticksPerMillisecond` hadn't been updated
 * yet.
 *
 * ## Not owned here
 *
 * - The Reanimated shared value itself. This module is pure
 *   TypeScript with no `react-native-reanimated` import. Tests
 *   run in plain node. The publisher module (W0-b-ii) wraps
 *   `useSharedValue<SharedTransportAnchor>` and drives updates
 *   from transport state changes.
 * - The frame callback consumer. That's a React hook that reads
 *   the shared value inside `useFrameCallback` and derives the
 *   visual tick per frame. Also W0-b-ii.
 */

import type { MetronomeTransportSnapshot } from '@/domain/coach/VoiceOutputPort'
import { TRANSPORT_TICKS_PER_PULSE } from '@/domain/timing/TimingEngine'

/**
 * The worklet-safe shape. Plain primitives only — no getters, no
 * class methods, no shared mutable references. Reanimated will
 * serialize this across the JS/UI runtime boundary.
 *
 * Every field is required and non-null so the worklet can do
 * arithmetic without branching on undefined. The initial value
 * `SHARED_ANCHOR_STOPPED` fills in sensible defaults before any
 * transport has started.
 */
export interface SharedTransportAnchor {
  /**
   * Monotonically increasing counter — bumps on every publisher
   * update that represents a NEW transport generation (i.e., on
   * `transport.start()`). Consumers can cache the generation they
   * last armed against and re-arm when it bumps.
   */
  generation: number
  /** Absolute unwrapped tick at the anchor moment. Zero when stopped. */
  anchorTick: number
  /**
   * Publisher-domain timestamp at which the anchor was sampled.
   * The consumer's frameTimestamp MUST come from the same domain;
   * the arithmetic is only meaningful when both share an epoch.
   */
  anchorFrameTimestampMs: number
  /**
   * `baseBpm * TRANSPORT_TICKS_PER_PULSE / 60000`. Zero when
   * stopped. Kept as ticks-per-MS (not ticks-per-second) so the
   * worklet's `(now - anchor)` in ms multiplies cleanly.
   */
  ticksPerMillisecond: number
  /** `true` only when the transport is `running` — interpolation is otherwise frozen. */
  running: boolean
}

/**
 * Baseline before any transport starts. Publisher's initial value
 * for `useSharedValue<SharedTransportAnchor>(SHARED_ANCHOR_STOPPED)`.
 * Reading currentTick from this yields 0 regardless of
 * frameTimestamp — matches the transport's own stopped semantics.
 */
export const SHARED_ANCHOR_STOPPED: SharedTransportAnchor = Object.freeze({
  generation: 0,
  anchorTick: 0,
  anchorFrameTimestampMs: 0,
  ticksPerMillisecond: 0,
  running: false,
})

/**
 * The arithmetic worklet. Kept as a plain TypeScript function so
 * it runs in unit tests without a Reanimated runtime. When called
 * from a real worklet, the caller must be inside a `worklet`
 * scope — the "worklet" directive lives at the CALL SITE, not on
 * this helper.
 *
 * Behavior:
 *   - `running` false → returns `anchor.anchorTick` regardless of
 *     `frameTimestampMs` (frozen tick during stopped / paused).
 *   - `running` true  → interpolates linearly:
 *       `anchorTick + (frameTimestampMs - anchorFrameTimestampMs)
 *        * ticksPerMillisecond`.
 *
 * The result is a positive fraction — callers that want an
 * integer tick should `Math.floor` or `Math.round` at the use
 * site, not inside this arithmetic (rounding here would drop
 * sub-tick precision that the score dispatcher's fit-check
 * depends on).
 */
export function sharedAnchorCurrentTick(
  anchor: SharedTransportAnchor,
  frameTimestampMs: number,
): number {
  'worklet'
  if (!anchor.running) return anchor.anchorTick
  const elapsedMs = frameTimestampMs - anchor.anchorFrameTimestampMs
  return anchor.anchorTick + elapsedMs * anchor.ticksPerMillisecond
}

/**
 * Convert a `MetronomeTransportSnapshot` (JS-side) to a
 * `SharedTransportAnchor` (worklet-side) at a given publisher-
 * domain frame timestamp. The publisher calls this on every
 * transport state change and assigns the result to the shared
 * value in one atomic step.
 *
 * `frameTimestampMs` is the publisher's choice of anchor moment
 * — usually the current Reanimated frame timestamp. It replaces
 * the snapshot's `sampledAtMonotonicMs` because the two clock
 * domains may differ (see the module header on domain
 * reconciliation).
 */
export function sharedAnchorFromSnapshot(
  snapshot: MetronomeTransportSnapshot,
  frameTimestampMs: number,
): SharedTransportAnchor {
  return {
    generation: snapshot.generation,
    anchorTick: snapshot.absoluteTick,
    anchorFrameTimestampMs: frameTimestampMs,
    ticksPerMillisecond: snapshot.ticksPerSecond / 1000,
    running: snapshot.state === 'running',
  }
}

/**
 * Convenience — the ticks-per-MS a BPM would produce. Exposed so
 * publisher tests can assert exact expected values without
 * re-deriving from `TRANSPORT_TICKS_PER_PULSE / 60000`.
 */
export function ticksPerMillisecondFor(baseBpm: number): number {
  if (!Number.isFinite(baseBpm) || baseBpm <= 0) return 0
  return (baseBpm * TRANSPORT_TICKS_PER_PULSE) / 60_000
}
