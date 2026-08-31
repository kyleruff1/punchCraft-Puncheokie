/**
 * Beat-cursor projection (option C, GH #305).
 *
 * The property that matters: the answer depends ONLY on the clock and the
 * authored offsets. No event history, no accumulation, so a stalled tick
 * cannot make the cursor wrong — it just reports where the beat actually
 * is when it is finally asked.
 */
import { beatOrdinalAt, beatOrdinalAtMs } from '../beatProjection'
import { expandTimeline, type CueInstance } from '../CueTimeline'
import { CADENCE_PROFILES } from '../../workout/cadence'
import { threeRoundFundamentals } from '../../workout/samples'

const STEADY_BPM = CADENCE_PROFILES.steady.nominalBpm

// `1-2` — two punches, offsets 0 and 0.75 beats.
const CUE: CueInstance = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)[0]!
  .cues[0]!

describe('beatOrdinalAtMs', () => {
  // scheduledStart 1000, strikes at +0 and +500.
  const start = 1_000
  const offsets = [0, 500]
  const expected = [0, 1]

  it('is -1 before the first strike is due', () => {
    expect(beatOrdinalAtMs(start, offsets, expected, 999)).toBe(-1)
  })

  it('reaches ordinal 0 exactly on the first strike', () => {
    expect(beatOrdinalAtMs(start, offsets, expected, 1_000)).toBe(0)
  })

  it('holds ordinal 0 through the gap', () => {
    expect(beatOrdinalAtMs(start, offsets, expected, 1_499)).toBe(0)
  })

  it('advances to ordinal 1 on the second strike', () => {
    expect(beatOrdinalAtMs(start, offsets, expected, 1_500)).toBe(1)
  })

  it('stays on the last strike after the cue is over', () => {
    // The cursor never runs past the final authored strike, however late
    // it is asked — a stall must not push it off the end.
    expect(beatOrdinalAtMs(start, offsets, expected, 99_999)).toBe(1)
  })

  it('is a pure function of time — a stall changes nothing about the answer', () => {
    // THE point of option C. Whether we ask every 50 ms or once after a
    // 3 s freeze, the answer for a given instant is identical. An
    // accumulator would depend on how many times it had been advanced.
    const fineGrained: number[] = []
    for (let t = 900; t <= 2_000; t += 50) {
      fineGrained.push(beatOrdinalAtMs(start, offsets, expected, t))
    }
    // The same instants sampled sparsely (as a stalled tick would) agree.
    for (const t of [900, 1_200, 1_600, 2_000]) {
      const fineIndex = (t - 900) / 50
      expect(beatOrdinalAtMs(start, offsets, expected, t)).toBe(fineGrained[fineIndex])
    }
    // And it never decreases as time advances.
    for (let i = 1; i < fineGrained.length; i += 1) {
      expect(fineGrained[i]).toBeGreaterThanOrEqual(fineGrained[i - 1]!)
    }
  })

  it('returns -1 for a cue with no expected punches', () => {
    expect(beatOrdinalAtMs(start, offsets, [], 5_000)).toBe(-1)
  })

  it('stops at a token index the offsets do not cover', () => {
    // Defensive: malformed data must not read past the array.
    expect(beatOrdinalAtMs(start, offsets, [0, 9], 99_999)).toBe(0)
  })
})

describe('beatOrdinalAt (CueInstance wrapper)', () => {
  it('is -1 before the cue starts', () => {
    expect(beatOrdinalAt(CUE, CUE.scheduledStartMs - 1)).toBe(-1)
  })

  it('walks each authored strike in order', () => {
    const seen = CUE.expectedPunches.map((p) =>
      beatOrdinalAt(CUE, CUE.scheduledStartMs + (CUE.tokenOffsetsMs[p.tokenIndex] ?? 0)),
    )
    expect(seen).toEqual(CUE.expectedPunches.map((_, i) => i))
  })

  it('never exceeds the last ordinal', () => {
    const last = CUE.expectedPunches.length - 1
    expect(beatOrdinalAt(CUE, CUE.windowEndMs + 60_000)).toBe(last)
  })
})
