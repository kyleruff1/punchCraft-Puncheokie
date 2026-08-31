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
import { typeConcordance, type Concordance, type DeviceTypeProfile } from '../punch/typeConcordance'

export interface LiveMatch {
  cueId: string
  expectedIndex: number
  eventId: string
  eventTimeMs: number
  outcome: MatchOutcome
  /** Tracker-reported velocity in tracker units, when the source has it. */
  velocityRaw?: number
  /**
   * Whether the device-local type byte agreed with the prescribed
   * technique. `'agree'` is the only actionable value — it earns the gold
   * affirmation. `'disagree'` is never shown and never subtracts.
   */
  concordance: Concordance
  /** True only on `'agree'`: the surface's cue to celebrate this punch. */
  affirmed: boolean
}

export interface LiveExtra {
  /** The cue in flight when it landed, if any. */
  cueId?: string
  eventId: string
  eventTimeMs: number
  /** Carried so the surface can present it; never so it can be dropped. */
  policy: ExtraPunchPolicy
  /**
   * Why this punch earned no slot, when the reason is known.
   *
   * `'hand-mismatch'` means it answered a live expectation with the wrong
   * glove, so the ordinal is still open (D18). Absent means the set simply had
   * nothing left to fill, or nothing was being called. A surface may
   * acknowledge the distinction — never punitively: doc §13's no-red rule
   * holds, and a miss is shown by the absence of green, not by a mark.
   */
  reason?: 'hand-mismatch'
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
  /** Device profiles for the form bonus; defaults to the H12-derived set. */
  typeProfiles?: readonly DeviceTypeProfile[]
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

  /**
   * Consumes the CueEngine's window lifecycle. Other events are ignored.
   *
   * ## Cue identity (2026-08-31 forensics fix)
   *
   * Acceptance windows OVERLAP by `DEFAULT_GRACE_BEFORE_MS` (200 ms) for
   * every consecutive cue pair: `truncateWindowsAtNextCue` ends cue P at
   * `next.scheduledStartMs` while cue N's window already opened at
   * `scheduledStartMs - graceBefore`. So the engine emits
   * `cue-window-opened(N)` BEFORE `cue-window-closed(P)`.
   *
   * The previous code held one unkeyed `open` slot:
   *   - opening N silently DISCARDED P (never settled — no score, no
   *     `cue-settled`, no completed marks for the athlete's row), and
   *   - closing P then settled N and nulled the slot. `windowOpened` is
   *     latched per runtime, so N never re-opened: every later punch fell
   *     to the `!open` branch and was published as `extra`.
   *
   * Net effect on-glass: after the first cue of a round the matcher was
   * orphaned — no cue ever completed, the ring row ran on the beat cursor
   * alone, and combos "started well then went wrong" (Kyle, 2026-08-31).
   *
   * Both transitions are now cue-id-keyed: opening a different cue settles
   * the outgoing one first, and a close only settles the cue it names.
   */
  onCueEvent(event: CueEvent): void {
    if (event.type === 'cue-window-opened') {
      // A new window while another is still open = the 200 ms overlap.
      // Settle the outgoing cue rather than dropping it on the floor.
      if (this.open && this.open.cue.id !== event.cue.id) this.settle()
      this.open = { cue: event.cue, events: [], provisional: [], filled: new Set() }
      return
    }

    if (event.type === 'cue-window-closed') {
      // Only settle the cue this close names. A late close for a cue that
      // already settled (via the overlap path above) must not consume the
      // cue that is currently open.
      if (this.open && this.open.cue.id !== event.cue.id) return
      this.settle()
      return
    }

    // A cancelled cue never settles into a score — the athlete was told to
    // stop, so there is nothing to grade. Same identity rule.
    if (event.type === 'cue-cancelled') {
      if (this.open && this.open.cue.id !== event.cue.id) return
      this.open = null
    }
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

    // Credit is presence, not arithmetic (D18). The cue's window brackets this
    // method — nothing is open before `cue-window-opened` or after
    // `cue-window-closed` — so a punch thrown while the set is on screen is
    // creditable however late in the window it lands. Timing gates nothing.
    const atMs = event.receivedMonotonicTimeMs
    const expectedIndex = this.nextUnfilled(open)

    // Every expectation already answered: the athlete threw more than the set
    // asked for. Still a punch, still counted.
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

    // A wrong hand does not consume the slot (D18). It used to: the index was
    // filled before the hand was even examined, which had two bad consequences.
    // The set could then never reach `expectedPunches.length` matches, so the
    // completion reward became permanently unreachable after a single hand
    // error; and because a completed set ends early, burning a slot turned a
    // recoverable mistake into a guaranteed timeout — punishing the athlete
    // with a slower workout for the thing they are here to practise. The punch
    // is reported as an extra carrying its reason, and the ordinal stays open
    // for the correct hand. Nothing is lost: extras are always counted.
    if (event.hand !== expected.hand) {
      this.publish({
        type: 'extra',
        extra: {
          cueId: open.cue.id,
          eventId: event.id,
          eventTimeMs: atMs,
          policy: this.options.extraPunchPolicy,
          reason: 'hand-mismatch',
        },
      })
      return
    }

    open.filled.add(expectedIndex)
    const outcome: MatchOutcome = 'matched'

    // Only a correct hand can earn the flourish: congratulating the type
    // byte on a punch thrown with the wrong glove would celebrate the one
    // thing that was definitely wrong.
    const concordance: Concordance =
      outcome === 'matched'
        ? typeConcordance(
            event,
            expected.type,
            ...(this.options.typeProfiles ? ([this.options.typeProfiles] as const) : ([] as const)),
          )
        : 'unknown'

    const match: LiveMatch = {
      cueId: open.cue.id,
      expectedIndex,
      eventId: event.id,
      eventTimeMs: atMs,
      // Hand is the only thing verifiable at this hardware's tier (D12);
      // the settled pass applies the full rule including technique.
      outcome,
      concordance,
      affirmed: concordance === 'agree',
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
    //
    // `gate: 'open'` because `open.events` are already exactly the punches that
    // arrived while this cue's window was open — re-testing their times would
    // apply a stricter rule than the live pass just applied and report a
    // correction for every one of them (D18).
    const result =
      open.cue.scoring === 'count'
        ? this.countScoredResult(open)
        : this.matcher.match(open.cue, open.events, { gate: 'open' })
    this.settled.push(result)

    const score = scoreCue(result, this.options.tier, {
      events: open.events,
      expectedPunches: open.cue.expectedPunches,
      ...(this.options.typeProfiles ? { typeProfiles: this.options.typeProfiles } : {}),
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
