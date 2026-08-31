/**
 * Reanimated-backed publisher for `SharedTransportAnchor` (M39-V2
 * Phase W0-b-ii, Kyle amended plan 2026-08-30).
 *
 * Subscribes to a `MetronomeTransportPort` and mirrors its
 * snapshot into a Reanimated shared value in atomic whole-struct
 * updates. Frame-callback consumers (rings, avatar, matcher) read
 * the shared value inside a worklet and derive the visual tick
 * via `sharedAnchorCurrentTick` — no cross-runtime state, no
 * per-frame allocation, no class calls in worklet scope
 * (principle #4 of the amended plan).
 *
 * ## Two callables
 *
 * `bindSharedTransportAnchor(sharedValue, transport, ...)` is a
 * pure JS helper — no React, testable without Reanimated. Given
 * any object with a `.value: SharedTransportAnchor` shape, it
 * subscribes to the transport, publishes on every transition,
 * and returns an unsubscribe function. This is what the tests
 * exercise.
 *
 * `useSharedTransportAnchor(transport, ...)` is a thin React
 * wrapper: it creates the shared value via `useSharedValue`,
 * calls `bindSharedTransportAnchor` inside `useEffect`, and
 * returns the shared value for `useFrameCallback` consumers to
 * read.
 *
 * ## Publisher frame-timestamp domain
 *
 * `anchorFrameTimestampMs` on the published struct MUST live in
 * the same clock domain as the frame timestamps the consumer's
 * `useFrameCallback` will receive. This helper takes a
 * `nowFrameTimestampMs()` callback whose default is
 * `performance.now()` — matching Reanimated's default frame
 * timestamp on both platforms (iOS uses `mach_absolute_time`,
 * Android uses `System.nanoTime`; both are exposed to JS as
 * `performance.now()` in the same monotonic domain). A future
 * calibration step (W0-b-iii) can inject a corrected `now` if
 * measurement proves a systematic offset.
 *
 * ## Initial publish on bind
 *
 * `bindSharedTransportAnchor` publishes ONCE immediately on bind
 * so a consumer that mounts after the transport has already
 * started still sees the current state. The transport's own
 * `subscribe` contract skips the initial state (publish-on-
 * change), so this initial write is the publisher's
 * responsibility.
 */

import { useEffect, useRef } from 'react'
import { useSharedValue, type SharedValue } from 'react-native-reanimated'

import type {
  MetronomeTransportPort,
  MetronomeTransportSnapshot,
} from '@/domain/coach/VoiceOutputPort'
import {
  SHARED_ANCHOR_STOPPED,
  type SharedTransportAnchor,
  sharedAnchorFromSnapshot,
} from '@/domain/timing/SharedTransportAnchor'

/**
 * A minimal shape matching Reanimated's `SharedValue<T>` — just
 * the mutable `.value` slot. Extracted so the helper can be
 * tested against a plain `{ value: SharedTransportAnchor }`
 * object without importing Reanimated in unit tests.
 */
export interface AnchorSlot {
  value: SharedTransportAnchor
}

/**
 * Pure helper — subscribes and publishes. Test with a plain slot.
 *
 * `transport` is nullable so the React hook can call this
 * unconditionally when the caller may not yet have a transport
 * (screens loaded before `VoiceOutputExpo` exposes its
 * metronome port). Null / undefined = no-op, slot stays at its
 * current value (typically `SHARED_ANCHOR_STOPPED`).
 */
export function bindSharedTransportAnchor(
  slot: AnchorSlot,
  transport: MetronomeTransportPort | null | undefined,
  nowFrameTimestampMs: () => number = defaultNow,
): () => void {
  if (!transport) return () => {}
  // Initial publish covers the case where the consumer mounted
  // AFTER the transport started. Transport's own subscribe
  // contract skips the initial state.
  slot.value = sharedAnchorFromSnapshot(transport.snapshot(), nowFrameTimestampMs())
  const unsubscribe = transport.subscribe((snapshot: MetronomeTransportSnapshot) => {
    // Atomic whole-struct assignment — Reanimated propagates the
    // new struct to the UI runtime as one indivisible write. A
    // field-by-field mutation would let the worklet observe a
    // torn state (e.g., `running` flipped true but the new
    // `ticksPerMillisecond` not yet visible).
    slot.value = sharedAnchorFromSnapshot(snapshot, nowFrameTimestampMs())
  })
  return unsubscribe
}

function defaultNow(): number {
  // Reanimated's `useFrameCallback` frame timestamp on both iOS
  // and Android maps to the same monotonic domain as
  // `performance.now()`. Falls back to `Date.now()` when
  // `performance` is unavailable (Node without perf polyfill).
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/**
 * React hook. Wire this once per workout screen; pass the
 * returned `SharedValue<SharedTransportAnchor>` down to any
 * `useFrameCallback` consumer that derives visual state from
 * the transport tick.
 *
 * `transport` is nullable to satisfy the rules-of-hooks in
 * callers whose port may not have exposed a metronome yet.
 * When null / undefined, the shared value stays at
 * `SHARED_ANCHOR_STOPPED` and consumers read tick 0 forever.
 */
export function useSharedTransportAnchor(
  transport: MetronomeTransportPort | null | undefined,
  nowFrameTimestampMs: () => number = defaultNow,
): SharedValue<SharedTransportAnchor> {
  const shared = useSharedValue<SharedTransportAnchor>(SHARED_ANCHOR_STOPPED)
  // Keep the callback fresh across re-renders without re-binding
  // the subscription on every render. Only the initial call in
  // useEffect uses this ref — no reactive dependency issues.
  const nowRef = useRef(nowFrameTimestampMs)
  nowRef.current = nowFrameTimestampMs
  useEffect(
    () =>
      bindSharedTransportAnchor(
        shared as unknown as AnchorSlot,
        transport,
        () => nowRef.current(),
      ),
    [shared, transport],
  )
  return shared
}
