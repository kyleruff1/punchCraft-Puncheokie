/**
 * MetronomePlayer (M39-V1b / #280).
 *
 * The behaviours worth guarding here are the ones with a wrong-but-plausible
 * alternative:
 *
 * - `start(loop, v)` with the SAME loop already loaded seeks-and-resumes; it
 *   does NOT rebuild the playlist. A rebuild is what causes the audible click
 *   Kyle noticed when a play state was toggled without a division change.
 * - A different loop tears the previous playlist down before building the new
 *   one — otherwise the old and new play concurrently.
 * - `stop()` tears the playlist down (not pause). The next `start()` after a
 *   stop is expected to begin on the downbeat, never mid-bar.
 * - A `createAudioPlaylist` throw is fatal for the SESSION: every subsequent
 *   call is a no-op. The workout keeps running with the click silent — a
 *   thrown play error must never propagate to the caller (mirrors
 *   `IntroPlayer`'s log-and-continue posture).
 * - `setVolume` updates the live playlist without a rebuild.
 */
interface FakePlaylist {
  volume: number
  playing: boolean
  playCount: number
  pauseCount: number
  destroyed: boolean
  seekCount: number
  play(): void
  pause(): void
  seekTo(seconds: number): Promise<void>
  destroy(): void
}

const mockBuilt: FakePlaylist[] = []
const mockControl = { throwOnCreate: false }

jest.mock('expo-audio', () => ({
  createAudioPlaylist: (
    opts: { sources: unknown[]; loop: string; updateInterval: number },
  ): FakePlaylist => {
    if (mockControl.throwOnCreate) {
      throw new Error('native init refused')
    }
    const pl: FakePlaylist = {
      volume: 1,
      playing: false,
      playCount: 0,
      pauseCount: 0,
      destroyed: false,
      seekCount: 0,
      play() {
        this.playCount += 1
        this.playing = true
      },
      pause() {
        this.pauseCount += 1
        this.playing = false
      },
      async seekTo() {
        this.seekCount += 1
      },
      destroy() {
        this.destroyed = true
      },
    }
    mockBuilt.push(pl)
    // Retain the loop mode arg on the playlist so a test can assert we pass
    // the correct native loop mode ('single' — the 60 BPM one-bar loop).
    ;(pl as unknown as { loopMode: string }).loopMode = opts.loop
    return pl
  },
}))

import { MetronomePlayer } from '../MetronomePlayer'
import type { MetronomeLoop } from '../voiceAssets/metronomeAssets'

// A `require` id is a `number` under Metro — the fixture keeps two distinct
// module ids so the same-vs-different-loop branch flips on identity.
const LOOP_A: MetronomeLoop = {
  baseBpm: 60,
  division: 2,
  swing: 0.54,
  durationMs: 1_000,
  module: 42,
}
const LOOP_B: MetronomeLoop = {
  baseBpm: 60,
  division: 4,
  swing: 0.5,
  durationMs: 1_000,
  module: 99,
}

beforeEach(() => {
  mockBuilt.length = 0
  mockControl.throwOnCreate = false
})

describe('MetronomePlayer', () => {
  it('builds one playlist on first start and plays it at the requested volume', () => {
    const p = new MetronomePlayer()
    p.start(LOOP_A, 0.7)

    expect(mockBuilt).toHaveLength(1)
    expect(mockBuilt[0]!.playCount).toBe(1)
    expect(mockBuilt[0]!.volume).toBeCloseTo(0.7, 5)
    expect((mockBuilt[0] as unknown as { loopMode: string }).loopMode).toBe('single')
    expect(p.isAvailable()).toBe(true)
  })

  it('same-loop start reuses the playlist (seek + play) — does not rebuild', () => {
    const p = new MetronomePlayer()
    p.start(LOOP_A, 0.5)
    p.start(LOOP_A, 0.5)

    expect(mockBuilt).toHaveLength(1)
    expect(mockBuilt[0]!.seekCount).toBe(1)
    // Two plays: the first from initial start, the second from the seek+play.
    expect(mockBuilt[0]!.playCount).toBe(2)
    expect(mockBuilt[0]!.destroyed).toBe(false)
  })

  it('different-loop start destroys the old playlist before building a new one', () => {
    const p = new MetronomePlayer()
    p.start(LOOP_A, 0.5)
    p.start(LOOP_B, 0.5)

    expect(mockBuilt).toHaveLength(2)
    expect(mockBuilt[0]!.destroyed).toBe(true)
    expect(mockBuilt[1]!.playCount).toBe(1)
    expect(mockBuilt[1]!.destroyed).toBe(false)
  })

  it('stop tears the playlist down (so the next start begins on the downbeat)', () => {
    const p = new MetronomePlayer()
    p.start(LOOP_A, 0.5)
    p.stop()

    expect(mockBuilt[0]!.pauseCount).toBe(1)
    expect(mockBuilt[0]!.destroyed).toBe(true)

    p.start(LOOP_A, 0.5)
    // A fresh playlist — not a seek on the destroyed one.
    expect(mockBuilt).toHaveLength(2)
    expect(mockBuilt[1]!.playCount).toBe(1)
  })

  it('setVolume updates the live playlist without rebuilding', () => {
    const p = new MetronomePlayer()
    p.start(LOOP_A, 0.4)
    p.setVolume(0.9)

    expect(mockBuilt).toHaveLength(1)
    expect(mockBuilt[0]!.volume).toBeCloseTo(0.9, 5)
  })

  it('clamps volume into [0, 1]', () => {
    const p = new MetronomePlayer()
    p.start(LOOP_A, 5)
    expect(mockBuilt[0]!.volume).toBe(1)

    p.setVolume(-0.5)
    expect(mockBuilt[0]!.volume).toBe(0)
  })

  it('a createAudioPlaylist throw disables the player for the session', () => {
    mockControl.throwOnCreate = true
    const p = new MetronomePlayer()

    expect(() => p.start(LOOP_A, 0.5)).not.toThrow()
    expect(p.isAvailable()).toBe(false)

    // Recovery attempts stay silent — never re-enter native code.
    mockControl.throwOnCreate = false
    p.start(LOOP_A, 0.5)
    p.stop()
    p.setVolume(0.7)
    expect(mockBuilt).toHaveLength(0)
  })
})
