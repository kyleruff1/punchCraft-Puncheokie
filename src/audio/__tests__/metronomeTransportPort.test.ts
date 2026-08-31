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
jest.mock('expo-audio', () => ({
  createAudioPlayer: () => {
    throw new Error('expo-audio is not available in tests; inject createPlayer')
  },
  createAudioPlaylist: () => ({
    play: () => {},
    pause: () => {},
    seekTo: () => {},
    destroy: () => {},
    volume: 0,
  }),
  setAudioModeAsync: async () => undefined,
}))
jest.mock('expo-speech', () => ({ speak: () => {}, stop: () => {} }))

import { VoiceOutputExpo } from '../VoiceOutputExpo'
import { TRANSPORT_TICKS_PER_PULSE } from '@/domain/timing/TimingEngine'

const FAKE_LOOP = { module: 1, division: 4 as const, swing: 0, durationMs: 1_000 }

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
