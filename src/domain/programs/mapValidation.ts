/**
 * Rhythm-map validation predicates (M3, D26).
 *
 * The two guarantees the silence bugs earned: a scored round's content
 * spans its work window, and the compiled map never leaves the athlete
 * unvoiced longer than the ceiling. Pure predicates — the property tests
 * hold every seeded workout to them, which is what makes "no silent
 * rounds" a compile-time fact rather than a bag-test surprise.
 */

import type { RoundRhythmMap } from './RhythmMap'
import type { WorkoutBlock } from '../workout/WorkoutTokens'
import { blocksSpanMs } from '../workout/samples/authoring'

/**
 * Research-grounded coaching ceiling: coaches keep silence under ~20-30s;
 * we hold the schedule to the tight end, leaving runtime margin.
 */
export const SILENCE_CEILING_MS = 20_000

/** Blocks may stop this close to the bell — the bell itself covers the end. */
export const COVERAGE_EPSILON_MS = 5_000

export interface SilenceAudit {
  ok: boolean
  /** The longest unvoiced stretch, including before the first voiced event
   * and after the last one. */
  maxGapMs: number
}

export function silenceAudit(
  map: RoundRhythmMap,
  ceilingMs: number = SILENCE_CEILING_MS,
): SilenceAudit {
  const times = map.voicedEvents
    .map((index) => map.events[index]?.atMs ?? 0)
    .sort((a, b) => a - b)
  if (times.length === 0) {
    return { ok: map.workDurationMs <= ceilingMs, maxGapMs: map.workDurationMs }
  }
  let maxGapMs = Math.max(times[0] as number, 0)
  for (let i = 1; i < times.length; i += 1) {
    maxGapMs = Math.max(maxGapMs, (times[i] as number) - (times[i - 1] as number))
  }
  maxGapMs = Math.max(maxGapMs, map.workDurationMs - (times[times.length - 1] as number))
  return { ok: maxGapMs <= ceilingMs, maxGapMs }
}

export interface CoverageAudit {
  ok: boolean
  spanMs: number
}

export function coverageAudit(
  blocks: readonly WorkoutBlock[],
  workDurationMs: number,
  epsilonMs: number = COVERAGE_EPSILON_MS,
): CoverageAudit {
  const spanMs = blocksSpanMs(blocks)
  return { ok: spanMs >= workDurationMs - epsilonMs, spanMs }
}
