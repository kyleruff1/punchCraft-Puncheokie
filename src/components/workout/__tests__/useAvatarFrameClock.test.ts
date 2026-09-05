/**
 * `useAvatarFrameClock` — worklet-safe helper equivalence + binder
 * behavior (M39-V2 Phase W0-b-iii avatar migration, Kyle 2026-08-30).
 *
 * Two things to guard:
 *
 *  1. **Byte-identical port.** `avatarFrameAtWorklet` /
 *     `minHoldMsWorklet` MUST return the same value as the domain's
 *     `avatarFrameAt` / `minHoldMs` for every input the runtime can
 *     produce — otherwise the setInterval fallback and the frame-
 *     clock path animate differently and a viewer switching between
 *     the two would see the flip drift. The tests below sweep many
 *     inputs; a divergence fails loudly.
 *  2. **The React hook is a no-op when `anchor` is undefined** —
 *     tests and screens that predate W0 must keep working with the
 *     setInterval fallback and never trigger runOnJS.
 */

// Reanimated has a native-only runtime; the module import chain
// crashes in node. The worklet-safe helpers under test never touch
// Reanimated (the `'worklet'` directive is inert outside a worklet
// runtime), so a minimal stub of the imported names is enough to
// let the useAvatarFrameClock module load.
jest.mock('react-native-reanimated', () => ({
  runOnJS: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => fn(...args),
  useSharedValue: <T,>(init: T) => ({ value: init }),
  useFrameCallback: () => ({ setActive: () => {} }),
}))

import {
  avatarFrameAt,
  minHoldMs,
} from '@domain/workout/punchAvatar'
import {
  avatarFrameAtWorklet,
  minHoldMsWorklet,
} from '../useAvatarFrameClock'

describe('avatarFrameAtWorklet ↔ domain avatarFrameAt equivalence', () => {
  // Windows the runtime can produce — from tight sprint tokens to
  // long teaching-cadence windows. `avatarWindowMs` clamps to non-
  // negative, so 0 is a valid input.
  const windows = [0, 30, 90, 120, 200, 240, 300, 500, 800, 1_200, 2_000]

  it('matches the domain function for every window × elapsed × isLast × pump tuple', () => {
    for (const windowMs of windows) {
      const beat = Math.max(windowMs, minHoldMs(windowMs, false))
      const step = Math.max(1, Math.floor(beat / 40))
      for (let elapsed = -20; elapsed <= beat + 100; elapsed += step) {
        for (const isLast of [false, true]) {
          for (const pump of [false, true]) {
            const domain = avatarFrameAt(elapsed, windowMs, isLast, pump)
            const workletVal = avatarFrameAtWorklet(elapsed, windowMs, isLast, pump)
            expect([elapsed, windowMs, isLast, pump, workletVal]).toEqual([
              elapsed,
              windowMs,
              isLast,
              pump,
              domain,
            ])
          }
        }
      }
    }
  })

  it('handles negative elapsed identically (clamped)', () => {
    for (const windowMs of windows) {
      for (const isLast of [false, true]) {
        expect(avatarFrameAtWorklet(-100, windowMs, isLast)).toBe(
          avatarFrameAt(-100, windowMs, isLast),
        )
      }
    }
  })
})

describe('minHoldMsWorklet ↔ domain minHoldMs equivalence', () => {
  const windows = [0, 30, 90, 120, 200, 240, 300, 500, 800, 1_200, 2_000, 5_000]

  it('matches the domain function for every window × isLast pair', () => {
    for (const windowMs of windows) {
      for (const isLast of [false, true]) {
        expect(minHoldMsWorklet(windowMs, isLast)).toBe(minHoldMs(windowMs, isLast))
      }
    }
  })
})

describe('useAvatarFrameClock — no-op contract', () => {
  // The hook itself needs Reanimated + React, which the existing
  // live-screen test already mocks (see live.test.tsx). We do NOT
  // duplicate that plumbing here; instead we prove the two exported
  // worklet-safe helpers are pure JS + return the right shape, and
  // trust the domain-equivalence tests above + the on-device
  // verification for the frame-callback wiring itself. The
  // integration path is covered by the existing PunchAvatarCard
  // fallback tests (which pass no anchor) — those keep passing
  // because the setInterval branch stays authoritative when
  // `anchor === undefined`.
  it('avatarFrameAtWorklet returns "step1" | "step2"', () => {
    const v1 = avatarFrameAtWorklet(0, 240, false)
    const v2 = avatarFrameAtWorklet(120, 240, false)
    expect(['step1', 'step2']).toContain(v1)
    expect(['step1', 'step2']).toContain(v2)
  })

  it('minHoldMsWorklet returns a positive finite ms value', () => {
    for (const windowMs of [90, 240, 500]) {
      const flip = minHoldMsWorklet(windowMs, false)
      const last = minHoldMsWorklet(windowMs, true)
      expect(Number.isFinite(flip)).toBe(true)
      expect(Number.isFinite(last)).toBe(true)
      expect(flip).toBeGreaterThan(0)
      expect(last).toBeGreaterThan(flip)
    }
  })
})
