/**
 * `HapticOutputPort` on top of `expo-haptics` (M32-05, D-haptics).
 *
 * Best-effort and fire-and-forget: a punch lands hundreds of times a session,
 * so a haptic that awaited or threw would be worse than one that occasionally
 * misses. Every call is gated by the athlete's `haptics` volume, so turning it
 * off in settings actually silences the motor rather than just muting a number.
 */
import * as Haptics from 'expo-haptics'

import {
  punchBuzzOf,
  type HapticOutputPort,
  type HapticStrike,
  type PunchBuzz,
} from '@domain/coach/HapticOutputPort'
import { createImpulseScaler } from '@domain/effects/impulseScale'
import type { PunchHand } from '@domain/punch/PunchEvent'
import { logger, safe } from '@/diagnostics/logger'

/** Buzz tier → motor style: the athlete literally feels the reading. */
const PUNCH_STYLE: Record<PunchBuzz, Haptics.ImpactFeedbackStyle> = {
  soft: Haptics.ImpactFeedbackStyle.Soft,
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
}

export class HapticOutputExpo implements HapticOutputPort {
  /** Off until settings say otherwise, so a fresh install does not buzz. */
  private enabled = false

  /**
   * Session-scoped scaling, the same rolling-window normalization the
   * backdrop uses — one instance per screen mount, so "hard" means hard
   * for THIS athlete, THIS session.
   */
  private readonly scaler = createImpulseScaler()

  /** Wire to the `haptics` volume: any positive value enables the motor. */
  setEnabled(on: boolean): void {
    this.enabled = on
  }

  strike(kind: HapticStrike): void {
    if (!this.enabled) return
    void this.fire(kind).catch((error: unknown) => {
      // A missed buzz is not worth interrupting a workout — log and move on.
      logger.warn('puncheokie.haptic.failed', 'haptic did not fire', {
        kind: safe(kind),
        error: safe(String(error)),
      })
    })
  }

  punch(hand: PunchHand, velocityRaw?: number): void {
    if (!this.enabled) return
    const tier = punchBuzzOf(this.scaler.scale(hand, velocityRaw))
    void Haptics.impactAsync(PUNCH_STYLE[tier]).catch((error: unknown) => {
      logger.warn('puncheokie.haptic.failed', 'punch buzz did not fire', {
        kind: safe(tier),
        error: safe(String(error)),
      })
    })
  }

  private async fire(kind: HapticStrike): Promise<void> {
    switch (kind) {
      case 'good':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        return
      case 'perfect':
        // A confirmed type earns a heavier, more definite hit than a good one.
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
        return
      case 'combo':
        // A celebratory pattern rather than one tap: success note, then a beat
        // and a heavy accent so a finished combo feels distinct from a hit.
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        await new Promise((resolve) => setTimeout(resolve, 90))
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
        return
    }
  }
}
