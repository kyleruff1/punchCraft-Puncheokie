/**
 * Live cue matching (#188, doc §21).
 *
 * Sits between the punch source and the runner, turning the batch
 * `CueMatcher` (#130) into the streaming shape a live screen needs.
 *
 * ## Why an adapter exists at all
 *
 * Two requirements pull in opposite directions. Doc §21 wants per-punch
 * feedback *now* — the token brightens as the punch lands. But the
 * authoritative match cannot be decided until the window closes, because
 * ordering depends on events that have not arrived yet: a recovered event
 * may turn up seconds later carrying a tracker timestamp that places it
 * earlier in the sequence.
 *
 * So this does both, and keeps them honest about which is which:
 *
 * - **Provisional**, on every punch: greedily credit the next unfilled
 *   expectation, using exactly the matcher's own rules. This drives the
 *   token, the counters and the haptic.
 * - **Authoritative**, on window close: run `CueMatcher.match` over
 *   everything buffered for that cue and emit the settled result. This is
 *   what gets scored and later persisted.
 *
 * When they disagree — which only a recovered or out-of-order event can
 * cause — the settled result wins and the disagreement is reported rather
 * than silently smoothed over.
 *
 * ## Extras
 *
 * A punch with no slot is still a punch. Extras are always emitted and
 * always counted; the recipe's policy travels with them so the surface can
 * present them differently, never so they can be discarded (spec §13.6).
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import { CueMatcher, type CueMatchResult, type MatchOutcome } from './CueMatcher'
import { scoreCue, type CueScore, type ScoreCueOptions } from './cueScoring'
import type { CueEvent } from './CueState'
import type { CueInstance } from './CueTimeline'
import type { CapabilityTier } from '../workout/capabilityTier'
import type { ExtraPunchPolicy } from '../workout/WorkoutRecipe'
import type { TrackerPunchEvent } from '../punch/PunchEvent'

export interface LiveMatch {
  cueId: string
  expectedIndex: number
  eventId: string
  eventTimeMs: number
  outcome: MatchOutcome
  /** Tracker-reported velocity in tracker units, when the source has it. */
  velocityRaw?: number
}

export interface LiveExtra {
  /** The cue in flight when it landed, if any. */
  cueId?: string
  eventId: string
  eventTimeMs: number
  /** Carried so the surface can present it; never so it can be dropped. */
  policy: ExtraPunchPolicy
}

export interface LiveCount {
  cueId: string
  eventId: string
  eventTimeMs: number
  velocityRaw?: number
}

export type LiveMatcherEvent =
  | { type: 'match'; match: LiveMatch }
  | { type: 'count'; count: LiveCount }
  | { type: 'extra'; extra: LiveExtra }
  | {
      type: 'cue-settled'
      result: CueMatchResult
      score: CueScore
      /**
       * Provisional assignments the settled pass disagreed with. Normally
       * empty; non-empty means a late or recovered event reordered the cue.
       */
      corrections: LiveMatch[]
    }

export interface LiveCueMatcherOptions {
  tier: CapabilityTier
  extraPunchPolicy: ExtraPunchPolicy
  /** Passed through to scoring when the recipe asks for a velocity band. */
  targetVelocityRange?: ScoreCueOptions['targetVelocityRange']
}

interface OpenCue {
  cue: CueInstance
  events: TrackerPunchEvent[]
  provisional: LiveMatch[]
  filled: Set<number>
}

export class LiveCueMatcher {
  private readonly matcher: CueMatcher
  private readonly options: LiveCueMatcherOptions
  private readonly listeners = new Set<(e: LiveMatcherEvent) => void>()
  private readonly settled: CueMatchResult[] = []

  private open: OpenCue | null = null

  constructor(options: LiveCueMatcherOptions) {
    this.options = options
    this.matcher = new CueMatcher(options.tier)
  }

  subscribe(listener: (e: LiveMatcherEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Consumes the CueEngine's window lifecycle. Other events are ignored. */
  onCueEvent(event: CueEvent): void {
    if (event.type === 'cue-window-opened') {
      this.open = { cue: event.cue, events: [], provisional: [], filled: new Set() }
      return
    }

    if (event.type === 'cue-window-closed') {
      this.settle()
      return
    }

    // A cancelled cue never settles into a score — the athlete was told to
    // stop, so there is nothing to grade.
    if (event.type === 'cue-cancelled') this.open = null
  }

  onPunchEvent(event: TrackerPunchEvent): void {
    const open = this.open
    if (!open) {
      // Nothing is being called: a punch between combinations. Still real,
      // still counted.
      this.publish({
        type: 'extra',
        extra: {
          eventId: event.id,
          eventTimeMs: event.receivedMonotonicTimeMs,
          policy: this.options.extraPunchPolicy,
        },
      })
      return
    }

    open.events.push(event)

    // A count-scored cue has no expectations to fill: every punch during a
    // burst is output, and output is what it is judged on (doc §14). It is
    // reported as a count, never as an extra — calling a burst punch an
    // "extra" would be exactly backwards.
    if (open.cue.scoring === 'count') {
      this.publish({
        type: 'count',
        count: {
          cueId: open.cue.id,
          eventId: event.id,
          eventTimeMs: event.receivedMonotonicTimeMs,
          ...(typeof event.velocityRaw === 'number' && event.velocityUnit !== 'unknown'
            ? { velocityRaw: event.velocityRaw }
            : {}),
        },
      })
      return
    }

    // A recovered event cannot be placed provisionally — its position
    // depends on a tracker timestamp the settled pass will order properly.
    // Buffer it and say nothing yet rather than crediting the wrong slot.
    if (event.recovered) return

    const atMs = event.receivedMonotonicTimeMs
    const inWindow = atMs >= open.cue.windowStartMs && atMs <= open.cue.windowEndMs
    const expectedIndex = inWindow ? this.nextUnfilled(open) : null

    if (expectedIndex === null) {
      this.publish({
        type: 'extra',
        extra: {
          cueId: open.cue.id,
          eventId: event.id,
          eventTimeMs: atMs,
          policy: this.options.extraPunchPolicy,
        },
      })
      return
    }

    const expected = open.cue.expectedPunches[expectedIndex]!
    open.filled.add(expectedIndex)

    const match: LiveMatch = {
      cueId: open.cue.id,
      expectedIndex,
      eventId: event.id,
      eventTimeMs: atMs,
      // Hand is the only thing verifiable at this hardware's tier (D12);
      // the settled pass applies the full rule including technique.
      outcome: event.hand === expected.hand ? 'matched' : 'hand-mismatch',
      ...(typeof event.velocityRaw === 'number' && event.velocityUnit !== 'unknown'
        ? { velocityRaw: event.velocityRaw }
        : {}),
    }
    open.provisional.push(match)
    this.publish({ type: 'match', match })
  }

  /** Every settled result so far — what M33-08 persists as `cue_results`. */
  results(): CueMatchResult[] {
    return [...this.settled]
  }

  // -------------------------------------------------------------------------

  private nextUnfilled(open: OpenCue): number | null {
    for (let i = 0; i < open.cue.expectedPunches.length; i++) {
      if (!open.filled.has(i)) return i
    }
    return null
  }

  private settle(): void {
    const open = this.open
    this.open = null
    if (!open) return

    // A count-scored cue is not matched token by token; the batch matcher
    // would report every punch as an extra, which is the wrong story.
    const result =
      open.cue.scoring === 'count'
        ? this.countScoredResult(open)
        : this.matcher.match(open.cue, open.events)
    this.settled.push(result)

    const score = scoreCue(result, this.options.tier, {
      events: open.events,
      ...(this.options.targetVelocityRange
        ? { targetVelocityRange: this.options.targetVelocityRange }
        : {}),
    })

    this.publish({
      type: 'cue-settled',
      result,
      score,
      corrections: this.correctionsFor(open, result),
    })
  }

  /**
   * Provisional assignments the settled pass contradicted.
   *
   * Reported rather than hidden: a non-empty list means a late or recovered
   * event reordered the cue after the athlete already saw feedback, and a
   * surface that silently rewrote the tokens would be lying about what it
   * had shown.
   */
  private correctionsFor(open: OpenCue, result: CueMatchResult): LiveMatch[] {
    const settledByEvent = new Map(result.assignments.map((a) => [a.eventId, a]))
    return open.provisional.filter((p) => {
      const settledAssignment = settledByEvent.get(p.eventId)
      if (!settledAssignment) return true
      return (
        settledAssignment.expectedIndex !== p.expectedIndex ||
        settledAssignment.outcome !== p.outcome
      )
    })
  }

  /**
   * A settled burst, expressed in the same shape as a matched cue.
   *
   * There are no assignments and no misses — the cue asked for output, not
   * a sequence. Every punch is carried as an extra in the structural sense
   * (unassigned to a slot), which is what keeps the count visible to
   * anything aggregating the round without pretending it was a sequence.
   */
  private countScoredResult(open: OpenCue): CueMatchResult {
    return {
      cueId: open.cue.id,
      assignments: [],
      missedExpectedIndexes: [],
      extras: open.events.map((e) => ({
        eventId: e.id,
        eventTimeMs: e.receivedMonotonicTimeMs,
      })),
      capabilityTier: this.options.tier,
      decoderVersions: [...new Set(open.events.map((e) => e.decoderVersion))].sort(),
    }
  }

  private publish(event: LiveMatcherEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}
