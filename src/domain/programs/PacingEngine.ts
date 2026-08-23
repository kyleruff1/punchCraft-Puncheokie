/**
 * Pacing (M33-05, doc §22).
 *
 * Maintains required pace against the punch goal and proposes adjustments
 * **only at safe boundaries** — after a block, during a rest, or at the
 * start of a round. It never touches a plan mid-combination.
 *
 * ## Why boundary-only is structural, not a policy
 *
 * `recordAccepted` and `snapshot` cannot return a decision: their return
 * types have nowhere to put one. Only `onBoundary` produces an
 * `AdaptationDecision`. That is deliberate — a pacing engine that could
 * adjust at any moment would be able to change the cadence in the middle of
 * a combination the athlete is already throwing, and no amount of care at
 * the call site would reliably prevent it.
 *
 * ## The rule that shapes the rest
 *
 * Doc §25: never encourage acceleration to recover an impossible target.
 * When the required pace exceeds what the athlete could physically sustain,
 * the engine reports `target-unreachable`, takes **no action**, and shows
 * **no cue**. Silence is the honest response — telling someone to "build
 * the pace" toward a target they cannot reach is worse than saying nothing,
 * and speeding up the cues to chase it would make the workout unusable in
 * pursuit of a number.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports, and no
 * `Date.now()` (spec §15.1, §18.3).
 */

import { clampToProfile, type CadenceProfile } from '../workout/cadence'
import { allocateRoundTargets } from '../workout/goalAllocation'
import type { WorkoutFocus } from '../workout/punchGoals'
import type { ProgramRound } from '../workout/WorkoutTokens'

export interface PacingSnapshot {
  remainingPunches: number
  remainingActiveSeconds: number
  /** Punches per minute needed to finish on target. */
  requiredPace: number
  projectedTotal: number
}

export type PacingBoundary = 'block' | 'rest' | 'round'

/** Exact strings from doc §22. Not paraphrasable. */
export type PacingCueText = 'Build the pace' | 'You are ahead; stay sharp'

export type PacingMode = 'fixed' | 'adaptive' | 'goal-seeking'

export type PacingAction =
  | { kind: 'none'; reason?: 'fixed-plan' | 'within-band' | 'target-unreachable' }
  | { kind: 'cadence-scale'; factor: number }
  | { kind: 'gap-scale'; factor: number }
  | { kind: 'reallocate'; roundTargets: number[] }

export interface AdaptationDecision {
  boundary: PacingBoundary
  atWorkElapsedMs: number
  inputs: PacingSnapshot & { mode: PacingMode; roundIndex: number }
  action: PacingAction
  cueText?: PacingCueText
}

// ---------------------------------------------------------------------------
// Tuning. Placeholders until M36-03 tunes them at the bag.
// ---------------------------------------------------------------------------

/**
 * How far off pace the athlete must be before anything is said or changed.
 *
 * A narrow band would have the engine reacting to the ordinary variation of
 * a round — a slow ten seconds is not a pacing problem, and an app that
 * commented on it would be noise.
 */
export const PACING_BAND = 0.12

/** The most cadence may move in one round (doc §22's 10-15%). */
export const MAX_CADENCE_DELTA_PER_ROUND = 0.15

/**
 * Above this, a target is treated as unreachable.
 *
 * Roughly three punches a second sustained — beyond anything the density
 * ceiling would ever prescribe. Past it the engine goes quiet rather than
 * asking for more (doc §25).
 */
export const DEFAULT_MAX_REQUIRED_PACE = 180

export interface PacingEngineOptions {
  totalGoal: number
  schedule: readonly ProgramRound[]
  mode: PacingMode
  profile: CadenceProfile
  maxRequiredPace?: number
  /** Needed by goal-seeking to reallocate; ignored in the other modes. */
  focus?: WorkoutFocus
}

export class PacingEngine {
  private readonly totalGoal: number
  private readonly schedule: readonly ProgramRound[]
  private readonly mode: PacingMode
  private readonly profile: CadenceProfile
  private readonly maxRequiredPace: number
  private readonly focus: WorkoutFocus

  private accepted = 0
  /** Cumulative cadence factor, so the per-round cap compounds correctly. */
  private cadenceFactor = 1

  constructor(opts: PacingEngineOptions) {
    this.totalGoal = opts.totalGoal
    this.schedule = opts.schedule
    this.mode = opts.mode
    this.profile = opts.profile
    this.maxRequiredPace = opts.maxRequiredPace ?? DEFAULT_MAX_REQUIRED_PACE
    this.focus = opts.focus ?? 'balanced'
  }

  /** Total active seconds across scored rounds only (doc §22, M31-03). */
  private totalActiveSeconds(): number {
    return this.schedule
      .filter((r) => r.countsTowardGoal)
      .reduce((sum, r) => sum + r.workDurationMs / 1000, 0)
  }

  recordAccepted(count: number): void {
    // Guards against a negative or fractional count reaching the formulas
    // and producing a nonsense pace the UI would render as fact.
    if (!Number.isFinite(count) || count <= 0) return
    this.accepted += Math.floor(count)
  }

  /**
   * The doc §22 quantities, transcribed.
   *
   * Produces no decision by construction — see the header note.
   */
  snapshot(activeElapsedSeconds: number): PacingSnapshot {
    const totalActive = this.totalActiveSeconds()
    const elapsed = Math.max(0, Math.min(activeElapsedSeconds, totalActive))
    const remainingActiveSeconds = Math.max(0, totalActive - elapsed)
    const remainingPunches = Math.max(0, this.totalGoal - this.accepted)

    const requiredPace =
      remainingActiveSeconds > 0 ? (remainingPunches / remainingActiveSeconds) * 60 : 0

    // Projected on the rate achieved so far, not on the rate being asked
    // for: the honest extrapolation is what the athlete is actually doing.
    const achievedPerSecond = elapsed > 0 ? this.accepted / elapsed : 0
    const projectedTotal = Math.round(this.accepted + achievedPerSecond * remainingActiveSeconds)

    return {
      remainingPunches,
      remainingActiveSeconds,
      requiredPace: Math.round(requiredPace * 10) / 10,
      projectedTotal,
    }
  }

  /**
   * The only method that can change anything.
   *
   * `atWorkElapsedMs` is the session's work clock (spec §18.3); nothing
   * here reads a wall clock.
   */
  onBoundary(
    boundary: PacingBoundary,
    ctx: { roundIndex: number; atWorkElapsedMs: number; activeElapsedSeconds: number },
  ): AdaptationDecision {
    const snapshot = this.snapshot(ctx.activeElapsedSeconds)
    const inputs = { ...snapshot, mode: this.mode, roundIndex: ctx.roundIndex }
    const base: Omit<AdaptationDecision, 'action' | 'cueText'> = {
      boundary,
      atWorkElapsedMs: ctx.atWorkElapsedMs,
      inputs,
    }

    if (this.mode === 'fixed') {
      return { ...base, action: { kind: 'none', reason: 'fixed-plan' } }
    }

    // Doc §25: past this the engine says nothing and does nothing. Asking
    // for more would be asking for something impossible.
    if (snapshot.requiredPace > this.maxRequiredPace) {
      return { ...base, action: { kind: 'none', reason: 'target-unreachable' } }
    }

    const onPace = this.pacePerMinuteSoFar(ctx.activeElapsedSeconds)
    // Before any punches land there is no rate to compare against, so the
    // engine holds rather than reacting to an empty first block.
    if (onPace === null) {
      return { ...base, action: { kind: 'none', reason: 'within-band' } }
    }

    const ratio = snapshot.requiredPace / onPace
    if (Math.abs(ratio - 1) <= PACING_BAND) {
      return { ...base, action: { kind: 'none', reason: 'within-band' } }
    }

    const behind = ratio > 1
    const cueText: PacingCueText = behind ? 'Build the pace' : 'You are ahead; stay sharp'

    // Goal-seeking reshapes the remaining plan rather than the cadence
    // (doc §22). It reallocates what is left of the budget across the
    // rounds that have not started; the runner turns that into blocks.
    if (this.mode === 'goal-seeking') {
      const remaining = this.schedule.map((round, index) =>
        index <= ctx.roundIndex ? { ...round, countsTowardGoal: false } : round,
      )
      const reallocated = allocateRoundTargets(snapshot.remainingPunches, remaining, this.focus)

      // Rounds already run keep the targets they were actually judged
      // against — rewriting them would retroactively change a result the
      // athlete was already shown.
      const roundTargets = this.schedule.map((round, index) =>
        index <= ctx.roundIndex ? round.targetPunches : (reallocated[index] ?? 0),
      )

      return { ...base, action: { kind: 'reallocate', roundTargets }, cueText }
    }

    // Cadence moves gradually, capped per round and clamped to the
    // profile's own BPM range so a theme never becomes unrecognisable.
    const desired = behind ? 1 + MAX_CADENCE_DELTA_PER_ROUND : 1 - MAX_CADENCE_DELTA_PER_ROUND
    const factor = this.clampFactor(desired)

    if (factor === 1) {
      // Already at the edge of what the profile allows: say the cue, change
      // nothing. The athlete can still respond even when the plan cannot.
      return { ...base, action: { kind: 'none', reason: 'within-band' }, cueText }
    }

    return { ...base, action: { kind: 'cadence-scale', factor }, cueText }
  }

  // -------------------------------------------------------------------------

  private pacePerMinuteSoFar(activeElapsedSeconds: number): number | null {
    if (activeElapsedSeconds <= 0 || this.accepted <= 0) return null
    return (this.accepted / activeElapsedSeconds) * 60
  }

  /**
   * Apply the per-round cap and the profile's BPM range together.
   *
   * Returns 1 when the move would leave the profile: a `pressure` round
   * pushed past its own range would stop being a pressure round, and doc
   * §22 keeps the theme intact.
   */
  private clampFactor(desired: number): number {
    const nextCumulative = this.cadenceFactor * desired
    const targetBpm = this.profile.nominalBpm * nextCumulative
    const clampedBpm = clampToProfile(targetBpm, this.profile)

    if (Math.abs(clampedBpm - targetBpm) > 0.001) {
      // The move would have left the profile's range; take what is left of
      // it, if anything.
      const reachable = clampedBpm / (this.profile.nominalBpm * this.cadenceFactor)
      if (Math.abs(reachable - 1) < 0.001) return 1
      this.cadenceFactor *= reachable
      return Math.round(reachable * 1000) / 1000
    }

    this.cadenceFactor = nextCumulative
    return desired
  }
}
