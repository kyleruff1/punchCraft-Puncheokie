/**
 * Native audio teardown (GH #356/#357).
 *
 * The defect this guards against is the one that made the whole investigation
 * hard: expo-audio's `remove()`/`destroy()` are registry unlinks, so the JS
 * side reported a clean teardown while every native AudioTrack stayed alive.
 * Nothing threw and nothing logged. Measured on the tablet, adding `release()`
 * took the count after leaving punchCraft Live from 21 to 1.
 *
 * So the load-bearing assertion is simply: BOTH calls happen, in order.
 */
import { releaseAudioPlayer, releaseAudioPlaylist } from '../nativeAudioTeardown'

describe('releaseAudioPlayer', () => {
  it('unlinks AND releases — remove() alone leaves the ExoPlayer alive', () => {
    const calls: string[] = []
    releaseAudioPlayer({
      remove: () => calls.push('remove'),
      release: () => calls.push('release'),
    })
    expect(calls).toEqual(['remove', 'release'])
  })

  it('still releases when remove() throws', () => {
    // A half-torn-down player must not keep its native handle just because
    // the registry unlink failed.
    const calls: string[] = []
    releaseAudioPlayer({
      remove: () => {
        throw new Error('already gone')
      },
      release: () => calls.push('release'),
    })
    expect(calls).toEqual(['release'])
  })

  it('never throws — a teardown loop must not abandon later handles', () => {
    expect(() =>
      releaseAudioPlayer({
        remove: () => {
          throw new Error('boom')
        },
        release: () => {
          throw new Error('boom')
        },
      }),
    ).not.toThrow()
  })

  it('tolerates null, undefined, and a player lacking release()', () => {
    expect(() => releaseAudioPlayer(null)).not.toThrow()
    expect(() => releaseAudioPlayer(undefined)).not.toThrow()
    const calls: string[] = []
    releaseAudioPlayer({ remove: () => calls.push('remove') })
    expect(calls).toEqual(['remove'])
  })
})

describe('releaseAudioPlaylist', () => {
  it('pauses, destroys, then releases — in that order', () => {
    // pause() first because destroying a sounding playlist leaves its last
    // buffer on the mixer, which is audible as a click.
    const calls: string[] = []
    releaseAudioPlaylist({
      pause: () => calls.push('pause'),
      destroy: () => calls.push('destroy'),
      release: () => calls.push('release'),
    })
    expect(calls).toEqual(['pause', 'destroy', 'release'])
  })

  it('reaches release() even if pause and destroy both throw', () => {
    const calls: string[] = []
    releaseAudioPlaylist({
      pause: () => {
        throw new Error('x')
      },
      destroy: () => {
        throw new Error('y')
      },
      release: () => calls.push('release'),
    })
    expect(calls).toEqual(['release'])
  })

  it('tolerates null and partial shapes', () => {
    expect(() => releaseAudioPlaylist(null)).not.toThrow()
    expect(() => releaseAudioPlaylist(undefined)).not.toThrow()
    expect(() => releaseAudioPlaylist({})).not.toThrow()
  })

  it('is safe to call twice on the same object', () => {
    let removed = 0
    const playlist = {
      destroy: () => {
        removed += 1
      },
      release: () => {
        removed += 1
      },
    }
    releaseAudioPlaylist(playlist)
    releaseAudioPlaylist(playlist)
    expect(removed).toBe(4) // both calls ran twice; neither threw
  })
})
