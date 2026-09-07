/**
 * Rolling per-hand normalization for the Puncheoke instrument — a
 * parameterized sibling of `@domain/effects/impulseScale` (same algorithm,
 * injectable constants) so the instrument can normalize BOTH tracker
 * readings it consumes:
 *
 *  - tracker-reported velocity (raw byte, observed ~4..20) → pitch zones
 *  - peak acceleration (raw u16, observed ~130..620 in the committed
 *    fixture) → attack / brightness / transient weight
 *
 * The workout's own scaler stays untouched: its constants are tuned for
 * the backdrop and haptics, versioned under IMPULSE_SCALE_VERSION, and the
 * instrument must be free to retune without moving decorative layers.
 *
 * Contract per instrument-design §5/§14: relative scale, robust
 * percentiles, warm-started so punch one lands sensibly, personal within
 * about a dozen punches. A stored calibration profile (the manifest's
 * per-hand anchors) later replaces the rolling source through
 * `RollingScaleReferenceSource` without touching callers — same seam as
 * impulseScale's `ImpulseReferenceSource`.
 *
 * Pure and clock-free: state advances only when a sample arrives.
 */
import type { PunchHand } from '../punch/PunchEvent'

export interface RollingScaleOptions {
  /** Rolling window length per hand. */
  window: number
  /** Warm-start low reference (raw units of the reading being scaled). */
  warmLow: number
  /** Warm-start high reference. */
  warmHigh: number
  /** Samples needed before the window fully owns the references. */
  warmSamples: number
  /** References never collapse closer than this. */
  minSpread: number
  /** Low percentile (0..1) once the window owns the references. */
  lowPercentile: number
  /** High percentile (0..1). */
  highPercentile: number
}

/**
 * Velocity defaults — byte-for-byte the constants in
 * `@domain/effects/impulseScale` (WINDOW 40, warm 5..14, P20/P90,
 * MIN_SPREAD 3), so the instrument's velocity01 agrees with the backdrop's
 * v01 until a calibration profile replaces the rolling source.
 */
export const VELOCITY_SCALE_DEFAULTS: RollingScaleOptions = {
  window: 40,
  warmLow: 5,
  warmHigh: 14,
  warmSamples: 12,
  minSpread: 3,
  lowPercentile: 0.2,
  highPercentile: 0.9,
}

/**
 * Acceleration defaults — warm-started from the committed live capture
 * (spike-mt4wm1d8-fx6x.json, raw u16 0x0084..0x0270 = 132..624). Wider
 * minSpread for the wider raw range.
 */
export const ACCELERATION_SCALE_DEFAULTS: RollingScaleOptions = {
  window: 40,
  warmLow: 150,
  warmHigh: 550,
  warmSamples: 12,
  minSpread: 60,
  lowPercentile: 0.2,
  highPercentile: 0.9,
}

/**
 * High-sensitivity variants for the instrument (Kyle, on-glass
 * 2026-09-05: soft play needs feedback). The firmware's transmit floor
 * (~threshold 30, cmd 17) still swallows the softest touches — that
 * lever is a protocol spike — but every punch that DOES arrive spreads
 * across the full musical range: anchors sit near the soft end of the
 * observed corpus (velocity bytes 2..10 mode 6-7; accel ~130..620), so a
 * relaxed jab reads mid-zone instead of pinning zone 0. Tighter
 * percentiles keep the top reachable without a haymaker.
 */
export const HIGH_SENSITIVITY_VELOCITY_DEFAULTS: RollingScaleOptions = {
  window: 40,
  warmLow: 2,
  warmHigh: 9,
  warmSamples: 12,
  minSpread: 3,
  lowPercentile: 0.1,
  highPercentile: 0.85,
}

/**
 * Acceleration, high sensitivity (retuned 2026-09-07 from a live capture).
 *
 * The soft end is deliberately unchanged — `warmLow` and `lowPercentile` are
 * what make a relaxed jab read mid-zone instead of pinning at nothing, which
 * is the whole reason this variant exists.
 *
 * What moved is the TOP. Measured over 24 real punches, accelerationRaw
 * spanned 41..796 while the references put the ceiling at P85 — so once the
 * window owned the references (after `warmSamples`), the hardest ~15% of
 * punches all mapped to 1.0 and were indistinguishable. Half the session
 * pinned at MIDI velocity 127: a medium punch and the hardest punch of the
 * night produced the identical hit.
 *
 * `highPercentile` is the persistent cause and 0.95 is the fix; `warmHigh`
 * only bites for the first dozen punches, but 350 was well under the observed
 * range and pinned nearly every hard punch during warm-up, so it moves too.
 * Both are conservative: the ceiling still adapts to whoever is punching,
 * it just stops treating the top of their range as one value.
 */
export const HIGH_SENSITIVITY_ACCELERATION_DEFAULTS: RollingScaleOptions = {
  window: 40,
  warmLow: 80,
  warmHigh: 600,
  warmSamples: 12,
  minSpread: 50,
  lowPercentile: 0.1,
  highPercentile: 0.95,
}

/** Where the low/high references come from (calibration seam). */
export interface RollingScaleReferenceSource {
  observe(hand: PunchHand, raw: number): void
  referencesFor(hand: PunchHand): { low: number; high: number }
}

export interface RollingScaler {
  /**
   * Map one reading to 0..1 for its hand, updating the rolling window.
   * `undefined` (reading absent on this device) → 0.5, mid-scale.
   */
  scale(hand: PunchHand, raw: number | undefined): number
}

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

class RollingReferences implements RollingScaleReferenceSource {
  private readonly windows: Record<'left' | 'right', number[]> = { left: [], right: [] }

  constructor(private readonly opts: RollingScaleOptions) {}

  observe(hand: PunchHand, raw: number): void {
    if (hand !== 'left' && hand !== 'right') return
    const window = this.windows[hand]
    window.push(raw)
    if (window.length > this.opts.window) window.shift()
  }

  referencesFor(hand: PunchHand): { low: number; high: number } {
    const samples =
      hand === 'left' || hand === 'right'
        ? this.windows[hand]
        : [...this.windows.left, ...this.windows.right]
    const sorted = [...samples].sort((a, b) => a - b)
    const weight = Math.min(1, sorted.length / this.opts.warmSamples)
    const low =
      this.opts.warmLow + (percentile(sorted, this.opts.lowPercentile) - this.opts.warmLow) * weight
    const high =
      this.opts.warmHigh +
      (percentile(sorted, this.opts.highPercentile) - this.opts.warmHigh) * weight
    return { low, high: Math.max(high, low + this.opts.minSpread) }
  }
}

export function createRollingScaler(
  opts: RollingScaleOptions,
  references: RollingScaleReferenceSource = new RollingReferences(opts),
): RollingScaler {
  return {
    scale(hand: PunchHand, raw: number | undefined): number {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0.5
      const { low, high } = references.referencesFor(hand)
      references.observe(hand, raw)
      return smoothstep((raw - low) / (high - low))
    },
  }
}
