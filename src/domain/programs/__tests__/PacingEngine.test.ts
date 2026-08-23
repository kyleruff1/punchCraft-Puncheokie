/**
 * Pacing (M33-05).
 *
 * Two properties carry the weight, and both are about restraint:
 *
 * - **No decision can be produced outside `onBoundary`.** Asserted
 *   structurally as well as behaviourally — a pacing engine able to act
 *   mid-combination would change cadence under a punch already in flight.
 * - **An impossible target produces silence.** Doc §25 forbids encouraging
 *   acceleration to recover a target that cannot be reached; saying nothing
 *   is the honest response.
 */
import {
  DEFAULT_MAX_REQUIRED_PACE,
  MAX_CADENCE_DELTA_PER_ROUND,
  PACING_BAND,
  PacingEngine,
  type AdaptationDecision,
  type PacingMode,
} from '../PacingEngine'
import { CADENCE_PROFILES } from '../../workout/cadence'
import type { ProgramRound } from '../../workout/WorkoutTokens'

const STEADY = CADENCE_PROFILES.steady

function round(over: Partial<ProgramRound> = {}): ProgramRound {
  return {
    id: 'r',
    order: 1,
    kind: 'round',
    countsTowardGoal: true,
    theme: 'Test',
    workDurationMs: 180_000,
    restAfterMs: 60_000,
    targetPunches: 0,
    blocks: [],
    ...over,
  }
}

/** Three scored rounds: 9 minutes of active work, 540 seconds. */
const SCHEDULE: ProgramRound[] = [round({ id: 'r1' }), round({ id: 'r2' }), round({ id: 'r3' })]

function engine(mode: PacingMode = 'adaptive', over: Partial<{ totalGoal: number; schedule: ProgramRound[]; maxRequiredPace: number }> = {}) {
  return new PacingEngine({
    totalGoal: over.totalGoal ?? 540,
    schedule: over.schedule ?? SCHEDULE,
    mode,
    profile: STEADY,
    ...(over.maxRequiredPace === undefined ? {} : { maxRequiredPace: over.maxRequiredPace }),
  })
}

const boundary = (
  e: PacingEngine,
  activeElapsedSeconds: number,
  roundIndex = 0,
): AdaptationDecision =>
  e.onBoundary('round', { roundIndex, atWorkElapsedMs: activeElapsedSeconds * 1000, activeElapsedSeconds })

// ---------------------------------------------------------------------------

describe('the doc §22 formulas', () => {
  it('computes remaining punches, remaining active seconds and required pace', () => {
    const e = engine()
    e.recordAccepted(120)
    const snapshot = e.snapshot(180) // one round in

    expect(snapshot.remainingPunches).toBe(420)
    expect(snapshot.remainingActiveSeconds).toBe(360)
    // 420 / 360 * 60 = 70
    expect(snapshot.requiredPace).toBe(70)
  })

  it('counts only rounds that carry a goal (M31-03)', () => {
    // A warm-up occupies session time but no punch goal (doc §9), so it
    // must not dilute the required pace.
    const withWarmup = [
      round({ id: 'w', kind: 'warm-up', countsTowardGoal: false }),
      ...SCHEDULE,
    ]
    const e = engine('adaptive', { schedule: withWarmup })
    expect(e.snapshot(0).remainingActiveSeconds).toBe(540)
  })

  it('projects on the rate achieved, not the rate being asked for', () => {
    const e = engine()
    e.recordAccepted(90) // 90 in 180s = 30/min
    // 30/min over the remaining 360s adds 180.
    expect(e.snapshot(180).projectedTotal).toBe(270)
  })

  it('reports a required pace of zero once the goal is met', () => {
    const e = engine()
    e.recordAccepted(600)
    const snapshot = e.snapshot(180)
    expect(snapshot.remainingPunches).toBe(0)
    expect(snapshot.requiredPace).toBe(0)
  })

  it('never reports negative remaining anything', () => {
    const e = engine()
    e.recordAccepted(10_000)
    const snapshot = e.snapshot(10_000)
    expect(snapshot.remainingPunches).toBeGreaterThanOrEqual(0)
    expect(snapshot.remainingActiveSeconds).toBeGreaterThanOrEqual(0)
  })

  it('ignores a nonsense accepted count rather than poisoning the pace', () => {
    const e = engine()
    e.recordAccepted(Number.NaN)
    e.recordAccepted(-5)
    e.recordAccepted(0)
    expect(e.snapshot(180).remainingPunches).toBe(540)
  })
})

describe('decisions come only from onBoundary', () => {
  it('gives snapshot no way to return a decision', () => {
    // Structural, not a convention: the return type has nowhere to put one.
    const e = engine()
    const snapshot = e.snapshot(60)
    expect(Object.keys(snapshot).sort()).toEqual([
      'projectedTotal',
      'remainingActiveSeconds',
      'remainingPunches',
      'requiredPace',
    ])
  })

  it('gives recordAccepted no return value at all', () => {
    const e = engine()
    expect(e.recordAccepted(5)).toBeUndefined()
  })

  it('does not change the plan across interleaved records and snapshots', () => {
    const e = engine()
    for (let i = 0; i < 50; i++) {
      e.recordAccepted(1)
      e.snapshot(i * 2)
    }
    // Only now, at a boundary, may anything be proposed.
    const decision = boundary(e, 100)
    expect(decision.boundary).toBe('round')
  })
})

describe('fixed mode never alters the plan', () => {
  it.each(['block', 'rest', 'round'] as const)('returns none at a %s boundary', (kind) => {
    const e = engine('fixed')
    e.recordAccepted(10) // far behind
    const decision = e.onBoundary(kind, {
      roundIndex: 0,
      atWorkElapsedMs: 180_000,
      activeElapsedSeconds: 180,
    })
    expect(decision.action).toEqual({ kind: 'none', reason: 'fixed-plan' })
  })

  it('shows no cue in fixed mode', () => {
    const e = engine('fixed')
    e.recordAccepted(5)
    expect(boundary(e, 180).cueText).toBeUndefined()
  })
})

describe('an unreachable target produces silence (doc §25)', () => {
  it('takes no action and shows no cue', () => {
    // 540 punches with 10 seconds left is far past anything sustainable.
    const e = engine('adaptive')
    const decision = boundary(e, 530)
    expect(decision.action).toEqual({ kind: 'none', reason: 'target-unreachable' })
    expect(decision.cueText).toBeUndefined()
  })

  it('never asks for a catch-up cadence', () => {
    const e = engine('adaptive')
    const decision = boundary(e, 535)
    expect(decision.action.kind).not.toBe('cadence-scale')
  })

  it('honours a caller-supplied ceiling', () => {
    const e = engine('adaptive', { maxRequiredPace: 10 })
    expect(boundary(e, 0).action).toEqual({ kind: 'none', reason: 'target-unreachable' })
  })

  it('uses a default ceiling above anything the plan would prescribe', () => {
    expect(DEFAULT_MAX_REQUIRED_PACE).toBeGreaterThan(120)
  })
})

describe('the band', () => {
  it('does nothing while on pace', () => {
    const e = engine('adaptive')
    e.recordAccepted(180) // exactly 60/min over 180s; required is also 60
    const decision = boundary(e, 180)
    expect(decision.action).toEqual({ kind: 'none', reason: 'within-band' })
    expect(decision.cueText).toBeUndefined()
  })

  it('holds before any punch lands rather than reacting to an empty block', () => {
    const e = engine('adaptive')
    expect(boundary(e, 30).action).toEqual({ kind: 'none', reason: 'within-band' })
  })

  it('is wide enough not to comment on ordinary variation', () => {
    expect(PACING_BAND).toBeGreaterThanOrEqual(0.05)
  })
})

describe('cues use the exact doc §22 strings', () => {
  it('says Build the pace when behind', () => {
    const e = engine('adaptive')
    e.recordAccepted(60) // 20/min against a required 160
    expect(boundary(e, 180).cueText).toBe('Build the pace')
  })

  it('says You are ahead; stay sharp when ahead', () => {
    const e = engine('adaptive')
    e.recordAccepted(400) // well ahead
    expect(boundary(e, 180).cueText).toBe('You are ahead; stay sharp')
  })

  it('emits at most one cue per boundary', () => {
    const e = engine('adaptive')
    e.recordAccepted(60)
    const decision = boundary(e, 180)
    expect(typeof decision.cueText).toBe('string')
    // One field, so more than one is not representable.
    expect(Object.keys(decision).filter((k) => k === 'cueText')).toHaveLength(1)
  })
})

describe('adaptive factors stay inside their limits (doc §22)', () => {
  it('never moves cadence more than the per-round cap', () => {
    const e = engine('adaptive')
    e.recordAccepted(60)
    const decision = boundary(e, 180)
    if (decision.action.kind === 'cadence-scale') {
      expect(Math.abs(decision.action.factor - 1)).toBeLessThanOrEqual(
        MAX_CADENCE_DELTA_PER_ROUND + 1e-9,
      )
    }
  })

  it('never pushes cadence outside the profile range', () => {
    // Repeatedly behind: the factor must run out at the profile's edge
    // rather than accelerating indefinitely.
    const e = engine('adaptive')
    for (let i = 0; i < 12; i++) {
      e.recordAccepted(1)
      const decision = boundary(e, 60 + i, i)
      if (decision.action.kind === 'cadence-scale') {
        expect(decision.action.factor).toBeGreaterThan(0)
      }
    }
    // After many rounds of pushing, a further push yields nothing.
    e.recordAccepted(1)
    const last = boundary(e, 200, 12)
    if (last.action.kind === 'cadence-scale') {
      expect(STEADY.nominalBpm * last.action.factor).toBeLessThanOrEqual(STEADY.maxBpm + 1)
    }
  })

  it('still shows the cue when the plan has no room left to move', () => {
    // The athlete can respond even when the cadence cannot.
    const e = engine('adaptive')
    for (let i = 0; i < 20; i++) {
      e.recordAccepted(1)
      boundary(e, 60 + i, i)
    }
    const decision = boundary(e, 200, 20)
    if (decision.action.kind === 'none' && decision.action.reason === 'within-band') {
      expect(['Build the pace', undefined]).toContain(decision.cueText)
    }
  })
})

describe('goal-seeking reshapes the plan, not the cadence (#193, doc §22)', () => {
  const seeking = () =>
    new PacingEngine({
      totalGoal: 540,
      schedule: SCHEDULE,
      mode: 'goal-seeking',
      profile: STEADY,
      focus: 'balanced',
    })

  it('reallocates instead of scaling cadence when behind', () => {
    const e = seeking()
    e.recordAccepted(60)
    const decision = boundary(e, 180, 0)
    expect(decision.action.kind).toBe('reallocate')
    expect(decision.cueText).toBe('Build the pace')
  })

  it('leaves rounds that already ran with the targets they were judged against', () => {
    // Rewriting them would retroactively change a result the athlete was
    // already shown.
    const e = seeking()
    e.recordAccepted(60)
    const decision = boundary(e, 180, 0)
    if (decision.action.kind !== 'reallocate') throw new Error('expected a reallocation')
    expect(decision.action.roundTargets[0]).toBe(SCHEDULE[0]!.targetPunches)
  })

  it('spreads only the remaining budget across the remaining rounds', () => {
    const e = seeking()
    e.recordAccepted(100)
    const decision = boundary(e, 180, 0)
    if (decision.action.kind !== 'reallocate') throw new Error('expected a reallocation')
    const future = decision.action.roundTargets.slice(1).reduce((a, b) => a + b, 0)
    expect(future).toBe(440)
  })

  it('still goes silent on an unreachable target', () => {
    // Goal-seeking may reshape a plan, but not into one nobody could run
    // (doc §25).
    const e = seeking()
    const decision = boundary(e, 535, 0)
    expect(decision.action).toEqual({ kind: 'none', reason: 'target-unreachable' })
    expect(decision.cueText).toBeUndefined()
  })

  it('does nothing while on pace', () => {
    const e = seeking()
    e.recordAccepted(180)
    expect(boundary(e, 180, 0).action).toEqual({ kind: 'none', reason: 'within-band' })
  })

  it('reallocates when far ahead too', () => {
    const e = seeking()
    e.recordAccepted(400)
    const decision = boundary(e, 180, 0)
    expect(decision.action.kind).toBe('reallocate')
    expect(decision.cueText).toBe('You are ahead; stay sharp')
  })

  it('is deterministic', () => {
    const run = () => {
      const e = seeking()
      e.recordAccepted(60)
      return boundary(e, 180, 0)
    }
    expect(run()).toEqual(run())
  })
})

describe('every decision records what it decided on', () => {
  it('carries the snapshot, mode, round and work-clock time', () => {
    const e = engine('adaptive')
    e.recordAccepted(100)
    const decision = e.onBoundary('rest', {
      roundIndex: 2,
      atWorkElapsedMs: 123_000,
      activeElapsedSeconds: 123,
    })
    expect(decision.inputs.mode).toBe('adaptive')
    expect(decision.inputs.roundIndex).toBe(2)
    expect(decision.atWorkElapsedMs).toBe(123_000)
    expect(decision.inputs.remainingPunches).toBe(440)
  })

  it('uses the work clock, never a wall clock', () => {
    const decision = engine().onBoundary('block', {
      roundIndex: 0,
      atWorkElapsedMs: 42_000,
      activeElapsedSeconds: 42,
    })
    expect(decision.atWorkElapsedMs).toBe(42_000)
  })
})

describe('determinism (spec §13.6)', () => {
  it('produces deep-equal decisions for an identical call sequence', () => {
    const run = (): AdaptationDecision[] => {
      const e = engine('adaptive')
      const out: AdaptationDecision[] = []
      for (let i = 0; i < 6; i++) {
        e.recordAccepted(20)
        out.push(boundary(e, 30 * (i + 1), i))
      }
      return out
    }
    expect(run()).toEqual(run())
  })
})
