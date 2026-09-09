/**
 * Velocity curves (§9), family energy (§14), kick merging (§17) and the
 * compiler seam itself (§2).
 *
 * The load-bearing properties: the two tracker values keep their separate
 * jobs, a punch we cannot identify never claims a technique, and the crash
 * stays rare.
 */
import type { StrikeToken } from '../instrument/gestureSchema'
import type { StrikeIdentity } from '../instrument/strikeArticulationCatalog'
import {
  compileDrumGesture,
  FREE_KIT_DEFAULT,
  type CompileDrumGestureInput,
} from '../instrument/drums/compileDrumGesture'
import {
  accentBandFor,
  drumGateMs,
  laneForArticulation,
  mapDrumVelocity,
  velocityForLane,
  VELOCITY_RANGES,
  DRUM_GATE_MS_MAX,
  DRUM_GATE_MS_MIN,
} from '../instrument/drums/drumVelocity'
import {
  drumEnergyAt,
  dominantFamily,
  emptyDrumEnergy,
  ENERGY_DECAY_TAU_S,
  noteDrumPunch,
} from '../instrument/drums/drumFamilyEnergy'
import {
  foldKickIntents,
  mergeKickVelocity,
  shouldMergeKicks,
} from '../instrument/drums/kickMerge'

const guided = (token: StrikeToken): StrikeIdentity => ({
  source: 'guided-score',
  token,
  confidence: 1,
})

function compile(overrides: Partial<CompileDrumGestureInput> = {}) {
  return compileDrumGesture({
    eventId: 'e1',
    identity: guided('2'),
    hand: 'right',
    acceleration01: 0.5,
    velocity01: 0.5,
    nowMs: 1000,
    energy: emptyDrumEnergy(),
    ...overrides,
  })
}

describe('§9 velocity curve', () => {
  test('endpoints are exact and the gamma bows the middle upward', () => {
    expect(mapDrumVelocity(0, 42, 104)).toBe(42)
    expect(mapDrumVelocity(1, 42, 104)).toBe(104)
    // gamma 0.72 < 1, so half acceleration yields MORE than half velocity —
    // that is what keeps a moderate punch from sounding limp.
    expect(mapDrumVelocity(0.5, 42, 104)).toBe(80)
    expect(mapDrumVelocity(0.5, 42, 104)).toBeGreaterThan((42 + 104) / 2)
  })

  test('input is clamped, never extrapolated', () => {
    expect(mapDrumVelocity(-3, 80, 127)).toBe(80)
    expect(mapDrumVelocity(9, 80, 127)).toBe(127)
  })

  test('every lane stays inside legal MIDI and respects its family floor', () => {
    for (const [lane, range] of Object.entries(VELOCITY_RANGES)) {
      expect(range.minimum).toBeGreaterThanOrEqual(1)
      expect(range.maximum).toBeLessThanOrEqual(127)
      expect(range.minimum).toBeLessThan(range.maximum)
      // A silent punch is still a punch: the floor is the point.
      expect(velocityForLane(lane as keyof typeof VELOCITY_RANGES, 0)).toBe(range.minimum)
    }
  })

  test('the softest cross still outweighs a mid-power jab — role stays legible', () => {
    // §9's reason for family-specific floors: a soft cross must still read
    // as a backbeat rather than disappearing under a busy ride. The two
    // land exactly equal at half acceleration (both 80), which is the
    // tightest the ranges ever get — the cross is never quieter.
    expect(VELOCITY_RANGES.cross.minimum).toBeGreaterThan(VELOCITY_RANGES.jab.minimum)
    expect(velocityForLane('cross', 0)).toBeGreaterThanOrEqual(velocityForLane('jab', 0.5))
    expect(velocityForLane('cross', 0)).toBeGreaterThan(velocityForLane('jab', 0.45))
  })

  test('pieces map to their family’s range', () => {
    expect(laneForArticulation('ride-bow')).toBe('jab')
    expect(laneForArticulation('snare-body')).toBe('cross')
    expect(laneForArticulation('rack-tom-mid')).toBe('hook')
    expect(laneForArticulation('floor-tom-low')).toBe('uppercut')
    expect(laneForArticulation('kick-main')).toBe('body-kick')
    // The crash has its own loud, narrow band and is NOT a cymbal-lane jab.
    expect(laneForArticulation('crash-main')).toBe('crash')
    expect(laneForArticulation('hihat-closed')).toBe('ghost')
  })

  test('accent bands sit exactly on the §9 thresholds', () => {
    expect(accentBandFor(0.64)).toBe('normal')
    expect(accentBandFor(0.65)).toBe('accent')
    expect(accentBandFor(0.84)).toBe('accent')
    expect(accentBandFor(0.85)).toBe('peak')
    expect(accentBandFor(1)).toBe('peak')
  })

  test('the MIDI gate stays a trigger width (§9: 25-40 ms)', () => {
    // The sample supplies the cymbal tail; the gate must never be mistaken
    // for the audible decay.
    expect(drumGateMs(0)).toBe(DRUM_GATE_MS_MIN)
    expect(drumGateMs(1)).toBe(DRUM_GATE_MS_MAX)
    expect(drumGateMs(0.5)).toBeGreaterThanOrEqual(DRUM_GATE_MS_MIN)
    expect(drumGateMs(0.5)).toBeLessThanOrEqual(DRUM_GATE_MS_MAX)
  })
})

describe('§8 division of responsibility', () => {
  test('acceleration drives MIDI velocity; the accent band ignores it', () => {
    const soft = compile({ acceleration01: 0.1, velocity01: 0.9 })
    const hard = compile({ acceleration01: 0.9, velocity01: 0.9 })
    expect(hard.gesture.hits[0]!.midiVelocity).toBeGreaterThan(soft.gesture.hits[0]!.midiVelocity)
    // Same velocity01 → same band, despite very different acceleration.
    expect(soft.gesture.accentBand).toBe(hard.gesture.accentBand)
  })

  test('velocity drives the accent band; MIDI velocity ignores it', () => {
    const normal = compile({ acceleration01: 0.5, velocity01: 0.2 })
    const peak = compile({ acceleration01: 0.5, velocity01: 0.95 })
    expect(normal.gesture.accentBand).toBe('normal')
    expect(peak.gesture.accentBand).toBe('peak')
    // The cross peaks onto the rimshot — a different PIECE, same intensity.
    expect(normal.gesture.hits[0]!.articulation).toBe('snare-center')
    expect(peak.gesture.hits[0]!.articulation).toBe('snare-rimshot')
  })
})

describe('§5.2 body shots', () => {
  test('2B adds a kick beneath a darker snare', () => {
    const { gesture } = compile({ identity: guided('2B'), acceleration01: 0.9, velocity01: 0.4 })
    expect(gesture.target).toBe('body')
    expect(gesture.hits.map((h) => h.articulation)).toEqual(['snare-body', 'kick-main'])
    expect(gesture.visual.low).toBe(true)
  })

  test('a head shot adds no kick', () => {
    const { gesture } = compile({ identity: guided('2') })
    expect(gesture.hits.map((h) => h.articulation)).toEqual(['snare-center'])
    expect(gesture.visual.low).toBe(false)
  })

  test('the heavy rear-uppercut body kick outweighs the jab’s (§5.1 "heavy")', () => {
    const jabKick = compile({ identity: guided('1B'), acceleration01: 0.6 }).gesture.hits.find(
      (h) => h.articulation === 'kick-main',
    )
    const uppercutKick = compile({
      identity: guided('6B'),
      acceleration01: 0.6,
    }).gesture.hits.find((h) => h.articulation === 'kick-main')
    expect(uppercutKick!.midiVelocity).toBeGreaterThan(jabKick!.midiVelocity)
  })
})

describe('§4 crash reservation, at the compiler', () => {
  test('an ordinary punch never emits a crash, however hard', () => {
    const { gesture } = compile({ identity: guided('6'), acceleration01: 1, velocity01: 1 })
    expect(gesture.hits.map((h) => h.articulation)).not.toContain('crash-main')
  })

  test('a new session peak does', () => {
    const { gesture } = compile({ identity: guided('6'), velocity01: 0.95, isNewPeak: true })
    expect(gesture.hits.map((h) => h.articulation)).toContain('crash-main')
  })

  test('a peak that is ALSO a phrase ending emits exactly one crash', () => {
    // The rear uppercut declares crash eligibility twice (§4 peak, §16
    // phrase ending). It is one cymbal — two note-ons would flam it.
    const { gesture } = compile({
      identity: guided('6'),
      velocity01: 0.95,
      isNewPeak: true,
      isPhraseEnding: true,
    })
    const crashes = gesture.hits.filter((h) => h.articulation === 'crash-main')
    expect(crashes).toHaveLength(1)
  })
})

describe('§3 identity policy', () => {
  test('a generic punch plays the Free Kit and claims no family', () => {
    const { gesture } = compile({
      identity: { source: 'generic', confidence: 0 },
      hand: 'left',
    })
    expect(gesture.family).toBeNull()
    expect(gesture.token).toBeUndefined()
    expect(gesture.arpMutation).toBeNull()
    expect(gesture.hits[0]!.articulation).toBe(FREE_KIT_DEFAULT['physical-left'])
  })

  test('the Free Kit is audibly hand-specific', () => {
    const left = compile({ identity: { source: 'generic', confidence: 0 }, hand: 'left' })
    const right = compile({ identity: { source: 'generic', confidence: 0 }, hand: 'right' })
    expect(left.gesture.hits[0]!.articulation).not.toBe(right.gesture.hits[0]!.articulation)
    expect(Math.sign(left.gesture.visual.side)).toBe(-1)
    expect(Math.sign(right.gesture.visual.side)).toBe(1)
  })

  test('a generic punch never advances a family energy lane', () => {
    // Crediting any of the five §14 lanes would be exactly the technique
    // claim §3 forbids until the classifier is validated.
    const after = compile({
      identity: { source: 'generic', confidence: 0 },
      hand: 'left',
      velocity01: 1,
    }).energy
    expect(drumEnergyAt(after, 1000)).toEqual(emptyDrumEnergy().values)
  })

  test('the Free Kit pieces are overridable (§3 "configurable")', () => {
    const { gesture } = compile({
      identity: { source: 'generic', confidence: 0 },
      hand: 'right',
      freeKit: { 'physical-left': 'rim-click', 'physical-right': 'rack-tom-mid' },
    })
    expect(gesture.hits[0]!.articulation).toBe('rack-tom-mid')
  })
})

describe('§14 family energy', () => {
  test('rise is the flat step plus the velocity share', () => {
    const state = noteDrumPunch(emptyDrumEnergy(), {
      family: 'hook',
      target: 'head',
      velocity01: 0.5,
      nowMs: 0,
    })
    expect(drumEnergyAt(state, 0).hook).toBeCloseTo(0.12 + 0.5 * 0.2, 10)
    expect(drumEnergyAt(state, 0).jab).toBe(0)
  })

  test('a body shot raises its family AND the body lane', () => {
    const state = noteDrumPunch(emptyDrumEnergy(), {
      family: 'uppercut',
      target: 'body',
      velocity01: 1,
      nowMs: 0,
    })
    const values = drumEnergyAt(state, 0)
    expect(values.uppercut).toBeGreaterThan(0)
    expect(values.body).toBeCloseTo(0.12 + 0.18, 10)
  })

  test('energy is capped at 1 no matter how long the flurry', () => {
    let state = emptyDrumEnergy()
    for (let n = 0; n < 40; n += 1) {
      state = noteDrumPunch(state, { family: 'jab', target: 'head', velocity01: 1, nowMs: n })
    }
    expect(drumEnergyAt(state, 40).jab).toBeLessThanOrEqual(1)
  })

  test('each family decays on its own §14 clock', () => {
    let state = emptyDrumEnergy()
    for (const family of ['jab', 'uppercut'] as const) {
      state = noteDrumPunch(state, { family, target: 'head', velocity01: 1, nowMs: 0 })
    }
    const at0 = drumEnergyAt(state, 0)
    // One jab tau later the jab has fallen to 1/e; the uppercut, whose tau
    // is twice as long, is still well above that.
    const oneJabTauMs = ENERGY_DECAY_TAU_S.jab * 1000
    const later = drumEnergyAt(state, oneJabTauMs)
    expect(later.jab).toBeCloseTo(at0.jab / Math.E, 6)
    expect(later.uppercut / at0.uppercut).toBeGreaterThan(later.jab / at0.jab)
  })

  test('dominantFamily ignores the body modifier and the quiet floor', () => {
    const quiet = noteDrumPunch(emptyDrumEnergy(), {
      family: 'jab',
      target: 'body',
      velocity01: 0,
      nowMs: 0,
    })
    // 0.12 is below the 0.2 threshold — one soft punch does not take over.
    expect(dominantFamily(quiet, 0)).toBeNull()
    let loud = emptyDrumEnergy()
    for (let n = 0; n < 3; n += 1) {
      loud = noteDrumPunch(loud, { family: 'hook', target: 'body', velocity01: 1, nowMs: n })
    }
    expect(dominantFamily(loud, 3)).toBe('hook')
  })
})

describe('§17 kick merging', () => {
  test('the strongest kick keeps 16% of every other', () => {
    expect(mergeKickVelocity([100])).toBe(100)
    expect(mergeKickVelocity([100, 50])).toBe(108)
    expect(mergeKickVelocity([100, 50, 50])).toBe(116)
    expect(mergeKickVelocity([120, 120, 120])).toBeLessThanOrEqual(127)
  })

  test('EXACT ties collapse — a quirk of §17 as written, pinned deliberately', () => {
    // `filter(value => value !== strongest)` removes every copy of the
    // maximum, so two identical kicks merge to that velocity rather than a
    // louder one. Reachable when both hits clamp to the same ceiling.
    // Kyle's formula verbatim; flagged rather than silently "fixed".
    expect(mergeKickVelocity([100, 100])).toBe(100)
  })

  test('merges inside 35 ms or inside one 240-tick subdivision', () => {
    expect(shouldMergeKicks({ atMs: 0, desiredTick: 0 }, { atMs: 30, desiredTick: 900 })).toBe(true)
    expect(shouldMergeKicks({ atMs: 0, desiredTick: 10 }, { atMs: 400, desiredTick: 200 })).toBe(
      true,
    )
    expect(shouldMergeKicks({ atMs: 0, desiredTick: 0 }, { atMs: 400, desiredTick: 960 })).toBe(
      false,
    )
  })

  test('a direct body kick absorbs a generated one instead of double-triggering', () => {
    const folded = foldKickIntents([
      { sourceEventId: 'groove', desiredTick: 100, velocity: 70, priority: 'generated', atMs: 0 },
      { sourceEventId: 'punch', desiredTick: 110, velocity: 110, priority: 'direct', atMs: 20 },
    ])
    expect(folded).toHaveLength(1)
    expect(folded[0]!.priority).toBe('direct')
    expect(folded[0]!.sourceEventId).toBe('punch')
    expect(folded[0]!.velocity).toBe(mergeKickVelocity([70, 110]))
  })

  test('kicks far apart are left alone', () => {
    const folded = foldKickIntents([
      { sourceEventId: 'a', desiredTick: 0, velocity: 100, priority: 'direct', atMs: 0 },
      { sourceEventId: 'b', desiredTick: 960, velocity: 100, priority: 'direct', atMs: 1000 },
    ])
    expect(folded).toHaveLength(2)
  })
})

describe('determinism (§2)', () => {
  test('the same punch compiles byte-identically every time', () => {
    const input: CompileDrumGestureInput = {
      eventId: 'e9',
      identity: guided('5B'),
      hand: 'left',
      acceleration01: 0.73,
      velocity01: 0.88,
      nowMs: 4242,
      energy: emptyDrumEnergy(),
      isNewPeak: true,
    }
    const a = compileDrumGesture(input)
    const b = compileDrumGesture(input)
    expect(JSON.stringify(a.gesture)).toBe(JSON.stringify(b.gesture))
  })

  test('compiling does not mutate the energy state handed in', () => {
    const before = emptyDrumEnergy()
    const snapshot = JSON.stringify(before)
    compileDrumGesture({
      eventId: 'e1',
      identity: guided('3'),
      hand: 'left',
      acceleration01: 1,
      velocity01: 1,
      nowMs: 10,
      energy: before,
    })
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})
