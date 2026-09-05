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
  pump: boolean = false,
): AvatarStep {
  'worklet'
  // Mirror of `avatarFrameAt` — STRIKE-FIRST with guard on all sides
  // (2026-09-02): strike(step1) on the beat, a flip-frame of
  // retract(step2), then the universal guard. With `pump` (a repeated
  // same punch, Kyle 2026-09-04) the cycle LEADS with one flip-frame of
  // retract so a pumping jab visibly re-throws. Frame names are
  // legacy-inverted (see punchAvatar.ts).
  void isLast
  const t = Math.max(0, elapsedMs)
  const flip = flipFrameMsWorklet(windowMs)
  const lead = pump ? flip : 0
  if (t < lead) return 'step2'
  const strikeEnd = Math.max(lead + MIN_FRAME_MS, windowMs - flip)
  if (t < strikeEnd) return 'step1'
  if (t < strikeEnd + flip) return 'step2'
  return 'guard'
}

/** Params driving one adopted-punch flip cycle. Null while no punch is shown. */
export interface AvatarClockShown {
  /** Stable id — used by the effect to detect adoption changes. */
  key: string
  windowMs: number
  isLast: boolean
  /** Repeated-same-punch adoption: lead the cycle with a retract (pump). */
  pump: boolean
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
  /**
   * UI-THREAD paint channel (Phase 5-i, Kyle on-glass 2026-09-04: strike
   * frames were being swallowed — the runOnJS→setState→re-render hop
   * starved under load and 90ms strikes never painted). When provided,
   * the worklet writes the frame INDEX here (0=step1, 1=step2, 2=guard)
   * and never calls runOnJS at all — the card's layers read it via
   * animated opacity. `owns` flips true while this worklet is the
   * authoritative driver (anchor running + a punch shown), so the card
   * knows when to defer its React-state fallback.
   */
  stepShared?: SharedValue<number>,
  owns?: SharedValue<boolean>,
): void {
  // The shared values below let the worklet read authored params
  // without capturing the React closure — cross-runtime safe.
  const startedAtTick = useSharedValue(0)
  const windowMs = useSharedValue(0)
  const isLast = useSharedValue(false)
  const pump = useSharedValue(false)
  const active = useSharedValue(false)
  const lastStep = useSharedValue<AvatarStep>('step1')
  const shownKey = shown?.key ?? null

  useEffect(() => {
    if (!shown || !anchor) {
      active.value = false
      if (owns) owns.value = false
      if (stepShared) stepShared.value = 2 // park the paint channel on guard
      return
    }
    // Sample the transport's tick at the adoption moment in the
    // publisher's frame-timestamp domain. The publisher's anchor
    // uses the same `nowFrameTimestampMs`, so subtraction inside
    // the worklet stays in that domain.
    startedAtTick.value = sharedAnchorCurrentTick(anchor.value, nowFrameTimestampMs())
    windowMs.value = shown.windowMs
    isLast.value = shown.isLast
    pump.value = shown.pump
    // Strike-first: the card's adoption already painted step1 (step2 for a
    // pump's retract lead), so the worklet's first emission is the next
    // flip, not a redundant repaint.
    lastStep.value = shown.pump ? 'step2' : 'step1'
    // PRIME the paint channel with the adoption pose (Kyle on-glass
    // 2026-09-04, "avatar wasn't moving much"): the worklet writes only on
    // CHANGE, so without this the strike phase — the very state adoption
    // starts in — never reached the screen and the card sat on guard.
    if (stepShared) stepShared.value = shown.pump ? 1 : 0
    if (owns) owns.value = true
    active.value = true
    // Deps are the PRIMITIVES, deliberately not `shown` (GH #305): this
    // effect re-samples `startedAtTick` and resets the cycle to step1, so
    // depending on an object identity meant every caller re-render
    // re-zeroed the flip phase — several times a second under the live
    // screen's store churn. A new adoption is a new `shownKey`; a
    // re-render is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, shown?.windowMs, shown?.isLast, shown?.pump, anchor, active, startedAtTick, windowMs, isLast, pump, lastStep, nowFrameTimestampMs])

  const cb = useFrameCallback(({ timestamp }) => {
    'worklet'
    if (!active.value || !anchor) {
      if (owns) owns.value = false
      return
    }
    const ticksPerMs = anchor.value.ticksPerMillisecond
    if (ticksPerMs <= 0) {
      // Transport stopped → freeze at last frame; hand the paint back to
      // the card's React fallback.
      if (owns) owns.value = false
      return
    }
    if (owns) owns.value = true
    const elapsedTicks = sharedAnchorCurrentTick(anchor.value, timestamp) - startedAtTick.value
    const elapsedMs = elapsedTicks / ticksPerMs
    // RAW elapsed, never wrapped (stillness rule, 2026-09-02): once the
    // cycle settles to guard the callback goes quiescent until the next
    // adoption resamples `startedAtTick`. The old modulo wrap re-threw
    // the same punch every beat through rest slots and pauses.
    const step = avatarFrameAtWorklet(elapsedMs, windowMs.value, isLast.value, pump.value)
    if (step !== lastStep.value) {
      lastStep.value = step
      if (stepShared) {
        // UI-thread paint (Phase 5-i, 2026-09-04): write the frame index
        // directly — no runOnJS hop, so a 90ms strike can never be
        // coalesced away by a busy JS thread ("the avatar does nothing
        // except squat and stand up").
        stepShared.value = step === 'step1' ? 0 : step === 'step2' ? 1 : 2
      } else {
        runOnJS(setStep)(step)
      }
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
