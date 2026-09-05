/**
 * Audible metronome grid division (W2, Kyle 2026-09-04 "roll into the
 * grid"). The click WAV's subdivision is chosen per section so its clicks
 * land on that section's node interval (`slotMs`) WITHOUT moving the
 * visual grid — `audibleDivisionForSlot` is the pure chooser. These pins
 * lock the two properties that matter: it reproduces the plan's per-frame
 * divisions exactly, and whatever it returns puts the slot on a whole
 * multiple of the loop's click interval (that IS "on the grid").
 */
import { audibleDivisionForSlot } from '../_useWorkoutRunner'

/** Node interval (ms) for a section at `rate` on a `bpm` visual grid. */
function slot(bpm: number, rate: number): number {
  return 60000 / (bpm * rate)
}

describe('audibleDivisionForSlot — the on-grid subdivision chooser', () => {
  // The 120-BPM (baseBpm 60) frame: division = 2 × rate — reuses b60 d2/d3/d4.
  it('fast frame (baseBpm 60): rate 1 → d2, 1.5 → d3, 2 → d4', () => {
    expect(audibleDivisionForSlot(slot(120, 1), 60)).toBe(2)
    expect(audibleDivisionForSlot(slot(120, 1.5), 60)).toBe(3)
    expect(audibleDivisionForSlot(slot(120, 2), 60)).toBe(4)
  })

  // The slow @100 frame (baseBpm 100): division = rate, with 1.5 → 3 (two
  // clicks per node keeps it on grid, since d2's 300ms misses the 400ms slot).
  it('slow @100 frame: rate 1 → d1, 2 → d2, 1.5 → d3', () => {
    expect(audibleDivisionForSlot(slot(100, 1), 100)).toBe(1)
    expect(audibleDivisionForSlot(slot(100, 2), 100)).toBe(2)
    expect(audibleDivisionForSlot(slot(100, 1.5), 100)).toBe(3)
  })

  // The slow @85 frame (baseBpm 85): same shape at the non-integer beat.
  it('slow @85 frame: rate 1 → d1, 2 → d2, 1.5 → d3', () => {
    expect(audibleDivisionForSlot(slot(85, 1), 85)).toBe(1)
    expect(audibleDivisionForSlot(slot(85, 2), 85)).toBe(2)
    expect(audibleDivisionForSlot(slot(85, 1.5), 85)).toBe(3)
  })

  it('grid-lock property: the slot is a whole multiple of the chosen click interval', () => {
    for (const [bpm, base] of [
      [120, 60],
      [100, 100],
      [85, 85],
    ] as const) {
      for (const rate of [1, 1.5, 2] as const) {
        const s = slot(bpm, rate)
        const d = audibleDivisionForSlot(s, base)
        expect(d).toBeDefined()
        const clickInterval = 60000 / base / d!
        const perSlot = s / clickInterval
        expect(Math.abs(perSlot - Math.round(perSlot))).toBeLessThan(1e-6)
        expect(Math.round(perSlot)).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('returns undefined for degenerate / off-grid input (caller falls back to the recipe division)', () => {
    expect(audibleDivisionForSlot(0, 100)).toBeUndefined()
    expect(audibleDivisionForSlot(300, 0)).toBeUndefined()
    // A slot that lands on no whole multiple of any d1-d4 click interval —
    // 0.4 of a beat: perSlot is 0.4/0.8/1.2/1.6, never near an integer.
    expect(audibleDivisionForSlot(0.4 * (60000 / 100), 100)).toBeUndefined()
  })
})
