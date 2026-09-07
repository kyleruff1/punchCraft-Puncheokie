/**
 * InstrumentVoiceOutput (M40-15 #319) — the tablet instrument engine.
 *
 * The behaviours worth guarding are the ones with a wrong-but-plausible
 * alternative:
 *
 * - identical selection must NOT rebuild the native playlists (R4 "swap
 *   only when the selection changed") — a rebuild per punch is the audible
 *   click AND the churn that stalls the audio thread.
 * - a retrigger while sounding must pause BEFORE the rewind and play only
 *   when the seek lands (the shllck lesson), with a stalled-seek fallback
 *   that plays anyway — degraded, never silent.
 * - the failure posture is MetronomePlayer verbatim: a playlist-creation
 *   throw disables the instrument for the session and never reaches the
 *   caller; ONE bad one-shot clip loses one note, not the voice.
 * - panic keeps the pools resident but must silence in-flight dispatches:
 *   a pending retrigger seek (or its stalled-seek fallback) firing AFTER
 *   panic would sound a one-shot after the user demanded silence.
 * - release frees everything.
 *
 * Everything is driven through the injected seams — no native binding, no
 * timers, no real expo-audio.
 */
import type { AudioPlayer, AudioPlaylist } from 'expo-audio'

jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(),
  createAudioPlaylist: jest.fn(),
  setAudioModeAsync: jest.fn(async () => undefined),
}))

import type {
  CompiledPunchGesture,
  ImmediateAccent,
  QuantizedChange,
} from '@domain/instrument/gestureSchema'

import {
  InstrumentVoiceOutput,
  ONE_SHOT_REARM_PAD_MS,
  STALLED_SEEK_FALLBACK_MS,
} from '../InstrumentVoiceOutput'
import { INSTRUMENT_BANKS } from '../voiceAssets/instrumentBankManifest'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakePlayer {
  volume: number
  playCount: number
  pauseCount: number
  removed: boolean
  seekCount: number
  play(): void
  pause(): void
  seekTo(seconds: number): Promise<void>
  remove(): void
}

interface FakePlaylist {
  opts: { sources: number[]; loop: string; updateInterval: number }
  volume: number
  playCount: number
  pauseCount: number
  destroyed: boolean
  play(): void
  pause(): void
  destroy(): void
}

interface Scheduled {
  fn: () => void
  delayMs: number
  cancelled: boolean
  ran: boolean
}

function makeHarness() {
  const players: FakePlayer[] = []
  const playlists: FakePlaylist[] = []
  const scheduled: Scheduled[] = []
  const audioModeCalls: unknown[] = []
  const pendingSeeks: Array<() => void> = []
  const control = {
    autoResolveSeeks: true,
    throwOnPlaylist: false,
    /** Player creation throws while this counts down past 0 at this index. */
    throwOnPlayerIndex: -1 as number,
    rejectAudioMode: false,
  }

  const engine = new InstrumentVoiceOutput({
    createPlayer: () => {
      if (players.length === control.throwOnPlayerIndex) {
        players.push(brokenPlayer())
        throw new Error('AudioTrack refused')
      }
      const player: FakePlayer = {
        volume: 1,
        playCount: 0,
        pauseCount: 0,
        removed: false,
        seekCount: 0,
        play() {
          this.playCount += 1
        },
        pause() {
          this.pauseCount += 1
        },
        seekTo() {
          this.seekCount += 1
          if (control.autoResolveSeeks) return Promise.resolve()
          return new Promise<void>((resolve) => pendingSeeks.push(resolve))
        },
        remove() {
          this.removed = true
        },
      }
      players.push(player)
      return player as unknown as AudioPlayer
    },
    createPlaylist: (opts) => {
      if (control.throwOnPlaylist) throw new Error('native init refused')
      const playlist: FakePlaylist = {
        opts,
        volume: 1,
        playCount: 0,
        pauseCount: 0,
        destroyed: false,
        play() {
          this.playCount += 1
        },
        pause() {
          this.pauseCount += 1
        },
        destroy() {
          this.destroyed = true
        },
      }
      playlists.push(playlist)
      return playlist as unknown as AudioPlaylist
    },
    schedule: (fn, delayMs) => {
      const entry: Scheduled = { fn, delayMs, cancelled: false, ran: false }
      scheduled.push(entry)
      return entry
    },
    cancelScheduled: (handle) => {
      ;(handle as Scheduled).cancelled = true
    },
    clock: () => 0,
    setAudioMode: async (mode) => {
      audioModeCalls.push(mode)
      if (control.rejectAudioMode) throw new Error('audio mode refused')
    },
  })

  /** Placeholder so index bookkeeping survives a creation throw. */
  function brokenPlayer(): FakePlayer {
    return {
      volume: 0,
      playCount: 0,
      pauseCount: 0,
      removed: true,
      seekCount: 0,
      play() {},
      pause() {},
      seekTo: () => Promise.resolve(),
      remove() {},
    }
  }

  /** Run every not-yet-run, not-cancelled timer (a burst of due work). */
  const fireScheduled = (): void => {
    for (const entry of [...scheduled]) {
      if (entry.cancelled || entry.ran) continue
      entry.ran = true
      entry.fn()
    }
  }

  const flush = async (): Promise<void> => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  }

  const resolveSeeks = async (): Promise<void> => {
    for (const resolve of pendingSeeks.splice(0)) resolve()
    await flush()
  }

  return {
    engine,
    players,
    playlists,
    scheduled,
    audioModeCalls,
    control,
    fireScheduled,
    flush,
    resolveSeeks,
  }
}

// Pool creation order during preload: stab keys in manifest order, then the
// drums. The transformer flattens every wav module to `1`, so ORDER is
// the only honest identity fakes can key on.
import { KIT_DRUM_WARM_SET } from '../instrumentBankKeys'

const STAB_KEYS = Object.keys(INSTRUMENT_BANKS.brass.stabs)
const DRUM_KEYS = Object.keys(INSTRUMENT_BANKS.brass.drums)
const stabIndex = (key: string): number => STAB_KEYS.indexOf(key)
// The Punch Kit's warm set preloads between the stabs and the legacy drums,
// so the legacy drum players start after both.
const DRUM_BASE = STAB_KEYS.length + KIT_DRUM_WARM_SET.length
// Derived, not hardcoded: the drum bank grew a low tom with M40-28, and the
// Punch Kit's warm set joined the pool with the tablet wiring. The kit's rare
// pieces (crash, bell, rimshot, hats, sub kick, tight ride, rim) stay LAZY, so
// they are deliberately absent from this count.
const POOL_SIZE = STAB_KEYS.length + KIT_DRUM_WARM_SET.length + DRUM_KEYS.length

// ---------------------------------------------------------------------------
// Gesture fixtures
// ---------------------------------------------------------------------------

function accent(overrides: Partial<ImmediateAccent> = {}): ImmediateAccent {
  return { midiNote: 57, midiVelocity: 100, channel: 4, gateMs: 120, ...overrides }
}

function quantized(overrides: Partial<QuantizedChange> = {}): QuantizedChange {
  return {
    cubeCellId: 'L3R2',
    chordName: 'Am11',
    bassMidiNote: 33,
    bassChannel: 2,
    chordMidiNotes: [64, 67, 74, 81, 57, 60],
    arpStartIndex: 2,
    arpPattern: [0, 2, 1, 3, 2, 4, 3, 5],
    arpChannel: 3,
    notesPerMinute: 120,
    gateRatio: 0.65,
    patternDepth: 4,
    activityLayer: 1,
    activityPps: 2,
    retrigger: 'quantized-rotate',
    backend: 'punchbridge-tick',
    ...overrides,
  }
}

function gesture(blocks: {
  accent?: ImmediateAccent
  quantized?: QuantizedChange
  drums?: CompiledPunchGesture['drums']
}): CompiledPunchGesture {
  return {
    schemaVersion: 1,
    sessionId: 'test',
    eventId: 'e1',
    mapHash: 'deadbeef',
    source: {
      hand: 'left',
      receivedMonotonicTimeMs: 1_000,
      velocity01: 0.5,
      acceleration01: 0.5,
      punchRate01: 0.2,
      gapSincePreviousPunchMs: 500,
      alternating: false,
    },
    cube: {
      leftZone: 3,
      rightZone: 2,
      activityLayer: 1,
      changedAxis: 'left',
      targetCoordinate: [3, 2, 1],
    },
    voice: {
      voiceId: 'left',
      midiChannel: 1,
      targetNote: 57,
      noteVelocity: 90,
      brightness: 0.5,
      expression: 0.5,
      transition: 'attack',
      transitionDurationMs: 0,
      pitchOvershootCents: 0,
    },
    transient: { note: 36, velocity: 80, layer: 'generic' },
    visual: {
      quadrant: 'upper-left',
      hueDegrees: 0,
      opacity: 0.5,
      radius: 10,
      persistenceMs: 200,
      transitionRibbonMs: 0,
    },
    ...(blocks.accent ? { accent: blocks.accent } : {}),
    ...(blocks.quantized ? { quantized: blocks.quantized } : {}),
    ...(blocks.drums ? { drums: blocks.drums } : {}),
  }
}

const fullGesture = (): CompiledPunchGesture =>
  gesture({ accent: accent(), quantized: quantized() })

// ---------------------------------------------------------------------------

describe('preload', () => {
  it('warms one pooled player per stab and drum, in silent-mode mixWithOthers', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')

    expect(h.audioModeCalls).toEqual([
      { playsInSilentMode: true, interruptionMode: 'mixWithOthers' },
    ])
    expect(h.players).toHaveLength(POOL_SIZE)
    expect(h.playlists).toHaveLength(0)
    expect(h.engine.available).toBe(true)
  })

  it('a setAudioMode failure disables the instrument for the session', async () => {
    const h = makeHarness()
    h.control.rejectAudioMode = true
    await expect(h.engine.preload('brass')).resolves.toBeUndefined()

    expect(h.engine.available).toBe(false)
    expect(h.players).toHaveLength(0)

    // Every subsequent call is a no-op — never re-enters native code.
    h.engine.handleGesture(fullGesture())
    h.engine.setTexture('pluck')
    h.engine.panic()
    h.engine.release()
    expect(h.players).toHaveLength(0)
    expect(h.playlists).toHaveLength(0)
  })

  it('one bad clip loses one note, not the voice', async () => {
    const h = makeHarness()
    h.control.throwOnPlayerIndex = stabIndex('stab-48')
    await h.engine.preload('brass')

    expect(h.engine.available).toBe(true)
    // The broken slot holds a placeholder; the rest of the pool loaded.
    expect(h.players.filter((p) => !p.removed)).toHaveLength(POOL_SIZE - 1)
  })
})

describe('handleGesture — one-shots and loop swaps', () => {
  it('fires the stab and drum at velocity gains, then starts bed + bass loops', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(fullGesture())

    const stab = h.players[stabIndex('stab-57')]!
    expect(stab.playCount).toBe(1)
    expect(stab.volume).toBeCloseTo(100 / 127, 5)
    const kick = h.players[DRUM_BASE]!
    expect(kick.playCount).toBe(1)
    expect(kick.volume).toBeCloseTo(80 / 127, 5)

    // Bed first, then bass — one native loop each, at full volume (all
    // level trims are baked into the wavs).
    expect(h.playlists).toHaveLength(2)
    for (const playlist of h.playlists) {
      expect(playlist.opts.loop).toBe('single')
      expect(playlist.opts.updateInterval).toBe(500)
      expect(playlist.opts.sources).toHaveLength(1)
      expect(playlist.volume).toBe(1)
      expect(playlist.playCount).toBe(1)
      expect(playlist.destroyed).toBe(false)
    }
  })

  it('an identical selection leaves the sounding loops untouched', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(fullGesture())
    h.engine.handleGesture(fullGesture())

    expect(h.playlists).toHaveLength(2)
    expect(h.playlists.every((p) => !p.destroyed)).toBe(true)
  })

  it('a chord change tears the old loops down and builds both anew', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(fullGesture())
    h.engine.handleGesture(
      gesture({ accent: accent({ midiNote: 53 }), quantized: quantized({ cubeCellId: 'L1R0' }) }),
    )

    expect(h.playlists).toHaveLength(4)
    expect(h.playlists[0]!.destroyed).toBe(true)
    expect(h.playlists[1]!.destroyed).toBe(true)
    expect(h.playlists[2]!.destroyed).toBe(false)
    expect(h.playlists[3]!.destroyed).toBe(false)
  })

  it('a layer-only change swaps the bed and leaves the bass alone', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(fullGesture())
    h.engine.handleGesture(
      gesture({
        accent: accent(),
        quantized: quantized({ notesPerMinute: 240, patternDepth: 8, activityLayer: 3 }),
      }),
    )

    expect(h.playlists).toHaveLength(3)
    expect(h.playlists[0]!.destroyed).toBe(true) // old bed
    expect(h.playlists[1]!.destroyed).toBe(false) // bass, untouched
  })

  it('a legacy gesture plays a drum and touches no loops', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(gesture({}))

    expect(h.players[DRUM_BASE]!.playCount).toBe(1)
    expect(h.playlists).toHaveLength(0)
  })
})

describe('one-shot arm / retrigger mechanics', () => {
  it('an armed player plays instantly; the re-arm timer parks it back at 0', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(fullGesture())

    const stab = h.players[stabIndex('stab-57')]!
    expect(stab.playCount).toBe(1)
    expect(stab.seekCount).toBe(0)
    const rearm = h.scheduled.find(
      (s) => s.delayMs === INSTRUMENT_BANKS.brass.stabs['stab-57']!.durationMs + ONE_SHOT_REARM_PAD_MS,
    )
    expect(rearm).toBeDefined()

    // The re-arm pauses FIRST (the voice-storm lesson), then rewinds.
    h.fireScheduled()
    expect(stab.pauseCount).toBe(1)
    expect(stab.seekCount).toBe(1)
    await h.flush()

    // Re-armed: the next dispatch plays instantly again, no rewind race.
    h.engine.handleGesture(fullGesture())
    expect(stab.playCount).toBe(2)
    expect(stab.seekCount).toBe(1)
  })

  it('a retrigger while sounding pauses, rewinds, and plays when the seek lands', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.control.autoResolveSeeks = false

    h.engine.handleGesture(fullGesture()) // armed → instant
    h.engine.handleGesture(fullGesture()) // retrigger → pause + seek

    const stab = h.players[stabIndex('stab-57')]!
    expect(stab.playCount).toBe(1)
    expect(stab.pauseCount).toBe(1)
    expect(stab.seekCount).toBe(1)

    await h.resolveSeeks()
    expect(stab.playCount).toBe(2)
  })

  it('a stalled rewind still plays — degraded, never silent, never doubled', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.control.autoResolveSeeks = false

    h.engine.handleGesture(fullGesture())
    h.engine.handleGesture(fullGesture())

    const stab = h.players[stabIndex('stab-57')]!
    const fallback = h.scheduled.find(
      (s) => s.delayMs === STALLED_SEEK_FALLBACK_MS && !s.cancelled,
    )
    expect(fallback).toBeDefined()
    fallback!.ran = true
    fallback!.fn()
    expect(stab.playCount).toBe(2)

    // The late seek must not play a second time.
    await h.resolveSeeks()
    expect(stab.playCount).toBe(2)
  })
})

describe('failure posture — MetronomePlayer verbatim', () => {
  it('a playlist-creation throw disables the instrument and tears everything down', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.control.throwOnPlaylist = true

    expect(() => h.engine.handleGesture(fullGesture())).not.toThrow()
    expect(h.engine.available).toBe(false)
    expect(h.players.every((p) => p.removed)).toBe(true)

    // Recovery attempts stay silent — never re-enter native code.
    h.control.throwOnPlaylist = false
    const playersBefore = h.players.length
    h.engine.handleGesture(fullGesture())
    expect(h.players).toHaveLength(playersBefore)
    expect(h.playlists.filter((p) => !p.destroyed)).toHaveLength(0)
  })
})

describe('setTexture', () => {
  it('re-preloads the pools and rebuilds the sounding loops from the new bank', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(fullGesture())

    h.engine.setTexture('pluck')

    // Old pool freed, new pool warmed (same size — same key scheme).
    expect(h.players.slice(0, POOL_SIZE).every((p) => p.removed)).toBe(true)
    expect(h.players).toHaveLength(POOL_SIZE * 2)
    expect(h.players.slice(POOL_SIZE).every((p) => !p.removed)).toBe(true)

    // The groove survives the flip: both loops rebuilt for the same keys.
    expect(h.playlists).toHaveLength(4)
    expect(h.playlists[0]!.destroyed).toBe(true)
    expect(h.playlists[1]!.destroyed).toBe(true)
    expect(h.playlists[2]!.destroyed).toBe(false)
    expect(h.playlists[3]!.destroyed).toBe(false)
  })

  it('the same texture id is a no-op', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(fullGesture())
    h.engine.setTexture('brass')

    expect(h.players).toHaveLength(POOL_SIZE)
    expect(h.playlists).toHaveLength(2)
  })
})

describe('panic and release', () => {
  it('panic destroys the loops, pauses the pool, and keeps it resident', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(fullGesture())

    h.engine.panic()

    expect(h.playlists.every((p) => p.destroyed)).toBe(true)
    expect(h.players.every((p) => !p.removed)).toBe(true)
    expect(h.players[stabIndex('stab-57')]!.pauseCount).toBeGreaterThan(0)
    // Pending re-arm timers are cancelled — a stale timer must never touch
    // a panicked player.
    expect(h.scheduled.filter((s) => !s.ran).every((s) => s.cancelled)).toBe(true)

    // Keys cleared: the same gesture builds fresh loops on the downbeat.
    h.engine.handleGesture(fullGesture())
    expect(h.playlists).toHaveLength(4)
    expect(h.playlists[2]!.destroyed).toBe(false)
    expect(h.playlists[3]!.destroyed).toBe(false)
  })

  it('panic silences an in-flight retrigger — neither the stalled fallback nor the late seek plays', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.control.autoResolveSeeks = false

    h.engine.handleGesture(fullGesture()) // armed → instant play
    h.engine.handleGesture(fullGesture()) // retrigger → pause + pending seek + fallback timer

    const stab = h.players[stabIndex('stab-57')]!
    const kick = h.players[DRUM_BASE]!
    expect(stab.playCount).toBe(1)
    expect(kick.playCount).toBe(1)

    h.engine.panic()

    // The stalled-seek fallback timer is closure-local — panic cannot
    // cancel it, so the epoch bump must make it a no-op.
    h.fireScheduled()
    expect(stab.playCount).toBe(1)
    expect(kick.playCount).toBe(1)

    // The late seek resolution must stay silent too.
    await h.resolveSeeks()
    expect(stab.playCount).toBe(1)
    expect(kick.playCount).toBe(1)
  })

  it('a punch after panic still sounds — the pool recovers from the epoch bump', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.control.autoResolveSeeks = false

    h.engine.handleGesture(fullGesture())
    h.engine.handleGesture(fullGesture()) // pending retrigger
    h.engine.panic()
    await h.resolveSeeks() // the stale seek lands silently

    const stab = h.players[stabIndex('stab-57')]!
    expect(stab.playCount).toBe(1)

    h.engine.handleGesture(fullGesture()) // fresh dispatch post-panic
    await h.resolveSeeks()
    expect(stab.playCount).toBe(2)
  })

  it('release removes every player and cancels pending re-arms', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(fullGesture())

    h.engine.release()

    expect(h.players.every((p) => p.removed)).toBe(true)
    expect(h.playlists.every((p) => p.destroyed)).toBe(true)
    expect(h.scheduled.filter((s) => !s.ran).every((s) => s.cancelled)).toBe(true)
  })
})

describe('Punch Kit playback (drum-kit-design §5.1)', () => {
  /** A minimal compiled drum gesture — the shape the compiler emits. */
  function drumBlock(
    hits: readonly { articulation: string; midiVelocity: number }[],
  ): CompiledPunchGesture['drums'] {
    return {
      schemaVersion: 1,
      eventId: 'e1',
      identitySource: 'guided-score',
      token: '2B',
      family: 'cross',
      target: 'body',
      accentBand: 'normal',
      hits: hits.map((h) => ({
        articulation: h.articulation,
        midiVelocity: h.midiVelocity,
        lane: 'cross',
        gateMs: 30,
        priority: 'direct',
        role: 'primary',
        group: 'snare',
      })),
      arpMutation: 'power-land',
      grooveIntent: {
        role: 'backbeat',
        energy: { jab: 0, cross: 0.3, hook: 0, uppercut: 0, body: 0.2 },
      },
      fillIntent: { eligible: false, maxSubdivisions: 8 },
      timingPolicy: 'soft-grid',
      visual: { side: 0.6, group: 'snare', weight: 0.5, low: true },
    } as CompiledPunchGesture['drums']
  }

  it('plays every hit in the block, at the compiler’s velocities', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    const before = h.players.length
    h.engine.handleGesture(
      gesture({
        drums: drumBlock([
          { articulation: 'snare-body', midiVelocity: 118 },
          { articulation: 'kick-main', midiVelocity: 100 },
        ]),
      }),
    )
    // snare-body is a RARE piece — lazy, so it is created on this first use.
    // kick-main is in the warm set and was already pooled.
    expect(h.players.length).toBeGreaterThan(before)
    const played = h.players.filter((p: FakePlayer) => p.playCount > 0)
    expect(played).toHaveLength(2)
    // §9's curve already ran in the compiler; the pool only converts to gain.
    expect(played.some((p: FakePlayer) => Math.abs(p.volume - 118 / 127) < 1e-6)).toBe(true)
    expect(played.some((p: FakePlayer) => Math.abs(p.volume - 100 / 127) < 1e-6)).toBe(true)
  })

  it('SUPERSEDES the legacy five-piece drum — a punch is not hit twice', async () => {
    // Both layers firing would double every punch. The kit wins whenever the
    // gesture carries a compiled drum block.
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(
      gesture({ drums: drumBlock([{ articulation: 'ride-bow', midiVelocity: 90 }]) }),
    )
    const legacyDrums = h.players.slice(DRUM_BASE, DRUM_BASE + DRUM_KEYS.length)
    expect(legacyDrums.every((p: FakePlayer) => p.playCount === 0)).toBe(true)
    expect(h.players.filter((p: FakePlayer) => p.playCount > 0)).toHaveLength(1)
  })

  it('falls back to the legacy drum when a gesture carries no kit block', async () => {
    // v1 and legacy patches emit no drum block at all, and must keep sounding
    // exactly as before.
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(gesture({}))
    const legacyDrums = h.players.slice(DRUM_BASE, DRUM_BASE + DRUM_KEYS.length)
    expect(legacyDrums.some((p: FakePlayer) => p.playCount > 0)).toBe(true)
  })

  it('an empty hit list falls through rather than silencing the punch', async () => {
    const h = makeHarness()
    await h.engine.preload('brass')
    h.engine.handleGesture(gesture({ drums: drumBlock([]) }))
    const legacyDrums = h.players.slice(DRUM_BASE, DRUM_BASE + DRUM_KEYS.length)
    expect(legacyDrums.some((p: FakePlayer) => p.playCount > 0)).toBe(true)
  })
})
