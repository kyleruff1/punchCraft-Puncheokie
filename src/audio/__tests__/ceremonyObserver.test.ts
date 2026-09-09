/**
 * The ceremony players on the silent timing observer (GH #291, plan C2).
 *
 * IntroPlayer, RoundWarningPlayer, RecoveryPlayer and MetronomePlayer each
 * take an optional observer. The contract under test:
 *
 * - Observed, a playlist is built at the 40 ms status cadence and handed to
 *   the observer right after `play()`, with `dispatchMs` stamped BEFORE the
 *   play call and the planned length as `expectedDurationMs`. The record
 *   that closes carries the player's kind, so the analyzer can join it to
 *   the round boundary it belongs to.
 * - Unobserved, nothing changes: the 500 ms cadence, no listener, no
 *   record. The flag-off path is byte-identical to before C2.
 * - Every teardown forgets the playlist BEFORE the native release — an
 *   open observation closes as `released`, and the listener is gone.
 * - One listener per playlist, ever. The metronome's same-loop restart
 *   (seek + play, no rebuild) does not re-watch; a loop change forgets the
 *   old playlist and watches the new one.
 */
import { IntroPlayer } from '../IntroPlayer'
import { MetronomePlayer } from '../MetronomePlayer'
import { OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS, PlaybackObserver, type ObservedRecord, type StatusLike } from '../PlaybackObserver'
import { RecoveryPlayer } from '../RecoveryPlayer'
import { RoundWarningPlayer } from '../RoundWarningPlayer'
import type { MetronomeLoop } from '../voiceAssets/metronomeAssets'
import type { RecoveryScript } from '../voiceAssets/recoveryManifest'

interface PlaylistStub {
  opts: { sources: unknown[]; loop: string; updateInterval: number }
  play: jest.Mock
  pause: jest.Mock
  seekTo: jest.Mock
  destroy: jest.Mock
  addListener: jest.Mock
  remove: jest.Mock
  /** Push one `playlistStatusUpdate` into every attached listener. */
  emit(status: StatusLike): void
  playing: boolean
  volume: number
}

const playlists: PlaylistStub[] = []

jest.mock('expo-audio', () => ({
  createAudioPlaylist: jest.fn((opts: PlaylistStub['opts']) => {
    const listeners = new Map<string, Array<(status: StatusLike) => void>>()
    const stub: PlaylistStub = {
      opts,
      play: jest.fn(() => {
        stub.playing = true
      }),
      pause: jest.fn(() => {
        stub.playing = false
      }),
      seekTo: jest.fn(async () => undefined),
      destroy: jest.fn(),
      remove: jest.fn(),
      addListener: jest.fn((event: string, cb: (status: StatusLike) => void) => {
        const list = listeners.get(event) ?? []
        list.push(cb)
        listeners.set(event, list)
        return {
          remove: () => {
            stub.remove()
            listeners.set(
              event,
              (listeners.get(event) ?? []).filter((x) => x !== cb),
            )
          },
        }
      }),
      emit(status) {
        for (const cb of listeners.get('playlistStatusUpdate') ?? []) cb(status)
      },
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

/** A deterministic observer: manual clock, timers captured (never fired). */
function rig(): { observer: PlaybackObserver; records: ObservedRecord[]; tick: (ms: number) => void } {
  let now = 10_000
  const records: ObservedRecord[] = []
  const observer = new PlaybackObserver({
    clock: () => now,
    schedule: () => ({}),
    cancelScheduled: () => undefined,
    onObserved: (r) => records.push(r),
  })
  return {
    observer,
    records,
    tick: (ms) => {
      now += ms
    },
  }
}

const SEGMENTS = [
  { id: 'walk-1', module: 201, durationMs: 5_000, gapBeforeMs: 0 },
  { id: 'walk-2', module: 202, durationMs: 4_000, gapBeforeMs: 0 },
]

const script: RecoveryScript = {
  scriptId: 'R-test',
  category: 'breathing',
  hydrationPrompt: false,
  requiresStableBag: false,
  avoidIfDizzy: false,
  measuredTotalMs: 30_000,
  segments: [
    { id: 'seg-1', module: 101, durationMs: 4_000, pauseAfterMs: 0 },
    { id: 'seg-2', module: 102, durationMs: 4_000, pauseAfterMs: 0 },
  ],
} as unknown as RecoveryScript

const LOOP_A: MetronomeLoop = { baseBpm: 60, division: 2, swing: 0.54, durationMs: 1_000, module: 42 }
const LOOP_B: MetronomeLoop = { baseBpm: 60, division: 4, swing: 0.5, durationMs: 1_000, module: 99 }

beforeEach(() => {
  playlists.length = 0
  jest.clearAllMocks()
  jest.useFakeTimers()
})
afterEach(() => {
  jest.useRealTimers()
})

describe('IntroPlayer', () => {
  it('observed: 40 ms cadence, watched after play, record closes as intro with the planned length', () => {
    const { observer, records, tick } = rig()
    const player = new IntroPlayer({ observer })
    player.load(SEGMENTS)
    const playlist = playlists[0]!
    expect(playlist.opts.updateInterval).toBe(OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS)
    expect(playlist.addListener).not.toHaveBeenCalled() // nothing to observe until play

    player.play(0.8)
    expect(playlist.addListener).toHaveBeenCalledTimes(1)
    expect(playlist.addListener.mock.calls[0]![0]).toBe('playlistStatusUpdate')
    expect(observer.stats()).toMatchObject({ watched: 1, open: 1, listeners: 1 })

    tick(60)
    playlist.emit({ playing: true, currentTime: 0 })
    tick(9_000)
    playlist.emit({ playing: false, didJustFinish: true, currentTime: 9 })

    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'intro',
      label: 'intro',
      method: 'status',
      outcome: 'ok',
      expectedDurationMs: 9_000,
      onsetLatencyMs: 60,
      observedDurationMs: 9_000,
      volumeAtDispatch: 0.8,
      silentByVolume: false,
    })
    expect(records[0]!.playId).toMatch(/^intro-\d+$/)
    expect(records[0]!.dispatchMs).toBe(10_000) // stamped before play(), at the rig's t0
    player.stop()
  })

  it('unobserved: 500 ms cadence, no listener, no record', () => {
    const player = new IntroPlayer()
    player.load(SEGMENTS)
    player.play(0.8)
    expect(playlists[0]!.opts.updateInterval).toBe(500)
    expect(playlists[0]!.addListener).not.toHaveBeenCalled()
    player.stop()
  })

  it('stop forgets before the release: an open observation closes as released and the listener is removed', () => {
    const { observer, records } = rig()
    const player = new IntroPlayer({ observer })
    player.load(SEGMENTS)
    player.play(0.8)
    const playlist = playlists[0]!
    playlist.emit({ playing: true, currentTime: 0 })
    player.stop()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'intro', outcome: 'released' })
    expect(playlist.remove).toHaveBeenCalledTimes(1)
    expect(observer.stats()).toMatchObject({ open: 0, listeners: 0 })
    // The observer let go BEFORE the native teardown ran.
    expect(playlist.remove.mock.invocationCallOrder[0]!).toBeLessThan(playlist.destroy.mock.invocationCallOrder[0]!)
  })
})

describe('RoundWarningPlayer', () => {
  it('observed: watched on the first due tick with the playlist total as the expected length', () => {
    const { observer, records, tick } = rig()
    const player = new RoundWarningPlayer({ observer })
    player.prepare(2)
    const playlist = playlists[0]!
    expect(playlist.opts.updateInterval).toBe(OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS)

    player.playIfDue(500, 0.9) // inside any window
    expect(playlist.play).toHaveBeenCalledTimes(1)
    expect(observer.stats()).toMatchObject({ watched: 1, open: 1, listeners: 1 })

    tick(45)
    playlist.emit({ playing: true, currentTime: 0 })
    tick(4_000)
    playlist.emit({ playing: false, didJustFinish: true })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'round-warning',
      label: 'warn-round-2',
      outcome: 'ok',
      onsetLatencyMs: 45,
      volumeAtDispatch: 0.9,
    })
    expect(records[0]!.expectedDurationMs).toBeGreaterThan(0)
    expect(records[0]!.playId).toMatch(/^warn-\d+$/)

    // Later ticks are idempotent: no second watch.
    player.playIfDue(200, 0.9)
    expect(observer.stats().watched).toBe(1)
    player.stop()
  })

  it('the bell cutting a talking warning closes it as released', () => {
    const { observer, records } = rig()
    const player = new RoundWarningPlayer({ observer })
    player.prepare(3)
    player.playIfDue(500, 0.9)
    playlists[0]!.emit({ playing: true, currentTime: 0 })
    player.stop()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'round-warning', label: 'warn-round-3', outcome: 'released' })
    expect(playlists[0]!.remove).toHaveBeenCalledTimes(1)
  })

  it('unobserved: 500 ms cadence and no listener', () => {
    const player = new RoundWarningPlayer()
    player.prepare(2)
    player.playIfDue(500, 0.9)
    expect(playlists[0]!.opts.updateInterval).toBe(500)
    expect(playlists[0]!.addListener).not.toHaveBeenCalled()
    player.stop()
  })
})

describe('RecoveryPlayer', () => {
  it('observed: watched after the bell clearance with measuredTotalMs as the expected length', () => {
    const { observer, records, tick } = rig()
    const player = new RecoveryPlayer({ observer })
    player.prepare(script)
    const playlist = playlists[0]!
    expect(playlist.opts.updateInterval).toBe(OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS)

    player.playIfDue(500, 0.7) // before the clearance: nothing yet
    expect(playlist.play).not.toHaveBeenCalled()
    expect(observer.stats().watched).toBe(0)

    player.playIfDue(1_200, 0.7)
    expect(playlist.play).toHaveBeenCalledTimes(1)
    expect(observer.stats()).toMatchObject({ watched: 1, open: 1, listeners: 1 })

    tick(30)
    playlist.emit({ playing: true, currentTime: 0 })
    tick(30_000)
    playlist.emit({ playing: false })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'recovery',
      label: 'R-test',
      outcome: 'ok',
      expectedDurationMs: 30_000,
      onsetLatencyMs: 30,
      observedDurationMs: 30_000,
      volumeAtDispatch: 0.7,
    })
    expect(records[0]!.playId).toMatch(/^recovery-\d+$/)
    player.stop()
  })

  it('a pause and resume in place stays one observation (no re-watch on resume)', () => {
    const { observer, records } = rig()
    const player = new RecoveryPlayer({ observer })
    player.prepare(script)
    player.playIfDue(1_200, 0.7)
    playlists[0]!.emit({ playing: true, currentTime: 0 })
    player.pause()
    player.playIfDue(9_000, 0.7)
    expect(playlists).toHaveLength(1)
    expect(observer.stats()).toMatchObject({ watched: 1, open: 1 })
    expect(records).toHaveLength(0)
    player.stop()
    expect(records[0]).toMatchObject({ kind: 'recovery', outcome: 'released' })
  })

  it('a silent birth (volume 0) is recorded as silentByVolume', () => {
    const { observer, records } = rig()
    const player = new RecoveryPlayer({ observer })
    player.prepare(script)
    player.playIfDue(1_200, 0)
    playlists[0]!.emit({ playing: true })
    playlists[0]!.emit({ playing: false })
    expect(records[0]).toMatchObject({ kind: 'recovery', outcome: 'ok', silentByVolume: true })
    player.stop()
  })
})

describe('MetronomePlayer', () => {
  it('observed: the loop is watched as metronome with one bar as the expected length', () => {
    const { observer, records, tick } = rig()
    const player = new MetronomePlayer({ timing: observer })
    player.start(LOOP_A, 0.5)
    const playlist = playlists[0]!
    expect(playlist.opts.updateInterval).toBe(OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS)
    expect(playlist.opts.loop).toBe('single')
    expect(observer.stats()).toMatchObject({ watched: 1, open: 1, listeners: 1 })

    tick(25)
    playlist.emit({ playing: true, currentTime: 0 })
    // A loop never ends on its own; the transport's periodic statuses keep
    // it open (positions advance, so it is not stalled either).
    tick(40)
    playlist.emit({ playing: true, currentTime: 0.04 })
    tick(40)
    playlist.emit({ playing: true, currentTime: 0.08 })
    expect(records).toHaveLength(0)

    player.stop()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      kind: 'metronome',
      label: 'loop-d2',
      outcome: 'released',
      expectedDurationMs: 1_000,
      onsetLatencyMs: 25,
      volumeAtDispatch: 0.5,
    })
    expect(records[0]!.playId).toMatch(/^metronome-\d+$/)
    expect(playlist.remove).toHaveBeenCalledTimes(1)
    expect(observer.stats()).toMatchObject({ open: 0, listeners: 0 })
  })

  it('a same-loop restart seeks and resumes without a second watch; a loop change forgets and re-watches', () => {
    const { observer, records } = rig()
    const player = new MetronomePlayer({ timing: observer })
    player.start(LOOP_A, 0.5)
    playlists[0]!.emit({ playing: true, currentTime: 0 })

    player.start(LOOP_A, 0.5)
    expect(playlists).toHaveLength(1)
    expect(playlists[0]!.seekTo).toHaveBeenCalledTimes(1)
    expect(observer.stats()).toMatchObject({ watched: 1, open: 1, listeners: 1 })
    expect(records).toHaveLength(0)

    player.start(LOOP_B, 0.5)
    expect(playlists).toHaveLength(2)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ kind: 'metronome', label: 'loop-d2', outcome: 'released' })
    expect(playlists[0]!.remove).toHaveBeenCalledTimes(1)
    expect(playlists[1]!.addListener).toHaveBeenCalledTimes(1)
    expect(observer.stats()).toMatchObject({ watched: 2, open: 1, listeners: 1 })
    player.stop()
    expect(records[1]).toMatchObject({ kind: 'metronome', label: 'loop-d4', outcome: 'released' })
  })

  it('unobserved: 500 ms cadence and no listener from the timing side', () => {
    const player = new MetronomePlayer()
    player.start(LOOP_A, 0.5)
    expect(playlists[0]!.opts.updateInterval).toBe(500)
    expect(playlists[0]!.addListener).not.toHaveBeenCalled()
    player.stop()
  })
})
