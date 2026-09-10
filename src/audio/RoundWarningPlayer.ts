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
import { releaseAudioPlaylist } from './nativeAudioTeardown'
import { OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS, type PlaybackObserver } from './PlaybackObserver'

import { logger, safe } from '@/diagnostics/logger'

import { themeClipFor } from './voiceAssets/calloutManifest'
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
  /** The silent timing observer (GH #291, C2), or null. Shared with the coach output. */
  private readonly timing: PlaybackObserver | null
  private totalMs = 0

  constructor(opts: { observer?: PlaybackObserver | null } = {}) {
    this.timing = opts.observer ?? null
  }
  private preparedRound: number | null = null
  private played = false
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
    this.dispose()
    this.preparedRound = roundNumber
    this.played = false

    const core = INTRO_SEGMENTS[`warn-round-${roundNumber}`]
    if (!core) return // Round number outside the rendered range.
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
        const breath = silenceFor(OPENER_GAP_MS)
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

    try {
      this.playlist = createAudioPlaylist({
        sources,
        loop: 'none',
        updateInterval: this.timing ? OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS : 500,
      })
      this.totalMs = totalMs
      // `tracks` is the field IntroPlayer and RecoveryPlayer already log and
      // this one did not, which is why the round warning is the one ceremony
      // whose dead air cannot be quantified per round.
      //
      // It matters more here than anywhere else. Plan 5b measured ~95 ms lost
      // entering a 24 kHz track and ~193 ms entering a 48 kHz one, and this
      // playlist alternates 24 kHz breaths with 48 kHz speech — so a 3-track
      // warning runs ~290 ms past `totalMs` and a 7-track one ~865 ms. The
      // analyzer's `warnEndToBellMs` is built on `totalMs`, and its whole job
      // is the SIGN of that number: the bell cutting the countdown off. It
      // currently reads a median +386 ms of margin that is partly not there,
      // and without the track count there is no way to say how much per round.
      logger.info('puncheokie.warn', 'round warning prepared', {
        round: safe(roundNumber),
        opener: safe(opener?.id),
        totalMs: safe(totalMs),
        tracks: safe(sources.length),
        boundaries: safe(Math.max(0, sources.length - 1)),
      })
    } catch (error) {
      // Dispose rather than merely drop the reference: if the throw came
      // from AFTER the field was assigned, nulling it would orphan a live
      // native playlist with no handle left to free it.
      this.dispose()
      // And CLEAR THE LATCH. `preparedRound` is set before the try so the
      // idempotence guard at the top of this method works — but that means a
      // failed build leaves it pointing at a round that has no playlist, and
      // every later `prepare()` for the same round returns at the guard. The
      // caller re-prepares on every store tick for the whole rest, so that is
      // ~60 retry opportunities all thrown away: one transient throw here and
      // that round gets no "three, two, one" into the bell. RecoveryPlayer's
      // otherwise-identical catch has always cleared its own latch; this one
      // drifted, and the drift cost a whole ceremony.
      this.preparedRound = null
      logger.warn('puncheokie.warn', 'round warning playlist failed', {
        round: safe(roundNumber),
        error: safe(String(error)),
      })
    }
  }

  /**
   * Suspend a talking warning in place — the athlete paused inside the
   * warning window. The playlist keeps its position and the session
   * clock keeps the remaining rest, so on resume the countdown still
   * lands on the bell. A warning that has not started has nothing to
   * suspend.
   */
  pause(): void {
    if (!this.played || this.paused || this.playlist === null) return
    this.paused = true
    try {
      this.playlist.pause()
    } catch {
      // Already stopped.
    }
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
    if (this.playlist === null) return
    if (this.played) {
      if (!this.paused) return
      this.paused = false
      try {
        this.playlist.volume = volume
        this.playlist.play()
      } catch {
        // The bell still rings without the countdown.
      }
      logger.info('puncheokie.warn', 'round warning resumed in place', {
        round: safe(this.preparedRound),
        remainingMs: safe(remainingMs),
      })
      return
    }
    if (remainingMs > this.totalMs + LEAD_SLACK_MS) return
    this.played = true
    try {
      this.playlist.volume = volume
      const dispatchMs = this.timing?.nowMs()
      this.playlist.play()
      const playId = this.timing?.mintPlayId('warn') ?? null
      logger.info('puncheokie.warn', 'round warning playing', {
        round: safe(this.preparedRound),
        remainingMs: safe(remainingMs),
        totalMs: safe(this.totalMs),
        playId: safe(playId),
      })
      if (this.timing !== null && playId !== null && dispatchMs !== undefined) {
        // The contract is "the countdown ends ON the bell": the analyzer
        // compares this play's observed end with the next work-entered
        // bell's onset (target [0, LEAD_SLACK_MS]; negative = cut off).
        this.timing.watch(
          this.playlist,
          {
            playId,
            kind: 'round-warning',
            label: `warn-round-${this.preparedRound ?? 0}`,
            expectedDurationMs: this.totalMs,
            dispatchMs,
            volumeAtDispatch: volume,
          },
          { statusEvent: 'playlistStatusUpdate' },
        )
      }
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
    this.paused = false
  }

  private dispose(): void {
    if (this.playlist !== null) this.timing?.forget(this.playlist, 'released')
    // pause + destroy + release. `destroy()` alone is only a registry
    // unlink — see nativeAudioTeardown.ts; the ExoPlayer survives it.
    releaseAudioPlaylist(this.playlist)
    this.playlist = null
    this.totalMs = 0
  }
}
