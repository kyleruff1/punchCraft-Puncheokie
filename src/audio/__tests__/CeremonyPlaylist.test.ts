/**
 * The `CeremonyPlaylist` handle's own contract — the parts that used to exist
 * as three hand-kept copies inside IntroPlayer, RecoveryPlayer and
 * RoundWarningPlayer, and drifted.
 *
 * The players' tests (ceremonyObserver, pauseResumeInPlace) still drive every
 * public behaviour through the players and pass unchanged. What this file
 * pins is the handle-level rule each of those copies had once gotten wrong
 * somewhere: teardown order, the latch following the playlist, the missing
 * silence track being named in the log, and the dispatch stamp landing after
 * the volume setter.
 */
import { createAudioPlaylist } from 'expo-audio'

import { CeremonyPlaylist } from '../CeremonyPlaylist'
import { PlaybackObserver, type ObservedRecord, type StatusLike } from '../PlaybackObserver'
import { logger } from '@/diagnostics/logger'

interface PlaylistStub {
  opts: { sources: unknown[]; loop: string; updateInterval: number }
  play: jest.Mock
  pause: jest.Mock
  destroy: jest.Mock
  addListener: jest.Mock
  remove: jest.Mock
  /** What `volume` was at the moment `play()` was called. */
  volumeAtPlay: number | null
  playing: boolean
  volume: number
}

const playlists: PlaylistStub[] = []

jest.mock('expo-audio', () => ({
  createAudioPlaylist: jest.fn((opts: PlaylistStub['opts']) => {
    const stub: PlaylistStub = {
      opts,
      play: jest.fn(() => {
        stub.volumeAtPlay = stub.volume
        stub.playing = true
      }),
      pause: jest.fn(() => {
        stub.playing = false
      }),
      destroy: jest.fn(),
      remove: jest.fn(),
      addListener: jest.fn((_event: string, _cb: (status: StatusLike) => void) => ({ remove: () => stub.remove() })),
      volumeAtPlay: null,
      playing: false,
      volume: 0,
    }
    playlists.push(stub)
    return stub
  }),
}))

jest.mock('@/diagnostics/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
  safe: (v: unknown) => v,
}))

function rig(): { observer: PlaybackObserver; records: ObservedRecord[] } {
  const records: ObservedRecord[] = []
  const observer = new PlaybackObserver({
    clock: () => 10_000,
    schedule: () => ({}),
    cancelScheduled: () => undefined,
    onObserved: (r) => records.push(r),
  })
  return { observer, records }
}

beforeEach(() => {
  playlists.length = 0
  jest.clearAllMocks()
})

describe('silenceTrack', () => {
  it('returns nothing for a zero gap, silently', () => {
    const pl = new CeremonyPlaylist(null, 'puncheokie.test')
    expect(pl.silenceTrack(0, {})).toBeUndefined()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('names a gap with no track in the log, for every ceremony', () => {
    // Two of the three players logged this and one did not — the round
    // warning would silently drop its breath. The lookup logs now, so no
    // caller can forget to.
    const pl = new CeremonyPlaylist(null, 'puncheokie.test')
    expect(pl.silenceTrack(123, { round: 4 })).toBeUndefined()
    expect(logger.warn).toHaveBeenCalledWith('puncheokie.test', 'no silence track for planned gap', { round: 4, gapMs: 123 })
  })
})

describe('build', () => {
  it('an empty source list builds nothing and says so with its return value', () => {
    const pl = new CeremonyPlaylist(null, 'puncheokie.test')
    expect(pl.build([], 0, 'x loaded', {})).toBe(false)
    expect(pl.loaded).toBe(false)
    expect(createAudioPlaylist).not.toHaveBeenCalled()
  })

  it('a native throw leaves no playlist, logs it, and returns false', () => {
    // This return value is what lets each player set its idempotence latch
    // only when there is something to be idempotent about — the rule whose
    // absence in one copy latched a round out of its countdown (fd700e4d).
    ;(createAudioPlaylist as jest.Mock).mockImplementationOnce(() => {
      throw new Error('transient native failure')
    })
    const pl = new CeremonyPlaylist(null, 'puncheokie.test')
    expect(pl.build([1, 2], 500, 'x loaded', { round: 2 })).toBe(false)
    expect(pl.loaded).toBe(false)
    expect(pl.plannedMs).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith('puncheokie.test', 'playlist creation failed', expect.objectContaining({ round: 2 }))
  })

  it('logs the ceremony’s own message with the track and boundary counts', () => {
    const pl = new CeremonyPlaylist(null, 'puncheokie.test')
    expect(pl.build([1, 9, 2, 9, 3], 4_000, 'round warning prepared', { round: 2 })).toBe(true)
    expect(pl.loaded).toBe(true)
    expect(pl.plannedMs).toBe(4_000)
    expect(pl.tracks).toBe(5)
    expect(logger.info).toHaveBeenCalledWith('puncheokie.test', 'round warning prepared', {
      round: 2,
      plannedMs: 4_000,
      tracks: 5,
      boundaries: 4,
    })
  })

  it('cadence follows the observer: 40 ms observed, 500 unobserved', () => {
    new CeremonyPlaylist(rig().observer, 'a').build([1], 100, 'm', {})
    new CeremonyPlaylist(null, 'b').build([1], 100, 'm', {})
    expect(playlists[0]!.opts.updateInterval).toBe(40)
    expect(playlists[1]!.opts.updateInterval).toBe(500)
  })

  it('rebuilding frees the previous playlist first', () => {
    const pl = new CeremonyPlaylist(null, 'puncheokie.test')
    pl.build([1], 100, 'm', {})
    pl.build([2], 200, 'm', {})
    expect(playlists).toHaveLength(2)
    expect(playlists[0]!.destroy).toHaveBeenCalledTimes(1)
    expect(playlists[1]!.destroy).not.toHaveBeenCalled()
    expect(pl.plannedMs).toBe(200)
  })
})

describe('start', () => {
  it('sets the volume BEFORE play(), and stamps dispatch between them', () => {
    // WatchMeta documents dispatchMs as "clock() taken immediately before
    // play()". One of the three copies stamped it before the volume setter —
    // a JSI hop — which put that ceremony's onset latency in a slightly
    // different domain from the other two. One order now.
    const { observer } = rig()
    const pl = new CeremonyPlaylist(observer, 'puncheokie.test')
    pl.build([1], 1_000, 'm', {})
    const playId = pl.start(0.7, { kind: 'intro', label: 'intro', playIdPrefix: 'intro' })
    expect(playId).toBe('intro-1')
    expect(playlists[0]!.volumeAtPlay).toBe(0.7)
    expect(playlists[0]!.addListener).toHaveBeenCalledWith('playlistStatusUpdate', expect.any(Function))
    expect(observer.stats()).toMatchObject({ watched: 1, open: 1, listeners: 1 })
  })

  it('unobserved: plays, returns no playId, attaches no listener', () => {
    const pl = new CeremonyPlaylist(null, 'puncheokie.test')
    pl.build([1], 1_000, 'm', {})
    expect(pl.start(0.5, { kind: 'recovery', label: 'r', playIdPrefix: 'recovery' })).toBeNull()
    expect(playlists[0]!.play).toHaveBeenCalledTimes(1)
    expect(playlists[0]!.addListener).not.toHaveBeenCalled()
  })

  it('a native throw propagates — what a failed start means is the caller’s to decide', () => {
    const pl = new CeremonyPlaylist(null, 'puncheokie.test')
    pl.build([1], 1_000, 'm', {})
    playlists[0]!.play.mockImplementationOnce(() => {
      throw new Error('boom')
    })
    expect(() => pl.start(0.5, { kind: 'intro', label: 'i', playIdPrefix: 'intro' })).toThrow('boom')
  })
})

describe('pause / resume / playing', () => {
  it('a pause and resume in place is one observation — no re-watch', () => {
    const { observer } = rig()
    const pl = new CeremonyPlaylist(observer, 'puncheokie.test')
    pl.build([1], 1_000, 'm', {})
    pl.start(0.7, { kind: 'recovery', label: 'r', playIdPrefix: 'recovery' })
    expect(pl.playing).toBe(true)
    pl.pause()
    expect(pl.playing).toBe(false)
    expect(playlists[0]!.destroy).not.toHaveBeenCalled()
    pl.resume(0.9)
    expect(playlists[0]!.play).toHaveBeenCalledTimes(2)
    expect(playlists[0]!.volumeAtPlay).toBe(0.9)
    expect(observer.stats().watched).toBe(1)
  })

  it('pause never throws, and playing is false with nothing built', () => {
    const pl = new CeremonyPlaylist(null, 'puncheokie.test')
    expect(() => pl.pause()).not.toThrow()
    expect(pl.playing).toBe(false)
  })
})

describe('dispose', () => {
  it('the observer lets go BEFORE the native teardown, and the open observation closes as released', () => {
    const { observer, records } = rig()
    const pl = new CeremonyPlaylist(observer, 'puncheokie.test')
    pl.build([1], 1_000, 'm', {})
    pl.start(0.7, { kind: 'intro', label: 'intro', playIdPrefix: 'intro' })
    pl.dispose()
    const stub = playlists[0]!
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'intro', outcome: 'released' })
    expect(stub.remove.mock.invocationCallOrder[0]!).toBeLessThan(stub.destroy.mock.invocationCallOrder[0]!)
    // pause + destroy + release — destroy() alone is a registry unlink.
    expect(stub.pause).toHaveBeenCalled()
    expect(pl.loaded).toBe(false)
    expect(pl.plannedMs).toBe(0)
    expect(observer.stats()).toMatchObject({ open: 0, listeners: 0 })
  })

  it('is safe repeatedly and on a handle that never built', () => {
    const pl = new CeremonyPlaylist(null, 'puncheokie.test')
    expect(() => {
      pl.dispose()
      pl.dispose()
    }).not.toThrow()
  })
})
