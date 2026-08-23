/**
 * Capability tier resolution (M32-02).
 *
 * The load-bearing assertion in this file is the FightCamp v1 one: it
 * resolves to `hand-timestamp`, per D12, not the `hand-broad-type` the
 * issue was written against before H12 refuted the vendor type flag on
 * hardware. If a later change promotes that fixture, this suite fails —
 * which is the point.
 */
import {
  resolveCapabilityTier,
  sequenceScoreLabel,
  tierScoresTechnique,
  type CapabilityTier,
} from '../capabilityTier'
import type { PunchEventSourceCapability } from '../../punch/PunchEventSource'
import type { TrackerPunchEvent } from '../../punch/PunchEvent'

const capability = (over: Partial<PunchEventSourceCapability> = {}): PunchEventSourceCapability => ({
  hand: true,
  timestamp: true,
  punchType: 'none',
  velocity: true,
  ...over,
})

const event = (over: Partial<TrackerPunchEvent> = {}): TrackerPunchEvent => ({
  id: 'e1',
  sourceFrameId: 'f1',
  deviceId: 'D7:34:B4:27:D5:84',
  hand: 'left',
  receivedMonotonicTimeMs: 1000,
  receivedWallTimeIso: '2026-08-23T00:00:00.000Z',
  recovered: false,
  decoderId: 'fightcamp-v1',
  decoderVersion: '1',
  velocityUnit: 'unknown',
  qualityFlags: [],
  ...over,
})

describe('resolving from a declared capability', () => {
  it.each([
    ['distinct', true, 'hand-distinct-type'],
    ['broad', true, 'hand-broad-type'],
    ['none', true, 'hand-timestamp'],
    ['none', false, 'hand-only'],
  ] as const)('punchType %s + timestamp %s → %s', (punchType, timestamp, expected) => {
    expect(resolveCapabilityTier({ capability: capability({ punchType, timestamp }) }).tier).toBe(
      expected,
    )
  })

  it('carries velocity availability straight through', () => {
    expect(resolveCapabilityTier({ capability: capability({ velocity: true }) })).toEqual({
      tier: 'hand-timestamp',
      velocityAvailable: true,
    })
    expect(resolveCapabilityTier({ capability: capability({ velocity: false }) })).toEqual({
      tier: 'hand-timestamp',
      velocityAvailable: false,
    })
  })

  it('does not let a technique capability imply a timestamp, or the reverse', () => {
    // Technique outranks timestamp in the ladder, so a type-capable source
    // without timestamps still resolves to a type tier.
    expect(
      resolveCapabilityTier({ capability: capability({ punchType: 'broad', timestamp: false }) })
        .tier,
    ).toBe('hand-broad-type')
  })
})

describe('resolving from observed events', () => {
  it('resolves a FightCamp v1 sample to hand-timestamp with velocity (D12)', () => {
    // The real shape after H12: hand from the connection slot, a tracker
    // epoch timestamp, tracker-unit velocity, a raw type byte that carries
    // no portable meaning, and therefore punchType 'unknown'.
    const sample = [
      event({
        trackerTimestampMs: 1_724_000_000_000,
        velocityRaw: 11,
        velocityUnit: 'tracker-unit',
        punchTypeRaw: 3,
        punchType: 'unknown',
      }),
      event({
        id: 'e2',
        hand: 'right',
        trackerTimestampMs: 1_724_000_000_400,
        velocityRaw: 8,
        velocityUnit: 'tracker-unit',
        punchTypeRaw: 1,
        punchType: 'unknown',
      }),
    ]
    expect(resolveCapabilityTier({ observedEvents: sample })).toEqual({
      tier: 'hand-timestamp',
      velocityAvailable: true,
    })
  })

  it('never promotes on a raw type byte alone', () => {
    // punchTypeRaw is the undecoded byte. Promoting on it would be exactly
    // the claim H12 disproved.
    const sample = [event({ trackerTimestampMs: 1, punchTypeRaw: 2, punchType: 'unknown' })]
    expect(resolveCapabilityTier({ observedEvents: sample }).tier).toBe('hand-timestamp')
  })

  it('promotes when a decoder genuinely classifies a technique', () => {
    // Not reachable on FightCamp v1, but the resolver must stay honest in
    // both directions — a future decoder that can classify should say so.
    const sample = [event({ trackerTimestampMs: 1, punchType: 'hook' })]
    expect(resolveCapabilityTier({ observedEvents: sample }).tier).toBe('hand-broad-type')
  })

  it('resolves an empty sample conservatively', () => {
    expect(resolveCapabilityTier({ observedEvents: [] })).toEqual({
      tier: 'hand-only',
      velocityAvailable: false,
    })
  })

  it('resolves a hand-only sample to hand-only with no velocity', () => {
    expect(resolveCapabilityTier({ observedEvents: [event()] })).toEqual({
      tier: 'hand-only',
      velocityAvailable: false,
    })
  })

  it('ignores a velocity value whose unit is unknown', () => {
    // A number with no unit is not tracker-reported velocity, it is a
    // number. Counting it would be claiming ahead of the evidence.
    const sample = [event({ velocityRaw: 9, velocityUnit: 'unknown' })]
    expect(resolveCapabilityTier({ observedEvents: sample }).velocityAvailable).toBe(false)
  })

  it('needs only one event carrying a field to establish it', () => {
    const sample = [event(), event({ id: 'e2', trackerTimestampMs: 5 })]
    expect(resolveCapabilityTier({ observedEvents: sample }).tier).toBe('hand-timestamp')
  })
})

describe('the two input shapes agree for equivalent sources', () => {
  it('agrees on a hand + timestamp + velocity source', () => {
    const declared = resolveCapabilityTier({
      capability: capability({ punchType: 'none', timestamp: true, velocity: true }),
    })
    const observed = resolveCapabilityTier({
      observedEvents: [event({ trackerTimestampMs: 1, velocityRaw: 9, velocityUnit: 'tracker-unit' })],
    })
    expect(observed).toEqual(declared)
  })

  it('agrees on a hand-only source', () => {
    const declared = resolveCapabilityTier({
      capability: capability({ punchType: 'none', timestamp: false, velocity: false }),
    })
    expect(resolveCapabilityTier({ observedEvents: [event()] })).toEqual(declared)
  })
})

describe('sequenceScoreLabel (D4, spec §13.3)', () => {
  it.each([
    ['hand-only', 'hand-sequence match'],
    ['hand-timestamp', 'hand-sequence match'],
    ['hand-broad-type', 'hand-sequence match'],
    ['hand-distinct-type', 'technique match'],
  ] as const)('%s → %s', (tier, expected) => {
    expect(sequenceScoreLabel(tier)).toBe(expected)
  })

  it('says hand-sequence match on the tier this hardware actually reaches', () => {
    const resolved = resolveCapabilityTier({ capability: capability() })
    expect(sequenceScoreLabel(resolved.tier)).toBe('hand-sequence match')
  })
})

describe('tierScoresTechnique', () => {
  it.each([
    ['hand-only', false],
    ['hand-timestamp', false],
    ['hand-broad-type', true],
    ['hand-distinct-type', true],
  ] as const)('%s → %s', (tier: CapabilityTier, expected) => {
    expect(tierScoresTechnique(tier)).toBe(expected)
  })
})

describe('the simulated source resolves honestly', () => {
  it('gives the sim the same tier the real hardware reaches, so M33-01 changes nothing', () => {
    // The sim declares punchType 'none' precisely so the live stack is not
    // built against a tier that evaporates when real trackers arrive.
    const sim = capability({ punchType: 'none', timestamp: true, velocity: true })
    expect(resolveCapabilityTier({ capability: sim }).tier).toBe('hand-timestamp')
  })
})
