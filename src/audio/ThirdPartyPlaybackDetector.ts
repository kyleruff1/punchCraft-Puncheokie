/**
 * Whether another app is playing audio (M34-05, D1, spec §13.5).
 *
 * The D1 gate needs exactly one bit: *is someone else's audio playing right
 * now.* Nothing about what it is, who owns it, or what is in it — the app
 * never inspects another app's audio (spec §14.6).
 *
 * ## There is no implementation yet, and that is stated rather than faked
 *
 * Android answers this with `AudioManager.isMusicActive()`. **`expo-audio`
 * exposes no equivalent** — no music-active query, no audio-focus events — so
 * a real detector needs a small native module and a rebuild.
 *
 * Until that lands, `UnavailablePlaybackDetector` is the only implementation.
 * It reports `false` and, crucially, says so through `available`. The
 * distinction matters: a detector that returned `false` while claiming to
 * work would let the coach talk over someone's music and look correct doing
 * it. Reporting `available: false` lets the surfaces above say plainly that
 * this build cannot tell — which is the honest version of not knowing.
 *
 * The D1 gate itself is complete and tested (`voiceAllowed`); only its input
 * is missing. When the native read lands, one implementation swaps in and
 * nothing else changes.
 */

export interface ThirdPartyPlaybackDetector {
  /**
   * True when another app is playing audio.
   *
   * Check `available` before trusting a `false` — an unavailable detector
   * returns `false` because it has nothing to report, not because it looked.
   */
  isActive(): Promise<boolean>
  subscribe(listener: (active: boolean) => void): () => void
  /** False when this build cannot actually detect playback. */
  readonly available: boolean
}

/**
 * The stand-in for platforms where playback cannot be detected.
 *
 * Deliberately not called `NullPlaybackDetector`: the point is not that it
 * does nothing, it is that it *does not know*, and every caller has to be
 * able to tell the difference.
 */
export class UnavailablePlaybackDetector implements ThirdPartyPlaybackDetector {
  readonly available = false

  async isActive(): Promise<boolean> {
    return false
  }

  subscribe(_listener: (active: boolean) => void): () => void {
    // Nothing will ever fire, so unsubscribing is equally uneventful.
    return () => {}
  }
}

/**
 * A detector driven by an explicit value. Used by tests and by the live
 * screen's manual override once one exists.
 */
export class StaticPlaybackDetector implements ThirdPartyPlaybackDetector {
  readonly available = true
  private active: boolean
  private listeners: Array<(active: boolean) => void> = []

  constructor(active = false) {
    this.active = active
  }

  async isActive(): Promise<boolean> {
    return this.active
  }

  set(active: boolean): void {
    if (active === this.active) return
    this.active = active
    for (const listener of [...this.listeners]) listener(active)
  }

  subscribe(listener: (active: boolean) => void): () => void {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }
}

/** What the app uses today. One line to change when the native read lands. */
export function createPlaybackDetector(): ThirdPartyPlaybackDetector {
  return new UnavailablePlaybackDetector()
}

/**
 * The line shown wherever voice is configured or running, when detection is
 * unavailable.
 *
 * Says what the app cannot do and what the athlete can do about it. It does
 * not apologise, and it does not pretend the gate is working.
 */
export const PLAYBACK_DETECTION_UNAVAILABLE_NOTICE =
  'This build cannot tell when another app is playing. If you are using your own music, turn the Voice Coach off.'
