/**
 * Sequential playback for the walkout announcement (see `introPlan.ts`).
 *
 * Lives in the audio layer because screens speak through adapters, never
 * expo-audio (spec §13.5). This player also delivers the joke — the joke
 * is an extension of the intro, planned into the same sequence.
 *
 * Three monitored walkouts taught this class its shape:
 *
 * - **Preload at load(), not at play().** A cold wav streams from Metro on
 *   the dev client; run 1 took ~16 s to make a sound. Players are created
 *   in the lobby, so play() starts warm (run 3 measured 1.6 s).
 * - **Never sequence on events or one-shot timers.** Run 2 advanced on
 *   `didJustFinish`; run 3's instrumentation showed that event arriving
 *   25 s late for a 5.6 s clip — the countdown's preload storm starves
 *   the JS thread, and a 10 s watchdog timer didn't fire either. The
 *   same lesson the rhythm map already carries (wall timers stretched
 *   2.3x mid-round): one-shot deadlines die under load.
 * - **A clock-sampled pump self-heals.** This player runs a short
 *   interval that compares the real clock against the plan's measured
 *   durations. A starved tick just means the next one starts the due
 *   segment immediately — the speech resumes the moment the thread
 *   breathes, instead of dying where the event was lost.
 *
 * The bell's authority is untouched: the session clock ends the countdown
 * at the planned total regardless, and stop() cuts a straggler.
 */

import { createAudioPlayer, type AudioPlayer } from 'expo-audio'

import { logger, safe } from '@/diagnostics/logger'

import type { PlannedIntroSegment } from './introPlan'

/** Pump cadence — the error bound on every segment hand-off. */
const PUMP_INTERVAL_MS = 150

interface LoadedSegment {
  segment: PlannedIntroSegment
  player: AudioPlayer
}

export class IntroPlayer {
  private loaded: LoadedSegment[] = []
  private pump: ReturnType<typeof setInterval> | null = null
  private started = false
  /** Index of the segment currently playing. */
  private index = -1
  /** Real-clock time the next segment is due, or null when done. */
  private nextDueAt: number | null = null
  private tailMs = 0
  private onComplete: (() => void) | null = null

  /**
   * Create (and start buffering) one player per segment. Call from the
   * lobby, as soon as the plan exists — long before the countdown needs
   * them. Safe to call again with a new plan; previous players are freed.
   */
  load(segments: readonly PlannedIntroSegment[]): void {
    if (this.started) return
    this.dispose()
    for (const segment of segments) {
      try {
        const player = createAudioPlayer(segment.module)
        this.loaded.push({ segment, player })
      } catch (error) {
        // A segment that cannot load is skipped; the speech survives.
        logger.warn('puncheokie.intro', 'segment player creation failed', {
          segment: safe(segment.id),
          error: safe(String(error)),
        })
      }
    }
    logger.info('puncheokie.intro', 'intro loaded', {
      requested: safe(segments.length),
      created: safe(this.loaded.length),
    })
  }

  /**
   * Deliver the announcement once. Idempotent.
   *
   * `onComplete` fires `tailMs` after the last clip's measured end — the
   * caller uses it to ring the bell early instead of serving the padded
   * countdown's leftover slack in silence.
   */
  play(
    volume: number,
    opts: { tailMs?: number; onComplete?: () => void } = {},
  ): void {
    if (this.started || this.loaded.length === 0) return
    this.started = true
    this.tailMs = opts.tailMs ?? 0
    this.onComplete = opts.onComplete ?? null
    for (const { player } of this.loaded) {
      try {
        player.volume = volume
      } catch {
        // Volume is best-effort.
      }
    }
    this.startSegment(0, Date.now())
    this.pump = setInterval(() => this.onPump(), PUMP_INTERVAL_MS)
  }

  private onPump(): void {
    if (this.nextDueAt === null) return
    const now = Date.now()
    if (now < this.nextDueAt) return
    this.startSegment(this.index + 1, now)
  }

  private startSegment(index: number, now: number): void {
    const entry = this.loaded[index]
    if (!entry) {
      // Past the last segment: the speech is delivered.
      this.nextDueAt = null
      if (this.pump !== null) {
        clearInterval(this.pump)
        this.pump = null
      }
      logger.info('puncheokie.intro', 'intro complete', {
        segments: safe(this.loaded.length),
      })
      this.onComplete?.()
      this.onComplete = null
      return
    }
    this.index = index
    try {
      entry.player.play()
      logger.info('puncheokie.intro', 'segment playing', {
        segment: safe(entry.segment.id),
        index: safe(index),
        isLoaded: safe(entry.player.isLoaded),
      })
    } catch (error) {
      logger.warn('puncheokie.intro', 'segment play failed', {
        segment: safe(entry.segment.id),
        error: safe(String(error)),
      })
    }
    // The schedule anchors on the ACTUAL start, so a late start never
    // truncates the clip — lateness pushes the tail toward the bell, and
    // the countdown cap settles any overrun. After the last clip, the due
    // time is the completion beat that lets the caller ring the bell.
    const next = this.loaded[index + 1]
    this.nextDueAt =
      now +
      entry.segment.durationMs +
      (next ? next.segment.gapBeforeMs : this.tailMs)
  }

  /** The bell ends the speech. Frees every player. Safe to call repeatedly. */
  stop(): void {
    if (this.loaded.length > 0) {
      logger.info('puncheokie.intro', 'intro stopped', {
        atIndex: safe(this.index),
        of: safe(this.loaded.length),
      })
    }
    if (this.pump !== null) {
      clearInterval(this.pump)
      this.pump = null
    }
    this.nextDueAt = null
    this.onComplete = null // The bell already rang; nothing left to skip.
    this.dispose()
  }

  private dispose(): void {
    for (const { player } of this.loaded) {
      try {
        player.remove()
      } catch {
        // Already gone.
      }
    }
    this.loaded = []
    this.index = -1
  }
}
