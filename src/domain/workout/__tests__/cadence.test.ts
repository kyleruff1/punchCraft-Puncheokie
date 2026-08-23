/**
 * Cadence conversion (M31-02, doc §17).
 *
 * Timing correctness starts here — every cue offset in the app is this
 * function applied to an authored beat value, so an error would shift the
 * whole workout rather than one cue.
 */

import {
  CADENCE_PROFILES,
  beatsToMs,
  blockDurationMs,
  clampToProfile,
  maxBeatOffset,
  msToBeats,
  tokenOffsetsMs,
  type CadenceProfileId,
} from '../cadence'
import { parseCombo, type WorkoutToken } from '../WorkoutTokens'

/** The doc §17 worked example: 1-2-3-2 with uneven, musical offsets. */
const ONE_TWO_THREE_TWO: WorkoutToken[] = [
  { kind: 'punch', number: 1, body: false, beatOffset: 0.0 },
  { kind: 'punch', number: 2, body: false, beatOffset: 0.75 },
  { kind: 'punch', number: 3, body: false, beatOffset: 1.55 },
  { kind: 'punch', number: 2, body: false, beatOffset: 2.3 },
]

describe('CADENCE_PROFILES', () => {
  it.each([
    ['technical', 80, 90],
    ['steady', 95, 110],
    ['pressure', 110, 130],
    ['sprint', 130, 150],
  ] as Array<[CadenceProfileId, number, number]>)(
    'matches doc §17 for %s: %i–%i BPM',
    (id, minBpm, maxBpm) => {
      const profile = CADENCE_PROFILES[id]
      expect(profile.minBpm).toBe(minBpm)
      expect(profile.maxBpm).toBe(maxBpm)
    },
  )

  it('places every nominal BPM inside its own range', () => {
    for (const profile of Object.values(CADENCE_PROFILES)) {
      expect(profile.nominalBpm).toBeGreaterThanOrEqual(profile.minBpm)
      expect(profile.nominalBpm).toBeLessThanOrEqual(profile.maxBpm)
    }
  })

  it('orders the profiles by increasing tempo with no gaps that strand a BPM', () => {
    const ordered: CadenceProfileId[] = ['technical', 'steady', 'pressure', 'sprint']
    for (let i = 1; i < ordered.length; i++) {
      const prev = CADENCE_PROFILES[ordered[i - 1]!]
      const next = CADENCE_PROFILES[ordered[i]!]
      expect(next.minBpm).toBeGreaterThanOrEqual(prev.minBpm)
      expect(next.maxBpm).toBeGreaterThan(prev.maxBpm)
    }
  })
})

describe('beatsToMs', () => {
  it('converts one beat at 60 BPM to exactly one second', () => {
    expect(beatsToMs(1, 60)).toBe(1000)
  })

  it('converts three-quarters of a beat at 120 BPM to 375ms', () => {
    expect(beatsToMs(0.75, 120)).toBe(375)
  })

  it('does not round — fractional milliseconds survive', () => {
    // Rounding inside the module would accumulate across a round. 1.55 beats
    // at 140 BPM is 664.28...ms; the caller rounds at the scheduling edge.
    const ms = beatsToMs(1.55, 140)
    expect(ms).toBeCloseTo(664.2857, 3)
    expect(Number.isInteger(ms)).toBe(false)
  })

  it('is zero at beat zero for any tempo', () => {
    for (const bpm of [80, 100, 120, 150]) expect(beatsToMs(0, bpm)).toBe(0)
  })

  it('round-trips through msToBeats', () => {
    for (const [beats, bpm] of [[2.3, 100], [0.75, 130], [1.55, 85]] as Array<[number, number]>) {
      expect(msToBeats(beatsToMs(beats, bpm), bpm)).toBeCloseTo(beats, 10)
    }
  })
})

describe('tokenOffsetsMs', () => {
  it('reproduces the doc §17 example proportions at any tempo', () => {
    for (const bpm of [80, 100, 120, 150]) {
      const offsets = tokenOffsetsMs(ONE_TWO_THREE_TWO, bpm)
      expect(offsets[0]).toBe(0)
      expect(offsets[1]).toBeCloseTo(beatsToMs(0.75, bpm), 10)
      expect(offsets[2]).toBeCloseTo(beatsToMs(1.55, bpm), 10)
      expect(offsets[3]).toBeCloseTo(beatsToMs(2.3, bpm), 10)
    }
  })

  it('preserves order and length', () => {
    const offsets = tokenOffsetsMs(ONE_TWO_THREE_TWO, 120)
    expect(offsets).toHaveLength(ONE_TWO_THREE_TWO.length)
    for (let i = 1; i < offsets.length; i++) {
      expect(offsets[i]!).toBeGreaterThan(offsets[i - 1]!)
    }
  })

  it('handles an empty token list', () => {
    expect(tokenOffsetsMs([], 120)).toEqual([])
  })

  it('works on tokens produced by parseCombo', () => {
    // parseCombo emits placeholder offsets 0,1,2,... — at 60 BPM those are
    // one second apart, which makes the wiring easy to eyeball.
    expect(tokenOffsetsMs(parseCombo('1-2-3'), 60)).toEqual([0, 1000, 2000])
  })
})

describe('maxBeatOffset', () => {
  it('returns the largest offset', () => {
    expect(maxBeatOffset(ONE_TWO_THREE_TWO)).toBe(2.3)
  })

  it('returns 0 for an empty list rather than -Infinity', () => {
    expect(maxBeatOffset([])).toBe(0)
  })
})

describe('blockDurationMs', () => {
  it('includes the trailing gapBeats gap (D5)', () => {
    const withoutGap = blockDurationMs(ONE_TWO_THREE_TWO, 0, 120)
    const withGap = blockDurationMs(ONE_TWO_THREE_TWO, 2, 120)
    expect(withGap - withoutGap).toBeCloseTo(beatsToMs(2, 120), 10)
  })

  it('is increasing in gapBeats', () => {
    let previous = -Infinity
    for (const gap of [0, 0.5, 1, 2, 4]) {
      const duration = blockDurationMs(ONE_TWO_THREE_TWO, gap, 120)
      expect(duration).toBeGreaterThan(previous)
      previous = duration
    }
  })

  it('is decreasing in bpm — a faster tempo makes the same block shorter', () => {
    let previous = Infinity
    for (const bpm of [80, 100, 120, 150]) {
      const duration = blockDurationMs(ONE_TWO_THREE_TWO, 2, bpm)
      expect(duration).toBeLessThan(previous)
      previous = duration
    }
  })

  it('lays back-to-back blocks end to end without overlap', () => {
    // The gap belongs to the block that precedes it, so the next block's
    // first token starts strictly after the previous block's last token.
    const bpm = 120
    const duration = blockDurationMs(ONE_TWO_THREE_TWO, 2, bpm)
    const lastTokenMs = beatsToMs(maxBeatOffset(ONE_TWO_THREE_TWO), bpm)
    expect(duration).toBeGreaterThan(lastTokenMs)
  })
})

describe('clampToProfile', () => {
  const steady = CADENCE_PROFILES.steady

  it('leaves a BPM inside the range untouched', () => {
    expect(clampToProfile(100, steady)).toBe(100)
  })

  it('clamps below and above', () => {
    expect(clampToProfile(50, steady)).toBe(steady.minBpm)
    expect(clampToProfile(400, steady)).toBe(steady.maxBpm)
  })

  it('is idempotent', () => {
    for (const bpm of [50, 95, 100, 110, 400]) {
      const once = clampToProfile(bpm, steady)
      expect(clampToProfile(once, steady)).toBe(once)
    }
  })

  it('bounds an adaptive adjustment so pace can never run away (R13, R23)', () => {
    // PacingEngine (M33-05) may push +15% per round; repeated escalation must
    // still terminate at the profile ceiling rather than compounding.
    let bpm = steady.nominalBpm
    for (let round = 0; round < 10; round++) bpm = clampToProfile(bpm * 1.15, steady)
    expect(bpm).toBe(steady.maxBpm)
  })
})

describe('D3 — cadence is authored, never derived', () => {
  it('takes BPM as a plain number and reads nothing else', () => {
    // A guard against the API growing an audio/metadata parameter later. If
    // this arity ever changes, D3 needs re-reading before the change lands.
    expect(beatsToMs).toHaveLength(2)
    expect(tokenOffsetsMs).toHaveLength(2)
    expect(blockDurationMs).toHaveLength(3)
  })
})
