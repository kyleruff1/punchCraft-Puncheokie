/**
 * Resume-in-place across the three playlist players (IntroPlayer,
 * RoundWarningPlayer, RecoveryPlayer).
 *
 * The contract under test: pausing a workout HOLDS speech where it is —
 * the native playlist is paused, never destroyed — and the next entry
 * call (`play` / `playIfDue`) continues from position instead of
 * replaying from the top or going silent. Before this contract, pausing
 * mid-rest restarted the recovery walkthrough over the round warning,
 * pausing in the warning window replayed the full countdown into the
 * bell, and pausing the walkout left the rest of the countdown as dead
 * air with the completion pump still racing the wall clock.
 */
import { IntroPlayer } from '../IntroPlayer'
import { RecoveryPlayer } from '../RecoveryPlayer'
import { RoundWarningPlayer } from '../RoundWarningPlayer'
import type { RecoveryScript } from '../voiceAssets/recoveryManifest'

interface PlaylistStub {
  play: jest.Mock
  pause: jest.Mock
  destroy: jest.Mock
  playing: boolean
  volume: number
}

const playlists: PlaylistStub[] = []

jest.mock('expo-audio', () => ({
  createAudioPlaylist: jest.fn(() => {
    const stub: PlaylistStub = {
      play: jest.fn(() => {
        stub.playing = true
      }),
      pause: jest.fn(() => {
        stub.playing = false
      }),
      destroy: jest.fn(),
      playing: false,
      volume: 0,
    }
    playlists.push(stub)
    return stub
  }),
}))

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

beforeEach(() => {
  playlists.length = 0
  jest.clearAllMocks()
})

describe('RecoveryPlayer resume-in-place', () => {
  it('pause holds the playlist; the next playIfDue resumes, never rebuilds', () => {
    const player = new RecoveryPlayer()
    player.prepare(script)
    player.playIfDue(2_000, 0.8)
    const playlist = playlists[0]!
    expect(playlist.play).toHaveBeenCalledTimes(1)

    player.pause()
    expect(playlist.pause).toHaveBeenCalledTimes(1)
    expect(playlist.destroy).not.toHaveBeenCalled()

    // Resume: continues the SAME playlist — no second build, one more play.
    player.playIfDue(9_000, 0.8)
    expect(playlists).toHaveLength(1)
    expect(playlist.play).toHaveBeenCalledTimes(2)

    // Steady state after resume: further ticks are no-ops.
    player.playIfDue(10_000, 0.8)
    expect(playlist.play).toHaveBeenCalledTimes(2)
  })

  it('pause before the walkthrough starts is a no-op and normal start still happens', () => {
    const player = new RecoveryPlayer()
    player.prepare(script)
    player.pause() // nothing started yet
    expect(playlists[0]!.pause).not.toHaveBeenCalled()
    player.playIfDue(2_000, 0.8)
    expect(playlists[0]!.play).toHaveBeenCalledTimes(1)
  })

  it('stop clears the paused state so the next rest starts clean', () => {
    const player = new RecoveryPlayer()
    player.prepare(script)
    player.playIfDue(2_000, 0.8)
    player.pause()
    player.stop()
    player.prepare(script)
    player.playIfDue(2_000, 0.8)
    // Second playlist (fresh rest), started from the top exactly once.
    expect(playlists).toHaveLength(2)
    expect(playlists[1]!.play).toHaveBeenCalledTimes(1)
  })
})

describe('RoundWarningPlayer resume-in-place', () => {
  it('pause inside the window holds position; resume continues, never replays', () => {
    const player = new RoundWarningPlayer()
    player.prepare(2)
    const playlist = playlists[0]!
    player.playIfDue(5_000, 0.9) // inside any window
    expect(playlist.play).toHaveBeenCalledTimes(1)

    player.pause()
    expect(playlist.pause).toHaveBeenCalledTimes(1)
    expect(playlist.destroy).not.toHaveBeenCalled()

    player.playIfDue(4_000, 0.9)
    expect(playlists).toHaveLength(1) // same playlist — no rebuild
    expect(playlist.play).toHaveBeenCalledTimes(2)
  })

  it('pause before the warning starts is a no-op', () => {
    const player = new RoundWarningPlayer()
    player.prepare(2)
    player.pause()
    expect(playlists[0]!.pause).not.toHaveBeenCalled()
  })
})

describe('IntroPlayer resume-in-place', () => {
  const SEGMENTS = [
    { id: 'walk-1', module: 201, durationMs: 5_000, gapBeforeMs: 0 },
    { id: 'walk-2', module: 202, durationMs: 5_000, gapBeforeMs: 0 },
  ]

  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
  })

  it('pause freezes the completion pump; resume shifts the deadline by the pause', () => {
    const onComplete = jest.fn()
    const player = new IntroPlayer()
    player.load(SEGMENTS)
    player.play(0.9, { tailMs: 0, onComplete })
    const playlist = playlists[0]!
    expect(playlist.play).toHaveBeenCalledTimes(1)

    // 4s in, the athlete pauses. plannedMs is 10s.
    jest.advanceTimersByTime(4_000)
    player.pause()
    playlist.playing = false
    expect(playlist.pause).toHaveBeenCalledTimes(1)
    expect(playlist.destroy).not.toHaveBeenCalled()

    // A long pause: without the deadline shift, the wall clock would blow
    // past plannedMs and "complete" the walkout into a paused app.
    jest.advanceTimersByTime(60_000)
    expect(onComplete).not.toHaveBeenCalled()

    // Resume: the same playlist continues; deadline moved out by the pause.
    player.play(0.9, { tailMs: 0, onComplete })
    expect(playlists).toHaveLength(1)
    expect(playlist.play).toHaveBeenCalledTimes(2)

    // 5s of remaining speech + a beat: now it completes.
    playlist.playing = false
    jest.advanceTimersByTime(7_000)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('a running intro stays idempotent — play() without a pause is a no-op', () => {
    const player = new IntroPlayer()
    player.load(SEGMENTS)
    player.play(0.9)
    player.play(0.9)
    expect(playlists[0]!.play).toHaveBeenCalledTimes(1)
  })

  it('finish racing pause: a finished walkout is never held, resumed, or replayed', () => {
    // The pump can fire finish() in the gap between the phase change and
    // the pause effect (the completion is swallowed by a paused session).
    // pause() after finish must be a no-op, and the next play() must
    // re-deliver the completion — NOT play() the finished playlist,
    // which would restart it from the top.
    const swallowed = jest.fn()
    const player = new IntroPlayer()
    player.load(SEGMENTS)
    player.play(0.9, { tailMs: 0, onComplete: swallowed })
    const playlist = playlists[0]!

    // Run to natural completion: finish() fires (the session was already
    // 'paused', so in production this call no-ops inside the runner).
    playlist.playing = false
    jest.advanceTimersByTime(12_000)
    expect(swallowed).toHaveBeenCalledTimes(1)

    // The racing pause effect lands after the fact: nothing to hold.
    player.pause()
    expect(playlist.pause).not.toHaveBeenCalled()

    // Resume: the fresh callback gets the completion immediately; the
    // finished playlist is not re-played and no pump is re-armed.
    const redelivered = jest.fn()
    player.play(0.9, { tailMs: 0, onComplete: redelivered })
    expect(redelivered).toHaveBeenCalledTimes(1)
    expect(playlist.play).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(60_000)
    expect(redelivered).toHaveBeenCalledTimes(1)
  })

  it('a wall-clock step during the pause cannot corrupt the deadline shift', () => {
    // pausedForMs is measured monotonically; a backwards Date step during
    // the pause must not make the pump complete the walkout early.
    const onComplete = jest.fn()
    const player = new IntroPlayer()
    player.load(SEGMENTS)
    player.play(0.9, { tailMs: 0, onComplete })
    const playlist = playlists[0]!

    jest.advanceTimersByTime(4_000)
    player.pause()
    playlist.playing = false

    // NTP yanks the wall clock back two minutes mid-pause.
    jest.setSystemTime(Date.now() - 120_000)
    jest.advanceTimersByTime(10_000)

    player.play(0.9, { tailMs: 0, onComplete })
    expect(playlist.play).toHaveBeenCalledTimes(2)
    // The walkout still has ~6s of speech; a corrupted shift would have
    // completed instantly on resume.
    jest.advanceTimersByTime(1_000)
    expect(onComplete).not.toHaveBeenCalled()
  })
})
