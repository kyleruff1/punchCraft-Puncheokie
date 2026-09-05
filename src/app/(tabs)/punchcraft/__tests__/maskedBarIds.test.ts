/**
 * Dim-until-called mask (Kyle 2026-09-04: "lit = spoken", plus the
 * round-start ear-first window — "establish a bit of a rhythm before
 * seeing the light up node tokens"). Pure-rule pins for `maskedBarIds`;
 * the render side simply holds a masked bar's tokens at 'upcoming'.
 */
import { maskedBarIds } from '../_useWorkoutRunner'

/** A 100 BPM grid: measure = 2400ms; a rate-1 4-slot bar = 2 measures. */
const BPM = 100
const MEASURE = 240000 / BPM

/** Section 1: three rate-1 bars from t=4800 (a 2-measure opener pad). */
const S1_START = 2 * MEASURE
const bars = [
  { id: 's1#0', scoring: 'sequence', scheduledStartMs: S1_START },
  { id: 's1#1', scoring: 'sequence', scheduledStartMs: S1_START + 2 * MEASURE },
  { id: 's1#2', scoring: 'sequence', scheduledStartMs: S1_START + 4 * MEASURE },
  // Section 2, far later.
  { id: 's2#0', scoring: 'sequence', scheduledStartMs: S1_START + 20 * MEASURE },
  { id: 's2#1', scoring: 'sequence', scheduledStartMs: S1_START + 22 * MEASURE },
  // A count-scored pump block — never masked (sequence bars only).
  { id: 'pump', scoring: 'count', scheduledStartMs: S1_START + 30 * MEASURE },
] as const

const allCalled = new Set(bars.map((b) => b.id))

describe('maskedBarIds — dim-until-called + the ear-first round open', () => {
  it('rule 0: the round-start window dims exactly the opener bar, even though called', () => {
    const masked = maskedBarIds(bars, allCalled, true, BPM)
    expect(masked.has('s1#0')).toBe(true)
    // The bar that begins EXACTLY at +2 measures is LIT (float-safe edge).
    expect(masked.has('s1#1')).toBe(false)
    expect(masked.has('s1#2')).toBe(false)
  })

  it('rule 0 covers TWO bars when the opener runs double-time (1 measure per bar)', () => {
    const fast = [
      { id: 'f#0', scoring: 'sequence', scheduledStartMs: S1_START },
      { id: 'f#1', scoring: 'sequence', scheduledStartMs: S1_START + MEASURE },
      { id: 'f#2', scoring: 'sequence', scheduledStartMs: S1_START + 2 * MEASURE },
    ]
    const masked = maskedBarIds(fast, new Set(fast.map((b) => b.id)), true, BPM)
    expect([...masked].sort()).toEqual(['f#0', 'f#1'])
  })

  it('rule 1: a bar with no scheduled call stays dim anywhere in the round', () => {
    const called = new Set([...allCalled].filter((id) => id !== 's2#1'))
    const masked = maskedBarIds(bars, called, true, BPM)
    expect(masked.has('s2#1')).toBe(true)
    expect(masked.has('s2#0')).toBe(false)
  })

  it('never masks when the guided layer is off — visuals are the whole workout', () => {
    expect(maskedBarIds(bars, allCalled, false, BPM).size).toBe(0)
  })

  it('never masks when the round scheduled no calls at all (unrendered bank)', () => {
    expect(maskedBarIds(bars, new Set(), true, BPM).size).toBe(0)
  })

  it('ignores non-sequence cues entirely', () => {
    const masked = maskedBarIds(bars, new Set(['s1#0']), true, BPM)
    expect(masked.has('pump')).toBe(false)
  })
})
