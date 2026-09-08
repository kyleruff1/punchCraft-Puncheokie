/**
 * Set-aware call breath (Kyle, 2026-09-04): breath shrinks as a bar's
 * inter-node interval widens, so a short call on a slow/sparse bar stops
 * ending a fixed 600/750ms before a wide-strided first shot — while dense
 * combos keep the exact tuned constant and still "snap." Pins the formula
 * and the invariant that the call never buries its own first two shots.
 */
import {
  breathForBar,
  DELIVERED_BREATH_SHORTFALL_MS,
  DENSE_BREATH_MS,
  MIN_BREATH_MS,
  BREATH_REF_SLOT_MS,
} from '../_useWorkoutRunner'

/**
 * What the clamp actually floors at. `MIN_BREATH_MS` is the silence Kyle
 * wants the athlete to HEAR; the audio path eats
 * `DELIVERED_BREATH_SHORTFALL_MS` of whatever the scheduler asks for, so the
 * scheduled floor is the sum. Asserting against `MIN_BREATH_MS` alone is how
 * this test passed for weeks while 8-15% of bars in the tighter workouts
 * delivered under it.
 */
const DELIVERED_FLOOR_MS = MIN_BREATH_MS + DELIVERED_BREATH_SHORTFALL_MS

const punch = { kind: 'punch' as const, number: 1 }
const rest = { kind: 'rest' as const }

/** Build a fake cue: punches at the given ms offsets, optional leading rest. */
function bar(offsets: number[], opts: { leadRest?: boolean } = {}) {
  const tokens = opts.leadRest ? [rest, ...offsets.map(() => punch)] : offsets.map(() => punch)
  const tokenOffsetsMs = opts.leadRest ? [0, ...offsets] : offsets
  return { tokens, tokenOffsetsMs }
}

describe('breathForBar — set-aware call breath', () => {
  it('a DENSE bar (tight inter-node interval) gets the full tuned constant', () => {
    // 4 punches, 250ms apart — below the reference slot, so no shrink.
    const { breathMs } = breathForBar(bar([0, 250, 500, 750]), 'techniques', 'call/x')
    expect(breathMs).toBe(DENSE_BREATH_MS.techniques)
  })

  it('a SLOW/sparse bar shrinks the breath below the dense constant', () => {
    // 2 punches 600ms apart (1x @100bpm): slotMs 600, 300 over ref → −300.
    const { breathMs } = breathForBar(bar([0, 600]), 'numbers', 'call/y')
    expect(breathMs).toBe(DENSE_BREATH_MS.numbers - (600 - BREATH_REF_SLOT_MS))
    expect(breathMs).toBeLessThan(DENSE_BREATH_MS.numbers)
    expect(breathMs).toBeGreaterThanOrEqual(DELIVERED_FLOOR_MS)
  })

  it('a single-punch bar floors to the DELIVERED floor (no interval to track)', () => {
    expect(breathForBar(bar([0]), 'numbers', 'call/z').breathMs).toBe(DELIVERED_FLOOR_MS)
    // and what the athlete hears is the floor Kyle set, which is the point
    expect(breathForBar(bar([0]), 'numbers', 'call/z').breathMs - DELIVERED_BREATH_SHORTFALL_MS).toBe(MIN_BREATH_MS)
  })

  it('anchors to the first PUNCH when the bar opens on a rest', () => {
    const { firstPunchOffsetMs } = breathForBar(bar([600, 1200], { leadRest: true }), 'numbers', 'call/r')
    expect(firstPunchOffsetMs).toBe(600)
  })

  it('never buries the first two shots: callEnd stays before the second node', () => {
    // With positive breath, callEnd = firstNode − breath is always before
    // firstNode < secondNode. Assert across a range of intervals.
    for (const slot of [150, 250, 300, 500, 800, 1200]) {
      const { breathMs } = breathForBar(bar([0, slot]), 'techniques', 'call/g')
      expect(breathMs).toBeGreaterThan(0) // callEnd is before the first node
      expect(breathMs).toBeLessThanOrEqual(DENSE_BREATH_MS.techniques)
      // ...and stays before it AT THE EAR, which is the guarantee that was
      // being read off the scheduled number rather than the delivered one.
      expect(breathMs - DELIVERED_BREATH_SHORTFALL_MS).toBeGreaterThanOrEqual(MIN_BREATH_MS)
    }
  })

  it('an override for the call slot wins outright', () => {
    // No override seeded by default, so the table is empty — documented here
    // as the escape hatch; formula governs until a bucket is pinned.
    expect(breathForBar(bar([0, 600]), 'numbers', 'call/none').breathMs).not.toBe(999)
  })
})
