/**
 * Playback for the inter-round recovery walkthrough — the cornerman
 * works the corner during the 1-minute rest.
 *
 * Same doctrine as `IntroPlayer` / `RoundWarningPlayer`: the whole
 * script — every segment interleaved with its held silence — plays as
 * ONE native playlist. Five failed monitored walkouts taught this
 * project that JS-side sequencing on the dev client cannot keep audio
 * on the beat (see `IntroPlayer`'s header). The recovery corpus's
 * `pauseAfterMs` values live on disk as real silence tracks in
 * `silenceManifest.ts`, so no code steers a hold from the JS thread.
 *
 * This player is deliberately simpler than the intro's: nothing gates
 * on its end. The round warning is scheduled by remaining rest, not
 * by "the recovery finished"; the plan's fit filter guarantees the
 * whole walkthrough finishes before the warning starts. So there is no
 * completion pump and no `onComplete` — start on the first tick after
 * a short bell clearance and let the native playlist run to its end.
 *
 * The playlist itself is a `CeremonyPlaylist`; what stays here is the
 * script's source order and the bell-clearance trigger.
 */

import { CeremonyPlaylist } from './CeremonyPlaylist'
import type { PlaybackObserver } from './PlaybackObserver'

import { logger, safe } from '@/diagnostics/logger'

import type { RecoveryScript } from './voiceAssets/recoveryManifest'

/**
 * Wait for the ding to clear before the coach speaks. Kept short (1 s)
 * because the round warning owns the tail of the rest — if the
 * walkthrough starts late its whole length shifts toward the warning
 * boundary. The plan's fit budget accounts for this same 1 s.
 */
export const RECOVERY_BELL_CLEARANCE_MS = 1_000

export class RecoveryPlayer {
  private readonly pl: CeremonyPlaylist
  private preparedScriptId: string | null = null

  constructor(opts: { observer?: PlaybackObserver | null } = {}) {
    this.pl = new CeremonyPlaylist(opts.observer ?? null, 'puncheokie.recovery')
  }
  private started = false
  private paused = false

  /**
   * Build the native playlist for a recovery script — segment / silence
   * / segment / silence / … Idempotent per scriptId; a new scriptId
   * frees the previous playlist first.
   */
  prepare(script: RecoveryScript): void {
    if (this.preparedScriptId === script.scriptId) return
    const sources: number[] = []
    for (let i = 0; i < script.segments.length; i += 1) {
      const segment = script.segments[i] as RecoveryScript['segments'][number]
      sources.push(segment.module)
      const silence = this.pl.silenceTrack(segment.pauseAfterMs, {
        scriptId: safe(script.scriptId),
        segmentIndex: safe(i),
      })
      if (silence !== undefined) sources.push(silence)
    }
    const built = this.pl.build(sources, script.measuredTotalMs, 'recovery loaded', {
      scriptId: safe(script.scriptId),
      segments: safe(script.segments.length),
    })
    // The latch follows the playlist: set only when one exists, so a failed
    // build is retried on the caller's next tick rather than latched out.
    this.preparedScriptId = built ? script.scriptId : null
  }

  /**
   * Suspend playback in place — the athlete paused mid-rest. The native
   * playlist keeps its position; the next `playIfDue` resumes it. A
   * walkthrough that has not started yet has nothing to suspend.
   */
  pause(): void {
    if (!this.started || this.paused || !this.pl.loaded) return
    this.paused = true
    this.pl.pause()
    logger.info('puncheokie.recovery', 'recovery paused in place', {
      scriptId: safe(this.preparedScriptId),
    })
  }

  /**
   * Start the walkthrough once, after the bell has cleared. Called
   * every store tick during rest; the guard makes repeats a no-op —
   * except after a pause, where it resumes from position (the session
   * clock froze with the playlist, so alignment is preserved).
   */
  playIfDue(restElapsedMs: number, volume: number): void {
    if (!this.pl.loaded) return
    if (this.started) {
      if (!this.paused) return
      this.paused = false
      try {
        this.pl.resume(volume)
      } catch {
        // The rest continues without the walkthrough.
      }
      logger.info('puncheokie.recovery', 'recovery resumed in place', {
        scriptId: safe(this.preparedScriptId),
      })
      return
    }
    if (restElapsedMs < RECOVERY_BELL_CLEARANCE_MS) return
    this.started = true
    try {
      // Contract: the script finishes before the round warning starts —
      // the analyzer checks this play's observed end against the next
      // round-warning onset (> 0 required).
      const playId = this.pl.start(volume, {
        kind: 'recovery',
        label: this.preparedScriptId ?? 'recovery',
        playIdPrefix: 'recovery',
      })
      logger.info('puncheokie.recovery', 'recovery playing', {
        scriptId: safe(this.preparedScriptId),
        restElapsedMs: safe(restElapsedMs),
        playId: safe(playId),
      })
    } catch (error) {
      logger.warn('puncheokie.recovery', 'playlist play failed', {
        scriptId: safe(this.preparedScriptId),
        error: safe(String(error)),
      })
    }
  }

  /** End of rest, or unmount. Frees the playlist. Safe to call repeatedly. */
  stop(): void {
    if (this.pl.loaded) {
      logger.info('puncheokie.recovery', 'recovery stopped', {
        scriptId: safe(this.preparedScriptId),
        wasPlaying: safe(this.started),
      })
    }
    this.pl.dispose()
    this.preparedScriptId = null
    this.started = false
    this.paused = false
  }
}
