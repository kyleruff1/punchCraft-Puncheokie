import {
  CONVERGE_WINDOW_S,
  HAND_LEFT,
  HAND_NEUTRAL,
  HAND_RIGHT,
  SPLATS_PER_STEP,
  SPLAT_FLOATS,
  bumpEnv,
  convergenceSplat,
  decayedEnv,
  decodeSigned,
  detectConvergence,
  encodeSigned,
  handCodeOf,
  hash01,
  impulseDirection,
  impulseOrigin,
  kickTray,
  packSplats,
  plasticShare,
  restingTray,
  splatFromPunch,
  stepTray,
  visualStrength,
} from '../effects/sedimentMath'

describe('sedimentMath', () => {
  it('hash01 is deterministic and lands in [0, 1)', () => {
    for (let seed = 0; seed < 16; seed += 1) {
      for (let lane = 0; lane < 16; lane += 1) {
        const v = hash01(seed, lane)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(1)
        expect(hash01(seed, lane)).toBe(v)
      }
    }
  })

  describe('signed channel encoding', () => {
    it('roundtrips across the range including extremes', () => {
      const range = 0.08
      for (const v of [-0.08, -0.03, 0, 0.001, 0.05, 0.08]) {
        expect(decodeSigned(encodeSigned(v, range), range)).toBeCloseTo(v, 10)
      }
    })

    it('clamps out-of-range values instead of wrapping', () => {
      expect(encodeSigned(99, 0.05)).toBe(1)
      expect(encodeSigned(-99, 0.05)).toBe(0)
      expect(decodeSigned(1, 0.05)).toBeCloseTo(0.05, 10)
    })
  })

  it('visualStrength has the 0.15 floor, 2.0 ceiling, and is monotone', () => {
    expect(visualStrength(0)).toBeCloseTo(0.15, 10)
    expect(visualStrength(1)).toBeCloseTo(2, 10)
    let prev = -1
    for (let i = 0; i <= 10; i += 1) {
      const v = visualStrength(i / 10)
      expect(v).toBeGreaterThan(prev)
      prev = v
    }
  })

  it('plasticShare spans light ~4% to hard ~18%', () => {
    expect(plasticShare(0)).toBeCloseTo(0.04, 10)
    expect(plasticShare(1)).toBeCloseTo(0.18, 10)
  })

  it('origins sit in hand thirds with bounded jitter', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      expect(impulseOrigin(HAND_LEFT, seed).x).toBeCloseTo(0.28, 10)
      expect(impulseOrigin(HAND_RIGHT, seed).x).toBeCloseTo(0.72, 10)
      expect(impulseOrigin(HAND_NEUTRAL, seed).x).toBeCloseTo(0.5, 10)
      const y = impulseOrigin(HAND_LEFT, seed).y
      expect(y).toBeGreaterThan(0.3)
      expect(y).toBeLessThan(0.7)
    }
    expect(impulseDirection(HAND_LEFT)).toBe(1)
    expect(impulseDirection(HAND_RIGHT)).toBe(-1)
    expect(impulseDirection(HAND_NEUTRAL)).toBe(0)
  })

  describe('envelopes', () => {
    it('decay analytically with the exact time constant', () => {
      const atTau = decayedEnv(1, 0, 2, 2)
      expect(atTau).toBeCloseTo(Math.exp(-1), 10)
      // Pre-stamp reads clamp instead of amplifying.
      expect(decayedEnv(1, 5, 2, 2)).toBe(1)
    })

    it('bump decays first, then adds, and saturates at 1.5', () => {
      const bumped = bumpEnv(1, 0, 2, 2, 0.5)
      expect(bumped).toBeCloseTo(Math.exp(-1) + 0.5, 10)
      expect(bumpEnv(1.5, 0, 0, 2, 9)).toBe(1.5)
    })
  })

  describe('convergence', () => {
    it('boosts opposite hands inside the window', () => {
      const boost = detectConvergence(HAND_LEFT, 10, 0.8, HAND_RIGHT, 10.3, 0.6)
      expect(boost).toBeCloseTo(0.7, 10)
    })

    it('stays dark for same hand, late pairs, and neutral', () => {
      expect(detectConvergence(HAND_LEFT, 10, 1, HAND_LEFT, 10.2, 1)).toBe(0)
      expect(
        detectConvergence(HAND_LEFT, 10, 1, HAND_RIGHT, 10 + CONVERGE_WINDOW_S + 0.01, 1),
      ).toBe(0)
      expect(detectConvergence(HAND_NEUTRAL, 10, 1, HAND_RIGHT, 10.1, 1)).toBe(0)
    })
  })

  describe('tray spring', () => {
    it('a kicked tray overshoots, decays, and settles near rest', () => {
      let tray = kickTray(restingTray(), HAND_LEFT, 1.5, 3)
      expect(tray.velX).toBeGreaterThan(0)
      let maxOffset = 0
      let crossedZero = false
      let prevSign = 1
      for (let i = 0; i < 30 * 6; i += 1) {
        tray = stepTray(tray, 1 / 30)
        maxOffset = Math.max(maxOffset, Math.abs(tray.offsetX))
        const sign = Math.sign(tray.offsetX) || prevSign
        if (sign !== prevSign) crossedZero = true
        prevSign = sign
      }
      expect(maxOffset).toBeGreaterThan(0.001) // it visibly moved
      expect(crossedZero).toBe(true) // it oscillated, not just decayed
      expect(Math.abs(tray.offsetX)).toBeLessThan(0.0005) // it settled
      expect(Math.abs(tray.velX)).toBeLessThan(0.005)
    })
  })

  describe('splats', () => {
    it('maps punches to sided, strength-scaled splats', () => {
      const left = splatFromPunch(HAND_LEFT, 1, 5)
      expect(left.x).toBeCloseTo(0.28, 10)
      expect(left.dirX).toBe(1)
      expect(left.handTint).toBe(-1)
      expect(left.strength).toBeCloseTo(2, 10)
      const soft = splatFromPunch(HAND_RIGHT, 0, 6)
      expect(soft.radius).toBeLessThan(left.radius)
      expect(soft.handTint).toBe(1)
      const center = convergenceSplat(0.7, 9)
      expect(center.x).toBe(0.5)
      expect(center.dirX).toBe(0)
    })

    it('packs to exactly the shader float counts, plain arrays', () => {
      const splats = [splatFromPunch(HAND_LEFT, 0.5, 1), splatFromPunch(HAND_RIGHT, 1, 2)]
      const packed = packSplats(splats)
      expect(Array.isArray(packed.positions)).toBe(true)
      expect(Array.isArray(packed.meta)).toBe(true)
      expect(packed.positions).toHaveLength(SPLAT_FLOATS)
      expect(packed.meta).toHaveLength(SPLAT_FLOATS)
      // Empty slots are inert: zero strength, tiny nonzero radius.
      const lastSlot = packed.positions.slice((SPLATS_PER_STEP - 1) * 4)
      expect(lastSlot[2]).toBe(0)
      expect(lastSlot[3]).toBeGreaterThan(0)
    })
  })

  it('maps bus hands to codes', () => {
    expect(handCodeOf('left')).toBe(HAND_LEFT)
    expect(handCodeOf('right')).toBe(HAND_RIGHT)
    expect(handCodeOf('unknown')).toBe(HAND_NEUTRAL)
  })
})
