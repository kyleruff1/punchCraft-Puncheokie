/**
 * Sequential playback for the walkout announcement (see `introPlan.ts`).
 *
 * Lives in the audio layer for the same reason as `LobbyJokePlayer`:
 * screens speak through adapters, never expo-audio (spec §13.5).
 *
 * One persistent player + `replace()` per segment — per-clip player
 * creation is the pattern that killed the clip audition ~90 clips in.
 * Segment hand-off uses a wall timer, which is acceptable ONLY here: the
 * countdown carries no workout load (the 2.3x stretch was measured under
 * live rounds), and the bell's authority is the session clock regardless —
 * a late intro gets cut off by `stop()`, it never delays the round.
 */

import { createAudioPlayer, type AudioPlayer } from 'expo-audio'

import { INTRO_SEGMENT_GAP_MS } from './introPlan'
import type { IntroSegment } from './voiceAssets/introManifest'

export class IntroPlayer {
  private player: AudioPlayer | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private started = false

  /** Deliver the announcement once. Idempotent. */
  play(segments: readonly IntroSegment[], volume: number): void {
    if (this.started) return
    this.started = true
    const first = segments[0]
    if (!first) return
    try {
      const player = createAudioPlayer(first.module)
      player.volume = volume
      this.player = player
      player.play()
    } catch {
      return // The lobby survives a mute cornerman.
    }
    this.scheduleNext(segments, 0)
  }

  private scheduleNext(segments: readonly IntroSegment[], index: number): void {
    const current = segments[index]
    const next = segments[index + 1]
    if (!current || !next) return
    this.timer = setTimeout(() => {
      try {
        this.player?.replace(next.module)
        this.player?.play()
      } catch {
        // Skip the segment; the chain continues.
      }
      this.scheduleNext(segments, index + 1)
    }, current.durationMs + INTRO_SEGMENT_GAP_MS)
  }

  /** The bell ends the speech. Safe to call repeatedly. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    try {
      this.player?.remove()
    } catch {
      // Already gone.
    }
    this.player = null
  }
}
