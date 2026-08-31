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
 *  4. **Correct ticks-per-second at every supported cadence.** V2
 *     amendment: transport publishes 960 ticks/pulse (not 12) so the
 *     ±10 ms fit-check tolerance and ~50 ms coach-lane grace fit
 *     inside a single tick's precision. `baseBpm × 960 / 60` gives
 *     960 tps at 60 BPM (~1.04 ms/tick).
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

  it('start(60) sets ticksPerSecond to 960 (TRANSPORT_TICKS_PER_PULSE) and bumps generation', () => {
    const t = new MetronomeTransport(createFakeClock())
    t.start(60)
    const s = t.snapshot()
    expect(s.state).toBe('running')
    expect(s.baseBpm).toBe(60)
    expect(s.ticksPerSecond).toBe(960)
    expect(s.generation).toBe(1)
    expect(s.absoluteTick).toBe(0)
  })

  it('elapsed monotonic time drives absoluteTick at ticksPerSecond', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    // At 60 BPM, 960 transport ticks/s → 1 s = 960 ticks.
    clock.advance(1_000)
    expect(t.currentTick()).toBeCloseTo(960, 5)
    clock.advance(500)
    expect(t.currentTick()).toBeCloseTo(1_440, 5)
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
    clock.advance(500) // 480 ticks at 960 tps
    t.pause()
    const paused = t.currentTick()
    expect(paused).toBeCloseTo(480, 5)
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
    expect(t.currentTick()).toBeCloseTo(480, 5)
    clock.advance(500)
    // After another 500 ms, +480 ticks.
    expect(t.currentTick()).toBeCloseTo(960, 5)
  })

  it('stop resets to zero and the next start bumps generation again', () => {
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(1_000)
    expect(t.currentTick()).toBeCloseTo(960, 5)
    t.stop()
    expect(t.snapshot().state).toBe('stopped')
    expect(t.currentTick()).toBe(0)
    expect(t.snapshot().generation).toBe(1) // stop does not bump
    t.start(60)
    expect(t.snapshot().generation).toBe(2)
    expect(t.currentTick()).toBe(0)
  })

  it('ticksPerSecond is correct at every engine-supported BPM (60/120/180/240)', () => {
    // baseBpm × TRANSPORT_TICKS_PER_PULSE / 60 → 960 / 1920 / 2880 / 3840
    const cases: Array<[number, number]> = [
      [60, 960],
      [120, 1_920],
      [180, 2_880],
      [240, 3_840],
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
    expect(t.currentTick()).toBeCloseTo(960, 5)
    t.start(120) // BPM change
    expect(t.snapshot().generation).toBe(2)
    expect(t.currentTick()).toBe(0)
    expect(t.snapshot().ticksPerSecond).toBeCloseTo(1_920, 5)
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

describe('MetronomeTransport.subscribe (W0-b-ii)', () => {
  it('fires synchronously on start with a running snapshot', () => {
    const t = new MetronomeTransport(createFakeClock())
    const seen: string[] = []
    t.subscribe((snap) => {
      seen.push(`${snap.state}:${snap.generation}:${snap.baseBpm}`)
    })
    t.start(60)
    expect(seen).toEqual(['running:1:60'])
  })

  it('fires on stop / pause / resume, skipping no-op transitions', () => {
    const t = new MetronomeTransport(createFakeClock())
    const seen: string[] = []
    t.subscribe((snap) => {
      seen.push(snap.state)
    })
    t.start(60)
    t.pause()
    t.resume()
    t.pause()
    t.pause() // no-op: already paused
    t.stop()
    t.stop() // no-op: already stopped
    expect(seen).toEqual(['running', 'paused', 'running', 'paused', 'stopped'])
  })

  it('does NOT fire on subscribe itself (publish-on-change)', () => {
    const t = new MetronomeTransport(createFakeClock())
    t.start(60)
    const seen: number[] = []
    t.subscribe((snap) => {
      seen.push(snap.generation)
    })
    // Subscribe after start: no initial fire.
    expect(seen).toEqual([])
    t.stop()
    expect(seen).toEqual([1])
  })

  it('returns an unsubscribe function that removes the listener', () => {
    const t = new MetronomeTransport(createFakeClock())
    const seen: string[] = []
    const unsubscribe = t.subscribe((snap) => {
      seen.push(snap.state)
    })
    t.start(60)
    expect(seen).toEqual(['running'])
    unsubscribe()
    t.stop()
    expect(seen).toEqual(['running']) // no second entry
  })

  it('a throwing subscriber does not break others or corrupt transport state', () => {
    const t = new MetronomeTransport(createFakeClock())
    const seen: string[] = []
    t.subscribe(() => {
      throw new Error('rogue listener')
    })
    t.subscribe((snap) => {
      seen.push(snap.state)
    })
    t.start(60)
    expect(seen).toEqual(['running'])
    // Transport state uncorrupted:
    expect(t.snapshot().state).toBe('running')
    expect(t.snapshot().baseBpm).toBe(60)
  })

  it('multiple subscribers all receive every event', () => {
    const t = new MetronomeTransport(createFakeClock())
    const a: string[] = []
    const b: string[] = []
    t.subscribe((snap) => a.push(snap.state))
    t.subscribe((snap) => b.push(snap.state))
    t.start(60)
    t.stop()
    expect(a).toEqual(['running', 'stopped'])
    expect(b).toEqual(['running', 'stopped'])
  })
})

describe('MetronomeTransport.correct — bounded phase correction (W0-c)', () => {
  it('is a no-op when the transport is stopped', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    // Never started — snapshot must not change under correct().
    const before = t.snapshot()
    t.correct({
      observedAbsoluteTick: 12_345,
      observedAtMonotonicMs: clock.now(),
      observedGeneration: 0,
    })
    const after = t.snapshot()
    expect(after.state).toBe(before.state)
    expect(after.generation).toBe(before.generation)
    expect(after.absoluteTick).toBe(before.absoluteTick)
  })

  it('is a no-op when the observation generation mismatches (stale)', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(1_000)
    const observationHadStaleGen = t.snapshot().generation - 1
    const tickBefore = t.currentTick()
    t.correct({
      observedAbsoluteTick: tickBefore + 100_000, // wildly off — would trigger re-anchor
      observedAtMonotonicMs: clock.now(),
      observedGeneration: observationHadStaleGen,
    })
    // Stale generation: observation dropped, no re-anchor, no slew.
    expect(t.currentTick()).toBeCloseTo(tickBefore, 5)
    expect(t.snapshot().generation).toBe(observationHadStaleGen + 1)
  })

  it('is a no-op when the observation timestamp is in the future', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(500)
    const gen = t.snapshot().generation
    const before = t.currentTick()
    t.correct({
      observedAbsoluteTick: 999_999,
      observedAtMonotonicMs: clock.now() + 10_000, // future
      observedGeneration: gen,
    })
    // Future timestamp: discarded. No re-anchor, no slew.
    expect(t.currentTick()).toBeCloseTo(before, 5)
    expect(t.snapshot().generation).toBe(gen)
  })

  it('slews FORWARD (audio ahead of JS) by up to the step cap, capped', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(1_000) // JS predicts ~960 ticks
    const predicted = t.currentTick()
    const gen = t.snapshot().generation
    // Audio reports it's actually 200 ticks ahead of JS estimate —
    // well inside the LARGE threshold (500).
    t.correct({
      observedAbsoluteTick: predicted + 200,
      observedAtMonotonicMs: clock.now(),
      observedGeneration: gen,
    })
    // Slewed forward by the step cap (20), not the full 200.
    // Generation unchanged (inside-generation smoothing).
    expect(t.currentTick()).toBeCloseTo(predicted + 20, 5)
    expect(t.snapshot().generation).toBe(gen)
  })

  it('does NOT slew backwards when JS is ahead of audio (visual monotonicity)', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(1_000)
    const predicted = t.currentTick()
    const gen = t.snapshot().generation
    // Audio reports it's 100 ticks BEHIND JS estimate — small error,
    // negative direction. The transport MUST NOT snap backwards
    // (Kyle principle #4).
    t.correct({
      observedAbsoluteTick: predicted - 100,
      observedAtMonotonicMs: clock.now(),
      observedGeneration: gen,
    })
    // Anchor unchanged; tick still at predicted (or advancing).
    expect(t.currentTick()).toBeCloseTo(predicted, 5)
    expect(t.snapshot().generation).toBe(gen)
  })

  it('projects the observation forward by (now - observedAt) before diffing', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(500)
    const gen = t.snapshot().generation
    // Snapshot the "audio" tick at this moment.
    const audioTick = t.currentTick() // ~480
    // Now let 100 ms elapse — the observation is 100 ms old when
    // correct() is called.
    clock.advance(100)
    const predicted = t.currentTick() // ~576
    // Send the OLD observation. The correct method must project
    // audioTick forward by 100 ms × 960 tps / 1000 = 96 ticks →
    // 576 → matches predicted → error ~ 0 → no correction.
    t.correct({
      observedAbsoluteTick: audioTick,
      observedAtMonotonicMs: clock.now() - 100,
      observedGeneration: gen,
    })
    expect(t.currentTick()).toBeCloseTo(predicted, 3)
  })

  it('re-anchors on LARGE error, bumps generation, notifies subscribers', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(1_000)
    const genBefore = t.snapshot().generation
    const predicted = t.currentTick()
    const seen: number[] = []
    t.subscribe((snap) => seen.push(snap.generation))
    // 5_000 tick jump = ~5.2 s worth of skew — well over LARGE
    // threshold (500). Simulates an audio underrun / seek / OS
    // route change / app-background pause that JS didn't see.
    t.correct({
      observedAbsoluteTick: predicted + 5_000,
      observedAtMonotonicMs: clock.now(),
      observedGeneration: genBefore,
    })
    expect(t.snapshot().generation).toBe(genBefore + 1)
    // Anchor re-seeded at the observed tick.
    expect(t.currentTick()).toBeCloseTo(predicted + 5_000, 5)
    // Subscribers were notified — score dispatch can re-arm.
    expect(seen).toEqual([genBefore + 1])
  })

  it('re-anchors on large NEGATIVE error too (large-magnitude discontinuity)', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(10_000) // JS predicts 9_600 ticks
    const genBefore = t.snapshot().generation
    // Audio reports we're actually at tick 0 — the loop restarted
    // without JS knowing. Magnitude is well over LARGE threshold.
    // Even though the direction is backwards, this is a
    // discontinuity, not a "small drift, hold the estimate"
    // situation. Re-anchor bumps generation so future score
    // events can be re-armed against the new anchor.
    t.correct({
      observedAbsoluteTick: 0,
      observedAtMonotonicMs: clock.now(),
      observedGeneration: genBefore,
    })
    expect(t.snapshot().generation).toBe(genBefore + 1)
    // Anchor at the observed tick — this DOES snap the visual
    // clock, but only because the discontinuity is severe enough
    // that continuing the old anchor would misalign every future
    // scheduled event. Small-error smoothing (which forbids
    // backward snaps) covers routine drift; this branch covers
    // catastrophic desync.
    expect(t.currentTick()).toBe(0)
  })

  it('multiple small corrections converge on the observed rate', () => {
    // Simulates the natural correction cadence — 500 ms status
    // callbacks with ~5-tick drift each. Over 10 callbacks the
    // JS anchor should slew to match audio.
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    // Skew audio by 50 ticks initially; each correction slews
    // by up to 20 (cap). After 3 corrections the anchor should
    // catch up entirely.
    clock.advance(1_000)
    const startPredicted = t.currentTick()
    const startGen = t.snapshot().generation
    for (let i = 0; i < 5; i += 1) {
      const predicted = t.currentTick()
      t.correct({
        observedAbsoluteTick: predicted + 50, // audio 50 ticks ahead
        observedAtMonotonicMs: clock.now(),
        observedGeneration: startGen,
      })
      clock.advance(50) // small wait between corrections
    }
    // After enough small corrections, the anchor has been shifted
    // forward by 5 × 20 = 100 ticks (limit) — actually each
    // observation was 50 ticks ahead so the correction was 20 →
    // then 30 → then 30 → etc. In any case, tick has advanced
    // strictly more than a bare 60 BPM rate would predict for
    // the elapsed time.
    const noCorrectionTick = startPredicted + (250 * 960) / 1_000
    expect(t.currentTick()).toBeGreaterThan(noCorrectionTick)
    // Generation stayed put — no discontinuity.
    expect(t.snapshot().generation).toBe(startGen)
  })
})

describe('MetronomeTransport.notifyDisruption (W0-d)', () => {
  it('is a no-op when the transport is not running (disruption of stopped is meaningless)', () => {
    const clock = createFakeClock()
    const t = new MetronomeTransport(clock)
    const before = t.snapshot()
    t.notifyDisruption('bluetooth-route-change')
    const after = t.snapshot()
    expect(after).toEqual(before)
  })

  it('is a no-op when the transport is paused', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(500)
    t.pause()
    const before = t.snapshot()
    t.notifyDisruption('interruption')
    const after = t.snapshot()
    expect(after.state).toBe('paused')
    expect(after.generation).toBe(before.generation)
    expect(after.absoluteTick).toBe(before.absoluteTick)
  })

  it('bumps generation but PRESERVES the current tick when running', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(2_500) // ~2400 ticks in
    const tickBefore = t.currentTick()
    const genBefore = t.snapshot().generation

    t.notifyDisruption('route-change')

    // Tick position is unchanged from the athlete's perspective.
    expect(t.currentTick()).toBeCloseTo(tickBefore, 3)
    // Generation bumped so downstream can reject stale timelines.
    expect(t.snapshot().generation).toBe(genBefore + 1)
    // State still running.
    expect(t.snapshot().state).toBe('running')
  })

  it('notifies subscribers with a running snapshot', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(1_000)
    const seen: Array<{ state: string; generation: number }> = []
    t.subscribe((snap) => seen.push({ state: snap.state, generation: snap.generation }))

    t.notifyDisruption('audio-underrun')

    expect(seen).toHaveLength(1)
    expect(seen[0]!.state).toBe('running')
    expect(seen[0]!.generation).toBe(2) // was 1 after start; bumped to 2
  })

  it('advances tick continuously across the disruption (no reset to 0)', () => {
    const clock = createFakeClock(1_000)
    const t = new MetronomeTransport(clock)
    t.start(60)
    clock.advance(1_000)
    const tick1 = t.currentTick() // ~960
    t.notifyDisruption('route-change')
    clock.advance(1_000)
    const tick2 = t.currentTick() // ~1920
    // Second read should be tick1 + 960 (one more second of running),
    // NOT reset to 960 (which would be the tick a full restart would
    // produce).
    expect(tick2).toBeGreaterThan(tick1 + 900)
    expect(tick2).toBeLessThan(tick1 + 1_020)
  })
})
