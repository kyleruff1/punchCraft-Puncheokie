/**
 * The bridge between the session clock and the score's tick axis.
 *
 * GH #305 blocker 2. Two clocks that look interchangeable are not:
 *
 * - `CompiledWorkoutScore` ticks are **cumulative** over the whole
 *   workout. Round 0 starts at 0, round 1 at 230400, round 2 at
 *   460800 — `compileWorkoutScore` walks a single `cursorTick`.
 * - `WorkoutSessionClock.workElapsedMs` is **round-relative**. It is
 *   reset to the phase overflow on every `work-entered`, so it counts
 *   from ~0 again at the top of each round.
 *
 * Feeding the second straight into `SlotDispatcher.advance()` only ever
 * addressed round 0's band. At the end of round 0 the cursor crossed
 * into round 1's range and dumped every round-1 slot in one tick; the
 * reset then dropped it to 0, so rounds 2+ never came due at all.
 *
 * These helpers do the lift. They are the only place that knows the two
 * axes differ, so a future score that is authored round-relative just
 * makes `roundStartTicksFrom` return zeros.
 *
 * Pure TypeScript — no clock, no React.
 */

import { TRANSPORT_TICKS_PER_PULSE } from '../timing/TimingEngine'
import type { CompiledWorkoutScore } from './workoutScore'

/** Base BPM the score's tick space runs at — matches `workoutScore`. */
const MS_PER_SCORE_TICK = 60_000 / (60 * TRANSPORT_TICKS_PER_PULSE)

/**
 * Score tick each round's work phase begins at, indexed by round.
 *
 * Read off the score's own `round-start` phase boundaries rather than
 * re-deriving from durations, so the two can never disagree.
 */
export function roundStartTicksFrom(score: CompiledWorkoutScore): number[] {
  const ticks: number[] = []
  for (const boundary of score.phaseBoundaries) {
    if (boundary.kind === 'round-start') ticks[boundary.roundIndex] = boundary.atTick
  }
  return ticks
}

/**
 * Round-relative `workElapsedMs` → the score's cumulative tick axis.
 *
 * An unknown round contributes no offset, which degrades to the old
 * round-0-only behaviour rather than throwing mid-workout.
 */
export function scoreTickAt(
  roundStartTicks: readonly number[],
  workElapsedMs: number,
  roundIndex: number,
): number {
  return (roundStartTicks[roundIndex] ?? 0) + Math.round(workElapsedMs / MS_PER_SCORE_TICK)
}
