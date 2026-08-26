/**
 * Sequential playback for the walkout announcement (see `introPlan.ts`).
 *
 * Lives in the audio layer because screens speak through adapters, never
 * expo-audio (spec §13.5). This player also delivers the joke — the joke
 * is an extension of the intro, planned into the same sequence.
 *
 * Two lessons from the first monitored walkout are load-bearing here:
 *
 * - **Preload at load(), not at play().** On the dev client a cold wav
 *   streams from Metro; the first run took ~16 s to make a sound. Every
 *   segment gets its own player the moment the plan exists (the athlete
 *   is still reading the lobby), so play() starts on warm players.
 * - **Advance on didJustFinish, never on a blind timer.** The first cut
 *   advanced on planned durations from the play() call; with the first
 *   clip still loading, every replace() fired early, threw, and the
 *   chain died silently — one sentence, 26 s of dead air, then the bell.
 *   Now the next segment starts when the current one actually ends, plus
 *   the planned gap. A watchdog (duration + gap + slack) advances if the
 *   finish event never arrives, so a stuck clip costs its own slot, not
 *   the whole speech.
 *
 * The bell's authority is untouched: the session clock ends the countdown
 * at the planned total regardless, and stop() cuts a straggler.
 */

import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio'

import type { PlannedIntroSegment } from './introPlan'

/** Grace beyond duration+gap before the watchdog force-advances. */
const WATCHDOG_SLACK_MS = 4_000

interface LoadedSegment {
  segment: PlannedIntroSegment
  player: AudioPlayer
  subscription: { remove: () => void } | null
}

export class IntroPlayer {
  private loaded: LoadedSegment[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private watchdog: ReturnType<typeof setTimeout> | null = null
  private index = -1
  private started = false

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
        this.loaded.push({ segment, player, subscription: null })
      } catch {
        // A segment that cannot load is skipped; the speech survives.
      }
    }
  }

  /** Deliver the announcement once. Idempotent. */
  play(volume: number): void {
    if (this.started || this.loaded.length === 0) return
    this.started = true
    for (const { player } of this.loaded) {
      try {
        player.volume = volume
      } catch {
        // Volume is best-effort.
      }
    }
    this.startSegment(0)
  }

  private startSegment(index: number): void {
    const entry = this.loaded[index]
    if (!entry) return
    this.index = index
    try {
      entry.subscription = entry.player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
        if (status.didJustFinish) this.advanceFrom(index)
      })
      entry.player.play()
    } catch {
      // Skip straight to the next segment; the chain continues.
      this.advanceFrom(index)
      return
    }
    // If the finish event never comes (clip stuck loading, event dropped),
    // the watchdog advances — a bad clip costs its slot, not the speech.
    const next = this.loaded[index + 1]
    const budget =
      entry.segment.durationMs + (next?.segment.gapBeforeMs ?? 0) + WATCHDOG_SLACK_MS
    this.watchdog = setTimeout(() => this.advanceFrom(index), budget)
  }

  private advanceFrom(index: number): void {
    if (this.index !== index) return // Already advanced (watchdog vs event race).
    const entry = this.loaded[index]
    entry?.subscription?.remove()
    if (entry) entry.subscription = null
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog)
      this.watchdog = null
    }
    const next = this.loaded[index + 1]
    if (!next) {
      this.index = this.loaded.length
      return
    }
    this.index = -1 // Between segments; the gap timer owns the hand-off.
    this.timer = setTimeout(() => {
      this.timer = null
      this.startSegment(index + 1)
    }, next.segment.gapBeforeMs)
  }

  /** The bell ends the speech. Frees every player. Safe to call repeatedly. */
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog)
      this.watchdog = null
    }
    this.dispose()
  }

  private dispose(): void {
    for (const { player, subscription } of this.loaded) {
      subscription?.remove()
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
