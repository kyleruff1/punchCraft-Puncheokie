/**
 * The 3rd audio track — a boxing-flavored one-bar loop that anchors
 * every ring and voice call to the master pulse (M39-V1b / #280).
 *
 * Kyle's spec (2026-08-30): 60 BPM master pulse, one call per master
 * beat when the boxer's cadence sits on the whole beat; four call
 * subdivisions when it sits on sixteenths. The click is the floor
 * both coach and chime-ins sit on — it does NOT duck under speech.
 *
 * ## Native loop only — never a JS-scheduled tick
 *
 * `IntroPlayer.ts:1-22` measured JS-side sequencing losing to
 * `didJustFinish` events landing 25 s late under workout load. A
 * metronome ridden on the JS thread would drift the same way. Every
 * subdivision is baked into the loop wav, and `createAudioPlaylist`
 * with `loop: 'single'` hands the whole cadence to the native player.
 * JS keeps exactly one job: `setVolume(v)` reacts to the volume
 * slider without restarting the loop.
 *
 * ## Failure semantics
 *
 * A `createAudioPlaylist` throw sets `available = false` and every
 * subsequent method is a no-op. The workout runs silently at the
 * click layer — never blocks a round. Mirrors `IntroPlayer`'s
 * log-and-continue posture verbatim.
 *
 * ## What this file does NOT own
 *
 * - **When to start / stop.** The runner's `applyTransitions`
 *   dispatch owns that: `work-entered` starts, `rest-entered` and
 *   the terminal phases stop, `resumed` restarts (which re-anchors
 *   the loop against the current work-elapsed offset).
 * - **Which loop to play.** The caller passes a resolved
 *   `MetronomeLoop` — `metronomeLoopFor(division, swing)` is the
 *   lookup that walks the `(division, swing) → loop` table.
 */

import { createAudioPlaylist, type AudioPlaylist } from 'expo-audio'

import { logger, safe } from '@/diagnostics/logger'

import type { MetronomeLoop } from './voiceAssets/metronomeAssets'

/**
 * A single position sample from the underlying playlist's status
 * update (M39-V2 Phase W0-c-ii). The observer receives one of
 * these per native callback (~500 ms cadence per Expo Audio
 * defaults); it is expected to translate the wrapped position
 * into an absolute tick and feed it into
 * `MetronomeTransport.correct`.
 */
export interface MetronomePositionReport {
  /** From `AudioPlaylistStatus.currentTime`, in seconds (wraps per loop). */
  wrappedPositionSec: number
  /** From `AudioPlaylistStatus.duration`, in seconds. Zero while unloaded. */
  loopDurationSec: number
  /** MonotonicClock timestamp at which the status was received. */
  sampleMonotonicMs: number
}

/** Optional observer wired at start-time. */
export interface MetronomePlayerObserver {
  /** MonotonicClock — the observer supplies its own clock so the report timestamp matches the transport's domain. */
  now(): number
  /** Called on every playlist status update while the loop is playing. */
  onPositionReport(report: MetronomePositionReport): void
}

/** Minimal shape of `AudioPlaylistStatus` we consume. */
interface PlaylistStatusLike {
  currentTime: number
  duration: number
}

export class MetronomePlayer {
  private playlist: AudioPlaylist | null = null
  /** Kept for logging / debug — the loop currently loaded. */
  private loaded: MetronomeLoop | null = null
  /** `false` when the platform refused to build a playlist. Every method is a no-op after that. */
  private available = true
  private volume = 0
  /**
   * Set at start-time when the caller passes an observer; used to
   * translate playlist status updates into position reports.
   */
  private observer: MetronomePlayerObserver | null = null
  /**
   * Unsubscribe returned by `playlist.addListener('playlistStatusUpdate', ...)`.
   * Called on stop and before re-adding on a new-loop rebuild so we
   * never leak listeners across playlist rebuilds.
   */
  private unsubscribeStatus: (() => void) | null = null

  /**
   * Start (or restart) the click at `loop`, `volume`. Idempotent when
   * called with the same loop; a different loop reloads the playlist
   * and starts from the top so the click always begins on the
   * downbeat.
   *
   * Optional `observer` (M39-V2 Phase W0-c-ii) receives a position
   * report on every `playlistStatusUpdate` from the underlying
   * playlist — used by VoiceOutputExpo to feed
   * `MetronomeTransport.correct` so the JS-side tick stays in sync
   * with the native audio backend.
   */
  start(loop: MetronomeLoop, volume: number, observer?: MetronomePlayerObserver): void {
    if (!this.available) return
    this.volume = clampVolume(volume)
    // Rebind the observer every start — a new caller (or a
    // no-observer test double) replaces the previous one. The
    // subscription itself is bound to `this.playlist` and re-added
    // whenever we build a new playlist, below.
    this.observer = observer ?? null
    if (this.loaded && this.loaded.module === loop.module) {
      // Same loop: seek to zero and resume — nothing to rebuild.
      // The status listener stays attached to the existing playlist.
      try {
        this.playlist?.seekTo(0)
        this.playlist?.play()
      } catch (error) {
        logger.warn('puncheokie.metronome', 'restart failed', {
          error: safe(String(error)),
        })
      }
      return
    }
    // New loop (first start of the workout, or a division change).
    if (this.playlist !== null) {
      this.detachStatusListener()
      try {
        this.playlist.pause()
        this.playlist.destroy()
      } catch {
        // Already gone.
      }
      this.playlist = null
    }
    try {
      this.playlist = createAudioPlaylist({
        sources: [loop.module],
        loop: 'single',
        updateInterval: 500,
      })
      this.playlist.volume = this.volume
      this.playlist.play()
      this.loaded = loop
      this.attachStatusListener(this.playlist)
      logger.info('puncheokie.metronome', 'loop started', {
        division: safe(loop.division),
        swing: safe(loop.swing),
        durationMs: safe(loop.durationMs),
      })
    } catch (error) {
      this.available = false
      this.playlist = null
      this.loaded = null
      logger.warn('puncheokie.metronome', 'playlist creation failed — click disabled for this session', {
        error: safe(String(error)),
      })
    }
  }

  /**
   * Attach the `playlistStatusUpdate` listener to a fresh playlist.
   * Wrapped in try/catch — `addListener` throws on native platforms
   * that don't expose the API; a throw disables the observer for
   * this playlist but keeps audio playback working.
   */
  private attachStatusListener(playlist: AudioPlaylist): void {
    if (!this.observer) return
    const obs = this.observer
    try {
      const rawSub = (
        playlist as unknown as {
          addListener?: (
            event: 'playlistStatusUpdate',
            cb: (status: PlaylistStatusLike) => void,
          ) => { remove?: () => void } | (() => void)
        }
      ).addListener?.('playlistStatusUpdate', (status: PlaylistStatusLike) => {
        try {
          obs.onPositionReport({
            wrappedPositionSec: status.currentTime,
            loopDurationSec: status.duration,
            sampleMonotonicMs: obs.now(),
          })
        } catch (error) {
          logger.warn('puncheokie.metronome', 'position observer threw', {
            error: safe(String(error)),
          })
        }
      })
      if (typeof rawSub === 'function') {
        this.unsubscribeStatus = rawSub
      } else if (rawSub && typeof rawSub.remove === 'function') {
        this.unsubscribeStatus = () => rawSub.remove?.()
      } else {
        this.unsubscribeStatus = null
      }
    } catch (error) {
      logger.warn('puncheokie.metronome', 'addListener unsupported — position reports disabled', {
        error: safe(String(error)),
      })
      this.unsubscribeStatus = null
    }
  }

  /** Remove the status listener if one is attached. Idempotent. */
  private detachStatusListener(): void {
    if (this.unsubscribeStatus) {
      try {
        this.unsubscribeStatus()
      } catch {
        // Already detached.
      }
      this.unsubscribeStatus = null
    }
  }

  /**
   * Stop the click. The playlist is TORN DOWN, not paused — the next
   * `work-entered` restarts fresh on the downbeat so drift cannot
   * accumulate across a rest.
   */
  stop(): void {
    if (!this.available) return
    this.detachStatusListener()
    this.observer = null
    if (this.playlist !== null) {
      try {
        this.playlist.pause()
        this.playlist.destroy()
      } catch (error) {
        logger.warn('puncheokie.metronome', 'stop failed', {
          error: safe(String(error)),
        })
      }
    }
    this.playlist = null
    this.loaded = null
  }

  /**
   * Change the mixer volume without restarting the loop. The slider
   * ships with V2's global speed slider; V1b uses a static default
   * from `Volumes.metronome`.
   */
  setVolume(volume: number): void {
    if (!this.available) return
    this.volume = clampVolume(volume)
    if (this.playlist) {
      try {
        this.playlist.volume = this.volume
      } catch (error) {
        logger.warn('puncheokie.metronome', 'setVolume failed', {
          error: safe(String(error)),
        })
      }
    }
  }

  /** Test seam. */
  isAvailable(): boolean {
    return this.available
  }
}

function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}
