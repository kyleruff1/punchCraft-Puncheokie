import {
  ATLAS_SLOTS,
  HAND_LEFT,
  HAND_NEUTRAL,
  HAND_RIGHT,
  INERT_T,
  MEET_GLOW_MS,
  MEET_WINDOW_MS,
  PARTICLES_PER_IMPULSE,
  PARTICLE_LIFE_MAX_MS,
  RIPPLE_LIFE_MS,
  RIPPLE_POOL,
  SURGE_TAU_MS,
  ambientBlobAt,
  emptyPool,
  hash01,
  meetBoostAt,
  particleAt,
  rippleAt,
  surgeAt,
  type ImpulseSlot,
} from '../effects/hydroPulse'

const W = 1200
const H = 700

function slot(overrides: Partial<ImpulseSlot>): ImpulseSlot {
  return { t: 0, hand: HAND_LEFT, v01: 0.8, seed: 3, ...overrides }
}

describe('hydroPulse frame math', () => {
  it('sizes the atlas to the ripple pool', () => {
    expect(ATLAS_SLOTS).toBe(RIPPLE_POOL * PARTICLES_PER_IMPULSE)
    const pool = emptyPool(RIPPLE_POOL)
    expect(pool).toHaveLength(RIPPLE_POOL)
    expect(pool.every((s) => s.t === INERT_T)).toBe(true)
  })

  it('hash01 is deterministic and lands in [0, 1)', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      for (let lane = 0; lane < 20; lane += 1) {
        const value = hash01(seed, lane)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThan(1)
        expect(hash01(seed, lane)).toBe(value)
      }
    }
  })

  describe('rippleAt', () => {
    it('grows the radius and fades the crest over its life, then goes inert', () => {
      const s = slot({ t: 1000 })
      const early = rippleAt(1150, s, W, H)
      const late = rippleAt(1700, s, W, H)
      expect(late.r).toBeGreaterThan(early.r)
      expect(late.fillOpacity).toBeLessThan(early.fillOpacity)
      expect(late.crestOpacity).toBeLessThan(early.crestOpacity)
      const done = rippleAt(1000 + RIPPLE_LIFE_MS, s, W, H)
      expect(done.r).toBe(0)
      expect(done.fillOpacity).toBe(0)
    })

    it('ignores impulses from the future and inert slots', () => {
      expect(rippleAt(900, slot({ t: 1000 }), W, H).r).toBe(0)
      expect(rippleAt(1000, slot({ t: INERT_T }), W, H).r).toBe(0)
    })

    it('left pushes right, right pushes left, a placeless hand blooms centered', () => {
      const left = slot({ t: 0, hand: HAND_LEFT })
      expect(rippleAt(600, left, W, H).cx).toBeGreaterThan(rippleAt(100, left, W, H).cx)
      const right = slot({ t: 0, hand: HAND_RIGHT })
      expect(rippleAt(600, right, W, H).cx).toBeLessThan(rippleAt(100, right, W, H).cx)
      const neutral = slot({ t: 0, hand: HAND_NEUTRAL })
      expect(rippleAt(600, neutral, W, H).cx).toBe(W * 0.5)
      expect(rippleAt(100, neutral, W, H).cx).toBe(W * 0.5)
    })

    it('a stronger impulse moves more water — radius and travel, not just opacity', () => {
      const soft = rippleAt(500, slot({ t: 0, v01: 0.1 }), W, H)
      const hard = rippleAt(500, slot({ t: 0, v01: 1 }), W, H)
      expect(hard.r).toBeGreaterThan(soft.r)
      expect(hard.cx).toBeGreaterThan(soft.cx)
      expect(hard.fillOpacity).toBeGreaterThan(soft.fillOpacity)
    })
  })

  describe('surgeAt', () => {
    it('decays exponentially with tau', () => {
      const slots = [slot({ t: 0, v01: 1 })]
      const atBirth = surgeAt(0, slots)
      const oneTauLater = surgeAt(SURGE_TAU_MS, slots)
      expect(atBirth).toBeGreaterThan(0)
      expect(oneTauLater / atBirth).toBeCloseTo(Math.exp(-1), 6)
    })

    it('accumulates across a flurry and clamps at 1', () => {
      const flurry = Array.from({ length: 8 }, (_, i) => slot({ t: i * 40, v01: 1, seed: i }))
      expect(surgeAt(320, flurry)).toBe(1)
    })

    it('settles to ~0 when the punches stop, and ignores future impulses', () => {
      expect(surgeAt(20_000, [slot({ t: 0, v01: 1 })])).toBeLessThan(0.001)
      expect(surgeAt(0, [slot({ t: 500, v01: 1 })])).toBe(0)
    })
  })

  describe('meetBoostAt', () => {
    const meet = [
      slot({ t: 0, hand: HAND_LEFT, seed: 1 }),
      slot({ t: 300, hand: HAND_RIGHT, seed: 2 }),
    ]

    it('lights up for an opposite-hand pair inside the window', () => {
      expect(meetBoostAt(350, meet)).toBeGreaterThan(0)
    })

    it('stays dark for same-hand pairs, slow pairs, and after the glow expires', () => {
      const sameHand = [
        slot({ t: 0, hand: HAND_LEFT, seed: 1 }),
        slot({ t: 300, hand: HAND_LEFT, seed: 2 }),
      ]
      expect(meetBoostAt(350, sameHand)).toBe(0)
      const slow = [
        slot({ t: 0, hand: HAND_LEFT, seed: 1 }),
        slot({ t: MEET_WINDOW_MS + 200, hand: HAND_RIGHT, seed: 2 }),
      ]
      expect(meetBoostAt(MEET_WINDOW_MS + 250, slow)).toBe(0)
      expect(meetBoostAt(300 + MEET_GLOW_MS, meet)).toBe(0)
    })

    it('ignores placeless impulses entirely', () => {
      const withNeutral = [...meet, slot({ t: 320, hand: HAND_NEUTRAL, seed: 9 })]
      expect(meetBoostAt(350, withNeutral)).toBeCloseTo(meetBoostAt(350, meet), 10)
    })
  })

  describe('particleAt', () => {
    it('is deterministic and dies with its impulse', () => {
      const s = slot({ t: 0 })
      const a = particleAt(200, s, 1, HAND_LEFT, W, H)
      const b = particleAt(200, s, 1, HAND_LEFT, W, H)
      expect(a).toEqual(b)
      for (let lane = 0; lane < PARTICLES_PER_IMPULSE; lane += 1) {
        const dead = particleAt(PARTICLE_LIFE_MAX_MS, s, lane, HAND_LEFT, W, H)
        expect(dead.scos).toBe(0)
        expect(dead.ssin).toBe(0)
      }
    })

    it('renders only into its own hand batch', () => {
      const s = slot({ t: 0, hand: HAND_RIGHT })
      const wrongBatch = particleAt(200, s, 0, HAND_LEFT, W, H)
      expect(wrongBatch.scos).toBe(0)
      const rightBatch = particleAt(200, s, 0, HAND_RIGHT, W, H)
      expect(Math.hypot(rightBatch.scos, rightBatch.ssin)).toBeGreaterThan(0)
    })

    it('shrinks as it ages', () => {
      const s = slot({ t: 0 })
      const young = particleAt(50, s, 2, HAND_LEFT, W, H)
      const old = particleAt(400, s, 2, HAND_LEFT, W, H)
      expect(Math.hypot(old.scos, old.ssin)).toBeLessThan(Math.hypot(young.scos, young.ssin))
    })
  })

  describe('ambientBlobAt', () => {
    it('yields finite geometry with sway-scaled visibility', () => {
      for (let i = 0; i < 3; i += 1) {
        const still = ambientBlobAt(10_000, i, W, H, 0)
        const stirred = ambientBlobAt(10_000, i, W, H, 1)
        expect(Number.isFinite(still.cx)).toBe(true)
        expect(still.r).toBeGreaterThan(0)
        expect(stirred.opacity).toBeGreaterThan(still.opacity)
      }
    })
  })
})
