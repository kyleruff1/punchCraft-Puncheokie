/**
 * Metronome transport surfaced through the coach port (M39-V2 Phase
 * W0-a, Kyle 2026-08-30).
 *
 * Pins the invariants:
 *
 *  1. `metronome.start(loop, vol, bpm)` starts BOTH the audio loop
 *     AND the shared `MetronomeTransport`. The transport becomes
 *     `running` with a fresh `generation` and the ticksPerSecond
 *     derived from `bpm × TRANSPORT_TICKS_PER_PULSE / 60` (960 at
 *     60 BPM per Phase 1').
 *  2. `metronome.start(loop, vol)` without a bpm leaves the
 *     transport stopped — backward-compat for test doubles that
 *     predate W0-a.
 *  3. `metronome.stop()` stops BOTH lifecycles.
 *  4. Every `metronome.start(...bpm)` bumps `generation` so any
 *     stale timeline compiled under the previous generation can be
 *     rejected at dispatch (principle #2 of the amended plan).
 *  5. Coach activity (`playAsset` / `playPhrase`) never touches the
 *     transport's state — the coach lane and the metronome lane are
 *     isolated (principle #20). A `playPhrase` between two
 *     `snapshot()` reads must not change `generation` or the
 *     `state`.
 *
 * These are all TYPE-level and STATE-level invariants that the
 * downstream score dispatcher, frame-clock visual dispatcher, and
 * QA analyzer will lean on. Breaking any of them shows up as a
 * schedule-hash mismatch or a lost tick, which is exactly the
 * class of bug W0 was designed to prevent.
 */

// The native audio + speech modules are never exercised — every seam is
// injected — but their imports must resolve. Mirrors the shape used by
// `VoiceOutputExpo.test.ts` and `MetronomePlayer.test.ts`.
//
// The playlist mock supports `addListener('playlistStatusUpdate', ...)`
// so W0-c-ii tests can capture the callback the metronome player
// wires up and fire simulated position updates by hand.
interface CapturedPlaylistListener {
  fire(status: { currentTime: number; duration: number }): void
}
const playlistListeners: CapturedPlaylistListener[] = []
jest.mock('expo-audio', () => ({
  createAudioPlayer: () => {
    throw new Error('expo-audio is not available in tests; inject createPlayer')
  },
  createAudioPlaylist: () => {
    const callbacks: Array<(status: { currentTime: number; duration: number }) => void> = []
    const capture: CapturedPlaylistListener = {
      fire(status) {
        for (const cb of [...callbacks]) cb(status)
      },
    }
    playlistListeners.push(capture)
    return {
      play: () => {},
      pause: () => {},
      seekTo: () => {},
      destroy: () => {},
      volume: 0,
      addListener: (
        _event: string,
        cb: (status: { currentTime: number; duration: number }) => void,
      ) => {
        callbacks.push(cb)
        return {
          remove: () => {
            const i = callbacks.indexOf(cb)
            if (i >= 0) callbacks.splice(i, 1)
          },
        }
      },
    }
  },
  setAudioModeAsync: async () => undefined,
}))
jest.mock('expo-speech', () => ({ speak: () => {}, stop: () => {} }))

import { VoiceOutputExpo } from '../VoiceOutputExpo'
import { TRANSPORT_TICKS_PER_PULSE } from '@/domain/timing/TimingEngine'

const FAKE_LOOP = { baseBpm: 60, module: 1, division: 4 as const, swing: 0, durationMs: 1_000 }

function buildOutput(): VoiceOutputExpo {
  let clock = 0
  return new VoiceOutputExpo({
    clock: () => clock,
    schedule: (fn, delayMs) => {
      clock += delayMs
      fn()
      return 0
    },
    cancelScheduled: () => {},
    createPlayer: (source) => {
      let volume = 1
      return {
        source,
        get volume() {
          return volume
        },
        set volume(v: number) {
          volume = v
        },
        seekTo: () => {},
        play: () => {},
        remove: () => {},
      } as never
    },
    speaker: {
      speak: () => {},
      stop: () => {},
    } as never,
    setAudioMode: (async () => {}) as never,
  })
}

describe('metronome transport surfaced through the port', () => {
  it('start(loop, vol, bpm) starts the transport with the fresh generation', () => {
    const output = buildOutput()
    const before = output.metronome.transport!.snapshot()
    expect(before.state).toBe('stopped')
    expect(before.generation).toBe(0)

    output.metronome.start(FAKE_LOOP, 0.6, 60)

    const after = output.metronome.transport!.snapshot()
    expect(after.state).toBe('running')
    expect(after.generation).toBe(1)
    expect(after.baseBpm).toBe(60)
    expect(after.ticksPerSecond).toBe((60 * TRANSPORT_TICKS_PER_PULSE) / 60)
  })

  it('start(loop, vol) without a bpm leaves the transport stopped', () => {
    const output = buildOutput()
    output.metronome.start(FAKE_LOOP, 0.6)
    const snap = output.metronome.transport!.snapshot()
    expect(snap.state).toBe('stopped')
    expect(snap.generation).toBe(0)
  })

  it('stop() stops the transport', () => {
    const output = buildOutput()
    output.metronome.start(FAKE_LOOP, 0.6, 120)
    expect(output.metronome.transport!.snapshot().state).toBe('running')
    output.metronome.stop()
    expect(output.metronome.transport!.snapshot().state).toBe('stopped')
  })

  it('every start(bpm) bumps generation so a stale timeline is rejectable', () => {
    const output = buildOutput()
    output.metronome.start(FAKE_LOOP, 0.6, 60)
    const gen1 = output.metronome.transport!.snapshot().generation
    output.metronome.stop()
    output.metronome.start(FAKE_LOOP, 0.6, 60)
    const gen2 = output.metronome.transport!.snapshot().generation
    output.metronome.start(FAKE_LOOP, 0.6, 120)
    const gen3 = output.metronome.transport!.snapshot().generation
    expect(gen2).toBeGreaterThan(gen1)
    expect(gen3).toBeGreaterThan(gen2)
  })

  it('setVolume does not touch the transport (volume is not a clock event)', () => {
    const output = buildOutput()
    output.metronome.start(FAKE_LOOP, 0.6, 60)
    const before = output.metronome.transport!.snapshot()
    output.metronome.setVolume(0.9)
    const after = output.metronome.transport!.snapshot()
    expect(after.state).toBe(before.state)
    expect(after.generation).toBe(before.generation)
    expect(after.baseBpm).toBe(before.baseBpm)
  })
})

describe('metronome position observer → transport.correct (W0-c-ii)', () => {
  beforeEach(() => {
    playlistListeners.length = 0
  })

  function buildOutputWithControlledClock(): {
    output: VoiceOutputExpo
    setClock: (ms: number) => void
  } {
    let clock = 0
    const output = new VoiceOutputExpo({
      clock: () => clock,
      schedule: (fn, delayMs) => {
        clock += delayMs
        fn()
        return 0
      },
      cancelScheduled: () => {},
      createPlayer: (source) =>
        ({
          source,
          volume: 1,
          seekTo: () => {},
          play: () => {},
          remove: () => {},
        }) as never,
      speaker: { speak: () => {}, stop: () => {} } as never,
      setAudioMode: (async () => {}) as never,
    })
    return { output, setClock: (ms) => { clock = ms } }
  }

  it('a captured playlist listener carries status updates back to the transport', () => {
    const { output, setClock } = buildOutputWithControlledClock()
    setClock(1_000)

    // Start the metronome at 60 BPM — transport starts, listener
    // is attached to the fresh playlist mock.
    output.metronome.start(FAKE_LOOP, 0.6, 60)
    expect(playlistListeners.length).toBeGreaterThan(0)
    const listener = playlistListeners.at(-1)!

    // Simulate the audio backend reporting we're 200 ms into the
    // loop (~192 ticks at 60 BPM), 200 ms after start. Under normal
    // conditions the JS estimate matches (also ~192 ticks). The
    // correction is a no-op / tiny slew — but the observation MUST
    // flow all the way through without throwing.
    setClock(1_200)
    listener.fire({ currentTime: 0.2, duration: 1.0 })
    // Transport still on the same generation (no discontinuity).
    expect(output.metronome.transport!.snapshot().generation).toBe(1)
    expect(output.metronome.transport!.snapshot().state).toBe('running')
  })

  it('a forward-skew observation (audio ahead of JS) slews the anchor forward', () => {
    const { output, setClock } = buildOutputWithControlledClock()
    setClock(1_000)
    output.metronome.start(FAKE_LOOP, 0.6, 60)
    const listener = playlistListeners.at(-1)!
    const genBefore = output.metronome.transport!.snapshot().generation

    // v5 (wall-time DELTA wrap counting) infers wraps from the gap
    // BETWEEN two consecutive reports, so the FIRST report of a run can
    // only establish a baseline — there is no delta to measure yet. Seed
    // it here; the assertion below is about the second report.
    setClock(1_050)
    listener.fire({ currentTime: 0.05, duration: 1.0 })

    // Set JS elapsed to 100 ms — JS predicts tick ~96. Then have
    // audio report it's at wrapped 0.4 s (well past where JS
    // thinks). Delta: gap 50 ms → expectedAdvance 0.05 s,
    // observedAdvance 0.35 s. Position moved FORWARD and less than a
    // loop of wall time passed, so wraps = 0 and absolute = 0.4 s =
    // 384 ticks. Error = 384 - 96 = 288 ticks — well INSIDE the LARGE
    // threshold (500), so the correct primitive slews forward by
    // the step cap (20).
    setClock(1_100)
    const tickBefore = output.metronome.transport!.currentTick()
    listener.fire({ currentTime: 0.4, duration: 1.0 })
    // Generation unchanged (small-error branch, inside-generation
    // smoothing).
    expect(output.metronome.transport!.snapshot().generation).toBe(genBefore)
    // Anchor slewed forward — the tick at the same monotonic
    // moment is now higher than before by (up to) the step cap.
    const tickAfter = output.metronome.transport!.currentTick()
    expect(tickAfter).toBeGreaterThan(tickBefore)
    expect(tickAfter - tickBefore).toBeLessThanOrEqual(20)
  })

  it('stopping the metronome detaches the listener', () => {
    const { output, setClock } = buildOutputWithControlledClock()
    setClock(1_000)
    output.metronome.start(FAKE_LOOP, 0.6, 60)
    const listener = playlistListeners.at(-1)!

    output.metronome.stop()
    // Fire a stale status update after stop. The observer wiring
    // is gone (unsubscribeStatus called); firing directly against
    // the mock's callbacks list would have found nothing to call.
    setClock(2_000)
    listener.fire({ currentTime: 0.5, duration: 1.0 })

    // Transport still stopped; no re-anchor happened, no throw.
    expect(output.metronome.transport!.snapshot().state).toBe('stopped')
  })

// ---------------------------------------------------------------------------
// Wall-time DELTA wrap counting (v5, 2026-08-31).
//
// Four earlier attempts failed. v1 and v2 measured wall time from
// `metronome.start`, which audio-startup latency poisons: wall time crosses
// a loop boundary before audio does, so the count runs ahead (v1 made the
// storm WORSE — 650 re-anchors vs 371). v3/v4 used position deltas alone,
// which the ~500 ms callback cadence on a 1000 ms loop fools, because a wrap
// observed exactly half a loop backwards is ambiguous.
//
// v5 trusts only the gap BETWEEN two consecutive callbacks, so startup
// latency cancels. These tests pin the arithmetic and both guard rails.
// ---------------------------------------------------------------------------

describe('metronome loop counting — wall-time delta (v5)', () => {
  /**
   * Drive a sequence of position reports and report how many times the
   * transport HARD RE-ANCHORED (generation bumps past the one `start()`
   * spends).
   *
   * Generation bumps are the right assertion, not the derived tick: when
   * the loop count is correct the derived absolute tracks wall time, so
   * `correct()` stays on its small-error slew branch and never snaps. A
   * miscount of even one loop puts the observation ~960 ticks away from
   * the JS estimate, which is far past PHASE_CORRECTION_LARGE_TICKS (500)
   * and forces a re-anchor. So "zero bumps" is precisely "no storm", and
   * it catches BOTH failure directions — a missed wrap (v3/v4) and an
   * over-counted one (v1/v2).
   */
  function reAnchorsDuring(reports: { atMs: number; currentTime: number }[]): number {
    const { output, setClock } = buildOutputWithControlledClock()
    setClock(1_000)
    output.metronome.start(FAKE_LOOP, 0.6, 60)
    const listener = playlistListeners.at(-1)!
    const genAfterStart = output.metronome.transport!.snapshot().generation
    for (const r of reports) {
      setClock(r.atMs)
      listener.fire({ currentTime: r.currentTime, duration: 1.0 })
    }
    return output.metronome.transport!.snapshot().generation - genAfterStart
  }

  /**
   * The realistic case, and the one that reproduces the storm: a metronome
   * whose 1000 ms loop is sampled every 500 ms. Audio position is exactly
   * `(elapsed % loop)`, so the reports alternate 0.5 → 0.0 → 0.5 → 0.0,
   * and every other one is a true wrap sitting exactly half a loop
   * backwards.
   */
  function steadyCadenceReports(count: number) {
    return Array.from({ length: count }, (_, i) => {
      const elapsedMs = (i + 1) * 500
      return { atMs: 1_000 + elapsedMs, currentTime: (elapsedMs % 1_000) / 1_000 }
    })
  }

  it('never re-anchors across a steady 500 ms cadence — the storm regression', () => {
    // v3 fails here on the third report: the wrap at exactly half a loop
    // fails its STRICT `backwardsBy > 0.5 * loop`, the callback returns
    // without updating the reference, and the next in-order report is then
    // a full loop adrift → hard re-anchor. Repeat forever = the storm.
    expect(reAnchorsDuring(steadyCadenceReports(12))).toBe(0)
  })

  it('never re-anchors across a multi-loop JS stall', () => {
    // A 2.5 s gap spans two whole loops. The delta formula resolves it
    // with the same arithmetic as a single wrap — no special case.
    expect(
      reAnchorsDuring([
        { atMs: 1_500, currentTime: 0.5 },
        { atMs: 4_000, currentTime: 0.0 },
        { atMs: 4_500, currentTime: 0.5 },
      ]),
    ).toBe(0)
  })

  it('never re-anchors on ordinary forward progress', () => {
    // The v1/v2 failure direction: a plain forward step must not round up
    // to a wrap. An over-count would put the estimate a full loop ahead
    // and force a re-anchor.
    expect(
      reAnchorsDuring([
        { atMs: 1_200, currentTime: 0.2 },
        { atMs: 1_400, currentTime: 0.4 },
        { atMs: 1_600, currentTime: 0.6 },
        { atMs: 1_800, currentTime: 0.8 },
      ]),
    ).toBe(0)
  })

  it('ignores a duplicate callback at the same instant', () => {
    // gap === 0 leaves no delta to measure; the stale report must be
    // dropped rather than counted as a wrap.
    expect(
      reAnchorsDuring([
        { atMs: 1_500, currentTime: 0.5 },
        { atMs: 2_000, currentTime: 0.0 },
        { atMs: 2_000, currentTime: 0.0 },
        { atMs: 2_500, currentTime: 0.5 },
      ]),
    ).toBe(0)
  })

  it('treats the first report of a run as a baseline only', () => {
    // No delta exists yet, so nothing is corrected; the transport is still
    // running on its own JS estimate at 100 ms elapsed = 96 ticks. Were
    // the first report acted on, the 0.4 s position would drag the anchor.
    const { output, setClock } = buildOutputWithControlledClock()
    setClock(1_000)
    output.metronome.start(FAKE_LOOP, 0.6, 60)
    const listener = playlistListeners.at(-1)!
    setClock(1_100)
    listener.fire({ currentTime: 0.4, duration: 1.0 })
    expect(output.metronome.transport!.currentTick()).toBeCloseTo(96, 0)
  })

  it('re-seeds the baseline after stop/start so a stale sample cannot leak', () => {
    const { output, setClock } = buildOutputWithControlledClock()
    setClock(1_000)
    output.metronome.start(FAKE_LOOP, 0.6, 60)
    const first = playlistListeners.at(-1)!
    setClock(1_500)
    first.fire({ currentTime: 0.5, duration: 1.0 })

    output.metronome.stop()
    setClock(10_000)
    output.metronome.start(FAKE_LOOP, 0.6, 60)
    const second = playlistListeners.at(-1)!
    // First report of the NEW run: baseline only, no correction, so the
    // huge wall gap across the restart cannot be read as thousands of wraps.
    setClock(10_100)
    second.fire({ currentTime: 0.4, duration: 1.0 })
    expect(output.metronome.transport!.currentTick()).toBeCloseTo(96, 0)
  })
  })
})

describe('metronome.notifyDisruption port method (W0-d)', () => {
  it('bumps transport generation without resetting the tick', () => {
    const output = buildOutput()
    output.metronome.start(FAKE_LOOP, 0.6, 60)
    const genBefore = output.metronome.transport!.snapshot().generation
    const tickBefore = output.metronome.transport!.currentTick()

    output.metronome.notifyDisruption!('bluetooth-route-change')

    const snap = output.metronome.transport!.snapshot()
    expect(snap.generation).toBe(genBefore + 1)
    expect(snap.state).toBe('running')
    // Tick preserved to within the arithmetic tolerance of the
    // controlled clock (buildOutput's clock doesn't advance
    // between the reads, so should be exact).
    expect(output.metronome.transport!.currentTick()).toBe(tickBefore)
  })

  it('is a no-op when the transport was never started', () => {
    const output = buildOutput()
    const before = output.metronome.transport!.snapshot()
    output.metronome.notifyDisruption!('unused')
    const after = output.metronome.transport!.snapshot()
    expect(after).toEqual(before)
  })
})

describe('metronome/coach isolation (principle #20)', () => {
  it('coach activity never touches the transport state', async () => {
    const output = buildOutput()
    await output.preload()
    output.metronome.start(FAKE_LOOP, 0.6, 60)
    const before = output.metronome.transport!.snapshot()

    // Fire coach activity across every lane the port exposes: single
    // asset, a phrase, a callout-style asset. Any of these reaching
    // into the metronome's lifecycle would surface as a generation
    // bump or a state flip.
    output.playAsset('1')
    output.playPhrase?.(['1', '2', '3'])
    output.playAsset('bell')
    output.tone('warning')

    const after = output.metronome.transport!.snapshot()
    expect(after.state).toBe(before.state)
    expect(after.generation).toBe(before.generation)
    expect(after.baseBpm).toBe(before.baseBpm)
  })
})
