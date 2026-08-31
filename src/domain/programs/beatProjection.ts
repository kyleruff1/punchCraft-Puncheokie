/**
 * Beat-cursor projection — where the beat IS, computed from the clock.
 *
 * Option C of the token-order investigation (GH #305).
 *
 * ## Why a projection rather than an accumulator
 *
 * The sequence-cue ring cursor used to be ACCUMULATED from `token-due`
 * events: each event advanced a ref, and a `cue-active` reset it. That
 * makes the displayed position a function of event HISTORY, so anything
 * that perturbs delivery — a stalled runner interval firing a backlog,
 * a cue boundary crossed mid-tick — perturbs what the athlete sees.
 * Measured on-tablet: the runner ticks at ~341 ms against a 50 ms
 * interval, so backlogs are routine, not exceptional.
 *
 * A projection cannot have that class of bug. `beatOrdinalAt(t)` answers
 * "which strike is the beat on at time t" from the authored offsets
 * alone. Replaying history is not possible because no history is read.
 * This is M39-V2 principle #0 (runtime PROJECTS the score, never
 * re-derives or accumulates) and principle #3 (a stall may skip an event
 * already over; it is never replayed).
 *
 * The count-scored branch has always worked this way via
 * `pulseCursorAt`. This brings sequence cues onto the same footing.
 *
 * ## Worklet safety
 *
 * `beatOrdinalAtMs` takes only numbers and number arrays and closes over
 * nothing, so it can be lifted onto the UI thread verbatim when ring
 * rendering moves to `useFrameCallback`. The `CueInstance` convenience
 * wrapper is JS-thread only.
 *
 * Pure TypeScript — no React, no clock of its own.
 */

import type { CueInstance } from './CueTimeline'

/**
 * The ordinal (index into the cue's expected punches) the beat has
 * reached at `workElapsedMs`, or `-1` before the first strike is due.
 *
 * `tokenOffsetsMs` is indexed by TOKEN index; `expectedTokenIndexes`
 * maps punch ordinal → token index, mirroring `cue.expectedPunches`.
 * Both come straight off the authored cue, so the answer is a pure
 * function of the authored schedule and the clock.
 *
 * Offsets are authored ascending, so the scan stops at the first strike
 * that is not yet due.
 */
export function beatOrdinalAtMs(
  scheduledStartMs: number,
  tokenOffsetsMs: readonly number[],
  expectedTokenIndexes: readonly number[],
  workElapsedMs: number,
): number {
  'worklet'
  let ordinal = -1
  for (let i = 0; i < expectedTokenIndexes.length; i += 1) {
    const tokenIndex = expectedTokenIndexes[i]
    if (tokenIndex === undefined) break
    const offset = tokenOffsetsMs[tokenIndex]
    if (offset === undefined) break
    if (workElapsedMs < scheduledStartMs + offset) break
    ordinal = i
  }
  return ordinal
}

/** `beatOrdinalAtMs` for a `CueInstance`. JS thread only. */
export function beatOrdinalAt(cue: CueInstance, workElapsedMs: number): number {
  return beatOrdinalAtMs(
    cue.scheduledStartMs,
    cue.tokenOffsetsMs,
    cue.expectedPunches.map((p) => p.tokenIndex),
    workElapsedMs,
  )
}
