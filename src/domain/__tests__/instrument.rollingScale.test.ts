import { createImpulseScaler } from '../effects/impulseScale'
import {
  ACCELERATION_SCALE_DEFAULTS,
  createRollingScaler,
  HIGH_SENSITIVITY_ACCELERATION_DEFAULTS,
  VELOCITY_SCALE_DEFAULTS,
  type RollingScaleOptions,
} from '../instrument/rollingScale'

describe('instrument rollingScale', () => {
  it('velocity defaults agree with the backdrop impulse scaler, reading for reading', () => {
    // The instrument's velocity01 and the backdrop's v01 must not drift —
    // VELOCITY_SCALE_DEFAULTS pins the same constants, and this parity
    // sweep proves the algorithm clone is faithful.
    const instrument = createRollingScaler(VELOCITY_SCALE_DEFAULTS)
    const backdrop = createImpulseScaler()
    const readings: Array<[hand: 'left' | 'right', raw: number | undefined]> = [
      ['left', 5],
      ['left', 14],
      ['right', 9],
      ['left', 7],
      ['right', 12],
      ['left', undefined],
      ['right', 6],
      ['left', 20],
      ['left', 2],
      ['right', 8],
      ['left', 11],
      ['right', 15],
    ]
    for (const [hand, raw] of readings) {
      expect(instrument.scale(hand, raw)).toBe(backdrop.scale(hand, raw))
    }
  })

  it('maps the warm-start anchors to the rails on the first reading', () => {
    const scaler = createRollingScaler(VELOCITY_SCALE_DEFAULTS)
    expect(scaler.scale('left', VELOCITY_SCALE_DEFAULTS.warmLow)).toBe(0)
    const fresh = createRollingScaler(VELOCITY_SCALE_DEFAULTS)
    expect(fresh.scale('left', VELOCITY_SCALE_DEFAULTS.warmHigh)).toBe(1)
  })

  it('is monotone in the reading', () => {
    for (const defaults of [VELOCITY_SCALE_DEFAULTS, ACCELERATION_SCALE_DEFAULTS]) {
      const scaler = createRollingScaler(defaults)
      const raws = [
        defaults.warmLow - 5,
        defaults.warmLow,
        (defaults.warmLow + defaults.warmHigh) / 2,
        defaults.warmHigh,
        defaults.warmHigh + 50,
      ]
      let prev = -1
      for (const raw of raws) {
        // A fresh scaler per reading isolates monotonicity from the
        // window's own adaptation.
        const value = createRollingScaler(defaults).scale('left', raw)
        expect(value).toBeGreaterThanOrEqual(prev)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
        prev = value
      }
      void scaler
    }
  })

  it('a missing reading lands mid-scale', () => {
    const scaler = createRollingScaler(ACCELERATION_SCALE_DEFAULTS)
    expect(scaler.scale('left', undefined)).toBe(0.5)
    expect(scaler.scale('right', Number.NaN)).toBe(0.5)
  })

  it('a flurry of identical readings cannot read maximal', () => {
    const scaler = createRollingScaler(ACCELERATION_SCALE_DEFAULTS)
    for (let i = 0; i < 60; i += 1) scaler.scale('left', 300)
    // minSpread holds high a fixed distance above low, so an identical
    // reading sits at the low anchor (reads 0) instead of collapsing the
    // rails and reading maximal (1) — the failure minSpread exists to
    // prevent. A reading above the settled value climbs off the floor.
    expect(scaler.scale('left', 300)).toBeLessThan(1)
    expect(scaler.scale('left', 360)).toBeGreaterThan(0)
  })

  it('keeps hands independent', () => {
    const scaler = createRollingScaler(VELOCITY_SCALE_DEFAULTS)
    // Feed the left window heavy readings; the right hand's scale for a
    // modest reading must not be dragged down by them.
    for (let i = 0; i < 20; i += 1) scaler.scale('left', 18)
    const rightFresh = createRollingScaler(VELOCITY_SCALE_DEFAULTS).scale('right', 9)
    expect(scaler.scale('right', 9)).toBe(rightFresh)
  })
})

describe('acceleration dynamics over a real capture (2026-09-07 retune)', () => {
  // The 24 accelerationRaw values logged off the gloves on 2026-09-06, in the
  // order thrown. Real data rather than synthetic: the defect was that the
  // hardest punches of an actual session were indistinguishable, and only the
  // real distribution shows that.
  const CAPTURED: readonly number[] = [
    237, 92, 197, 41, 721, 110, 104, 116, 120, 175, 76, 796, 484, 217, 215, 564,
    602, 548, 230, 643, 466, 470, 360, 380,
  ]

  function scaleAll(opts: RollingScaleOptions): number[] {
    const scaler = createRollingScaler(opts)
    // One hand: the window is per-hand, and a two-hand split would halve the
    // sample count and keep the references in warm-up for the whole run.
    return CAPTURED.map((raw) => scaler.scale('right', raw))
  }

  const SATURATED = 0.999

  it('stops pinning the top of the range — the defect this retune fixes', () => {
    const values = scaleAll(HIGH_SENSITIVITY_ACCELERATION_DEFAULTS)
    const pinned = values.filter((v) => v >= SATURATED)
    // Before: highPercentile 0.85 and warmHigh 350 pinned a third of the
    // session at 1.0, which downstream became MIDI velocity 127 for every one.
    expect(pinned.length).toBeLessThanOrEqual(4)
  })

  it('still spreads the hardest punches apart from each other', () => {
    // The four biggest hits (796, 721, 643, 602) must not collapse to one
    // value — that is precisely what "a medium punch and my hardest punch
    // sound identical" means.
    const scaler = createRollingScaler(HIGH_SENSITIVITY_ACCELERATION_DEFAULTS)
    for (const raw of CAPTURED) scaler.scale('right', raw)
    const hard = [602, 643, 721, 796].map((raw) => scaler.scale('right', raw))
    const distinct = new Set(hard.map((v) => v.toFixed(3)))
    expect(distinct.size).toBeGreaterThan(1)
  })

  it('keeps soft play expressive — the reason this variant exists', () => {
    // The low anchor is deliberately untouched by the retune. A soft punch
    // must still read meaningfully above zero, or the high-sensitivity
    // variant has lost its purpose.
    const scaler = createRollingScaler(HIGH_SENSITIVITY_ACCELERATION_DEFAULTS)
    for (const raw of CAPTURED) scaler.scale('right', raw)
    const soft = scaler.scale('right', 175)
    expect(soft).toBeGreaterThan(0)
    expect(soft).toBeLessThan(0.6)
  })

  it('is a strict improvement on the old constants for this capture', () => {
    const before = scaleAll({
      ...HIGH_SENSITIVITY_ACCELERATION_DEFAULTS,
      warmHigh: 350,
      highPercentile: 0.85,
    })
    const after = scaleAll(HIGH_SENSITIVITY_ACCELERATION_DEFAULTS)
    const pinnedBefore = before.filter((v) => v >= SATURATED).length
    const pinnedAfter = after.filter((v) => v >= SATURATED).length
    expect(pinnedAfter).toBeLessThan(pinnedBefore)
  })
})
