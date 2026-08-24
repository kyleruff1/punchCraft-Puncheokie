/**
 * `HapticOutputPort` on top of `expo-haptics` (M32-05, D-haptics).
 *
 * Best-effort and fire-and-forget: a punch lands hundreds of times a session,
 * so a haptic that awaited or threw would be worse than one that occasionally
 * misses. Every call is gated by the athlete's `haptics` volume, so turning it
 * off in settings actually silences the motor rather than just muting a number.
 */
import * as Haptics from 'expo-haptics'

import type { HapticOutputPort, HapticStrike } from '@domain/coach/HapticOutputPort'
import { logger, safe } from '@/diagnostics/logger'

export class HapticOutputExpo implements HapticOutputPort {
  /** Off until settings say otherwise, so a fresh install does not buzz. */
  private enabled = false

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
