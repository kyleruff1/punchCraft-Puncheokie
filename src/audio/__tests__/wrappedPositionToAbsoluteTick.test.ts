/**
 * `wrappedPositionToAbsoluteTick` — the pure translator behind
 * MetronomePlayer's position observer (M39-V2 Phase W0-c-ii).
 *
 * Pins the loop-count inference against JS monotonic time and the
 * defensive corners (zero-duration loop, negative elapsed) that the
 * real audio callback can produce before the loop is fully loaded.
 */

import {
  wrappedPositionToAbsoluteTick,
  type MetronomePositionSample,
} from '../wrappedPositionToAbsoluteTick'

const TICKS_PER_SECOND = 960 // 60 BPM, matches TRANSPORT_TICKS_PER_PULSE
const LOOP_SEC = 1.0 // matches the shipped metronome loops

function sample(overrides: Partial<MetronomePositionSample> = {}): MetronomePositionSample {
  return {
    wrappedPositionSec: 0.5,
    loopDurationSec: LOOP_SEC,
    sampleMonotonicMs: 1_500,
    ...overrides,
  }
}

describe('wrappedPositionToAbsoluteTick — happy path', () => {
  it('returns wrapped position × ticksPerSecond when the sample is inside loop 0', () => {
    // Elapsed 500 ms, wrapped position 0.5 s → integer loops = 0,
    // absolute position = 0.5 s = 480 ticks.
    const result = wrappedPositionToAbsoluteTick(
      sample({ wrappedPositionSec: 0.5, sampleMonotonicMs: 1_500 }),
      1_000,
      TICKS_PER_SECOND,
    )
    expect(result).toBeCloseTo(480, 5)
  })

  it('picks integer loop count from monotonic elapsed', () => {
    // Elapsed 3.5 s, wrapped position 0.5 s → integer loops = 3,
    // absolute position = 3.5 s = 3360 ticks.
    const result = wrappedPositionToAbsoluteTick(
      sample({ wrappedPositionSec: 0.5, sampleMonotonicMs: 4_500 }),
      1_000,
      TICKS_PER_SECOND,
    )
    expect(result).toBeCloseTo(3_360, 5)
  })

  it('rounds toward the loop count closest to JS estimate — small forward skew', () => {
    // JS says elapsed = 3.7 s, audio says wrapped = 0.6 s.
    //   nominalLoopsTotal = 3.7
    //   wrappedFraction = 0.6
    //   bestInt = round(3.7 - 0.6) = round(3.1) = 3
    //   absolute = 3 * 1 + 0.6 = 3.6 s → 3456 ticks
    const result = wrappedPositionToAbsoluteTick(
      sample({ wrappedPositionSec: 0.6, sampleMonotonicMs: 4_700 }),
      1_000,
      TICKS_PER_SECOND,
    )
    expect(result).toBeCloseTo(3_456, 5)
  })

  it('rounds toward the loop count closest to JS estimate — audio just past a wrap', () => {
    // JS says elapsed = 3.9 s, audio wrapped just past 0 (0.1 s):
    //   nominalLoopsTotal = 3.9
    //   wrappedFraction = 0.1
    //   bestInt = round(3.9 - 0.1) = round(3.8) = 4
    //   absolute = 4 * 1 + 0.1 = 4.1 s → 3936 ticks
    const result = wrappedPositionToAbsoluteTick(
      sample({ wrappedPositionSec: 0.1, sampleMonotonicMs: 4_900 }),
      1_000,
      TICKS_PER_SECOND,
    )
    expect(result).toBeCloseTo(3_936, 5)
  })

  it('handles a longer loop duration correctly', () => {
    // 2 s loop; elapsed 5 s means we're in loop 2.5. Wrapped at 0.7 s:
    //   nominalLoopsTotal = 5 / 2 = 2.5
    //   wrappedFraction = 0.7 / 2 = 0.35
    //   bestInt = round(2.5 - 0.35) = round(2.15) = 2
    //   absolute = 2 * 2 + 0.7 = 4.7 s → 4512 ticks
    const result = wrappedPositionToAbsoluteTick(
      sample({
        loopDurationSec: 2.0,
        wrappedPositionSec: 0.7,
        sampleMonotonicMs: 6_000,
      }),
      1_000,
      TICKS_PER_SECOND,
    )
    expect(result).toBeCloseTo(4_512, 5)
  })
})

describe('wrappedPositionToAbsoluteTick — defensive corners', () => {
  it('returns 0 when loop duration is 0 (unloaded playlist)', () => {
    expect(
      wrappedPositionToAbsoluteTick(
        sample({ loopDurationSec: 0 }),
        1_000,
        TICKS_PER_SECOND,
      ),
    ).toBe(0)
  })

  it('returns 0 when ticksPerSecond is 0 (transport stopped)', () => {
    expect(wrappedPositionToAbsoluteTick(sample(), 1_000, 0)).toBe(0)
  })

  it('returns 0 for non-finite inputs', () => {
    expect(
      wrappedPositionToAbsoluteTick(sample({ loopDurationSec: NaN }), 1_000, TICKS_PER_SECOND),
    ).toBe(0)
    expect(
      wrappedPositionToAbsoluteTick(sample({ loopDurationSec: -1 }), 1_000, TICKS_PER_SECOND),
    ).toBe(0)
    expect(wrappedPositionToAbsoluteTick(sample(), 1_000, NaN)).toBe(0)
  })

  it('clamps negative elapsed to zero (audio callback before anchor)', () => {
    // sampleMonotonicMs = 500, startMonotonicMs = 1_000 → elapsed -500.
    // With wrapped = 0.3, integer loops = round(0 - 0.3) = round(-0.3) = 0,
    // absolute = 0.3 s → 288 ticks. Not negative.
    const result = wrappedPositionToAbsoluteTick(
      sample({ wrappedPositionSec: 0.3, sampleMonotonicMs: 500 }),
      1_000,
      TICKS_PER_SECOND,
    )
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeCloseTo(288, 5)
  })
})

describe('wrappedPositionToAbsoluteTick — convergence at loop boundaries', () => {
  it('nominalLoopsTotal near .5 with wrapped near .5: both loops give similar answers', () => {
    // JS elapsed 2.5 s exactly, wrapped 0.5. Integer loops:
    //   round(2.5 - 0.5) = round(2.0) = 2
    //   absolute = 2 * 1 + 0.5 = 2.5 s → 2400 ticks
    // The alternative (loops = 3) would give 3.5 s → 3360 ticks
    // (a full 960 ticks off — that's what the LARGE-error re-anchor
    // branch of transport.correct would catch and fix).
    const result = wrappedPositionToAbsoluteTick(
      sample({ wrappedPositionSec: 0.5, sampleMonotonicMs: 3_500 }),
      1_000,
      TICKS_PER_SECOND,
    )
    expect(result).toBeCloseTo(2_400, 5)
  })
})
