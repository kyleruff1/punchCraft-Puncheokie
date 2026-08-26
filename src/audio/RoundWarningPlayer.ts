/**
 * The round-start warning — the coach preparing the athlete out of rest
 * and counting down into the bell.
 *
 * "Break's over, champ! … It's time to get ready for round two, in
 * three… two… one!" → ding.
 *
 * Two whole-sentence clips (D16): a rotating opener (15 variants, drawn
 * per rest for freshness) and the countdown core for the round number.
 * The playback is a NATIVE playlist — clips plus a silence track for the
 * breath between them — for the same reason the walkout is (see
 * `IntroPlayer`): nothing on the JS thread may interrupt or stretch the
 * coach's timing, and this clip's timing IS the feature: it is started
 * so its measured end lands on the bell.
 *
 * The trigger is tick-driven, not timer-driven: the live screen calls
 * `playIfDue(remainingMs)` on every store update during rest, and the
 * clip starts on the first tick inside its window. A missed tick delays
 * the start slightly; the countdown then ends a touch early — never
 * late, never cut by the bell.
 */

import { createAudioPlaylist, type AudioPlaylist } from 'expo-audio'

import { logger, safe } from '@/diagnostics/logger'

import { INTRO_SEGMENTS } from './voiceAssets/introManifest'
import { silenceFor } from './voiceAssets/silenceManifest'

const OPENER_COUNT = 15
const OPENER_GAP_MS = 350
/**
 * Start bias: the clip begins on the first tick at or inside its window,
 * so the countdown lands at-or-just-before the ding — "one!… ding".
 */
const LEAD_SLACK_MS = 400

export class RoundWarningPlayer {
  private playlist: AudioPlaylist | null = null
  private totalMs = 0
  private preparedRound: number | null = null
  private played = false

  /**
   * Build the playlist for the upcoming round. Call at rest entry — the
   * native side buffers while the athlete breathes. Re-preparing the same
   * round is a no-op; a new round frees the previous playlist.
   */
  prepare(roundNumber: number): void {
    if (this.preparedRound === roundNumber) return
    this.dispose()
    this.preparedRound = roundNumber
    this.played = false

    const core = INTRO_SEGMENTS[`warn-round-${roundNumber}`]
    if (!core) return // Round number outside the rendered range.
    const openerIndex = 1 + Math.floor(Math.random() * OPENER_COUNT)
    const opener = INTRO_SEGMENTS[`warn-opener-${String(openerIndex).padStart(2, '0')}`]

    const sources: number[] = []
    let totalMs = 0
    if (opener) {
      sources.push(opener.module)
      totalMs += opener.durationMs
      const breath = silenceFor(OPENER_GAP_MS)
      if (breath !== undefined) {
        sources.push(breath)
        totalMs += OPENER_GAP_MS
      }
    }
    sources.push(core.module)
    totalMs += core.durationMs

    try {
      this.playlist = createAudioPlaylist({ sources, loop: 'none', updateInterval: 500 })
      this.totalMs = totalMs
      logger.info('puncheokie.warn', 'round warning prepared', {
        round: safe(roundNumber),
        opener: safe(opener?.id),
        totalMs: safe(totalMs),
      })
    } catch (error) {
      this.playlist = null
      logger.warn('puncheokie.warn', 'round warning playlist failed', {
        error: safe(String(error)),
      })
    }
  }

  /**
   * Start the warning on the first rest tick inside its window, so the
   * countdown's measured end lands on the bell. Idempotent per prepare().
   */
  playIfDue(remainingMs: number, volume: number): void {
    if (this.played || this.playlist === null) return
    if (remainingMs > this.totalMs + LEAD_SLACK_MS) return
    this.played = true
    try {
      this.playlist.volume = volume
      this.playlist.play()
      logger.info('puncheokie.warn', 'round warning playing', {
        round: safe(this.preparedRound),
        remainingMs: safe(remainingMs),
        totalMs: safe(this.totalMs),
      })
    } catch (error) {
      logger.warn('puncheokie.warn', 'round warning play failed', {
        error: safe(String(error)),
      })
    }
  }

  /** The bell (or an exit) ends it. Safe to call repeatedly. */
  stop(): void {
    this.dispose()
    this.preparedRound = null
    this.played = false
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
    this.totalMs = 0
  }
}
