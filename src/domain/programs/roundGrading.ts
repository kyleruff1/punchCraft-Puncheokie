/**
 * Round grading (M33-03, doc §23).
 *
 * Turns a frozen round's punch **count** into the three-way result the rest
 * screen and the workout summary both render. Nothing here grades technique
 * — the tracker cannot observe it (D12), and this module never sees a match
 * result at all.
 *
 * ## Three outcomes, and deliberately no tolerance band
 *
 * Doc §23 defines gold as "actual count exactly equals the round goal".
 * That is exact equality, and this module implements exactly that: there is
 * no ±band around the target inside which a round is rounded up to exact.
 * A band would be a quiet redesign of the objective the athlete was given —
 * "240" would silently start meaning "236 to 244" — and the whole reason
 * doc §23 refuses letter grades is that the count target is *clear and
 * objective*. So the only bands are the sign of `delta`: positive, negative,
 * zero.
 *
 * ## A short round is a result, not a failure (doc §21)
 *
 * The copy in this module never renders a verdict on the athlete. `19 SHORT`
 * is arithmetic — the distance between two counts — and the accessible
 * sentence says "19 short of target", not "missed", "failed" or "under".
 * Doc §21 is explicit that the tracker transmits nothing below an
 * acceleration floor, so a soft strike and an unthrown one are the same
 * absence of evidence (D13); a low count is partly a measurement statement
 * and may never be presented as a failure. The one thing that *is* a
 * judgement — colour — is why the badge always carries text and an icon too
 * (spec §19.4).
 *
 * ## Counts only
 *
 * Any sequence-score text rendered beside the badge takes its wording from
 * `sequenceScoreLabel` (D4, spec §13.3) — never a literal, and never
 * "technique accuracy". `secondaryBadgeLabel` is the only naming entry point
 * for the doc §23 recognitions for the same reason.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1), and
 * no clock: every function here is a total function of its arguments.
 */

import { sequenceScoreLabel, type CapabilityTier } from '../workout/capabilityTier'
import type { RoundScore } from './cueScoring'

export type RoundOutcome = 'over' | 'short' | 'exact'

export interface RoundGrade {
  outcome: RoundOutcome
  /** `actual - target`. Signed: positive over, negative short, zero exact. */
  delta: number
}

/**
 * Grade an achieved punch count against the round's target.
 *
 * Throws rather than guessing on nonsense input. A `NaN` count silently
 * grading as `short` would put a red badge in front of an athlete because of
 * an upstream arithmetic bug, which is precisely the failure doc §21 says
 * must never be shown as theirs.
 */
export function gradeRound(actual: number, target: number): RoundGrade {
  assertCount(actual, 'actual')
  assertCount(target, 'target')

  const delta = actual - target
  if (delta > 0) return { outcome: 'over', delta }
  if (delta < 0) return { outcome: 'short', delta }
  return { outcome: 'exact', delta: 0 }
}

function assertCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`roundGrading: ${name} must be a non-negative integer, got ${value}`)
  }
}

/**
 * Total punches the tracker reported for a round.
 *
 * Landed plus extras: doc §21 keeps extra punches counted, so a punch that
 * belonged to no cue still belongs to the round's output. This is the bridge
 * from `cueScoring`'s `RoundScore` to a gradeable count — grading builds on
 * the scored round, not on raw match results.
 */
export function roundPunchCount(score: RoundScore): number {
  return score.landedCount + score.extraCount
}

/** `gradeRound` applied to a scored round (M33-04 freezes one of these). */
export function gradeRoundScore(score: RoundScore, targetPunches: number): RoundGrade {
  return gradeRound(roundPunchCount(score), targetPunches)
}

/**
 * The doc §23 status line, byte for byte: `+6 OVER`, `19 SHORT`,
 * `EXACT TARGET`.
 *
 * Short shows the magnitude without a minus sign — the word already carries
 * the direction, and `-19 SHORT` would state it twice.
 */
export function gradeStatusText(grade: RoundGrade): string {
  switch (grade.outcome) {
    case 'over':
      return `+${grade.delta} OVER`
    case 'short':
      return `${Math.abs(grade.delta)} SHORT`
    case 'exact':
      return 'EXACT TARGET'
  }
}

/** The doc §23 count line: `246 / 240`. */
export function gradeCountText(actual: number, target: number): string {
  assertCount(actual, 'actual')
  assertCount(target, 'target')
  return `${actual} / ${target}`
}

/**
 * One neutral sentence for screen readers and the Voice Coach summary.
 *
 * Reports the two counts and the distance between them. No praise, no
 * reprimand, and no word that reads as a verdict — "short of target" is a
 * measurement, "missed" and "failed" are accusations.
 */
export function gradeAccessibilityText(actual: number, target: number): string {
  const grade = gradeRound(actual, target)
  const counts = `${actual} of ${target} punches`
  switch (grade.outcome) {
    case 'over':
      return `${counts}. ${grade.delta} over target.`
    case 'short':
      return `${counts}. ${Math.abs(grade.delta)} short of target.`
    case 'exact':
      return `${counts}. Exact target.`
  }
}

/**
 * The doc §23 recognitions. Recognitions, not grades — they are layered on
 * by M33-04 / M33-08 and are never required for a round to be complete.
 */
export type SecondaryBadgeId =
  | 'pace-consistency'
  | 'velocity-consistency'
  | 'left-right-balance'
  | 'best-round'
  | 'exact-sequence-streak'
  | 'tracker-coverage'

/**
 * What a recognition may be called at this tier.
 *
 * `exact-sequence-streak` is the reason this takes a tier: on FightCamp v1
 * it is a run of exact **hand-sequence** matches, because that is all the
 * tracker verified (D4). The wording comes from `sequenceScoreLabel` so a
 * future distinct-type decoder promotes it honestly, and so no caller can
 * hardcode the stronger claim.
 */
export function secondaryBadgeLabel(id: SecondaryBadgeId, tier: CapabilityTier): string {
  switch (id) {
    case 'pace-consistency':
      return 'Pace consistency'
    case 'velocity-consistency':
      return 'Velocity consistency'
    case 'left-right-balance':
      return 'Left / right balance'
    case 'best-round':
      return 'Best round'
    case 'exact-sequence-streak':
      return `Exact ${sequenceScoreLabel(tier)} streak`
    case 'tracker-coverage':
      return 'Complete tracker coverage'
  }
}
