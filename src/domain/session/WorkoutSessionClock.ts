/**
 * Workout session clock (spec §18.1).
 *
 * Owns the phase machine — countdown, work, rest, paused, completed — and
 * the **work-elapsed clock the CueEngine schedules against**. That clock is
 * frozen while paused, which is the whole reason the engine needs no
 * offset-shifting logic of its own (see `CueEngine`'s header).
 *
 * ## Why this exists here
 *
 * #107 (M20-01) owns the full SessionEngine, and it has not landed. Rather
 * than block the live screen on it, this is the minimum phase machine
 * M32-08 needs, kept pure and in the domain layer so it can be swapped for
 * #107's implementation without touching the screen. It deliberately does
 * *not* cover session persistence, metrics, or the BLE-facing states — only
 * the timing the live screen and the cue engine consume.
 *
 * Time is accumulated per phase rather than compared against an absolute
 * start instant: a pause simply stops accumulating, so no paused-duration
 * offset has to be tracked and later subtracted. That difference is why a
 * long pause cannot drift the round clock.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports, and no
 * `Date.now()` (spec §15.1, §18.3).
 */

import type { MonotonicClock } from '../time/MonotonicClock'

export type SessionPhase =
  | 'idle'
  | 'countdown'
  | 'work'
  | 'rest'
  | 'paused'
  | 'completed'
  | 'cancelled'

export interface SessionRoundSpec {
  workDurationMs: number
  restAfterMs: number
}

export interface SessionSnapshot {
  phase: SessionPhase
  /** Index into the round schedule; -1 before the first round starts. */
  roundIndex: number
  roundCount: number
  /** Elapsed inside the current phase. Frozen while paused. */
  phaseElapsedMs: number
  /** Remaining in the current phase, floored at 0. */
  phaseRemainingMs: number
  /**
   * The clock the CueEngine ticks against — elapsed within the current
   * *work* interval. Holds its last value through a pause and resets at the
   * start of each round.
   */
  workElapsedMs: number
}

export interface SessionClockOptions {
  clock: MonotonicClock
  /** Lead-in before round 1. Doc §19 shows a countdown; 0 disables it. */
  countdownMs?: number
}

export const DEFAULT_COUNTDOWN_MS = 5_000

/** Phase transitions the runner reacts to, in the order they occurred. */
export type SessionTransition =
  | { type: 'countdown-entered' }
  | { type: 'work-entered'; roundIndex: number }
  | { type: 'rest-entered'; roundIndex: number }
  | { type: 'paused' }
  | { type: 'resumed' }
  | { type: 'completed' }
  | { type: 'cancelled' }

export class WorkoutSessionClock {
  private readonly rounds: readonly SessionRoundSpec[]
  private readonly clock: MonotonicClock
  private readonly countdownMs: number

  private phase: SessionPhase = 'idle'
  private phaseBeforePause: SessionPhase = 'idle'
  private roundIndex = -1
  private phaseElapsedMs = 0
  private workElapsedMs = 0
  private lastAdvanceAtMs: number | null = null

  constructor(rounds: readonly SessionRoundSpec[], opts: SessionClockOptions) {
    this.rounds = rounds
    this.clock = opts.clock
    this.countdownMs = opts.countdownMs ?? DEFAULT_COUNTDOWN_MS
  }

  start(): SessionTransition[] {
    if (this.phase !== 'idle') return []
    this.lastAdvanceAtMs = this.clock.now()
    this.phaseElapsedMs = 0

    if (this.countdownMs > 0) {
      this.phase = 'countdown'
      return [{ type: 'countdown-entered' }]
    }
    return this.enterWork(0)
  }

  /**
   * Accumulate real time and apply any transitions it caused.
   *
   * Returns the transitions in order, so a caller that advances by a large
   * step still sees every phase it passed through rather than only the one
   * it landed in.
   */
  advance(): SessionTransition[] {
    const now = this.clock.now()
    if (this.lastAdvanceAtMs === null) {
      this.lastAdvanceAtMs = now
      return []
    }

    const delta = Math.max(0, now - this.lastAdvanceAtMs)
    this.lastAdvanceAtMs = now

    // Paused and terminal phases accumulate nothing — this is what freezes
    // the work clock rather than any offset arithmetic.
    if (delta === 0 || !this.isRunning()) return []

    this.phaseElapsedMs += delta
    if (this.phase === 'work') this.workElapsedMs = this.phaseElapsedMs

    const transitions: SessionTransition[] = []
    // Loop, because one large delta can cross more than one boundary.
    for (;;) {
      const duration = this.currentPhaseDurationMs()
      if (duration === null || this.phaseElapsedMs < duration) break

      const overflow = this.phaseElapsedMs - duration
      transitions.push(...this.advancePhase(overflow))
      if (!this.isRunning()) break
    }

    return transitions
  }

  pause(): SessionTransition[] {
    if (!this.isRunning()) return []
    this.phaseBeforePause = this.phase
    this.phase = 'paused'
    return [{ type: 'paused' }]
  }

  resume(): SessionTransition[] {
    if (this.phase !== 'paused') return []
    this.phase = this.phaseBeforePause
    // Discard the paused interval rather than accumulating it.
    this.lastAdvanceAtMs = this.clock.now()
    return [{ type: 'resumed' }]
  }

  /** Immediate stop (doc §25) — nothing lingers. */
  cancel(): SessionTransition[] {
    if (this.phase === 'completed' || this.phase === 'cancelled') return []
    this.phase = 'cancelled'
    return [{ type: 'cancelled' }]
  }

  snapshot(): SessionSnapshot {
    const duration = this.currentPhaseDurationMs()
    return {
      phase: this.phase,
      roundIndex: this.roundIndex,
      roundCount: this.rounds.length,
      phaseElapsedMs: this.phaseElapsedMs,
      phaseRemainingMs: duration === null ? 0 : Math.max(0, duration - this.phaseElapsedMs),
      workElapsedMs: this.workElapsedMs,
    }
  }

  // -------------------------------------------------------------------------

  private isRunning(): boolean {
    return this.phase === 'countdown' || this.phase === 'work' || this.phase === 'rest'
  }

  private currentPhaseDurationMs(): number | null {
    switch (this.phase) {
      case 'countdown':
        return this.countdownMs
      case 'work':
        return this.rounds[this.roundIndex]?.workDurationMs ?? null
      case 'rest':
        return this.rounds[this.roundIndex]?.restAfterMs ?? null
      default:
        return null
    }
  }

  private advancePhase(overflowMs: number): SessionTransition[] {
    switch (this.phase) {
      case 'countdown':
        return this.enterWork(0, overflowMs)

      case 'work': {
        const rest = this.rounds[this.roundIndex]?.restAfterMs ?? 0
        const isLast = this.roundIndex >= this.rounds.length - 1
        // A final round with no rest ends the session rather than entering a
        // zero-length rest nobody sees.
        if (isLast && rest <= 0) return this.complete()
        if (rest <= 0) return this.enterWork(this.roundIndex + 1, overflowMs)
        this.phase = 'rest'
        this.phaseElapsedMs = overflowMs
        return [{ type: 'rest-entered', roundIndex: this.roundIndex }]
      }

      case 'rest': {
        if (this.roundIndex >= this.rounds.length - 1) return this.complete()
        return this.enterWork(this.roundIndex + 1, overflowMs)
      }

      default:
        return []
    }
  }

  private enterWork(roundIndex: number, overflowMs = 0): SessionTransition[] {
    this.roundIndex = roundIndex
    this.phase = 'work'
    this.phaseElapsedMs = overflowMs
    this.workElapsedMs = overflowMs
    return [{ type: 'work-entered', roundIndex }]
  }

  private complete(): SessionTransition[] {
    this.phase = 'completed'
    this.phaseElapsedMs = 0
    return [{ type: 'completed' }]
  }
}
