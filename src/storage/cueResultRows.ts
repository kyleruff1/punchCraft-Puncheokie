/**
 * Settled cue matches → `cue_results` rows (M33-08).
 *
 * Lives in the storage layer rather than the domain because the row shape
 * belongs to the schema: a domain module importing `CueResultRow` would
 * invert the dependency direction (spec §15.1).
 *
 * ## One row per expectation, always
 *
 * Every expected punch produces a row, including the ones nothing answered.
 * A missing row would be indistinguishable from a cue that was never
 * reached, and the summary could not tell "you did not throw this" from
 * "this was never asked of you".
 *
 * `expected_type` is always null on this hardware, and `'type-mismatch'` is
 * unreachable — the payload's type byte carries no device-portable meaning
 * (D12). Both stay in the schema for a future decoder.
 */

import { CALCULATION_VERSION } from '@domain/workout/versions'
import type { CueMatchResult } from '@domain/programs/CueMatcher'
import type { CueInstance } from '@domain/programs/CueTimeline'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'
import type { CueResultRow } from './repositories/WorkoutRepository'

/** A row before the session and workout ids are known. */
export type PendingCueResultRow = Omit<CueResultRow, 'sessionId' | 'generatedWorkoutId'>

export interface ToCueResultRowsArgs {
  cue: CueInstance
  result: CueMatchResult
  /**
   * Any events the row might reference, for velocity pass-through. Looked
   * up by the assignment's own event id, so this may be a bounded recent
   * window rather than exactly this cue's events — attribution comes from
   * the match, never from which events happened to be in the bucket.
   */
  events?: Iterable<TrackerPunchEvent>
  decoderVersion?: string
}

export function toCueResultRows(args: ToCueResultRowsArgs): PendingCueResultRow[] {
  const { cue, result, events = [] } = args
  const byId = new Map<string, TrackerPunchEvent>()
  for (const event of events) byId.set(event.id, event)

  // A count-scored burst has no expectations to enumerate (doc §14). Its
  // output is recorded as the round's count, not as a row per punch —
  // inventing rows here would fabricate expectations nobody was given.
  if (cue.scoring === 'count') return []

  return cue.expectedPunches.map((expected, expectedIndex) => {
    const assignment = result.assignments.find((a) => a.expectedIndex === expectedIndex)
    const event = assignment ? byId.get(assignment.eventId) : undefined

    return {
      blockId: cue.blockId,
      // A repeated block runs the same token indexes more than once, so the
      // pass is part of what identifies the row (migration 005).
      repeatIndex: cue.repeatIndex,
      tokenIndex: expected.tokenIndex,
      expectedHand: expected.hand,
      // Always null on FightCamp v1 (D12).
      expectedType: null,
      observedEventId: assignment?.eventId ?? null,
      // No assignment means nothing answered this call. `missed` is
      // deliberately ambiguous per D13 — it covers both "did not throw" and
      // "threw too softly for the tracker to transmit", which are the same
      // absence of evidence.
      outcome: assignment?.outcome ?? 'missed',
      offsetMs: assignment?.offsetMs ?? null,
      // Passed through exactly as received, never converted (spec §4.3).
      velocityRaw: event?.velocityRaw ?? null,
      velocityCalibrated: event?.velocityCalibrated ?? null,
      velocityUnit: event?.velocityUnit ?? null,
      capabilityTier: result.capabilityTier,
      decoderVersion:
        args.decoderVersion ?? event?.decoderVersion ?? result.decoderVersions[0] ?? 'unknown',
      calculationVersion: CALCULATION_VERSION,
    }
  })
}
