/**
 * Simulated punch source (M32-01).
 *
 * Runs entirely on the fake clock, so the suite needs no timers, no
 * Bluetooth, and takes microseconds rather than the length of a script
 * (spec §21.1).
 *
 * The assertions worth having here are the ones that would otherwise become
 * flaky tests three issues downstream: determinism under a seed, monotonic
 * delivery order, and a fully-populated event shape.
 */
import { SIM_DECODER_ID, SimulatedPunchSource } from '../SimulatedPunchSource'
import { SIM_SCRIPTS, type SimScriptId } from '../scripts'
import { createFakeClock, type FakeClock } from '@testing/fakeClock'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'

interface Harness {
  clock: FakeClock
  source: SimulatedPunchSource
  events: TrackerPunchEvent[]
  /** Delivery times, which is what latency and jitter actually move. */
  times: () => number[]
}

function harness(options: Partial<ConstructorParameters<typeof SimulatedPunchSource>[0]> = {}): Harness {
  const clock = createFakeClock()
  const events: TrackerPunchEvent[] = []
  const source = new SimulatedPunchSource({
    clock,
    seed: 'test-seed',
    wallClockIso: () => '2026-08-23T00:00:00.000Z',
    ...options,
  })
  source.subscribe((event) => events.push(event))
  source.start()
  return { clock, source, events, times: () => events.map((e) => e.receivedMonotonicTimeMs) }
}

describe('script catalogue', () => {
  it('contains exactly the declared scripts', () => {
    expect(Object.keys(SIM_SCRIPTS).sort()).toEqual([
      'alternating-1-2',
      'burst',
      'captured-jam',
      'combo-1-2-3-2',
    ])
  })

  it('alternates hands in alternating-1-2, starting on the lead', () => {
    const hands = SIM_SCRIPTS['alternating-1-2'].map((s) => s.hand)
    expect(hands[0]).toBe('left')
    for (let i = 1; i < hands.length; i++) expect(hands[i]).not.toBe(hands[i - 1])
  })

  it('gives combo-1-2-3-2 an L-R-L-R sequence on uneven offsets', () => {
    const steps = SIM_SCRIPTS['combo-1-2-3-2']
    expect(steps.map((s) => s.hand)).toEqual(['left', 'right', 'left', 'right'])

    // Even spacing would let a matcher pass on cadence alone, so the gaps
    // must genuinely differ.
    const gaps = steps.slice(1).map((s, i) => s.offsetMs - steps[i]!.offsetMs)
    expect(new Set(gaps).size).toBeGreaterThan(1)
  })

  it('makes burst denser than five punches a second', () => {
    const steps = SIM_SCRIPTS.burst
    const spanMs = steps[steps.length - 1]!.offsetMs
    const perSecond = (steps.length - 1) / (spanMs / 1000)
    expect(perSecond).toBeGreaterThan(5)
  })
})

describe('delivery', () => {
  it('delivers combo-1-2-3-2 at the scripted offsets', () => {
    const h = harness()
    h.source.playScript('combo-1-2-3-2')
    h.clock.advance(2_000)
    expect(h.events).toHaveLength(4)
    expect(h.times()).toEqual(SIM_SCRIPTS['combo-1-2-3-2'].map((s) => s.offsetMs))
    expect(h.events.map((e) => e.hand)).toEqual(['left', 'right', 'left', 'right'])
  })

  it('shifts every delivery by a fixed latency', () => {
    const h = harness({ latencyMs: 80 })
    h.source.playScript('combo-1-2-3-2')
    h.clock.advance(3_000)
    expect(h.times()).toEqual(SIM_SCRIPTS['combo-1-2-3-2'].map((s) => s.offsetMs + 80))
  })

  it('rescales offsets with bpm', () => {
    const h = harness()
    // Double the tempo, halve the offsets.
    h.source.playScript('combo-1-2-3-2', 200)
    h.clock.advance(3_000)
    expect(h.times()).toEqual(SIM_SCRIPTS['combo-1-2-3-2'].map((s) => s.offsetMs / 2))
  })

  it('keeps receivedMonotonicTimeMs non-decreasing even under jitter', () => {
    const h = harness({ jitterMs: 120, latencyMs: 120 })
    h.source.playScript('burst')
    h.clock.advance(10_000)
    const times = h.times()
    expect(times.length).toBeGreaterThan(0)
    for (let i = 1; i < times.length; i++) {
      expect(times[i]!).toBeGreaterThanOrEqual(times[i - 1]!)
    }
  })

  it('loops when asked, and stops looping on stop()', () => {
    const h = harness({ loop: true })
    h.source.playScript('combo-1-2-3-2')
    h.clock.advance(10_000)
    const afterLooping = h.events.length
    expect(afterLooping).toBeGreaterThan(4)

    h.source.stop()
    h.clock.advance(10_000)
    expect(h.events).toHaveLength(afterLooping)
  })
})

describe('jitter and drops are deterministic under a seed', () => {
  function run(seed: string, overrides: Record<string, unknown> = {}): number[] {
    const clock = createFakeClock()
    const events: TrackerPunchEvent[] = []
    const source = new SimulatedPunchSource({ clock, seed, ...overrides })
    source.subscribe((e) => events.push(e))
    source.start()
    source.playScript('burst')
    clock.advance(20_000)
    return events.map((e) => e.receivedMonotonicTimeMs)
  }

  it('reproduces the same jitter stream for one seed', () => {
    expect(run('seed-a', { jitterMs: 90, latencyMs: 90 })).toEqual(
      run('seed-a', { jitterMs: 90, latencyMs: 90 }),
    )
  })

  it('produces a different stream for a different seed', () => {
    const a = run('seed-a', { jitterMs: 90, latencyMs: 90 })
    const b = run('seed-b', { jitterMs: 90, latencyMs: 90 })
    expect(a).not.toEqual(b)
  })

  it('keeps jitter inside its bound', () => {
    const clock = createFakeClock()
    const events: TrackerPunchEvent[] = []
    const source = new SimulatedPunchSource({ clock, seed: 's', jitterMs: 50, latencyMs: 50 })
    source.subscribe((e) => events.push(e))
    source.start()
    source.playScript('alternating-1-2')
    clock.advance(20_000)

    const expected = SIM_SCRIPTS['alternating-1-2'].map((s) => s.offsetMs + 50)
    expect(events).toHaveLength(expected.length)
    events.forEach((event, i) => {
      expect(Math.abs(event.receivedMonotonicTimeMs - expected[i]!)).toBeLessThanOrEqual(50)
    })
  })

  it('thins delivery at a drop rate, stably for one seed', () => {
    const dropped = run('seed-a', { dropRate: 0.5 })
    const full = run('seed-a', { dropRate: 0 })
    expect(dropped.length).toBeGreaterThan(0)
    expect(dropped.length).toBeLessThan(full.length)
    expect(run('seed-a', { dropRate: 0.5 })).toEqual(dropped)
  })
})

describe('taps', () => {
  it('emits one event, subject to latency', () => {
    const h = harness({ latencyMs: 40 })
    h.source.emitTap('right')
    h.clock.advance(100)
    expect(h.events).toHaveLength(1)
    expect(h.events[0]?.hand).toBe('right')
    expect(h.events[0]?.receivedMonotonicTimeMs).toBe(40)
  })

  it('is never dropped — a tap is a direct instruction, not traffic', () => {
    const h = harness({ dropRate: 1 })
    h.source.emitTap('left')
    h.source.emitTap('right')
    h.clock.advance(100)
    expect(h.events).toHaveLength(2)
  })

  it('does nothing before start()', () => {
    const clock = createFakeClock()
    const events: TrackerPunchEvent[] = []
    const source = new SimulatedPunchSource({ clock })
    source.subscribe((e) => events.push(e))
    source.emitTap('left')
    clock.advance(1_000)
    expect(events).toEqual([])
  })
})

describe('subscription and lifecycle', () => {
  it('stops delivering after unsubscribe', () => {
    const clock = createFakeClock()
    const events: TrackerPunchEvent[] = []
    const source = new SimulatedPunchSource({ clock })
    const unsubscribe = source.subscribe((e) => events.push(e))
    source.start()
    source.playScript('combo-1-2-3-2')
    clock.advance(500)
    const delivered = events.length
    expect(delivered).toBeGreaterThan(0)

    unsubscribe()
    clock.advance(2_000)
    expect(events).toHaveLength(delivered)
  })

  it('cancels pending emissions on stop()', () => {
    const h = harness()
    h.source.playScript('combo-1-2-3-2')
    h.clock.advance(100)
    expect(h.events).toHaveLength(1)

    h.source.stop()
    h.clock.advance(5_000)
    expect(h.events).toHaveLength(1)
    expect(h.clock.pendingCount()).toBe(0)
  })

  it('start() is idempotent', () => {
    const h = harness({ script: 'combo-1-2-3-2' })
    h.source.start()
    h.clock.advance(3_000)
    // The script armed by the first start() runs once, not twice.
    expect(h.events).toHaveLength(4)
  })
})

describe('event shape (spec §12.5)', () => {
  it('populates every required field', () => {
    const h = harness()
    h.source.playScript('combo-1-2-3-2')
    h.clock.advance(2_000)

    for (const event of h.events) {
      expect(typeof event.id).toBe('string')
      expect(typeof event.sourceFrameId).toBe('string')
      expect(event.deviceId).toMatch(/^sim-(left|right)$/)
      expect(['left', 'right']).toContain(event.hand)
      expect(typeof event.receivedMonotonicTimeMs).toBe('number')
      expect(typeof event.receivedWallTimeIso).toBe('string')
      expect(event.recovered).toBe(false)
      expect(event.decoderId).toBe(SIM_DECODER_ID)
      expect(typeof event.decoderVersion).toBe('string')
      expect(event.qualityFlags).toEqual([])
    }
  })

  it('gives every event a distinct id', () => {
    const h = harness()
    h.source.playScript('burst')
    h.clock.advance(10_000)
    expect(new Set(h.events.map((e) => e.id)).size).toBe(h.events.length)
  })

  it('labels simulated velocity in tracker units, never a physical unit', () => {
    const h = harness({ velocity: true })
    h.source.playScript('combo-1-2-3-2')
    h.clock.advance(2_000)
    for (const event of h.events) {
      expect(event.velocityUnit).toBe('tracker-unit')
      expect(typeof event.velocityRaw).toBe('number')
    }
  })

  it('never claims a technique — the tracker cannot report one (D12)', () => {
    const h = harness()
    h.source.playScript('combo-1-2-3-2')
    h.clock.advance(2_000)
    for (const event of h.events) {
      expect(event.punchType).toBeUndefined()
      expect(event.punchTypeRaw).toBeUndefined()
    }
  })
})

describe('capability describes the source truthfully', () => {
  it('advertises velocity only when configured to emit it', () => {
    const withVelocity = new SimulatedPunchSource({ clock: createFakeClock(), velocity: true })
    const without = new SimulatedPunchSource({ clock: createFakeClock(), velocity: false })
    expect(withVelocity.capability.velocity).toBe(true)
    expect(without.capability.velocity).toBe(false)
  })

  it('emits no velocity fields when velocity is off', () => {
    const h = harness({ velocity: false })
    h.source.playScript('combo-1-2-3-2')
    h.clock.advance(2_000)
    expect(h.events.length).toBeGreaterThan(0)
    for (const event of h.events) {
      expect(event.velocityRaw).toBeUndefined()
      expect(event.velocityCalibrated).toBeUndefined()
      expect(event.velocityUnit).toBe('unknown')
    }
  })

  it('declares hand and timestamp, and no technique', () => {
    const source = new SimulatedPunchSource({ clock: createFakeClock() })
    expect(source.capability).toEqual({
      hand: true,
      timestamp: true,
      punchType: 'none',
      velocity: true,
    })
  })
})

describe('every script runs end to end', () => {
  it.each(Object.keys(SIM_SCRIPTS) as SimScriptId[])('%s delivers every step', (id) => {
    const h = harness()
    h.source.playScript(id)
    h.clock.advance(60_000)
    expect(h.events).toHaveLength(SIM_SCRIPTS[id].length)
  })
})
