/**
 * Cue scoring (#131, doc §6).
 *
 * Turns one `CueMatchResult` into the numbers a surface may show, and — more
 * importantly — decides what those numbers are allowed to be *called*.
 *
 * ## The rule this module exists to enforce
 *
 * A hand-pattern score is labelled **hand-sequence match** at every tier
 * except `hand-distinct-type` (D4, spec §13.3). On FightCamp v1 the tracker
 * cannot tell a jab from a lead hook, so `1-2-3` and `1-2b-3` — both
 * left-right-left — are indistinguishable to it and score identically. The
 * cue told the athlete which to throw; the tracker only confirms a hand
 * fired in the window. Calling that "technique accuracy" would be a claim
 * the hardware cannot support.
 *
 * ## Absent, not zero
 *
 * A dimension the tier cannot supply is **omitted and explained**, never
 * scored as zero (D11, doc §21). A zero reads as athlete failure; the truth
 * is that nothing measured it. Every omission leaves a `capabilityGaps`
 * entry so the surface can say why a number is missing rather than showing
 * an unexplained blank.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import { sequenceScoreLabel, tierScoresTechnique, type CapabilityTier } from '../workout/capabilityTier'
import { CALCULATION_VERSION } from '../workout/versions'
import type { CueMatchResult } from './CueMatcher'
import type { TrackerPunchEvent } from '../punch/PunchEvent'
import { TYPE_PROFILE_VERSION, formBonus, type DeviceTypeProfile } from '../punch/typeConcordance'
import type { ExpectedPunch } from './CueTimeline'

/**
 * How close to the called moment a punch must land to count as on-time.
 *
 * Distinct from the acceptance window, which is far wider: the window
 * decides whether a punch belongs to the cue at all, while this decides
 * whether it was *on the beat*. A placeholder until M36-03 tunes it against
 * real punching.
 */
export const TIMING_TIGHT_MS = 150

export type SequenceScoreLabel = ReturnType<typeof sequenceScoreLabel>

export interface CueScore {
  cueId: string
  /** `technique match` only at `hand-distinct-type` (D4). */
  label: SequenceScoreLabel
  /** Share of expected punches that got any punch at all. */
  completionPct: number
  /** Share of expected punches answered with the correct hand. */
  correctHandPct: number
  /** Share of *landed* punches inside `TIMING_TIGHT_MS` of their token. */
  timingWindowPct: number
  /**
   * Secondary and caveated: broad technique families are a decoder guess,
   * never a verified measurement. Present only at a type-capable tier.
   */
  broadTypeAgreementPct?: number
  /** Only when the source reports velocity. */
  targetZonePct?: number
  /** Tracker-reported velocity, in tracker units. */
  averageVelocity?: number
  extraCount: number
  expectedCount: number
  /**
   * Additive form bonus (#formBonus). Never subtracts from anything above
   * it — the type byte is too device-local to accuse anyone with, so it is
   * wired so that it can only congratulate.
   */
  formBonus: number
  /** How many punches earned it, for the surface to celebrate individually. */
  formAgreements: number
  typeProfileVersion: string
  capabilityTier: CapabilityTier
  decoderVersions: string[]
  calculationVersion: string
  /** Why a dimension is missing — so a blank is never unexplained (D11). */
  capabilityGaps: string[]
  /** Shown wherever `broadTypeAgreementPct` is. */
  broadTypeCaveat?: string
}

export interface ScoreCueOptions {
  /**
   * The cue's expectations, so an event can be paired with the technique it
   * was asked for. Without this the form bonus is always zero.
   */
  expectedPunches?: readonly ExpectedPunch[]
  /** Override the device profiles; defaults to the H12-derived set. */
  typeProfiles?: readonly DeviceTypeProfile[]
  /**
   * The events that were matched, for the velocity dimensions.
   *
   * Additive to the binding signature: `CueMatchResult` deliberately carries
   * no velocity — the matcher is about hand and timing — so without this
   * `averageVelocity` and `targetZonePct` could never be computed.
   */
  events?: readonly TrackerPunchEvent[]
  /** Tracker-unit band a punch should land in, when the recipe asks for one. */
  targetVelocityRange?: { min: number; max: number }
}

const BROAD_TYPE_CAVEAT =
  'Technique families are a decoder estimate and are not verified by the tracker.'

/** Percentage on 0-100, rounded to one decimal so it round-trips cleanly. */
function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

export function scoreCue(
  result: CueMatchResult,
  tier: CapabilityTier,
  options: ScoreCueOptions = {},
): CueScore {
  const expectedCount = result.assignments.length + result.missedExpectedIndexes.length
  const capabilityGaps: string[] = []

  const landed = result.assignments.length
  const correctHand = result.assignments.filter((a) => a.outcome !== 'hand-mismatch').length
  const onTime = result.assignments.filter((a) => Math.abs(a.offsetMs) <= TIMING_TIGHT_MS).length

  // Pair each assignment with the technique its slot asked for, so the
  // bonus can only be earned against something actually prescribed.
  const byEventId = new Map((options.events ?? []).map((e) => [e.id, e]))
  const pairs = result.assignments
    .filter((a) => a.outcome !== 'hand-mismatch')
    .flatMap((a) => {
      const event = byEventId.get(a.eventId)
      const expected = options.expectedPunches?.[a.expectedIndex]
      if (!event) return []
      return [{ event, expectedType: expected?.type }]
    })
  const agreements = formBonus(
    pairs,
    ...(options.typeProfiles ? ([options.typeProfiles] as const) : ([] as const)),
  )

  const score: CueScore = {
    cueId: result.cueId,
    label: sequenceScoreLabel(tier),
    completionPct: pct(landed, expectedCount),
    correctHandPct: pct(correctHand, expectedCount),
    // Denominator is what landed, not what was called: an unthrown punch is
    // a completion problem, and counting it as bad timing would penalise the
    // same miss twice.
    timingWindowPct: pct(onTime, landed),
    extraCount: result.extras.length,
    expectedCount,
    formBonus: agreements,
    formAgreements: agreements,
    typeProfileVersion: TYPE_PROFILE_VERSION,
    capabilityTier: tier,
    decoderVersions: result.decoderVersions,
    calculationVersion: CALCULATION_VERSION,
    capabilityGaps,
  }

  // -- technique, only where the tier supports it ---------------------------

  if (tierScoresTechnique(tier)) {
    const typed = result.assignments.filter((a) => a.outcome !== 'hand-mismatch')
    const agreeing = typed.filter((a) => a.outcome === 'matched').length
    score.broadTypeAgreementPct = pct(agreeing, typed.length)
    score.broadTypeCaveat = BROAD_TYPE_CAVEAT
  } else {
    capabilityGaps.push(
      'Technique agreement is not available: this tracker reports no usable technique.',
    )
  }

  // -- velocity, only where the source reports it ---------------------------

  const velocities = (options.events ?? [])
    .filter((e) => typeof e.velocityRaw === 'number' && e.velocityUnit !== 'unknown')
    .map((e) => e.velocityRaw as number)

  if (velocities.length > 0) {
    score.averageVelocity =
      Math.round((velocities.reduce((sum, v) => sum + v, 0) / velocities.length) * 10) / 10

    const range = options.targetVelocityRange
    if (range) {
      const inZone = velocities.filter((v) => v >= range.min && v <= range.max).length
      score.targetZonePct = pct(inZone, velocities.length)
    } else {
      capabilityGaps.push('No target velocity zone was requested for this block.')
    }
  } else {
    capabilityGaps.push(
      'Velocity dimensions are not available: this source reports no tracker-reported velocity.',
    )
  }

  return score
}

/**
 * Aggregate several cue scores into a round-level view.
 *
 * Percentages are recomputed from the underlying counts rather than averaged
 * — averaging percentages would weight a one-punch cue the same as a
 * five-punch one.
 */
export interface RoundScore {
  label: SequenceScoreLabel
  completionPct: number
  correctHandPct: number
  timingWindowPct: number
  expectedCount: number
  landedCount: number
  extraCount: number
  capabilityTier: CapabilityTier
  calculationVersion: string
}

export function scoreRound(scores: readonly CueScore[], tier: CapabilityTier): RoundScore {
  let expected = 0
  let landed = 0
  let correctHand = 0
  let onTime = 0
  let extras = 0

  for (const score of scores) {
    expected += score.expectedCount
    const cueLanded = Math.round((score.completionPct / 100) * score.expectedCount)
    landed += cueLanded
    correctHand += Math.round((score.correctHandPct / 100) * score.expectedCount)
    onTime += Math.round((score.timingWindowPct / 100) * cueLanded)
    extras += score.extraCount
  }

  return {
    label: sequenceScoreLabel(tier),
    completionPct: pct(landed, expected),
    correctHandPct: pct(correctHand, expected),
    timingWindowPct: pct(onTime, landed),
    expectedCount: expected,
    landedCount: landed,
    extraCount: extras,
    capabilityTier: tier,
    calculationVersion: CALCULATION_VERSION,
  }
}
