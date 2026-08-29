/**
 * Session-local impulse scaling — tracker-reported velocity → 0..1.
 *
 * There is no athlete calibration yet (M17–M19), and the raw byte's real
 * range is narrow and athlete-dependent (observed ~4..20, spec's fixed
 * 0..255 ceiling would flatten everything). So the scale is *relative to
 * this session*: each hand keeps a rolling window of recent readings and
 * normalizes between its ~P20 and ~P90, warm-started from the observed
 * hardware range so the very first punches still land sensibly. Within
 * about a dozen punches the references are the athlete's own.
 *
 * `ImpulseReferenceSource` is the seam for the future calibration
 * profile (spec §10.2 p35/p90): when M17–M19 land, a profile-backed
 * source replaces the rolling one without touching any caller.
 *
 * Pure and clock-free: state advances only when a sample arrives, so
 * domain purity holds and tests drive it with plain numbers.
 */
import type { PunchHand } from '../punch/PunchEvent'

/** Where the low/high references come from. */
export interface ImpulseReferenceSource {
  /** Record one reading for a hand (no-op for `unknown`). */
  observe(hand: PunchHand, raw: number): void
  /** Current [low, high] references for a hand, high > low always. */
  referencesFor(hand: PunchHand): { low: number; high: number }
}

export interface ImpulseScaler {
  /**
   * Map one reading to 0..1 for its hand, updating the rolling window.
   * `undefined` (capability-limited device) → 0.5, a mid splash.
   */
  scale(hand: PunchHand, raw: number | undefined): number
}

/** Rolling window per hand; enough history to be personal, short enough to track a session's arc. */
const WINDOW = 40
/** Warm-start references, from the observed hardware range (~4..20 raw). */
const WARM_LOW = 5
const WARM_HIGH = 14
/** Samples needed before the window fully owns the references. */
const WARM_SAMPLES = 12
/** The references never collapse closer than this, so one flurry of identical readings cannot make everything read maximal. */
const MIN_SPREAD = 3

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))
  return sorted[idx] ?? 0
}

/** Hermite smoothstep — soft knees at both references. */
function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

class RollingReferences implements ImpulseReferenceSource {
  private readonly windows: Record<'left' | 'right', number[]> = { left: [], right: [] }

  observe(hand: PunchHand, raw: number): void {
    if (hand !== 'left' && hand !== 'right') return
    const window = this.windows[hand]
    window.push(raw)
    if (window.length > WINDOW) window.shift()
  }

  referencesFor(hand: PunchHand): { low: number; high: number } {
    // An unknown hand reads the merged view of both — it still deserves
    // a personal scale, it just cannot say whose.
    const samples =
      hand === 'left' || hand === 'right'
        ? this.windows[hand]
        : [...this.windows.left, ...this.windows.right]
    const sorted = [...samples].sort((a, b) => a - b)
    // Blend from the warm-start toward the window as samples accrue, so
    // punch one is sane and punch twelve is personal.
    const weight = Math.min(1, sorted.length / WARM_SAMPLES)
    const low = WARM_LOW + (percentile(sorted, 0.2) - WARM_LOW) * weight
    const high = WARM_HIGH + (percentile(sorted, 0.9) - WARM_HIGH) * weight
    return { low, high: Math.max(high, low + MIN_SPREAD) }
  }
}

export function createImpulseScaler(
  references: ImpulseReferenceSource = new RollingReferences(),
): ImpulseScaler {
  return {
    scale(hand: PunchHand, raw: number | undefined): number {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0.5
      const { low, high } = references.referencesFor(hand)
      references.observe(hand, raw)
      return smoothstep((raw - low) / (high - low))
    },
  }
}
