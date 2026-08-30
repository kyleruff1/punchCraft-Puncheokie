/**
 * Reaction-window constants for the timing engine (Kyle's spec,
 * 2026-08-30).
 *
 * The practical reaction model:
 *
 *   Voice onset:              grid time
 *   Circle activation:        grid time
 *   Expected physical punch:  grid time + 140 ms
 *   Acceptance window:        grid time + 60 to 400 ms
 *
 * For faster sprint work, WIDEN the acceptance windows so ordinary
 * human reaction delay does not make correct sequences look late —
 * at division 4 the slots are only 250 ms apart, so a fixed 400 ms
 * close would overlap three later slots; the widening deliberately
 * accepts that overlap (Kyle: "widen or overlap the acceptance
 * windows") rather than shrinking the athlete's margin.
 *
 * Pure constants + one function. No imports.
 */

import type { BeatDivision } from './TimingEngine'

/** Expected physical strike lands this long after the grid time. */
export const EXPECTED_STRIKE_DELAY_MS = 140

/** Acceptance opens this long after the grid time. */
export const ACCEPT_FROM_MS = 60

/** Acceptance close for the slower grids (divisions 1–2). */
export const ACCEPT_UNTIL_BASE_MS = 400

/**
 * Acceptance close per division. Slower grids keep the base close;
 * the triplet and sprint grids widen so reaction delay on a correct
 * sequence never reads as late — the matcher's ordered-sequence rule
 * still attributes each strike to the earliest open window, so
 * overlap does not double-count.
 */
export function acceptUntilMsFor(division: BeatDivision): number {
  switch (division) {
    case 1:
    case 2:
      return ACCEPT_UNTIL_BASE_MS
    case 3:
      return 450
    case 4:
      return 500
  }
}
