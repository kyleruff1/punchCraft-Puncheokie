/**
 * MetronomeTransport (M39-V2 Phase 1).
 *
 * Pins the four invariants the rest of V2 depends on:
 *
 *  1. **Monotonicity.** `absoluteTick` never goes backward while
 *     running. A consumer sampling repeatedly gets a strictly
 *     non-decreasing sequence.
 *  2. **Generation on start.** Every `start()` bumps the counter so
 *     a compiled timeline can be revision-guarded and stale
 *     schedules discarded (Kyle blueprint §11).
 *  3. **Pause preserves position.** `pause()` freezes the tick;
 *     `resume()` continues from the pause point. Elapsed monotonic
 *     time during the pause does NOT advance the tick.
 *  4. **Correct ticks-per-second at every supported cadence.** The
 *     TICKS_PER_PULSE=12 grid must divide evenly at divisions 1/2/3/4,
 *     which the ticksPerSecond helper honors via
 *     `baseBpm × TICKS_PER_PULSE / 60`.
 */
import { createFakeClock } from '@testing/fakeClock'

import { MetronomeTransport } from '../MetronomeTransport'

describe('MetronomeTransport', () => {
  it('starts stopped with zero tick, zero bpm, generation 0', () => {
    const t = new MetronomeTransport(createFakeClock())
    const s = t.snapshot()
    expect(s.state).toBe('stopped')
    expect(s.absoluteTick).toBe(0)
    expect(s.baseBpm).toBe(0)
    expect(s.ticksPerSecond).toBe(0)
    expect(s.generation).toBe(0)
  })

  it('start(60) sets ticksPerSecond to 12 (TICKS_PER_PULSE) and bumps generation', () => {
    const t = new MetronomeTransport(createFakeClock())
    t.start(60)
    const s = t.snapshot()
    expect(s.state).toBe('running')
    expect(s.baseBpm).toBe(60)
    expect(s.ticksPerSecond).toBe(12)
    expect(s.generation).toBe(1)
    expect(s.absoluteTick).toBe(0)
  })

  it('elapsed monotonic time drives absoluteTick at ticksPerSecond', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    // At 60 BPM, 12 ticks/s → 1 s = 12 ticks.
    clock.advance(1_000)
    expect(t.currentTick()).toBeCloseTo(12, 5)
    clock.advance(500)
    expect(t.currentTick()).toBeCloseTo(18, 5)
  })

  it('monotonicity — repeated snapshots at successive times never decrease', () => {
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    t.start(60)
    let prev = -Infinity
    for (let i = 0; i < 100; i += 1) {
      clock.advance(17) // ~60 FPS worth of jitter
      const tick = t.currentTick()
      expect(tick).toBeGreaterThanOrEqual(prev)
      prev = tick
    }
  })

  it('pause freezes absoluteTick; elapsed time during pause does not advance the tick', () => {
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(500) // 6 ticks
    t.pause()
    const paused = t.currentTick()
    expect(paused).toBeCloseTo(6, 5)
    clock.advance(10_000) // long pause
    expect(t.currentTick()).toBeCloseTo(paused, 5)
    expect(t.snapshot().state).toBe('paused')
  })

  it('resume continues from the pause point', () => {
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(500)
    t.pause()
    clock.advance(10_000)
    t.resume()
    // Immediately after resume, tick == pause point.
    expect(t.currentTick()).toBeCloseTo(6, 5)
    clock.advance(500)
    // After another 500 ms, +6 ticks.
    expect(t.currentTick()).toBeCloseTo(12, 5)
  })

  it('stop resets to zero and the next start bumps generation again', () => {
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(1_000)
    expect(t.currentTick()).toBeCloseTo(12, 5)
    t.stop()
    expect(t.snapshot().state).toBe('stopped')
    expect(t.currentTick()).toBe(0)
    expect(t.snapshot().generation).toBe(1) // stop does not bump
    t.start(60)
    expect(t.snapshot().generation).toBe(2)
    expect(t.currentTick()).toBe(0)
  })

  it('ticksPerSecond is correct at every engine-supported BPM (60/120/180/240)', () => {
    // baseBpm × TICKS_PER_PULSE / 60 → 12 / 24 / 36 / 48
    const cases: Array<[number, number]> = [
      [60, 12],
      [120, 24],
      [180, 36],
      [240, 48],
    ]
    for (const [bpm, tps] of cases) {
      const t = new MetronomeTransport(createFakeClock())
      t.start(bpm)
      expect(t.snapshot().ticksPerSecond).toBeCloseTo(tps, 5)
    }
  })

  it('rejects a non-positive baseBpm', () => {
    const t = new MetronomeTransport(createFakeClock())
    expect(() => t.start(0)).toThrow()
    expect(() => t.start(-60)).toThrow()
    expect(() => t.start(NaN)).toThrow()
    expect(t.snapshot().state).toBe('stopped')
  })

  it('a second start under a running transport re-anchors at 0 and bumps generation', () => {
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(1_000)
    expect(t.currentTick()).toBeCloseTo(12, 5)
    t.start(120) // BPM change
    expect(t.snapshot().generation).toBe(2)
    expect(t.currentTick()).toBe(0)
    expect(t.snapshot().ticksPerSecond).toBeCloseTo(24, 5)
  })

  it('pause with no prior start is a no-op (state stays stopped)', () => {
    const t = new MetronomeTransport(createFakeClock())
    t.pause()
    expect(t.snapshot().state).toBe('stopped')
  })

  it('resume from stopped is a no-op (state stays stopped)', () => {
    const t = new MetronomeTransport(createFakeClock())
    t.resume()
    expect(t.snapshot().state).toBe('stopped')
  })
})
