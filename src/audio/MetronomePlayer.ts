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

export class MetronomePlayer {
  private playlist: AudioPlaylist | null = null
  /** Kept for logging / debug — the loop currently loaded. */
  private loaded: MetronomeLoop | null = null
  /** `false` when the platform refused to build a playlist. Every method is a no-op after that. */
  private available = true
  private volume = 0

  /**
   * Start (or restart) the click at `loop`, `volume`. Idempotent when
   * called with the same loop; a different loop reloads the playlist
   * and starts from the top so the click always begins on the
   * downbeat.
   */
  start(loop: MetronomeLoop, volume: number): void {
    if (!this.available) return
    this.volume = clampVolume(volume)
    if (this.loaded && this.loaded.module === loop.module) {
      // Same loop: seek to zero and resume — nothing to rebuild.
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
   * Stop the click. The playlist is TORN DOWN, not paused — the next
   * `work-entered` restarts fresh on the downbeat so drift cannot
   * accumulate across a rest.
   */
  stop(): void {
    if (!this.available) return
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
