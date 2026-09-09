/**
 * Playback for the walkout announcement (see `introPlan.ts`).
 *
 * Lives in the audio layer because screens speak through adapters, never
 * expo-audio (spec §13.5). This player also delivers the joke — the joke
 * is an extension of the intro, planned into the same sequence.
 *
 * Five monitored walkouts shaped this into its current form: **the whole
 * speech plays as one NATIVE playlist, pauses included.** JS-side
 * sequencing lost twice on the dev client — first `replace()` on blind
 * timers (run 1: one sentence, then dead air), then `didJustFinish`
 * events that arrived 25 s late with even a 10 s watchdog timer starved
 * (run 3), then a clock pump that self-healed but still inherited every
 * JS stall as an on-air gap (run 5: ~10 s of silence mid-intro). The
 * playlist hands the entire sequence — clips and silence tracks — to the
 * native player, so nothing on the JS thread can interrupt or stretch
 * the coach's timing. The planned pauses ship as real silence assets
 * (`silenceManifest.ts`), which is why the plan quantizes them.
 *
 * JS keeps exactly one job: a clock-sampled pump that notices when the
 * planned total has elapsed and fires `onComplete`, so the caller can
 * skip the countdown's padded cap and ring the bell. A stalled pump
 * delays only the bell skip — never the speech — and the cap bounds it.
 */

import { createAudioPlaylist, type AudioPlaylist } from 'expo-audio'
import { releaseAudioPlaylist } from './nativeAudioTeardown'
import { OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS, type PlaybackObserver } from './PlaybackObserver'

import { logger, safe } from '@/diagnostics/logger'

import type { PlannedIntroSegment } from './introPlan'
import { silenceFor } from './voiceAssets/silenceManifest'

/** Pump cadence — the error bound on completion detection, not on audio. */
const PUMP_INTERVAL_MS = 150

/**
 * After the planned end, how long a still-playing playlist may hold the
 * bell. Kyle heard the ding land before the workout truly began: a late
 * native start let the planned clock declare completion while the coach
 * was still talking. The bell now waits for the playlist to actually
 * finish — bounded, because the countdown cap is the final authority.
 */
const INTRO_COMPLETE_GRACE_MS = 8_000

/** Monotonic milliseconds — immune to wall-clock steps during a pause. */
const monotonicNowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

export class IntroPlayer {
  private playlist: AudioPlaylist | null = null
  /** The silent timing observer (GH #291, C2), or null. Shared with the coach output. */
  private readonly timing: PlaybackObserver | null
  private pump: ReturnType<typeof setInterval> | null = null

  constructor(opts: { observer?: PlaybackObserver | null } = {}) {
    this.timing = opts.observer ?? null
  }
  private started = false
  /** Sum of planned clip + pause milliseconds, set by load(). */
  private plannedMs = 0
  private doneAt: number | null = null
  private onComplete: (() => void) | null = null
  /** Monotonic moment a pause() suspended playback, or null. */
  private pausedAt: number | null = null

  /**
   * Build the native playlist — clips interleaved with their planned
   * silence tracks — and start it buffering. Call from the lobby, long
   * before the countdown needs it. Safe to call again with a new plan.
   */
  load(segments: readonly PlannedIntroSegment[]): void {
    if (this.started) return
    this.dispose()
    const sources: number[] = []
    let plannedMs = 0
    for (const segment of segments) {
      const silence = silenceFor(segment.gapBeforeMs)
      if (silence !== undefined) {
        sources.push(silence)
        plannedMs += segment.gapBeforeMs
      } else if (segment.gapBeforeMs > 0) {
        // A gap with no silence track is a planner/manifest mismatch —
        // the speech goes on without the pause, and the log names it.
        logger.warn('puncheokie.intro', 'no silence track for planned gap', {
          segment: safe(segment.id),
          gapMs: safe(segment.gapBeforeMs),
        })
      }
      sources.push(segment.module)
      plannedMs += segment.durationMs
    }
    if (sources.length === 0) return
    try {
      this.playlist = createAudioPlaylist({
        sources,
        loop: 'none',
        updateInterval: this.timing ? OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS : 500,
      })
      this.plannedMs = plannedMs
      logger.info('puncheokie.intro', 'intro loaded', {
        segments: safe(segments.length),
        tracks: safe(sources.length),
        plannedMs: safe(plannedMs),
      })
    } catch (error) {
      // Dispose rather than merely drop the reference: if the throw came
      // from AFTER the field was assigned, nulling it would orphan a live
      // native playlist with no handle left to free it.
      this.dispose()
      logger.warn('puncheokie.intro', 'playlist creation failed', {
        error: safe(String(error)),
      })
    }
  }

  /**
   * Deliver the announcement once. Idempotent.
   *
   * `onComplete` fires `tailMs` after the planned audio ends — the caller
   * uses it to ring the bell instead of serving the countdown cap's
   * leftover slack in silence.
   */
  play(
    volume: number,
    opts: { tailMs?: number; onComplete?: () => void } = {},
  ): void {
    if (this.playlist === null) return
    if (this.started) {
      if (this.pausedAt !== null) {
        // Resume-in-place after a pause(): the countdown's session clock
        // froze with the playlist, so continuing from position keeps the
        // walkout aligned with the extended countdown. The pause length
        // is measured on the MONOTONIC clock — a wall-clock step (NTP,
        // DST, manual change) during an arbitrarily-long pause must not
        // corrupt the deadline shift — and clamped non-negative.
        const pausedForMs = Math.max(0, monotonicNowMs() - this.pausedAt)
        this.pausedAt = null
        if (this.doneAt !== null) this.doneAt += pausedForMs
        // The pause callback may have been replaced by a re-render; keep
        // the freshest one so skipCountdown fires on the live closure.
        if (opts.onComplete) this.onComplete = opts.onComplete
        try {
          this.playlist.volume = volume
          this.playlist.play()
        } catch (error) {
          logger.warn('puncheokie.intro', 'playlist resume failed', {
            error: safe(String(error)),
          })
          this.finish('resume-failed')
          return
        }
        logger.info('puncheokie.intro', 'intro resumed in place', {
          pausedForMs: safe(pausedForMs),
        })
        this.startPump()
        return
      }
      if (this.doneAt === null) {
        // The intro FINISHED while the app was paused: the pump's
        // completion fired into a 'paused' session where skipCountdown
        // no-ops, swallowing the bell. Re-deliver the completion on the
        // fresh callback now that the countdown is live again — never
        // play() a finished playlist (it would restart from the top).
        if (opts.onComplete) {
          logger.info('puncheokie.intro', 'intro completion re-delivered after pause', {})
          opts.onComplete()
        }
        return
      }
      // Running normally — idempotent as before.
      return
    }
    this.started = true
    this.onComplete = opts.onComplete ?? null
    const dispatchMs = this.timing?.nowMs()
    try {
      this.playlist.volume = volume
      this.playlist.play()
    } catch (error) {
      logger.warn('puncheokie.intro', 'playlist play failed', {
        error: safe(String(error)),
      })
      // No audio will come; complete immediately so the bell isn't held.
      this.finish('play-failed')
      return
    }
    const playId = this.timing?.mintPlayId('intro') ?? null
    logger.info('puncheokie.intro', 'intro playing', {
      plannedMs: safe(this.plannedMs),
      playId: safe(playId),
    })
    if (this.timing !== null && playId !== null && dispatchMs !== undefined) {
      this.timing.watch(
        this.playlist,
        {
          playId,
          kind: 'intro',
          label: 'intro',
          expectedDurationMs: this.plannedMs,
          dispatchMs,
          volumeAtDispatch: volume,
        },
        { statusEvent: 'playlistStatusUpdate' },
      )
    }
    this.doneAt = Date.now() + this.plannedMs + (opts.tailMs ?? 0)
    this.startPump()
  }

  /**
   * Suspend the walkout in place — the athlete paused mid-countdown.
   * The playlist holds its position and the completion deadline shifts
   * by the pause length on resume; `play()` (re-fired when the phase
   * returns to countdown) continues the speech. Stopping the pump here
   * matters as much as pausing the audio: a paused walkout must not
   * "complete" on the wall clock and ring the bell into a paused app.
   */
  pause(): void {
    if (!this.started || this.pausedAt !== null || this.playlist === null) return
    // finish() may have raced this call (the pause effect runs a commit
    // after the phase change; the pump can fire in that gap). A finished
    // walkout has nothing to hold — arming pausedAt here would make the
    // later resume re-play a finished playlist from the top and re-arm a
    // pump that can never fire.
    if (this.doneAt === null) return
    this.pausedAt = monotonicNowMs()
    if (this.pump !== null) {
      clearInterval(this.pump)
      this.pump = null
    }
    try {
      this.playlist.pause()
    } catch {
      // Already stopped.
    }
    logger.info('puncheokie.intro', 'intro paused in place', {})
  }

  private startPump(): void {
    if (this.pump !== null) clearInterval(this.pump)
    this.pump = setInterval(() => {
      if (this.doneAt === null) return
      const now = Date.now()
      if (now < this.doneAt) return
      // Planned end reached — but the NATIVE playlist is the truth. If it
      // started late, it is still speaking; the ding must not ring over
      // the coach or before the athlete's cue that the round begins.
      let stillPlaying = false
      try {
        stillPlaying = this.playlist?.playing === true
      } catch {
        // Treat an unreadable playlist as done.
      }
      if (stillPlaying && now < this.doneAt + INTRO_COMPLETE_GRACE_MS) return
      this.finish(stillPlaying ? 'grace-elapsed' : 'planned-end')
    }, PUMP_INTERVAL_MS)
  }

  private finish(reason: string): void {
    if (this.pump !== null) {
      clearInterval(this.pump)
      this.pump = null
    }
    this.doneAt = null
    if (this.onComplete === null) return
    logger.info('puncheokie.intro', 'intro complete', { reason: safe(reason) })
    const callback = this.onComplete
    this.onComplete = null
    callback()
  }

  /** The bell ends the speech. Frees the playlist. Safe to call repeatedly. */
  stop(): void {
    if (this.playlist !== null) {
      logger.info('puncheokie.intro', 'intro stopped', {
        wasPlaying: safe(this.started),
      })
    }
    if (this.pump !== null) {
      clearInterval(this.pump)
      this.pump = null
    }
    this.doneAt = null
    this.pausedAt = null
    this.onComplete = null // The bell already rang; nothing left to skip.
    this.dispose()
  }

  private dispose(): void {
    // The observer must let go BEFORE the native release, or it would hold
    // a listener on a freed playlist.
    if (this.playlist !== null) this.timing?.forget(this.playlist, 'released')
    // pause + destroy + release. `destroy()` alone is only a registry
    // unlink — see nativeAudioTeardown.ts; the ExoPlayer survives it.
    releaseAudioPlaylist(this.playlist)
    this.playlist = null
    this.plannedMs = 0
  }
}
