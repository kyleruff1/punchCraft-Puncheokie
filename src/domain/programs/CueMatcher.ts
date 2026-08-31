/**
 * Cue matching (#130, doc §6).
 *
 * Assigns tracker punch events to the expected punches of one cue. This is
 * the module that decides what "you hit that" means, so its restraint
 * matters more than its cleverness.
 *
 * ## What it refuses to do
 *
 * - **It never recomputes a window.** `expandTimeline` (M32-03) already
 *   applied the graces and clamped to the round's work interval, so grace
 *   arithmetic appears nowhere here. Two places computing the same window
 *   is how a punch ends up accepted on one screen and rejected on another.
 * - **It never drops an extra.** A punch the athlete threw happened,
 *   whether or not a cue was waiting for it. Extras carry their event ids
 *   through so the UI can show them and the summary can count them
 *   (doc §21, spec §13.6).
 * - **It never claims a technique the tier cannot support.** A
 *   `type-mismatch` is only possible when the decoder actually reported a
 *   type, which on FightCamp v1 it never does (D12).
 *
 * ## Order and greed
 *
 * Events are matched in event-time order, each to the earliest unfilled
 * expectation whose window contains it. One event fills at most one slot.
 * That is deliberately simple: a smarter assignment could pair punches to
 * slots more flatteringly, but the athlete's experience is sequential — the
 * first punch answers the first call — and a matcher that reorders reality
 * to raise a score is not measuring anything.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports, and no
 * `Date.now()` (spec §15.1, §18.3).
 */

import type { CapabilityTier } from '../workout/capabilityTier'
import { tierScoresTechnique } from '../workout/capabilityTier'
import type { CueInstance, ExpectedPunch } from './CueTimeline'
import type { PunchType, TrackerPunchEvent } from '../punch/PunchEvent'

export type MatchOutcome = 'matched' | 'hand-mismatch' | 'type-mismatch'

export interface CueAssignment {
  expectedIndex: number
  eventId: string
  outcome: MatchOutcome
  /** Signed offset from the token's scheduled moment; negative is early. */
  offsetMs: number
}

export interface CueExtra {
  eventId: string
  eventTimeMs: number
  /**
   * Why this punch earned no slot, when the reason is known.
   *
   * `'hand-mismatch'` means it answered a live expectation with the wrong
   * glove. Since D18 that no longer consumes the ordinal — the athlete may
   * still answer it — so the punch lands here rather than as an assignment.
   * Recording the reason is what keeps "threw it with the wrong hand"
   * distinguishable from "never threw it", which the assignment list alone can
   * no longer tell apart.
   */
  reason?: 'hand-mismatch'
}

export interface CueMatchResult {
  cueId: string
  assignments: CueAssignment[]
  missedExpectedIndexes: number[]
  /** Punches with no slot. Visible, never merged away (doc §21). */
  extras: CueExtra[]
  capabilityTier: CapabilityTier
  /** Every decoder that contributed, so a result stays recalculable. */
  decoderVersions: string[]
}

/**
 * When a tracker timestamp can be trusted for ordering.
 *
 * A recovered event (delivered after a reconnection) may arrive long after
 * it happened, so receive time says nothing useful about when the punch
 * landed. Its tracker timestamp does — but only if the tracker reported
 * one. Without that, the event cannot be placed in the sequence and is
 * treated as an extra rather than guessed into a slot (H12, doc §6).
 */
function eventTimeMs(event: TrackerPunchEvent): number | null {
  if (event.recovered) {
    return typeof event.trackerTimestampMs === 'number' ? event.trackerTimestampMs : null
  }
  return event.receivedMonotonicTimeMs
}

export class CueMatcher {
  private readonly tier: CapabilityTier

  constructor(tier: CapabilityTier) {
    this.tier = tier
  }

  /**
   * @param opts.gate how a punch qualifies for the cue.
   *
   * `'window'` (the default) keeps the original rule: the punch must land
   * inside the cue's acceptance window. `'open'` credits any event the caller
   * supplies, because the caller already scoped them — `LiveCueMatcher` only
   * buffers events that arrived while the cue's window was open, so re-testing
   * the times here would apply a stricter rule than the live pass and
   * manufacture a correction on every set (D18).
   *
   * The two passes **must** agree. A divergence is not a cosmetic difference:
   * `LiveCueMatcher.correctionsFor` diffs them, and every mismatch is logged as
   * a corrected match.
   */
  match(
    cue: CueInstance,
    events: readonly TrackerPunchEvent[],
    opts: { gate?: 'window' | 'open' } = {},
  ): CueMatchResult {
    const gate = opts.gate ?? 'window'
    const assignments: CueAssignment[] = []
    const extras: CueExtra[] = []
    const filled = new Set<number>()
    const decoderVersions = new Set<string>()

    // Order by the time each event actually happened. A recovered event
    // without a usable timestamp is unorderable, so it is set aside as an
    // extra rather than being slotted by its arrival time.
    const timed: Array<{ event: TrackerPunchEvent; atMs: number }> = []
    for (const event of events) {
      decoderVersions.add(event.decoderVersion)
      const atMs = eventTimeMs(event)
      if (atMs === null) {
        extras.push({ eventId: event.id, eventTimeMs: event.receivedMonotonicTimeMs })
        continue
      }
      timed.push({ event, atMs })
    }
    timed.sort((a, b) => a.atMs - b.atMs || a.event.id.localeCompare(b.event.id))

    for (const { event, atMs } of timed) {
      // Windows arrive already clamped from expandTimeline — no grace math
      // here, deliberately. Under `gate: 'open'` the caller has already scoped
      // the events to the cue's open window, so the test is skipped rather
      // than applied twice.
      if (gate === 'window' && (atMs < cue.windowStartMs || atMs > cue.windowEndMs)) {
        extras.push({ eventId: event.id, eventTimeMs: atMs })
        continue
      }

      const expectedIndex = this.nextUnfilledIndex(cue, filled)
      if (expectedIndex === null) {
        // Every slot is taken: the athlete threw more than was called. That
        // is information, not an error (doc §21).
        extras.push({ eventId: event.id, eventTimeMs: atMs })
        continue
      }

      const expected = cue.expectedPunches[expectedIndex] as ExpectedPunch
      const outcome = this.outcomeFor(expected, event)

      // A wrong hand leaves the ordinal open for a retry (D18), matching the
      // live pass. Without this the two disagree on every hand error.
      if (outcome === 'hand-mismatch') {
        extras.push({ eventId: event.id, eventTimeMs: atMs, reason: 'hand-mismatch' })
        continue
      }

      filled.add(expectedIndex)
      assignments.push({
        expectedIndex,
        eventId: event.id,
        outcome,
        offsetMs: atMs - this.scheduledMomentMs(cue, expected),
      })
    }

    const missedExpectedIndexes = cue.expectedPunches
      .map((_, index) => index)
      .filter((index) => !filled.has(index))

    return {
      cueId: cue.id,
      assignments,
      missedExpectedIndexes,
      extras,
      capabilityTier: this.tier,
      decoderVersions: [...decoderVersions].sort(),
    }
  }

  // -------------------------------------------------------------------------

  private nextUnfilledIndex(cue: CueInstance, filled: ReadonlySet<number>): number | null {
    for (let i = 0; i < cue.expectedPunches.length; i++) {
      if (!filled.has(i)) return i
    }
    return null
  }

  /**
   * When this expectation's token was expected to LAND (the reference
   * used for the signed match offset).
   *
   * M39-V1c plumbing (2026-08-30): engine mode returns the authored
   * expected-strike time (visualAtMs + `EXPECTED_STRIKE_DELAY_MS`) so
   * scoring measures against "when the strike should land" rather than
   * "when the coach said the token." For legacy cues (no
   * `expectedStrikeOffsetsMs`) the moment is `scheduledStartMs +
   * tokenOffsetsMs[i]` — the identical value produced by the pre-M39
   * scheduledMomentMs.
   */
  private scheduledMomentMs(cue: CueInstance, expected: ExpectedPunch): number {
    const offset =
      cue.expectedStrikeOffsetsMs?.[expected.tokenIndex] ??
      cue.tokenOffsetsMs[expected.tokenIndex] ??
      0
    return cue.scheduledStartMs + offset
  }

  /**
   * Hand first, then technique — and technique only when the tier supports
   * it. A hand mismatch and a type mismatch are separate outcomes (doc §6):
   * throwing the wrong hand is a different mistake from throwing the right
   * hand with the wrong technique, and collapsing them would tell the
   * athlete nothing actionable.
   */
  private outcomeFor(expected: ExpectedPunch, event: TrackerPunchEvent): MatchOutcome {
    if (event.hand !== expected.hand) return 'hand-mismatch'

    if (!tierScoresTechnique(this.tier)) return 'matched'

    const observed = event.punchType
    // No reported technique means nothing to disagree with. On FightCamp v1
    // this is always the case, so `type-mismatch` is unreachable (D12).
    if (!isReportedType(observed)) return 'matched'
    if (expected.type === undefined) return 'matched'

    return sameFamily(observed, expected.type) ? 'matched' : 'type-mismatch'
  }
}

function isReportedType(type: PunchType | undefined): type is PunchType {
  return typeof type === 'string' && type !== 'unknown'
}

/**
 * Broad-family comparison.
 *
 * `'power'` is a vendor classification, not a technique family, so it never
 * contradicts a prescribed technique (spec §12.5).
 */
function sameFamily(observed: PunchType, expectedType: PunchType): boolean {
  if (observed === 'power' || expectedType === 'power') return true
  return observed === expectedType
}

/** Convenience for callers aggregating a round. */
export function matchedCount(result: CueMatchResult): number {
  return result.assignments.filter((a) => a.outcome === 'matched').length
}
