/**
 * Frame-clock driver for `PunchAvatarCard` (M39-V2 Phase W0-b-iii
 * avatar migration, Kyle amended plan 2026-08-30).
 *
 * Replaces the card's 30 ms JS `setInterval` with a Reanimated
 * `useFrameCallback` worklet that reads the shared
 * `MetronomeTransport` anchor and derives the current avatar
 * frame per UI-thread frame. Two consequences:
 *
 *  1. **Avatar aligns to the transport.** A workout pause freezes
 *     the transport → tick freezes → avatar frame freezes. Under
 *     the old JS-timer path the avatar kept flipping through the
 *     last punch's frames while the workout was paused, which was
 *     wrong on a pause (nothing else was moving).
 *  2. **No per-frame React re-render.** The frame callback runs
 *     on every UI frame, but only calls `runOnJS(setStep)` when
 *     the computed frame differs from what's been pushed. The
 *     card re-renders exactly on the flip — same cadence as the
 *     old level-triggered setInterval.
 *
 * ## Worklet-safe helpers
 *
 * `avatarFrameAt` / `minHoldMs` / `flipFrameMs` / `avatarResetAtMs`
 * live in `@domain/workout/punchAvatar` without a `'worklet'`
 * directive (domain code stays free of Reanimated concerns). The
 * `avatarFrameAtWorklet` here is a byte-identical reimplementation
 * of that arithmetic, marked as a worklet so it runs on the UI
 * thread. A jest test in `useAvatarFrameClock.test.ts` pins the
 * two implementations to the same output for a wide range of
 * inputs — if they diverge the test fails, and the reader can
 * fix either side.
 *
 * ## Fallback when no anchor
 *
 * The hook is a no-op when `anchor` is undefined. The card's
 * existing `setInterval` path stays in place and gates on
 * `!anchor` so both paths never fire together. This means tests
 * (which don't pass an anchor) keep working unchanged, and any
 * screen that mounts the card without a shared transport still
 * gets the wall-clock-driven flip.
 */

import { useEffect } from 'react'
import {
  runOnJS,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'

import type { AvatarStep } from '@domain/workout/punchAvatar'
import {
  sharedAnchorCurrentTick,
  type SharedTransportAnchor,
} from '@domain/timing/SharedTransportAnchor'

/** Copied constants from `@domain/workout/punchAvatar`. Kept in sync by test. */
const MIN_FRAME_MS = 90
const MAX_FRAME_MS = 220
const RESET_MS = 130

/**
 * Worklet-safe port of `flipFrameMs` from
 * `@domain/workout/punchAvatar`. Byte-identical output for every
 * finite input.
 */
function flipFrameMsWorklet(windowMs: number): number {
  'worklet'
  const quarter = Math.max(0, windowMs) * 0.25
  return Math.max(MIN_FRAME_MS, Math.min(MAX_FRAME_MS, quarter))
}

/** Worklet-safe port of `avatarResetAtMs`. */
function avatarResetAtMsWorklet(windowMs: number): number {
  'worklet'
  const frame = flipFrameMsWorklet(windowMs)
  return Math.max(frame * 2, windowMs - RESET_MS)
}

/** Worklet-safe port of `minHoldMs`. */
export function minHoldMsWorklet(windowMs: number, isLast: boolean): number {
  'worklet'
  return flipFrameMsWorklet(windowMs) * (isLast ? 3 : 2)
}

/** Worklet-safe port of `avatarFrameAt`. */
export function avatarFrameAtWorklet(
  elapsedMs: number,
  windowMs: number,
  isLast: boolean,
): AvatarStep {
  'worklet'
  // Mirror of `avatarFrameAt` — one flip per node, guard(step2) then
  // strike(step1); frame names are legacy-inverted (see punchAvatar.ts).
  void isLast
  const t = Math.max(0, elapsedMs)
  return t < flipFrameMsWorklet(windowMs) ? 'step2' : 'step1'
}

/** Params driving one adopted-punch flip cycle. Null while no punch is shown. */
export interface AvatarClockShown {
  /** Stable id — used by the effect to detect adoption changes. */
  key: string
  windowMs: number
  isLast: boolean
}

/**
 * Wire the card's flip to the shared transport anchor.
 *
 * Behavior:
 *   - When `shown === null` or `anchor === undefined`, the hook
 *     is a no-op (the caller's fallback owns the flip).
 *   - On every adoption (new `shown.key`), records
 *     `startedAtTick = sharedAnchorCurrentTick(anchor.value,
 *     performance.now())` so subsequent frame samples measure
 *     elapsed against the transport.
 *   - Each UI frame, the worklet computes the current frame and
 *     calls `runOnJS(setStep)` only when it changes. `reducedMotion`
 *     freezes the callback via `.setActive(false)`.
 *
 * The `nowFrameTimestampMs` seam mirrors the publisher's — same
 * default (`performance.now`), same reconciled clock domain.
 */
export function useAvatarFrameClock(
  shown: AvatarClockShown | null,
  reducedMotion: boolean,
  anchor: SharedValue<SharedTransportAnchor> | undefined,
  setStep: (step: AvatarStep) => void,
  nowFrameTimestampMs: () => number = defaultNow,
): void {
  // The shared values below let the worklet read authored params
  // without capturing the React closure — cross-runtime safe.
  const startedAtTick = useSharedValue(0)
  const windowMs = useSharedValue(0)
  const isLast = useSharedValue(false)
  const active = useSharedValue(false)
  const lastStep = useSharedValue<AvatarStep>('step1')
  const shownKey = shown?.key ?? null

  useEffect(() => {
    if (!shown || !anchor) {
      active.value = false
      return
    }
    // Sample the transport's tick at the adoption moment in the
    // publisher's frame-timestamp domain. The publisher's anchor
    // uses the same `nowFrameTimestampMs`, so subtraction inside
    // the worklet stays in that domain.
    startedAtTick.value = sharedAnchorCurrentTick(anchor.value, nowFrameTimestampMs())
    windowMs.value = shown.windowMs
    isLast.value = shown.isLast
    lastStep.value = 'step2'
    active.value = true
    // Deps are the PRIMITIVES, deliberately not `shown` (GH #305): this
    // effect re-samples `startedAtTick` and resets the cycle to step1, so
    // depending on an object identity meant every caller re-render
    // re-zeroed the flip phase — several times a second under the live
    // screen's store churn. A new adoption is a new `shownKey`; a
    // re-render is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, shown?.windowMs, shown?.isLast, anchor, active, startedAtTick, windowMs, isLast, lastStep, nowFrameTimestampMs])

  const cb = useFrameCallback(({ timestamp }) => {
    'worklet'
    if (!active.value || !anchor) return
    const ticksPerMs = anchor.value.ticksPerMillisecond
    if (ticksPerMs <= 0) return // transport stopped → freeze at last frame
    const elapsedTicks = sharedAnchorCurrentTick(anchor.value, timestamp) - startedAtTick.value
    const elapsedMs = elapsedTicks / ticksPerMs
    const beat = Math.max(windowMs.value, minHoldMsWorklet(windowMs.value, isLast.value))
    if (beat <= 0) return
    const wrapped = ((elapsedMs % beat) + beat) % beat
    const step = avatarFrameAtWorklet(wrapped, windowMs.value, isLast.value)
    if (step !== lastStep.value) {
      lastStep.value = step
      runOnJS(setStep)(step)
    }
  })

  useEffect(() => {
    cb.setActive(!reducedMotion && !!anchor && shownKey !== null)
    // `shownKey`, not `shown`: presence is what matters, and the object's
    // identity churns per render (see the adoption effect above).
  }, [cb, reducedMotion, anchor, shownKey])
}

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}
