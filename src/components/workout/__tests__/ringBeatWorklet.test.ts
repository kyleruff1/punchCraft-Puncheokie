/**
 * The ring walk's worklet math (MVP v2, GH #305).
 *
 * `beatOrdinalAtMsWorklet` is a hand mirror of `beatOrdinalAtMs` — the
 * same trade `useAvatarFrameClock` makes, pinned the same way: parity
 * across a dense time sweep, so the two can never drift apart silently.
 */
import { beatOrdinalAtMsWorklet } from '../ringBeatMath'
import { beatOrdinalAtMs } from '@domain/programs/beatProjection'

describe('beatOrdinalAtMsWorklet — parity with the domain projection', () => {
  const start = 1_000
  const offsets = [0, 333, 667, 1_000]
  const expected = [0, 1, 2, 3]

  it('agrees with beatOrdinalAtMs at every ms across the cue and beyond', () => {
    for (let t = 0; t <= 4_000; t += 1) {
      expect(beatOrdinalAtMsWorklet(start, offsets, expected, t)).toBe(
        beatOrdinalAtMs(start, offsets, expected, t),
      )
    }
  })

  it('is monotone non-decreasing in time — the walk can never go backwards', () => {
    let last = -1
    for (let t = 0; t <= 4_000; t += 7) {
      const o = beatOrdinalAtMsWorklet(start, offsets, expected, t)
      expect(o).toBeGreaterThanOrEqual(last)
      last = o
    }
  })

  it('holds the last ordinal after the cue ends — never runs off the row', () => {
    expect(beatOrdinalAtMsWorklet(start, offsets, expected, 99_999)).toBe(3)
  })

  it('respects fractional-rate offsets — 2x double-time walks twice as fast', () => {
    const half = offsets.map((o) => o / 2)
    // At the same instant, the 2x walk has advanced at least as far.
    for (let t = 0; t <= 2_000; t += 50) {
      expect(beatOrdinalAtMsWorklet(start, half, expected, t)).toBeGreaterThanOrEqual(
        beatOrdinalAtMsWorklet(start, offsets, expected, t),
      )
    }
    expect(beatOrdinalAtMsWorklet(start, half, expected, start + 500)).toBe(3)
  })
})
