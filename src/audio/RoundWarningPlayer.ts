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
 *
 * The playlist itself is a `CeremonyPlaylist`; what stays here is the
 * ceremony's assembly (opener, theme, lead, core, breaths between) and
 * the remaining-rest window that triggers it.
 */

import { CeremonyPlaylist } from './CeremonyPlaylist'
import type { PlaybackObserver } from './PlaybackObserver'

import { logger, safe } from '@/diagnostics/logger'

import { themeClipFor } from './voiceAssets/calloutManifest'
import { INTRO_SEGMENTS } from './voiceAssets/introManifest'

const OPENER_COUNT = 15
const OPENER_GAP_MS = 350
/**
 * Start bias: the clip begins on the first tick at or inside its window,
 * so the countdown lands at-or-just-before the ding — "one!… ding".
 */
const LEAD_SLACK_MS = 400

export class RoundWarningPlayer {
  private readonly pl: CeremonyPlaylist

  constructor(opts: { observer?: PlaybackObserver | null } = {}) {
    this.pl = new CeremonyPlaylist(opts.observer ?? null, 'puncheokie.warn')
  }
  private preparedRound: number | null = null
  private started = false
  private paused = false

  /**
   * Build the playlist for the upcoming round. Call at rest entry — the
   * native side buffers while the athlete breathes. Re-preparing the same
   * round is a no-op; a new round frees the previous playlist.
   */
  prepare(
    roundNumber: number,
    theme?: string,
    /**
     * Script Bible v2 pre-bell opener (Kyle, 2026-09-01): the next
     * round's first-section lead-in, voiced between the theme and the
     * countdown core so the bell releases straight into punches. The
     * playlist total grows, so `playIfDue`'s window widens and the
     * countdown still lands on the ding.
     */
    lead?: { module: number; durationMs: number },
  ): void {
    if (this.preparedRound === roundNumber) return
    this.started = false

    const core = INTRO_SEGMENTS[`warn-round-${roundNumber}`]
    if (!core) {
      // Round number outside the rendered range. Latch it anyway: there is
      // nothing to retry, and the caller ticks ~60 times per rest.
      this.pl.dispose()
      this.preparedRound = roundNumber
      return
    }
    const openerIndex = 1 + Math.floor(Math.random() * OPENER_COUNT)
    const opener = INTRO_SEGMENTS[`warn-opener-${String(openerIndex).padStart(2, '0')}`]
    // "Coming up — the Square Builder!" (Set Ceremonies): the next
    // round's theme, voiced between the opener and the countdown when a
    // clip exists for it. Unknown themes are simply skipped.
    const themeClip = theme === undefined ? undefined : themeClipFor(theme)

    const sources: number[] = []
    let totalMs = 0
    const pushWithBreath = (module: number, durationMs: number): void => {
      if (sources.length > 0) {
        const breath = this.pl.silenceTrack(OPENER_GAP_MS, { round: safe(roundNumber) })
        if (breath !== undefined) {
          sources.push(breath)
          totalMs += OPENER_GAP_MS
        }
      }
      sources.push(module)
      totalMs += durationMs
    }
    if (opener) pushWithBreath(opener.module, opener.durationMs)
    if (themeClip) pushWithBreath(themeClip.module, themeClip.durationMs)
    if (lead) pushWithBreath(lead.module, lead.durationMs)
    pushWithBreath(core.module, core.durationMs)

    const built = this.pl.build(sources, totalMs, 'round warning prepared', {
      round: safe(roundNumber),
      opener: safe(opener?.id),
      totalMs: safe(totalMs),
    })
    // The latch follows the playlist. A failed build used to leave
    // `preparedRound` pointing at a round with no playlist, and every later
    // tick returned at the guard above — one transient throw and that round
    // got no "three, two, one" into the bell (`fd700e4d`). Now it is set
    // only when there is something to be idempotent about.
    this.preparedRound = built ? roundNumber : null
  }

  /**
   * Suspend a talking warning in place — the athlete paused inside the
   * warning window. The playlist keeps its position and the session
   * clock keeps the remaining rest, so on resume the countdown still
   * lands on the bell. A warning that has not started has nothing to
   * suspend.
   */
  pause(): void {
    if (!this.started || this.paused || !this.pl.loaded) return
    this.paused = true
    this.pl.pause()
    logger.info('puncheokie.warn', 'round warning paused in place', {
      round: safe(this.preparedRound),
    })
  }

  /**
   * Start the warning on the first rest tick inside its window, so the
   * countdown's measured end lands on the bell. Idempotent per prepare()
   * — except after a pause, where it resumes from position rather than
   * replaying from the top (which the bell would cut).
   */
  playIfDue(remainingMs: number, volume: number): void {
    if (!this.pl.loaded) return
    if (this.started) {
      if (!this.paused) return
      this.paused = false
      try {
        this.pl.resume(volume)
      } catch {
        // The bell still rings without the countdown.
      }
      logger.info('puncheokie.warn', 'round warning resumed in place', {
        round: safe(this.preparedRound),
        remainingMs: safe(remainingMs),
      })
      return
    }
    if (remainingMs > this.pl.plannedMs + LEAD_SLACK_MS) return
    this.started = true
    try {
      // The contract is "the countdown ends ON the bell": the analyzer
      // compares this play's observed end with the next work-entered
      // bell's onset (target [0, LEAD_SLACK_MS]; negative = cut off).
      const playId = this.pl.start(volume, {
        kind: 'round-warning',
        label: `warn-round-${this.preparedRound ?? 0}`,
        playIdPrefix: 'warn',
      })
      logger.info('puncheokie.warn', 'round warning playing', {
        round: safe(this.preparedRound),
        remainingMs: safe(remainingMs),
        totalMs: safe(this.pl.plannedMs),
        playId: safe(playId),
      })
    } catch (error) {
      logger.warn('puncheokie.warn', 'round warning play failed', {
        error: safe(String(error)),
      })
    }
  }

  /** The bell (or an exit) ends it. Safe to call repeatedly. */
  stop(): void {
    if (this.pl.loaded) {
      logger.info('puncheokie.warn', 'round warning stopped', {
        round: safe(this.preparedRound),
        wasPlaying: safe(this.started),
      })
    }
    this.pl.dispose()
    this.preparedRound = null
    this.started = false
    this.paused = false
  }
}
