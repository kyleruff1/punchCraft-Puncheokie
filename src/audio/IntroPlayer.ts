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

import { logger, safe } from '@/diagnostics/logger'

import type { PlannedIntroSegment } from './introPlan'
import { silenceFor } from './voiceAssets/silenceManifest'

/** Pump cadence — the error bound on completion detection, not on audio. */
const PUMP_INTERVAL_MS = 150

export class IntroPlayer {
  private playlist: AudioPlaylist | null = null
  private pump: ReturnType<typeof setInterval> | null = null
  private started = false
  /** Sum of planned clip + pause milliseconds, set by load(). */
  private plannedMs = 0
  private doneAt: number | null = null
  private onComplete: (() => void) | null = null

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
      this.playlist = createAudioPlaylist({ sources, loop: 'none', updateInterval: 500 })
      this.plannedMs = plannedMs
      logger.info('puncheokie.intro', 'intro loaded', {
        segments: safe(segments.length),
        tracks: safe(sources.length),
        plannedMs: safe(plannedMs),
      })
    } catch (error) {
      this.playlist = null
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
    if (this.started || this.playlist === null) return
    this.started = true
    this.onComplete = opts.onComplete ?? null
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
    logger.info('puncheokie.intro', 'intro playing', {
      plannedMs: safe(this.plannedMs),
    })
    this.doneAt = Date.now() + this.plannedMs + (opts.tailMs ?? 0)
    this.pump = setInterval(() => {
      if (this.doneAt !== null && Date.now() >= this.doneAt) this.finish('planned-end')
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
    this.onComplete = null // The bell already rang; nothing left to skip.
    this.dispose()
  }

  private dispose(): void {
    try {
      this.playlist?.pause()
    } catch {
      // Already stopped.
    }
    try {
      this.playlist?.destroy()
    } catch {
      // Already gone.
    }
    this.playlist = null
    this.plannedMs = 0
  }
}
