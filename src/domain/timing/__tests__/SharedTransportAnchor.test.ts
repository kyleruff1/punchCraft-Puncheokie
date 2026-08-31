/**
 * `SharedTransportAnchor` — arithmetic + snapshot conversion
 * (M39-V2 Phase W0-b-i, Kyle amended plan 2026-08-30).
 *
 * These pin the invariants the worklet consumer will lean on:
 *
 *   - Running interpolation is exact + linear + sub-tick precise.
 *   - Stopped/paused freezes at the anchor tick regardless of
 *     frame timestamp (principle #3: visual cursor never moves
 *     backward — but also never drifts forward on a frozen clock).
 *   - Snapshot conversion produces a worklet-safe struct with the
 *     right ticks-per-MS derived from `TRANSPORT_TICKS_PER_PULSE`.
 *   - The initial `SHARED_ANCHOR_STOPPED` yields tick 0 for any
 *     frame timestamp — the value the useSharedValue hook uses
 *     before any transport has started.
 */

import type { MetronomeTransportSnapshot } from '@/domain/coach/VoiceOutputPort'
import {
  SHARED_ANCHOR_STOPPED,
  type SharedTransportAnchor,
  sharedAnchorCurrentTick,
  sharedAnchorFromSnapshot,
  ticksPerMillisecondFor,
} from '../SharedTransportAnchor'
import { TRANSPORT_TICKS_PER_PULSE } from '../TimingEngine'

function anchor(overrides: Partial<SharedTransportAnchor> = {}): SharedTransportAnchor {
  return {
    generation: 1,
    anchorTick: 0,
    anchorFrameTimestampMs: 1_000,
    ticksPerMillisecond: ticksPerMillisecondFor(60), // 60 BPM → 0.96 ticks/ms
    running: true,
    ...overrides,
  }
}

function snapshot(
  overrides: Partial<MetronomeTransportSnapshot> = {},
): MetronomeTransportSnapshot {
  return {
    generation: 3,
    state: 'running',
    absoluteTick: 4_800,
    sampledAtMonotonicMs: 5_000,
    ticksPerSecond: TRANSPORT_TICKS_PER_PULSE, // 60 BPM
    baseBpm: 60,
    ...overrides,
  }
}

describe('sharedAnchorCurrentTick — running interpolation', () => {
  it('advances linearly from the anchor at the transport rate', () => {
    const a = anchor()
    // 60 BPM → 0.96 ticks/ms. 1000 ms later → 960 additional ticks.
    expect(sharedAnchorCurrentTick(a, 2_000)).toBeCloseTo(960, 10)
  })

  it('preserves sub-tick precision (fit-check depends on it)', () => {
    const a = anchor({ ticksPerMillisecond: ticksPerMillisecondFor(60) })
    // 10.5 ms after anchor at 60 BPM: 10.5 * 0.96 = 10.08 ticks
    // — do NOT round, the fit-check depends on sub-tick precision.
    const result = sharedAnchorCurrentTick(a, a.anchorFrameTimestampMs + 10.5)
    expect(result).toBeCloseTo(10.08, 10)
    expect(result).not.toBe(10)
  })

  it('scales with BPM: 120 BPM doubles the rate', () => {
    const a = anchor({ ticksPerMillisecond: ticksPerMillisecondFor(120) })
    const result = sharedAnchorCurrentTick(a, a.anchorFrameTimestampMs + 500)
    // 120 BPM = 1.92 ticks/ms, 500 ms → 960 ticks.
    expect(result).toBeCloseTo(960, 10)
  })

  it('handles a non-zero anchor tick (mid-workout publish)', () => {
    const a = anchor({ anchorTick: 5_000 })
    // 100 ms after a 5_000-tick anchor: 5_000 + 100 * 0.96 = 5_096.
    expect(sharedAnchorCurrentTick(a, a.anchorFrameTimestampMs + 100)).toBeCloseTo(5_096, 10)
  })
})

describe('sharedAnchorCurrentTick — stopped/paused freeze', () => {
  it('returns anchorTick when running=false, regardless of frameTimestamp', () => {
    const a = anchor({ running: false, anchorTick: 2_400 })
    // No matter how far the frame timestamp moves, tick stays frozen.
    expect(sharedAnchorCurrentTick(a, a.anchorFrameTimestampMs)).toBe(2_400)
    expect(sharedAnchorCurrentTick(a, a.anchorFrameTimestampMs + 1_000_000)).toBe(2_400)
    expect(sharedAnchorCurrentTick(a, a.anchorFrameTimestampMs - 1_000_000)).toBe(2_400)
  })

  it('SHARED_ANCHOR_STOPPED yields 0 for any frame timestamp', () => {
    expect(sharedAnchorCurrentTick(SHARED_ANCHOR_STOPPED, 0)).toBe(0)
    expect(sharedAnchorCurrentTick(SHARED_ANCHOR_STOPPED, 1_000_000)).toBe(0)
  })

  it('SHARED_ANCHOR_STOPPED is frozen (defensive against publisher mutation)', () => {
    // Reanimated is fussy about worklet-safe object identity — a
    // mutable initial value would let a stale JS-side reference
    // stomp the shared value's contents. Freeze proves the intent.
    expect(Object.isFrozen(SHARED_ANCHOR_STOPPED)).toBe(true)
  })
})

describe('sharedAnchorFromSnapshot', () => {
  it('carries generation and absoluteTick verbatim', () => {
    const s = snapshot({ generation: 7, absoluteTick: 12_345 })
    const a = sharedAnchorFromSnapshot(s, 999)
    expect(a.generation).toBe(7)
    expect(a.anchorTick).toBe(12_345)
  })

  it('replaces sampledAtMonotonicMs with the publisher-supplied frame timestamp', () => {
    // The publisher's frame timestamp is what the WORKLET domain
    // uses. Snapshot's own sampledAtMonotonicMs (JS domain) does
    // not cross the runtime boundary — the arithmetic would drift
    // by the epoch offset between the two clocks.
    const s = snapshot({ sampledAtMonotonicMs: 12_345 })
    const a = sharedAnchorFromSnapshot(s, 999)
    expect(a.anchorFrameTimestampMs).toBe(999)
  })

  it('derives ticksPerMillisecond from ticksPerSecond (per-ms not per-sec)', () => {
    // ticksPerSecond is the transport's canonical rate — the
    // worklet works in ms, so the /1000 conversion happens once
    // at publish time and the frame callback multiplies cleanly.
    const s = snapshot({ ticksPerSecond: 960 })
    const a = sharedAnchorFromSnapshot(s, 0)
    expect(a.ticksPerMillisecond).toBe(0.96)
  })

  it('maps running state truthfully', () => {
    expect(sharedAnchorFromSnapshot(snapshot({ state: 'running' }), 0).running).toBe(true)
    expect(sharedAnchorFromSnapshot(snapshot({ state: 'paused' }), 0).running).toBe(false)
    expect(sharedAnchorFromSnapshot(snapshot({ state: 'stopped' }), 0).running).toBe(false)
  })
})

describe('ticksPerMillisecondFor', () => {
  it('returns 0 for invalid BPMs (defensive)', () => {
    expect(ticksPerMillisecondFor(0)).toBe(0)
    expect(ticksPerMillisecondFor(-1)).toBe(0)
    expect(ticksPerMillisecondFor(NaN)).toBe(0)
    expect(ticksPerMillisecondFor(Infinity)).toBe(0)
  })

  it('matches (baseBpm * TRANSPORT_TICKS_PER_PULSE) / 60000', () => {
    // 60 BPM = 1 pulse/sec = 960 ticks/sec = 0.96 ticks/ms.
    expect(ticksPerMillisecondFor(60)).toBe((60 * TRANSPORT_TICKS_PER_PULSE) / 60_000)
    expect(ticksPerMillisecondFor(120)).toBe((120 * TRANSPORT_TICKS_PER_PULSE) / 60_000)
    expect(ticksPerMillisecondFor(240)).toBe((240 * TRANSPORT_TICKS_PER_PULSE) / 60_000)
    // Sanity: 60 BPM should yield 0.96 exactly.
    expect(ticksPerMillisecondFor(60)).toBeCloseTo(0.96, 10)
  })
})

describe('generation bump — stale-timeline rejection', () => {
  it('a new generation carries the new anchorTick + new rate atomically', () => {
    // Simulates the transport being re-started at a new BPM
    // between two publishes. The consumer sees generation bump
    // AND rate change together — never the old rate applied to
    // the new anchorTick.
    const first = sharedAnchorFromSnapshot(
      snapshot({ generation: 1, absoluteTick: 0, ticksPerSecond: 960 }),
      1_000,
    )
    const second = sharedAnchorFromSnapshot(
      snapshot({ generation: 2, absoluteTick: 0, ticksPerSecond: 1_920 }),
      2_000,
    )
    expect(second.generation).toBeGreaterThan(first.generation)
    expect(second.anchorTick).toBe(0)
    expect(second.ticksPerMillisecond).toBe(1.92)
    expect(second.anchorFrameTimestampMs).toBe(2_000)
  })
})
