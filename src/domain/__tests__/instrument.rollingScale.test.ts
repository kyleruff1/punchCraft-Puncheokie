import { createImpulseScaler } from '../effects/impulseScale'
import {
  ACCELERATION_SCALE_DEFAULTS,
  createRollingScaler,
  VELOCITY_SCALE_DEFAULTS,
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
