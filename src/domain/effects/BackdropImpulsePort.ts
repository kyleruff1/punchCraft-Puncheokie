/**
 * The port for the decorative backdrop — the visual echo of a punch.
 *
 * Split from scoring on purpose (D17): the backdrop is ambience, never a
 * signal. An implementation may drop, merge, or ignore impulses under
 * load; the workout engine must never miss a punch. Nothing downstream
 * of this port may influence counts, matching, or pacing.
 *
 * Pure TypeScript: no React Native, no Expo (spec §15.1). The
 * implementation lives in `src/components/workout/backdrop/backdropBus.ts`.
 */
import type { PunchHand } from '../punch/PunchEvent'

/**
 * One decoded punch, reduced to what the backdrop needs. `velocityRaw`
 * is the tracker-reported velocity byte when the device profile carries
 * one; absent on capability-limited devices, and the impl treats that
 * as a mid-strength splash rather than nothing.
 */
export interface BackdropPunchImpulse {
  hand: PunchHand
  velocityRaw?: number
}

export interface BackdropImpulsePort {
  /** Fire the visual echo for a punch. Best-effort and non-blocking. */
  impulse(punch: BackdropPunchImpulse): void
}
