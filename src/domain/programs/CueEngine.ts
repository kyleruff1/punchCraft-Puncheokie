/**
 * Cue engine (M32-04, doc §20).
 *
 * Walks a round's cue timeline and drives every cue through the doc §20
 * lifecycle, emitting the events the live screen, the matcher, the
 * announcer and the pacing engine consume.
 *
 * ## The time base is the thing to understand
 *
 * Every scheduling decision compares against `workElapsedMs` — the
 * SessionEngine's round work clock, which is **frozen while paused**. The
 * monotonic clock is written only into `*ActualMs` fields, never used to
 * decide whether something is due.
 *
 * That is why a pause needs no offset shifting anywhere in this file: the
 * work clock simply stops advancing, so the cue stops advancing with it.
 * The alternative — recording a pause instant and subtracting it from every
 * later comparison — is the same behaviour with an accumulating error and a
 * dozen places to get it wrong. (Settled decision; do not re-litigate.)
 *
 * The engine does not own work/rest/pause. Those belong to the §18.1
 * SessionEngine; this composes with it through `onSessionPhase`.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports, and no
 * `Date.now()` (spec §15.1, §18.3).
 */

import type { MonotonicClock } from '../time/MonotonicClock'
import type { CueInstance, RoundTimeline } from './CueTimeline'
import { DEFAULT_REP_ID, strikeIdFor } from '../strikes/strikeCatalog'
import {
  TERMINAL_STATUSES,
  type CueEvent,
  type CueEventType,
  type CueStatus,
  type CueTimestamps,
  type SessionPhaseEvent,
} from './CueState'

export interface CueEngineLeadTimes {
  previewMs: number
  announceMs: number
  /** Doc §18.3's T−0.10s ready tone / contracting ring. */
  readyToneMs: number
}

export interface CueEngineOptions {
  leadTimes: CueEngineLeadTimes
  clock: MonotonicClock
}

/** Doc §18 defaults; tuned against real punching in M36-03. */
export const DEFAULT_LEAD_TIMES: CueEngineLeadTimes = {
  previewMs: 1_500,
  announceMs: 750,
  readyToneMs: 100,
}

export interface CueSnapshot {
  current?: CueInstance
  next?: CueInstance
  status: CueStatus
  remainingMs: number
  /**
   * True when the round has no further cues scheduled — the athlete is in
   * free work until the bell. Distinct from an ordinary `gap` (which has a
   * `next`): the stage shows a free-work state rather than latching the
   * last finished cue forever, which read as a freeze on the bag (M2).
   */
  freeWork?: boolean
}

/** How a cue finished, kept separately because the status becomes `gap`. */
export type CueOutcome = 'completed' | 'expired' | 'cancelled'

export interface CueResult {
  cue: CueInstance
  outcome: CueOutcome
  matchedCount: number
  expectedCount: number
  timestamps: CueTimestamps
  /** Punches counted during a count-scored cue; 0 for sequence cues. */
  countedPunches: number
}

interface CueRuntime {
  cue: CueInstance
  status: CueStatus
  /** Tracker punches seen during a count-scored cue (doc §14). */
  counted: number
  /** Status to restore when a suspension clears. */
  priorStatus?: CueStatus
  timestamps: CueTimestamps
  /**
   * StrikeIds already fired (M39-V2 Phase 2). Migrated from
   * `Set<number>` keyed by tokenIndex to `Set<string>` keyed by
   * strikeId so the two `1`s in `1-1-2` are distinguishable — the
   * former had them collapse. Kept "fired" language to match the
   * event name.
   */
  firedTokens: Set<string>
  matched: Set<number>
  windowOpened: boolean
  readyFired: boolean
  outcome?: CueOutcome
}

// ---------------------------------------------------------------------------

export class CueEngine {
  private readonly timeline: RoundTimeline[]
  private readonly leadTimes: CueEngineLeadTimes
  private readonly clock: MonotonicClock
  private readonly listeners = new Set<(e: CueEvent) => void>()

  private runtimes: CueRuntime[] = []
  private roundIndex = -1
  private lastTickMs = -1
  private paused = false
  private trackerFault = false

  constructor(timeline: RoundTimeline[], opts: CueEngineOptions) {
    this.timeline = timeline
    this.leadTimes = opts.leadTimes
    this.clock = opts.clock
    assertWindowsClamped(timeline)
  }

  subscribe(listener: (e: CueEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // -- session composition --------------------------------------------------

  onSessionPhase(e: SessionPhaseEvent): void {
    switch (e.type) {
      case 'work-entered':
        this.loadRound(e.roundIndex)
        break
      case 'paused':
        this.paused = true
        this.applySuspension()
        break
      case 'resumed':
        this.paused = false
        this.releaseSuspension()
        break
      case 'rest-entered':
      case 'finishing':
      case 'cancelled':
        // Immediate stop (doc §25): nothing lingers into rest.
        this.cancelRemaining()
        break
    }
  }

  notifyTrackerFault(active: boolean): void {
    this.trackerFault = active
    if (active) this.applySuspension()
    else this.releaseSuspension()
  }

  // -- the tick -------------------------------------------------------------

  /**
   * Advance to `workElapsedMs`. Idempotent per value, and a backwards tick
   * is ignored rather than throwing — a stalled caller should not end a
   * workout mid-round.
   */
  tick(workElapsedMs: number): void {
    if (workElapsedMs < this.lastTickMs) return
    // While suspended the work clock is frozen anyway; refusing to advance
    // makes a stray tick harmless rather than subtly wrong.
    if (this.isSuspended()) return
    this.lastTickMs = workElapsedMs

    for (const runtime of this.runtimes) {
      this.advance(runtime, workElapsedMs)
    }

    this.assertSingleActive()
  }

  /** Called by CueMatcher when a tracker event is credited to an expectation. */
  notifyMatch(cueId: string, expectedIndex: number, eventTimeMs: number): void {
    const runtime = this.runtimes.find((r) => r.cue.id === cueId)
    if (!runtime) return
    runtime.matched.add(expectedIndex)
    runtime.timestamps.trackerEventTimesMs.push(eventTimeMs)
  }

  // -- athlete controls -----------------------------------------------------

  skipCue(): void {
    const runtime = this.currentRuntime()
    if (!runtime) return
    this.finish(runtime, 'cancelled', 'cue-cancelled')
  }

  /**
   * Re-run the current cue at the next gap.
   *
   * The copy carries `repeatIndex + 1` and every timing field shifted by the
   * same delta, so the acceptance window keeps its shape rather than being
   * recomputed from graces the engine does not own.
   */
  repeatCue(): void {
    const runtime = this.currentRuntime() ?? this.lastFinishedRuntime()
    if (!runtime) return

    const round = this.timeline[this.roundIndex]
    if (!round) return

    const source = runtime.cue
    const startAt = Math.max(source.windowEndMs, this.lastTickMs)
    const delta = startAt - source.scheduledStartMs
    if (delta <= 0) return

    const copy: CueInstance = {
      ...source,
      id: `${source.blockId}#${source.repeatIndex + 1}r`,
      repeatIndex: source.repeatIndex + 1,
      previewAt: Math.max(0, source.previewAt + delta),
      announceAt: Math.max(0, source.announceAt + delta),
      scheduledStartMs: source.scheduledStartMs + delta,
      scheduledEndMs: source.scheduledEndMs + delta,
      windowStartMs: Math.max(0, source.windowStartMs + delta),
      windowEndMs: Math.min(round.workDurationMs, source.windowEndMs + delta),
    }

    this.runtimes.push(newRuntime(copy))
    this.runtimes.sort((a, b) => a.cue.scheduledStartMs - b.cue.scheduledStartMs)
  }

  // -- read model -----------------------------------------------------------

  snapshot(): CueSnapshot {
    const current = this.currentRuntime()
    // The cue that follows in schedule order — not the next *queued* one.
    // With lookahead the following cue is usually already previewing, and a
    // "next" that skipped it would show the athlete the wrong combination.
    const next = this.nextRuntimeAfter(current)

    if (current) {
      const remaining =
        current.status === 'active' || current.status === 'accepting'
          ? Math.max(0, current.cue.windowEndMs - this.lastTickMs)
          : Math.max(0, current.cue.scheduledStartMs - this.lastTickMs)
      return {
        current: current.cue,
        ...(next ? { next: next.cue } : {}),
        status: current.status,
        remainingMs: remaining,
      }
    }

    // Nothing in flight: the just-finished cue holds `gap` until the next
    // one previews. With NO next cue at all, the round is in free work —
    // holding the finished cue there latched a stale combination on screen
    // for the rest of the round (the "stagnant 1" freeze).
    const finished = this.lastFinishedRuntime()
    if (!next && finished) {
      return { status: 'gap', remainingMs: 0, freeWork: true }
    }
    const remainingMs = next ? Math.max(0, next.cue.previewAt - this.lastTickMs) : 0
    return {
      ...(finished ? { current: finished.cue } : {}),
      ...(next ? { next: next.cue } : {}),
      status: finished ? finished.status : 'queued',
      remainingMs,
    }
  }

  /** Per-cue outcomes so far — what the matcher and summary aggregate. */
  results(): CueResult[] {
    return this.runtimes
      .filter((r) => r.outcome !== undefined)
      .map((r) => ({
        cue: r.cue,
        outcome: r.outcome as CueOutcome,
        matchedCount: r.matched.size,
        expectedCount:
          r.cue.scoring === 'count'
            ? (r.cue.countScored?.targetPunches ?? 0)
            : r.cue.expectedPunches.length,
        timestamps: r.timestamps,
        countedPunches: r.counted,
      }))
  }

  // -- internals ------------------------------------------------------------

  private loadRound(roundIndex: number): void {
    const round = this.timeline[roundIndex]
    this.roundIndex = roundIndex
    this.lastTickMs = -1
    this.runtimes = round ? round.cues.map(newRuntime) : []
  }

  private isSuspended(): boolean {
    return this.paused || this.trackerFault
  }

  private advance(runtime: CueRuntime, t: number): void {
    if (runtime.status === 'suspended' || TERMINAL_STATUSES.has(runtime.status)) return

    // Window opening is independent of lifecycle status: with the default
    // graces the window opens at T−200ms, while the cue is still announcing.
    if (!runtime.windowOpened && t >= runtime.cue.windowStartMs) {
      runtime.windowOpened = true
      this.emit('cue-window-opened', runtime, t)
    }

    // Loop so one large tick can carry a cue through several states — a
    // dropped frame must not strand a cue in an earlier status.
    for (;;) {
      const before: CueStatus = runtime.status
      this.step(runtime, t)
      if (runtime.status === before) break
      if (TERMINAL_STATUSES.has(runtime.status)) break
    }
  }

  private step(runtime: CueRuntime, t: number): void {
    const { cue } = runtime

    switch (runtime.status) {
      case 'queued':
        if (t >= cue.previewAt) {
          runtime.status = 'previewing'
          runtime.timestamps.previewActualMs = this.clock.now()
          this.emit('cue-previewing', runtime, t)
        }
        return

      case 'previewing':
        if (t >= cue.announceAt) {
          runtime.status = 'announcing'
          runtime.timestamps.voiceActualMs = this.clock.now()
          this.emit('cue-announcing', runtime, t)
        }
        return

      case 'announcing': {
        const readyAt = cue.scheduledStartMs - this.leadTimes.readyToneMs
        if (!runtime.readyFired && t >= readyAt) {
          runtime.readyFired = true
          this.emit('cue-ready', runtime, t)
        }
        if (t >= cue.scheduledStartMs) {
          // A new combination being called ends the previous one's window,
          // whatever the timeline's geometry says (see `closeOverlapping`).
          this.closeOverlapping(runtime, t)
          runtime.status = 'active'
          runtime.timestamps.executionActualMs = this.clock.now()
          this.emit('cue-active', runtime, t)
        }
        return
      }

      case 'active':
        // A count-scored cue calls no tokens: the pattern is shown once and
        // repeated, so there is nothing to schedule (doc §14).
        if (cue.scoring !== 'count') this.fireDueTokens(runtime, t)
        // A window truncated at the next cue's start (see CueTimeline's
        // `truncateWindowsAtNextCue`) can close before the combination has
        // finished being called, so `active` has to be able to close too —
        // otherwise the cue would sit in flight past its own window.
        if (t >= cue.windowEndMs) this.closeWindow(runtime, t)
        // Every token has been called; the cue is now only waiting for
        // punches to land inside the window.
        else if (t >= cue.scheduledEndMs) runtime.status = 'accepting'
        return

      case 'accepting':
        if (cue.scoring !== 'count') this.fireDueTokens(runtime, t)
        if (t >= cue.windowEndMs) this.closeWindow(runtime, t)
        return

      default:
        return
    }
  }

  /**
   * Close a cue's acceptance window and settle its outcome.
   *
   * Partial completion is not failure (doc §21) — `expired` records what
   * landed, and nothing anywhere renders it as a red state.
   */
  /**
   * Credit a punch to a count-scored cue.
   *
   * Separate from `notifyMatch` because there is nothing to match: a burst
   * has no expectations, only a target. The runner calls this for every
   * punch that lands during one.
   */
  notifyCount(cueId: string, eventTimeMs: number): void {
    const runtime = this.runtimes.find((r) => r.cue.id === cueId)
    if (!runtime || runtime.cue.scoring !== 'count') return
    runtime.counted += 1
    runtime.timestamps.trackerEventTimesMs.push(eventTimeMs)
  }

  private closeWindow(runtime: CueRuntime, t: number): void {
    this.emit('cue-window-closed', runtime, t)
    const complete = this.isComplete(runtime)
    this.finish(
      runtime,
      complete ? 'completed' : 'expired',
      complete ? 'cue-completed' : 'cue-expired',
      t,
    )
  }

  /**
   * End any cue still in flight when the next one starts being thrown.
   *
   * Acceptance windows are *not* guaranteed to be disjoint. `graceAfterMs`
   * is added to a cue's end without regard to how soon the next cue begins,
   * so any block whose `gapBeats` converts to less than the grace produces
   * an overlap — and the shipped samples do exactly that once the cadence
   * differs from the one they were authored at, which is precisely what
   * PacingEngine's ±10–15% adjustment (M33-05) will do.
   *
   * The engine used to rely on the overlap never happening and threw from
   * `tick()` when it did, which killed the round. Ending the earlier cue
   * instead keeps the doc §20 "one cue in flight" model true by
   * construction and keeps a punch creditable to exactly one cue: the
   * athlete is being told the next combination, so the previous one's
   * window is over whatever the arithmetic says.
   */
  private closeOverlapping(entering: CueRuntime, t: number): void {
    for (const other of this.runtimes) {
      if (other === entering) continue
      if (other.status !== 'active' && other.status !== 'accepting') continue
      this.closeWindow(other, t)
    }
  }

  /**
   * Did this cue meet what it asked for?
   *
   * A count-scored cue is judged on output against its target; a sequence
   * cue on whether every expectation was answered. Either way falling short
   * is `expired` with the numbers recorded, never a failure state — nothing
   * renders it red (doc §21).
   */
  private isComplete(runtime: CueRuntime): boolean {
    if (runtime.cue.scoring === 'count') {
      const target = runtime.cue.countScored?.targetPunches ?? 0
      // A burst with no target cannot be fallen short of.
      return target <= 0 || runtime.counted >= target
    }
    return runtime.matched.size >= runtime.cue.expectedPunches.length
  }

  private fireDueTokens(runtime: CueRuntime, t: number): void {
    const { cue } = runtime
    // Capped at the window end so a coarse tick calls exactly the tokens a
    // fine one would: without the cap, a single large tick would fire the
    // tokens of a truncated cue that a 10ms tick never reaches, and the
    // event stream would depend on frame rate.
    const until = Math.min(t, cue.windowEndMs)
    // Ring-fire time reads from the beat grid (M39-V2 Phase 5-ii + iii:
    // the V1c authority chain retired). Engine-authored per-strike ticks
    // live on `SpineSchedule.compiled[cueId]` now — a follow-up Phase 5
    // pass wires the ring dispatcher to that shared authority; today's
    // ring fires still use the beat grid.
    cue.tokenOffsetsMs.forEach((offset, tokenIndex) => {
      // A rest occupies a slot and a beat but is not a ring fire. Without
      // this it would publish a `token-due` like any other token, which
      // feeds `puncheokie.cue.tokenDue` (the cadence-lab drift signal) and
      // the viz forensics recorder — so every padded bar would inject
      // phantom ring events into both (GH #305).
      if (cue.tokens[tokenIndex]?.kind === 'rest') return
      const strikeId = strikeIdFor(cue.id, DEFAULT_REP_ID, tokenIndex)
      if (runtime.firedTokens.has(strikeId)) return
      if (until < cue.scheduledStartMs + offset) return
      runtime.firedTokens.add(strikeId)
      this.publish({
        type: 'token-due',
        cue,
        tokenIndex,
        repId: DEFAULT_REP_ID,
        strikeId,
        workElapsedMs: t,
        nowMs: this.clock.now(),
      })
    })
  }

  private finish(
    runtime: CueRuntime,
    outcome: CueOutcome,
    eventType: CueEventType,
    t: number = this.lastTickMs,
  ): void {
    runtime.outcome = outcome
    runtime.timestamps.completedAtMs = this.clock.now()
    runtime.status = outcome === 'cancelled' ? 'cancelled' : outcome
    this.emit(eventType, runtime, t)
    // The outcome is preserved on `outcome`; the status moves to `gap`, the
    // post-combo rest before the next cue previews (doc §20).
    if (outcome !== 'cancelled') runtime.status = 'gap'
  }

  private applySuspension(): void {
    for (const runtime of this.runtimes) {
      if (!SUSPENDABLE.has(runtime.status)) continue
      runtime.priorStatus = runtime.status
      runtime.status = 'suspended'
      // Monotonic, not work-elapsed: the work clock is frozen while
      // suspended, so work-elapsed would make every span zero-length.
      runtime.timestamps.suspensions.push({ atMs: this.clock.now() })
      this.emit('cue-suspended', runtime, this.lastTickMs)
    }
  }

  private releaseSuspension(): void {
    if (this.isSuspended()) return
    for (const runtime of this.runtimes) {
      if (runtime.status !== 'suspended') continue
      const open = runtime.timestamps.suspensions[runtime.timestamps.suspensions.length - 1]
      if (open && open.resumedAtMs === undefined) open.resumedAtMs = this.clock.now()
      runtime.status = runtime.priorStatus ?? 'queued'
      runtime.priorStatus = undefined
      this.emit('cue-resumed', runtime, this.lastTickMs)
    }
  }

  private cancelRemaining(): void {
    for (const runtime of this.runtimes) {
      if (TERMINAL_STATUSES.has(runtime.status)) continue
      this.finish(runtime, 'cancelled', 'cue-cancelled')
    }
  }

  private currentRuntime(): CueRuntime | undefined {
    // Most advanced first: an accepting cue outranks a previewing one that
    // has already begun looking ahead.
    for (const status of IN_FLIGHT_PRIORITY) {
      const match = this.runtimes.find((r) => r.status === status)
      if (match) return match
    }
    return undefined
  }

  private nextRuntimeAfter(current?: CueRuntime): CueRuntime | undefined {
    const from = current ? this.runtimes.indexOf(current) + 1 : 0
    for (let i = from; i < this.runtimes.length; i++) {
      const runtime = this.runtimes[i]
      if (runtime && !TERMINAL_STATUSES.has(runtime.status)) return runtime
    }
    return undefined
  }

  private lastFinishedRuntime(): CueRuntime | undefined {
    for (let i = this.runtimes.length - 1; i >= 0; i--) {
      const runtime = this.runtimes[i]
      if (runtime && runtime.outcome !== undefined) return runtime
    }
    return undefined
  }

  private assertSingleActive(): void {
    const inPlay = this.runtimes.filter(
      (r) => r.status === 'active' || r.status === 'accepting',
    )
    if (inPlay.length > 1) {
      throw new Error(
        `CueEngine: ${inPlay.length} cues active at once (${inPlay
          .map((r) => r.cue.id)
          .join(', ')}). The timeline should never overlap cues.`,
      )
    }
  }

  private emit(type: CueEventType, runtime: CueRuntime, workElapsedMs: number): void {
    this.publish({
      type,
      cue: runtime.cue,
      status: runtime.status,
      timestamps: runtime.timestamps,
      workElapsedMs,
      nowMs: this.clock.now(),
    })
  }

  private publish(event: CueEvent): void {
    for (const listener of this.listeners) listener(event)
  }
}

// ---------------------------------------------------------------------------

const SUSPENDABLE: ReadonlySet<CueStatus> = new Set<CueStatus>([
  'announcing',
  'active',
  'accepting',
])

const IN_FLIGHT_PRIORITY: readonly CueStatus[] = [
  'accepting',
  'active',
  'announcing',
  'previewing',
  'suspended',
]

function newRuntime(cue: CueInstance): CueRuntime {
  return {
    cue,
    status: 'queued',
    timestamps: {
      previewScheduledMs: cue.previewAt,
      voiceScheduledMs: cue.announceAt,
      executionScheduledMs: cue.scheduledStartMs,
      windowCloseMs: cue.windowEndMs,
      trackerEventTimesMs: [],
      suspensions: [],
    },
    firedTokens: new Set(),
    matched: new Set(),
    counted: 0,
    windowOpened: false,
    readyFired: false,
  }
}

/**
 * Windows arrive already clamped from `expandTimeline` (M32-03). The engine
 * asserts rather than re-clamps: a window outside the work interval means
 * expansion is broken, and quietly correcting it here would hide that while
 * letting events be accepted during rest (spec §18.2).
 */
function assertWindowsClamped(timeline: readonly RoundTimeline[]): void {
  for (const round of timeline) {
    for (const cue of round.cues) {
      if (cue.windowStartMs < 0 || cue.windowEndMs > round.workDurationMs) {
        throw new Error(
          `CueEngine: cue ${cue.id} has window [${cue.windowStartMs}, ${cue.windowEndMs}] ` +
            `outside the round work interval [0, ${round.workDurationMs}]. ` +
            'expandTimeline must clamp windows before the engine sees them.',
        )
      }
    }
  }
}
