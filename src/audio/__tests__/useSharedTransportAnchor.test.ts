/**
 * `bindSharedTransportAnchor` — the pure-JS helper behind the
 * React hook (M39-V2 Phase W0-b-ii, Kyle amended plan 2026-08-30).
 *
 * Verifies the publisher contract:
 *
 *   - Publishes the transport's CURRENT state on bind (covers a
 *     late-mounting consumer).
 *   - Publishes on every subsequent state transition
 *     (start / stop / pause / resume).
 *   - Every write is an ATOMIC whole-struct assignment (the slot's
 *     `.value` is replaced, never mutated in-place). A worklet
 *     reading the slot never observes a torn state (e.g., `running`
 *     flipped true but `ticksPerMillisecond` still zero).
 *   - Uses the publisher-supplied `nowFrameTimestampMs` for the
 *     anchor moment, NOT the snapshot's `sampledAtMonotonicMs`
 *     (the two clock domains may differ; the frame domain is what
 *     the consumer's `useFrameCallback` reads against).
 *   - Unsubscribe stops further publishes.
 */

// Reanimated has a native-only runtime and requires a native proxy
// jest can't load. The hook module imports `useSharedValue` from it,
// so the import path must resolve to something. The pure JS helper
// under test never touches Reanimated — only the `useSharedTransportAnchor`
// React hook does — so a minimal stub is enough for these tests.
jest.mock('react-native-reanimated', () => ({
  useSharedValue: <T,>(init: T) => ({ value: init }),
}))

import { MetronomeTransport } from '../MetronomeTransport'
import {
  bindSharedTransportAnchor,
  type AnchorSlot,
} from '../useSharedTransportAnchor'
import {
  SHARED_ANCHOR_STOPPED,
  type SharedTransportAnchor,
} from '@/domain/timing/SharedTransportAnchor'
import { createFakeClock } from '@testing/fakeClock'

function makeSlot(): AnchorSlot {
  return { value: SHARED_ANCHOR_STOPPED }
}

describe('bindSharedTransportAnchor', () => {
  it('publishes the transport current state on bind (late mount)', () => {
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    t.start(60)
    const slot = makeSlot()
    let now = 5_000

    bindSharedTransportAnchor(slot, t, () => now)

    expect(slot.value.running).toBe(true)
    expect(slot.value.generation).toBe(1)
    expect(slot.value.anchorFrameTimestampMs).toBe(5_000)
    expect(slot.value.ticksPerMillisecond).toBeCloseTo(0.96, 5) // 60 BPM
  })

  it('publishes on start / pause / resume / stop after bind', () => {
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    const slot = makeSlot()
    let now = 1_000

    bindSharedTransportAnchor(slot, t, () => now)
    // Initial publish (stopped) already happened.
    expect(slot.value.running).toBe(false)

    now = 2_000
    t.start(60)
    expect(slot.value.running).toBe(true)
    expect(slot.value.generation).toBe(1)
    expect(slot.value.anchorFrameTimestampMs).toBe(2_000)

    now = 2_500
    clock.advance(500)
    t.pause()
    expect(slot.value.running).toBe(false)
    expect(slot.value.generation).toBe(1) // pause does not bump generation
    expect(slot.value.anchorFrameTimestampMs).toBe(2_500)

    now = 3_000
    t.resume()
    expect(slot.value.running).toBe(true)

    now = 3_500
    t.stop()
    expect(slot.value.running).toBe(false)
    expect(slot.value.anchorTick).toBe(0)
  })

  it('every publish is an atomic whole-struct assignment (never in-place mutation)', () => {
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    const slot = makeSlot()
    let now = 1_000

    bindSharedTransportAnchor(slot, t, () => now)
    const afterBind = slot.value
    now = 2_000
    t.start(60)
    const afterStart = slot.value

    // Different object identity → atomic swap, not mutation.
    expect(afterStart).not.toBe(afterBind)
    // afterBind must not have been mutated in place — a stale
    // reference must still show the OLD values.
    expect(afterBind.running).toBe(false)
    expect(afterBind.generation).toBe(0)
    expect(afterBind.ticksPerMillisecond).toBe(0)
  })

  it('uses the publisher-supplied nowFrameTimestampMs, not snapshot.sampledAtMonotonicMs', () => {
    // The two clock domains (native monotonic vs Reanimated frame
    // timestamp) may differ. The published anchor MUST live in the
    // consumer's frame domain — else the worklet's arithmetic drifts
    // by the epoch offset every frame.
    const monotonicClock = createFakeClock(999_999) // wildly different value
    const t = new MetronomeTransport(monotonicClock)
    const slot = makeSlot()
    let frameNow = 42

    bindSharedTransportAnchor(slot, t, () => frameNow)
    t.start(60)

    expect(slot.value.anchorFrameTimestampMs).toBe(42)
    // Explicitly NOT the monotonic clock's value.
    expect(slot.value.anchorFrameTimestampMs).not.toBe(monotonicClock.now())
  })

  it('unsubscribe stops further publishes', () => {
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    const slot = makeSlot()
    let now = 1_000

    const unsubscribe = bindSharedTransportAnchor(slot, t, () => now)
    now = 2_000
    t.start(60)
    const afterStart = slot.value

    unsubscribe()
    now = 3_000
    t.stop()
    // Slot value unchanged after unsubscribe.
    expect(slot.value).toBe(afterStart)
    expect(slot.value.running).toBe(true)
  })

  it('carries the transport generation bump into the published struct', () => {
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    const slot = makeSlot()
    let now = 1_000
    bindSharedTransportAnchor(slot, t, () => now)

    t.start(60)
    const gen1 = slot.value.generation
    t.stop()
    t.start(120)
    const gen2 = slot.value.generation
    t.stop()
    t.start(60)
    const gen3 = slot.value.generation

    expect(gen2).toBeGreaterThan(gen1)
    expect(gen3).toBeGreaterThan(gen2)
  })

  it('default now (no callback passed) still produces a finite anchorFrameTimestampMs', () => {
    // Smoke-test the default `performance.now()` / `Date.now()`
    // fallback path — a Node test runner has one of the two.
    const t = new MetronomeTransport(createFakeClock())
    const slot = makeSlot()
    bindSharedTransportAnchor(slot, t)
    t.start(60)
    const stamp = slot.value.anchorFrameTimestampMs
    expect(Number.isFinite(stamp)).toBe(true)
    expect(stamp).toBeGreaterThan(0)
  })
})

describe('bindSharedTransportAnchor — worklet-safe struct shape', () => {
  it('published struct has only plain-primitive fields (no methods, no refs)', () => {
    // Reanimated cross-runtime serialization requires plain values.
    // A getter, method, or shared reference here would break the
    // JS→UI thread copy.
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    const slot = makeSlot()
    bindSharedTransportAnchor(slot, t)
    t.start(120)
    const v: SharedTransportAnchor = slot.value
    expect(typeof v.generation).toBe('number')
    expect(typeof v.anchorTick).toBe('number')
    expect(typeof v.anchorFrameTimestampMs).toBe('number')
    expect(typeof v.ticksPerMillisecond).toBe('number')
    expect(typeof v.running).toBe('boolean')
    // No extra keys — a bloated struct wastes worklet copy time.
    expect(Object.keys(v).sort()).toEqual([
      'anchorFrameTimestampMs',
      'anchorTick',
      'generation',
      'running',
      'ticksPerMillisecond',
    ])
  })
})
