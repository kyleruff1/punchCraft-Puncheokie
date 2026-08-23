/**
 * Workout summary (M33-08, doc §24).
 *
 * Computes everything the summary screen shows, from the **realized token
 * stream and the persisted cue results only** — never from the recipe
 * (D8). That distinction is the whole reason a stored workout stays
 * recomputable: the recipe says what was asked for, the realized stream
 * says what actually ran after any adaptation, and only the second one can
 * be reconciled against what the tracker saw.
 *
 * ## Why this is pure and separately versioned
 *
 * `WORKOUT_SUMMARY_CALCULATION_VERSION` is independent of MetricsEngine's
 * (#117). They change for different reasons and at different times, and a
 * shared version would force one to bump whenever the other's formula
 * moved — which would invalidate history for no reason.
 *
 * Recomputing this function over the same persisted rows must produce a
 * deep-equal result, forever, for a given version. That is what the golden
 * test pins (spec §8.6, §19.1).
 *
 * ## What it refuses to claim
 *
 * Sequence figures are labelled by `sequenceScoreLabel` — "hand-sequence
 * match" at every tier this hardware reaches (D4). Velocity is
 * tracker-reported, in tracker units, and the summary states which
 * representation it is showing (spec §8.5) rather than letting a bare
 * number imply a physical measurement.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports, and no
 * `Date.now()` (spec §15.1, §18.3).
 */

import { gradeRound, type RoundGrade } from './roundGrading'
import { sequenceScoreLabel, type CapabilityTier } from '../workout/capabilityTier'
import type { GeneratedWorkout } from '../workout/GeneratedWorkout'

/**
 * Bumped whenever any figure below changes for the same input. Independent
 * of #117's metrics version on purpose — see the header note.
 */
export const WORKOUT_SUMMARY_CALCULATION_VERSION = '1.0.0'

/** The six persisted outcomes (spec §17.1 amendment). */
export type SummaryCueOutcome =
  | 'matched'
  | 'hand-mismatch'
  | 'type-mismatch'
  | 'missed'
  | 'late'
  | 'during-pause'

/** The persisted shape this reads. Structural, so storage stays out of domain. */
export interface SummaryCueResult {
  blockId: string
  tokenIndex: number
  expectedHand: 'left' | 'right'
  outcome: SummaryCueOutcome
  offsetMs: number | null
  velocityRaw: number | null
  velocityUnit: string | null
  capabilityTier: string
}

export interface SummaryAdaptation {
  decidedAtMonotonicMs: number
  boundary: 'block' | 'rest' | 'round'
}

export interface RoundSummary {
  roundIndex: number
  theme: string
  target: number
  actual: number
  grade: RoundGrade
  leftRight: { left: number; right: number }
  avgVelocity?: number
}

export interface WorkoutSummaryData {
  totalPunches: number
  target: number
  grade: RoundGrade
  completedRounds: number
  avgVelocity?: number
  peakVelocity?: number
  /**
   * Spec §8.5: say which representation the numbers are, so a bare figure
   * never implies a physical measurement that was not made.
   */
  velocityRepresentation: string
  leftRightSplit: { left: number; right: number }
  avgRatePerMin: number
  mostProductiveRound: number
  bestVelocityRound?: number
  /** Share of expected punches answered at all, as a percentage. */
  handSequenceMatchPercent?: number
  /** What that figure may be called (D4). */
  sequenceScoreLabel: 'hand-sequence match' | 'technique match'
  /**
   * The tier the figures were produced at. Carried so a surface can resolve
   * its own label rather than being handed a pre-baked string it might
   * then contradict.
   */
  capabilityTier: CapabilityTier
  extraPunches: number
  adaptationCount: number
  perRound: RoundSummary[]
  recipeName: string
  seed: string
  generatorVersion: string
  calculationVersion: string
}

export interface ComputeSummaryArgs {
  /** The realized stream, never the recipe (D8). */
  workout: GeneratedWorkout
  cueResults: readonly SummaryCueResult[]
  adaptations?: readonly SummaryAdaptation[]
  /** Punches with no expectation to answer; counted, never discarded. */
  extraPunches?: number
  recipeName?: string
}

/** Spec §8.5 disclosure strings, keyed by the unit actually stored. */
const VELOCITY_REPRESENTATION: Record<string, string> = {
  'tracker-unit': 'Tracker-reported velocity, in tracker units. Not a physical measurement.',
  index: 'Normalized index derived from tracker-reported velocity.',
  'cm/s': 'Calibrated against an external reference (cm/s).',
  'm/s': 'Calibrated against an external reference (m/s).',
  mph: 'Calibrated against an external reference (mph).',
}

const NO_VELOCITY_DISCLOSURE = 'No velocity was recorded for this workout.'

/** Outcomes that mean a punch actually landed for that expectation. */
const LANDED: ReadonlySet<SummaryCueOutcome> = new Set<SummaryCueOutcome>([
  'matched',
  'hand-mismatch',
  'type-mismatch',
  'late',
])

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function computeWorkoutSummary(args: ComputeSummaryArgs): WorkoutSummaryData {
  const { workout, cueResults, adaptations = [], extraPunches = 0 } = args

  const scoredRounds = workout.schedule.filter((r) => r.countsTowardGoal)
  const blockToRound = new Map<string, number>()
  workout.schedule.forEach((round, index) => {
    for (const block of round.blocks) blockToRound.set(block.id, index)
  })

  // -- per round ------------------------------------------------------------

  const perRound: RoundSummary[] = workout.schedule.map((round, roundIndex) => {
    const rows = cueResults.filter((r) => blockToRound.get(r.blockId) === roundIndex)
    const landed = rows.filter((r) => LANDED.has(r.outcome))

    const left = landed.filter((r) => r.expectedHand === 'left').length
    const right = landed.filter((r) => r.expectedHand === 'right').length
    const velocities = landed
      .filter((r) => typeof r.velocityRaw === 'number' && r.velocityUnit !== null)
      .map((r) => r.velocityRaw as number)

    return {
      roundIndex,
      theme: round.theme,
      target: round.targetPunches,
      actual: landed.length,
      grade: gradeRound(landed.length, round.targetPunches),
      leftRight: { left, right },
      ...(velocities.length > 0
        ? { avgVelocity: round1(velocities.reduce((a, b) => a + b, 0) / velocities.length) }
        : {}),
    }
  })

  // -- workout totals -------------------------------------------------------

  const landedRows = cueResults.filter((r) => LANDED.has(r.outcome))
  // Extras are punches too (doc §21), so they belong in the total the
  // athlete is graded against — the count badge grades what they threw.
  const totalPunches = landedRows.length + extraPunches
  const target = workout.recipe.totalPunchGoal

  const velocityRows = cueResults.filter(
    (r) => typeof r.velocityRaw === 'number' && r.velocityUnit !== null,
  )
  const velocities = velocityRows.map((r) => r.velocityRaw as number)
  const storedUnit = velocityRows[0]?.velocityUnit ?? null

  const activeMinutes = scoredRounds.reduce((sum, r) => sum + r.workDurationMs, 0) / 60_000

  // Expected punches are the denominator for the sequence figure; display-
  // only tokens never enter it (D4).
  const expectedCount = cueResults.length
  const matchedCount = cueResults.filter((r) => r.outcome === 'matched').length

  const tier = (cueResults[0]?.capabilityTier ?? 'hand-only') as CapabilityTier

  const mostProductiveRound = perRound.reduce(
    (best, current) => (current.actual > (perRound[best]?.actual ?? -1) ? current.roundIndex : best),
    0,
  )
  const roundsWithVelocity = perRound.filter((r) => r.avgVelocity !== undefined)
  const bestVelocityRound =
    roundsWithVelocity.length > 0
      ? roundsWithVelocity.reduce((best, current) =>
          (current.avgVelocity ?? 0) > (best.avgVelocity ?? 0) ? current : best,
        ).roundIndex
      : undefined

  return {
    totalPunches,
    target,
    grade: gradeRound(totalPunches, target),
    // A round counts as completed once anything was recorded against it;
    // a round nobody reached is not "completed with zero".
    completedRounds: perRound.filter((r) => r.actual > 0).length,
    ...(velocities.length > 0
      ? {
          avgVelocity: round1(velocities.reduce((a, b) => a + b, 0) / velocities.length),
          peakVelocity: Math.max(...velocities),
        }
      : {}),
    velocityRepresentation:
      storedUnit === null
        ? NO_VELOCITY_DISCLOSURE
        : (VELOCITY_REPRESENTATION[storedUnit] ?? VELOCITY_REPRESENTATION['tracker-unit']!),
    leftRightSplit: {
      left: landedRows.filter((r) => r.expectedHand === 'left').length,
      right: landedRows.filter((r) => r.expectedHand === 'right').length,
    },
    avgRatePerMin: activeMinutes > 0 ? round1(totalPunches / activeMinutes) : 0,
    mostProductiveRound,
    ...(bestVelocityRound === undefined ? {} : { bestVelocityRound }),
    // Absent rather than zero when there was nothing to match against
    // (D11): zero would read as total failure.
    ...(expectedCount > 0
      ? { handSequenceMatchPercent: round1((matchedCount / expectedCount) * 100) }
      : {}),
    sequenceScoreLabel: sequenceScoreLabel(tier),
    capabilityTier: tier,
    extraPunches,
    adaptationCount: adaptations.length,
    perRound,
    recipeName: args.recipeName ?? workout.id,
    seed: workout.recipe.seed,
    generatorVersion: workout.recipe.generatorVersion,
    calculationVersion: WORKOUT_SUMMARY_CALCULATION_VERSION,
  }
}

/**
 * Connection completeness — the share of the workout a tracker was
 * actually streaming for.
 *
 * Kept separate because it is the one figure that does *not* come from the
 * realized stream: it describes the radio, not the athlete. Presenting it
 * alongside their counts without that separation would invite reading a
 * dropout as a performance dip (D13).
 */
export function connectionCompleteness(
  connectedMs: number,
  totalActiveMs: number,
): number {
  if (totalActiveMs <= 0) return 0
  return round1(Math.min(100, (connectedMs / totalActiveMs) * 100))
}
