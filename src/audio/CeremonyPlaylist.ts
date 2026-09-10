/**
 * The one native playlist a ceremony owns: build → start → pause/resume →
 * dispose, with the timing observer wired through every step.
 *
 * `IntroPlayer`, `RecoveryPlayer` and `RoundWarningPlayer` each hold one of
 * these. What they keep for themselves is everything that genuinely differs:
 * how the source list is assembled, what triggers the start (a countdown
 * phase, a rest-elapsed clearance, a remaining-rest window), the walkout's
 * completion pump. What lives here is everything that had been written three
 * times and was drifting apart.
 *
 * ## Why composition, and why now
 *
 * A survey measured 217 of the three players' 480 code lines — 45% — as
 * normalised-identical, and three of their last four substantive commits as
 * the same edit applied by hand three or four times: the observer wiring, the
 * resume-in-place branch, and a native-resource-leak fix (`24d3a8be`) whose
 * correctness depended on every copy being right. The drift that survives a
 * copy is the cost: `RoundWarningPlayer.prepare()`'s catch was byte-identical
 * to `RecoveryPlayer`'s, comment included, minus one line — and that missing
 * line latched a round out of its countdown on any transient failure
 * (`fd700e4d`). Two of the three logged a missing silence track; one did not.
 * One stamped `dispatchMs` before the volume setter, three after. Same
 * concept, two field names.
 *
 * This is a handle, not a base class. The players are not three kinds of one
 * thing — the intro's pause/resume shifts a completion deadline, the others'
 * does not — and a base class would have made them fight over the parts that
 * differ. The handle owns exactly the parts that must not differ.
 *
 * ## The native contract, in one place
 *
 * - `createAudioPlaylist` at the observed 40 ms status cadence when a timing
 *   observer is attached, else the default 500.
 * - `dispatchMs` is stamped AFTER the volume setter and immediately before
 *   `play()` — `WatchMeta.dispatchMs` documents it as "`clock()` taken
 *   immediately before `play()`", and the setter is a JSI hop. The intro used
 *   to stamp it before the setter, which put its onset latency in a slightly
 *   different domain from the other three.
 * - On teardown the observer lets go BEFORE the native release, or it would
 *   hold a listener on a freed playlist. Then pause + destroy + release —
 *   `destroy()` alone is a registry unlink and the ExoPlayer survives it (see
 *   `nativeAudioTeardown.ts`).
 * - A build that throws disposes rather than merely dropping the reference: if
 *   the throw came from AFTER the field was assigned, nulling it would orphan
 *   a live native playlist with no handle left to free it.
 */

import { createAudioPlaylist, type AudioPlaylist } from 'expo-audio'
import { releaseAudioPlaylist } from './nativeAudioTeardown'
import { OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS, type ObservedKind, type PlaybackObserver } from './PlaybackObserver'

import { logger, safe } from '@/diagnostics/logger'

import { silenceFor } from './voiceAssets/silenceManifest'

export interface CeremonyStartMeta {
  kind: ObservedKind
  /** What names the sound in the log — `'intro'`, a script id, `warn-round-N`. */
  label: string
  /** Prefix for the minted playId; the observer numbers it. */
  playIdPrefix: string
}

export class CeremonyPlaylist {
  private playlist: AudioPlaylist | null = null
  /** The silent timing observer (GH #291, C2), or null. Shared with the coach output. */
  private readonly timing: PlaybackObserver | null
  /** Logger tag — `puncheokie.intro` and friends — so the log reads as before. */
  private readonly tag: string
  /** Sum of the planned clip + silence milliseconds, as the caller computed it. */
  private plannedMsValue = 0
  private tracksValue = 0

  constructor(timing: PlaybackObserver | null, tag: string) {
    this.timing = timing
    this.tag = tag
  }

  /** True once `build()` has produced a live native playlist. */
  get loaded(): boolean {
    return this.playlist !== null
  }

  get plannedMs(): number {
    return this.plannedMsValue
  }

  /** Native track count — every clip and every silence track. */
  get tracks(): number {
    return this.tracksValue
  }

  /**
   * The silence track for a planned gap, or `undefined` with the mismatch
   * named in the log. A gap with no track is a planner/manifest mismatch: the
   * speech goes on without the pause, and the log says which one — so it can
   * be regenerated (see `silenceManifest.ts`). Two of the three players logged
   * this and one did not; now the lookup itself does.
   */
  silenceTrack(gapMs: number, where: Record<string, unknown>): number | undefined {
    if (gapMs <= 0) return undefined
    const track = silenceFor(gapMs)
    if (track === undefined) {
      logger.warn(this.tag, 'no silence track for planned gap', { ...where, gapMs: safe(gapMs) })
    }
    return track
  }

  /**
   * Build the native playlist and start it buffering. Frees any previous one
   * first. Returns whether a playlist now exists — `false` for an empty source
   * list or a native throw, both already handled and logged.
   *
   * `message` is the ceremony's own "prepared" line — `'recovery loaded'`,
   * `'round warning prepared'` — and must stay per-ceremony: `verify-suite`
   * and `drive-full-workout` count those exact strings to tally ceremonies
   * per drive. `log` is spread into it, so each ceremony names what it built
   * (segments, script, round, opener) without the handle knowing.
   */
  build(sources: readonly number[], plannedMs: number, message: string, log: Record<string, unknown>): boolean {
    this.dispose()
    if (sources.length === 0) return false
    try {
      this.playlist = createAudioPlaylist({
        sources: [...sources],
        loop: 'none',
        updateInterval: this.timing ? OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS : 500,
      })
      this.plannedMsValue = plannedMs
      this.tracksValue = sources.length
      // `tracks` and `boundaries` are what the analyzer needs to cost the dead
      // air at playlist track boundaries — measured (plan 5b) at ~95 ms
      // entering a 24 kHz track and ~193 ms entering a 48 kHz one. Logged for
      // every ceremony, from one place, so none can drift out of it again.
      logger.info(this.tag, message, {
        ...log,
        plannedMs: safe(plannedMs),
        tracks: safe(sources.length),
        boundaries: safe(Math.max(0, sources.length - 1)),
      })
      return true
    } catch (error) {
      this.dispose()
      logger.warn(this.tag, 'playlist creation failed', { ...log, error: safe(String(error)) })
      return false
    }
  }

  /**
   * Start playback once: volume, then the dispatch stamp, then `play()`,
   * then the observer watch. A native throw from the setter or `play()`
   * propagates — what a failed start MEANS differs per ceremony (the intro
   * must still release the bell; the others just go quiet), so the caller
   * decides. Returns the minted playId, or null when unobserved.
   */
  start(volume: number, meta: CeremonyStartMeta): string | null {
    if (this.playlist === null) return null
    this.playlist.volume = volume
    const dispatchMs = this.timing?.nowMs()
    this.playlist.play()
    const playId = this.timing?.mintPlayId(meta.playIdPrefix) ?? null
    if (this.timing !== null && playId !== null && dispatchMs !== undefined) {
      this.timing.watch(
        this.playlist,
        {
          playId,
          kind: meta.kind,
          label: meta.label,
          expectedDurationMs: this.plannedMsValue,
          dispatchMs,
          volumeAtDispatch: volume,
        },
        { statusEvent: 'playlistStatusUpdate' },
      )
    }
    return playId
  }

  /**
   * Continue from position after `pause()`. No re-watch: a pause and resume
   * in place is one observation. A native throw propagates, as with `start`.
   */
  resume(volume: number): void {
    if (this.playlist === null) return
    this.playlist.volume = volume
    this.playlist.play()
  }

  /** Hold position. The playlist is paused, never destroyed. Never throws. */
  pause(): void {
    try {
      this.playlist?.pause()
    } catch {
      // Already stopped.
    }
  }

  /** Whether native reports the playlist sounding right now; false if unreadable. */
  get playing(): boolean {
    try {
      return this.playlist?.playing === true
    } catch {
      return false
    }
  }

  /**
   * Free the playlist. The observer forgets it FIRST (an open observation
   * closes as `released`), then the native teardown runs. Safe to call
   * repeatedly and on a handle that never built.
   */
  dispose(): void {
    if (this.playlist !== null) this.timing?.forget(this.playlist, 'released')
    releaseAudioPlaylist(this.playlist)
    this.playlist = null
    this.plannedMsValue = 0
    this.tracksValue = 0
  }
}
