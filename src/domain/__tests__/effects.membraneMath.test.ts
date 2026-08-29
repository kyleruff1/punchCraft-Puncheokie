/**
 * The membrane's physical contract, pinned where it matters:
 * reversibility (everything returns to EXACTLY zero), underdamped feel
 * (one or two overshoots, not a fade and not a buzz), the reading →
 * effect curve, bounded-ring eviction, and per-event determinism.
 */
import {
  CONVERGE_WINDOW_S,
  DEBRIS_CAP,
  DEBRIS_TAU_S,
  DUST_TAU_S,
  GEL_WINDOW_S,
  VEIL_TAU_S,
  HAND_LEFT,
  HAND_NEUTRAL,
  HAND_RIGHT,
  MAX_IMPULSES,
  MEMBRANE_PRESETS,
  bumpEnv,
  convergenceImpulse,
  coverageOf,
  decayedEnv,
  detectConvergence,
  expiryOf,
  gelResponse,
  handCodeOf,
  hash01,
  impulseDirection,
  impulseOrigin,
  lastExpiry,
  mapVelocityToEffect,
  packImpulses,
  pushImpulse,
  rateOf,
  registerPunchGains,
  spawnImpulse,
  veilWakeOf,
  visualCoverage,
} from '../effects/membraneMath'

describe('mapVelocityToEffect', () => {
  it('pins the curve endpoints', () => {
    const soft = mapVelocityToEffect(0)
    expect(soft.amplitude).toBeCloseTo(0.005 + 0.15 * 0.036, 6)
    expect(soft.lifetimeSec).toBeCloseTo(1.1 + 0.15 * 2.0, 6)
    const hard = mapVelocityToEffect(1)
    expect(hard.amplitude).toBeCloseTo(0.041, 6)
    expect(hard.radius).toBeCloseTo(0.16, 6)
    expect(hard.lifetimeSec).toBeCloseTo(3.1, 6)
    expect(hard.waveSpeed).toBeCloseTo(1.25, 6)
  })

  it('is monotone and clamped', () => {
    let prev = -1
    for (let v = -0.2; v <= 1.2; v += 0.05) {
      const s = mapVelocityToEffect(v)
      expect(s.amplitude).toBeGreaterThanOrEqual(prev)
      prev = s.amplitude
    }
    expect(mapVelocityToEffect(5)).toEqual(mapVelocityToEffect(1))
  })
})

describe('impulse spawning', () => {
  it('origins sit in hand thirds with bounded jitter', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      expect(impulseOrigin(HAND_LEFT, seed).x).toBe(0.28)
      expect(impulseOrigin(HAND_RIGHT, seed).x).toBe(0.72)
      const y = impulseOrigin(HAND_NEUTRAL, seed).y
      expect(y).toBeGreaterThan(0.3)
      expect(y).toBeLessThan(0.7)
    }
    expect(impulseDirection(HAND_LEFT)).toBe(1)
    expect(impulseDirection(HAND_RIGHT)).toBe(-1)
    expect(impulseDirection(HAND_NEUTRAL)).toBe(0)
  })

  it('is deterministic per event id and varies across ids', () => {
    const a = spawnImpulse(HAND_LEFT, 0.7, 42, 5)
    const b = spawnImpulse(HAND_LEFT, 0.7, 42, 5)
    expect(a).toEqual(b)
    const c = spawnImpulse(HAND_LEFT, 0.7, 43, 5)
    expect(c.y === a.y && c.spin === a.spin && c.phase === a.phase).toBe(false)
  })

  it('spin is a signed turn direction', () => {
    let signs = 0
    for (let id = 0; id < 32; id += 1) {
      const s = spawnImpulse(HAND_LEFT, 0.5, id, 0).spin
      expect(Math.abs(s)).toBeLessThanOrEqual(1)
      if (s > 0) signs += 1
    }
    expect(signs).toBeGreaterThan(4)
    expect(signs).toBeLessThan(28)
  })

  it('convergence spawns a center impulse', () => {
    const c = convergenceImpulse(0.8, 9, 3)
    expect(c.x).toBe(0.5)
    expect(c.dirX).toBe(0)
    expect(c.handCode).toBe(HAND_NEUTRAL)
  })
})

describe('detectConvergence', () => {
  it('fires only for opposite hands inside the window', () => {
    expect(detectConvergence(HAND_LEFT, 1, 0.6, HAND_RIGHT, 1.3, 0.8)).toBeCloseTo(0.7)
    expect(detectConvergence(HAND_LEFT, 1, 0.6, HAND_LEFT, 1.3, 0.8)).toBe(0)
    expect(
      detectConvergence(HAND_LEFT, 1, 0.6, HAND_RIGHT, 1 + CONVERGE_WINDOW_S + 0.01, 0.8),
    ).toBe(0)
    expect(detectConvergence(HAND_NEUTRAL, 1, 0.6, HAND_RIGHT, 1.2, 0.8)).toBe(0)
  })
})

describe('ring eviction', () => {
  const now = 100
  it('drops expired impulses first', () => {
    const stale = spawnImpulse(HAND_LEFT, 1, 1, now - 10)
    expect(expiryOf(stale)).toBeLessThan(now)
    const { ring } = pushImpulse([stale], spawnImpulse(HAND_RIGHT, 0.5, 2, now), now)
    expect(ring).toHaveLength(1)
    expect(ring[0]?.eventId).toBe(2)
  })

  it('caps at MAX_IMPULSES, dropping the weakest and spilling churn', () => {
    let ring: ReturnType<typeof spawnImpulse>[] = []
    for (let id = 0; id < MAX_IMPULSES; id += 1) {
      ring = pushImpulse(ring, spawnImpulse(HAND_LEFT, 0.9, id, now + id * 0.01), now).ring
    }
    expect(ring).toHaveLength(MAX_IMPULSES)
    const { ring: next, spilled } = pushImpulse(
      ring,
      spawnImpulse(HAND_RIGHT, 0.9, 99, now + 1),
      now + 1,
    )
    expect(next).toHaveLength(MAX_IMPULSES)
    expect(next.some((i) => i.eventId === 99)).toBe(true)
    expect(spilled).toBeGreaterThan(0)
  })
})

describe('gel response — the underdamped sheet', () => {
  const impulse = spawnImpulse(HAND_LEFT, 0.8, 7, 0)

  it('kicks toward the punch direction, overshoots once or twice, then rests', () => {
    // Sample the response densely and count zero crossings of x.
    let crossings = 0
    let prev = 0
    let peak = 0
    for (let t = 0.01; t < GEL_WINDOW_S; t += 0.01) {
      const { offsetX } = gelResponse([impulse], t)
      peak = Math.max(peak, Math.abs(offsetX))
      if (prev !== 0 && Math.sign(offsetX) !== Math.sign(prev) && Math.abs(offsetX) > peak * 1e-3)
        crossings += 1
      if (Math.abs(offsetX) > peak * 1e-3) prev = offsetX
    }
    expect(peak).toBeGreaterThan(0)
    expect(crossings).toBeGreaterThanOrEqual(1)
    expect(crossings).toBeLessThanOrEqual(4)
    // First motion goes the punch's way (left → +x).
    expect(gelResponse([impulse], 0.05).offsetX).toBeGreaterThan(0)
  })

  it('settles far below its peak within ~2.2s and hard-zeros at the window', () => {
    let peak = 0
    for (let t = 0.01; t < 1; t += 0.01) {
      peak = Math.max(peak, Math.abs(gelResponse([impulse], t).offsetX))
    }
    expect(Math.abs(gelResponse([impulse], 2.2).offsetX)).toBeLessThan(peak * 0.01)
    const rest = gelResponse([impulse], GEL_WINDOW_S)
    expect(rest.offsetX).toBe(0)
    expect(rest.offsetY).toBe(0)
    expect(rest.twist).toBe(0)
  })

  it('an empty ring is exactly the origin', () => {
    expect(gelResponse([], 123)).toEqual({ offsetX: 0, offsetY: 0, twist: 0 })
  })

  it('opposite hands kick opposite ways', () => {
    const right = spawnImpulse(HAND_RIGHT, 0.8, 8, 0)
    const t = 0.05
    expect(Math.sign(gelResponse([right], t).offsetX)).toBe(
      -Math.sign(gelResponse([impulse], t).offsetX),
    )
  })
})

describe('exact restoration', () => {
  it('after the last expiry, nothing in the model can still move', () => {
    const ring = [
      spawnImpulse(HAND_LEFT, 1, 1, 0),
      spawnImpulse(HAND_RIGHT, 0.4, 2, 0.3),
      convergenceImpulse(0.7, 3, 0.35),
    ]
    const end = lastExpiry(ring)
    expect(end).toBeGreaterThan(3)
    const gel = gelResponse(ring, end + 0.01)
    expect(gel).toEqual({ offsetX: 0, offsetY: 0, twist: 0 })
    // Wave terms zero by construction: every impulse's age exceeds its
    // lifetime, which the shader gates to zero — pinned via expiryOf.
    for (const item of ring) expect(end + 0.01).toBeGreaterThan(expiryOf(item))
    // The churn envelope is analytically decayed and reaches ~0 too.
    expect(decayedEnv(1, 0, end + 10, 1.8)).toBeLessThan(1e-3)
  })
})

describe('churn and impact envelopes', () => {
  it('bump per punch with the brief curves and cap at 1', () => {
    const soft = registerPunchGains(0, 1, 1)
    const hard = registerPunchGains(1, 1, 1)
    expect(soft.churn).toBeCloseTo(0.05)
    expect(hard.churn).toBeCloseTo(0.25)
    expect(soft.impact).toBeCloseTo(0.2)
    expect(hard.impact).toBeCloseTo(1)
    let churn = 0
    for (let i = 0; i < 20; i += 1) churn = bumpEnv(churn, 0, 0, 1.65, hard.churn)
    expect(churn).toBe(1)
  })

  it('rateOf reads the trailing window and skips the convergence center', () => {
    const ring = [
      spawnImpulse(HAND_LEFT, 0.5, 1, 9.0),
      spawnImpulse(HAND_RIGHT, 0.5, 2, 9.5),
      spawnImpulse(HAND_LEFT, 0.5, 3, 10.0),
      convergenceImpulse(0.5, 4, 10.0),
      spawnImpulse(HAND_LEFT, 0.5, 5, 3.0),
    ]
    expect(rateOf(ring, 10.2)).toBeCloseTo(3 / 1.5)
  })
})

describe('pummel veil', () => {
  /**
   * Simulate a punch cadence (each punch also enters the ring, so the
   * rate the gains read is the real trailing rate) and return the
   * three settled charges.
   */
  function pummel(
    v01: number,
    perSecond: number,
    seconds: number,
  ): { dust: number; debris: number; veil: number } {
    let ring: ReturnType<typeof spawnImpulse>[] = []
    let dust = 0
    let debris = 0
    let veil = 0
    let stamp = 0
    let id = 0
    const gap = 1 / perSecond
    for (let t = gap; t <= seconds; t += gap) {
      id += 1
      ring = pushImpulse(ring, spawnImpulse(id % 2, v01, id, t), t).ring
      const gains = registerPunchGains(v01, rateOf(ring, t), 1)
      dust = bumpEnv(dust, stamp, t, DUST_TAU_S, gains.dust)
      debris = bumpEnv(debris, stamp, t, DEBRIS_TAU_S, gains.debris, DEBRIS_CAP)
      veil = bumpEnv(veil, stamp, t, VEIL_TAU_S, gains.veil)
      stamp = t
    }
    return { dust, debris, veil }
  }

  it('matches the target profile: singles fleck, moderate work dims, a sprint closes', () => {
    // One light punch: essentially nothing.
    const single = registerPunchGains(0.3, 1, 1)
    expect(single.debris).toBeLessThan(0.02)
    expect(single.veil).toBe(0)
    // Steady moderate work: clearly dimmed, never blacked out.
    const moderate = pummel(0.6, 3.5, 15)
    expect(visualCoverage(moderate.debris)).toBeGreaterThan(0.1)
    expect(visualCoverage(moderate.debris)).toBeLessThan(0.5)
    expect(moderate.veil).toBeLessThan(0.15)
    // A sustained high-velocity sprint feeds the veil toward closure.
    const sprint = pummel(1, 8, 12)
    expect(sprint.debris).toBeGreaterThan(0.8)
    expect(sprint.veil).toBeGreaterThan(0.5)
    expect(sprint.veil).toBeGreaterThan(moderate.veil * 3)
  })

  it('velocity and rate stay distinct: a lone haymaker deposits little', () => {
    const haymaker = registerPunchGains(1, 1, 1)
    const flurryHit = registerPunchGains(1, 9, 1)
    expect(haymaker.impact).toBeCloseTo(1)
    expect(haymaker.veil).toBe(0)
    expect(flurryHit.veil).toBeGreaterThan(0.02)
    expect(flurryHit.debris).toBeGreaterThan(haymaker.debris)
  })

  it('clears in stages: dust first, debris next, the veil last', () => {
    const charged = { dust: 0.8, debris: 0.8, veil: 0.8 }
    const at = (t: number): number[] => [
      decayedEnv(charged.dust, 0, t, DUST_TAU_S),
      decayedEnv(charged.debris, 0, t, DEBRIS_TAU_S),
      decayedEnv(charged.veil, 0, t, VEIL_TAU_S),
    ]
    const [dust2, debris2, veil2] = at(2)
    expect(dust2).toBeLessThan(debris2!)
    expect(debris2).toBeLessThan(veil2!)
    // And everything is essentially neutral inside ~10 s from typical charges.
    const [dust10, debris10] = at(10)
    expect(dust10).toBeLessThan(0.01)
    expect(debris10).toBeLessThan(0.04)
  })

  it('the wake window covers the slowest fade and vanishes when clear', () => {
    expect(veilWakeOf(0, 0, 0)).toBe(0)
    expect(veilWakeOf(0.005, 0.005, 0.005)).toBe(0)
    const window = veilWakeOf(1, 1, 1)
    expect(window).toBeGreaterThan(15)
    expect(decayedEnv(1, 0, window, VEIL_TAU_S)).toBeLessThanOrEqual(0.011)
  })

  it('sensitivity scales the veil charges only', () => {
    const standard = registerPunchGains(0.8, 6, 1)
    const high = registerPunchGains(0.8, 6, 1.8)
    expect(high.dust).toBeCloseTo(standard.dust * 1.8)
    expect(high.debris).toBeCloseTo(standard.debris * 1.8)
    expect(high.impact).toBe(standard.impact)
    expect(high.churn).toBe(standard.churn)
  })

  it('perceptual coverage bends recovery without moving the endpoints', () => {
    expect(visualCoverage(0)).toBe(0)
    expect(visualCoverage(1)).toBe(1)
    expect(visualCoverage(0.5)).toBeLessThan(0.5)
  })

  it('the shader coverage has the 0.04 deadband: near-zero is exactly zero', () => {
    expect(coverageOf(0)).toBe(0)
    expect(coverageOf(0.03)).toBe(0)
    expect(coverageOf(0.1)).toBeGreaterThan(0)
    expect(coverageOf(1)).toBe(1)
  })
})

describe('packing', () => {
  it('always emits exactly MAX_IMPULSES float4s per lane, plain arrays', () => {
    const packed = packImpulses([spawnImpulse(HAND_LEFT, 0.5, 1, 2)])
    for (const lane of [packed.a, packed.b, packed.c]) {
      expect(Array.isArray(lane)).toBe(true)
      expect(lane).toHaveLength(MAX_IMPULSES * 4)
    }
    // Slot 0 carries the impulse, slot 1 is inert (amplitude 0).
    expect(packed.a[3]).toBeGreaterThan(0)
    expect(packed.a[7]).toBe(0)
  })
})

describe('presets and hands', () => {
  it('gelatin moves more and longer than controlled', () => {
    const { controlled, gelatin } = MEMBRANE_PRESETS
    expect(gelatin.surgeMul).toBeGreaterThan(controlled.surgeMul)
    expect(gelatin.lifeMul).toBeGreaterThan(controlled.lifeMul)
    expect(gelatin.gelMul).toBeGreaterThan(controlled.gelMul)
  })

  it('maps bus hands to codes', () => {
    expect(handCodeOf('left')).toBe(HAND_LEFT)
    expect(handCodeOf('right')).toBe(HAND_RIGHT)
    expect(handCodeOf('unknown')).toBe(HAND_NEUTRAL)
  })

  it('hash01 is deterministic and in range', () => {
    expect(hash01(5, 3)).toBe(hash01(5, 3))
    for (let s = 0; s < 50; s += 1) {
      const v = hash01(s, 1)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})
