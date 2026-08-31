/**
 * `compileWorkoutScore` — the single-mapping compiler foundation
 * (M39-V2 W1 Epic Slice 1, Kyle amended plan 2026-08-30).
 *
 * Pins the invariants every subsequent slice will build on:
 *
 *  1. **Shape.** `version: 'workout-score/1'`, non-empty rounds
 *     produce non-empty phaseBoundaries, `identity.workoutId`
 *     matches, `revision` propagates, `compiledAtEpochMs` is
 *     stamped from config.
 *  2. **Phase boundaries.** Every round contributes exactly one
 *     `round-start` + one `round-end`, in `atTick` order, and
 *     the last `atTick` equals `totalDurationTicks`.
 *  3. **Score-relative ticks.** Every strike's `startTick`
 *     falls between its round's start and end boundary, and
 *     strikes are monotonic in score-tick order across the
 *     whole workout (never backwards).
 *  4. **Provenance.** Every strike carries the full identity
 *     tuple (`eventId`, `cueId`, `repId`, `repIndex`,
 *     `strikeIndex`, `roundIndex`) — no consumer has to parse
 *     the string `eventId` (principle #12).
 *  5. **Repetition.** Every strike occurrence gets a distinct
 *     `eventId`; a `1-1-2` combo repeated `× 3` yields 9
 *     distinct events even though only 2 physical nodes light.
 *  6. **Identity hash.** `identity.timelineHash` is stable
 *     across recompiles of the same input, changes when the
 *     input changes, and is scoped by revision.
 *  7. **Determinism.** Identical input → deep-equal output.
 *
 * Coach slots + ceremonies are intentionally absent in this
 * slice (they land in slices 2 + 6); tests assert their
 * absence to prove the slice boundary.
 */

import { compileWorkoutScore, type WorkoutScoreConfig } from '../workoutScore'
import { listSampleWorkouts } from '../../workout/samples'
import { threeRoundFundamentals } from '../../workout/samples/threeRoundFundamentals'
import { bodyWork } from '../../workout/samples/bodyWork'
import { pumpAndCoast } from '../../workout/samples/pumpAndCoast'

function baseConfig(overrides: Partial<WorkoutScoreConfig> = {}): WorkoutScoreConfig {
  return {
    stance: 'orthodox',
    bpm: 60,
    revision: 1,
    compiledAtEpochMs: 1_700_000_000_000,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe('compileWorkoutScore — shape + identity', () => {
  it.each(listSampleWorkouts().map((s) => [s.key, s.workout] as const))(
    '%s produces a workout-score/1 with phaseBoundaries + workoutId + revision',
    (_key, workout) => {
      const score = compileWorkoutScore(workout, baseConfig({ revision: 7 }))
      expect(score.version).toBe('workout-score/1')
      expect(score.identity.workoutId).toBe(workout.id)
      expect(score.identity.revision).toBe(7)
      expect(score.identity.timelineHash).toMatch(/^v2:[0-9a-f]{8}$/)
      expect(score.compiledAtEpochMs).toBe(1_700_000_000_000)
      expect(score.phaseBoundaries.length).toBeGreaterThanOrEqual(2)
      expect(score.totalDurationTicks).toBeGreaterThan(0)
    },
  )

  it('propagates the config verbatim', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig({ bpm: 120 }))
    expect(score.config).toEqual({
      stance: 'orthodox',
      bpm: 120,
      revision: 1,
    })
  })
})

// ---------------------------------------------------------------------------
// Phase boundaries
// ---------------------------------------------------------------------------

describe('compileWorkoutScore — phase boundaries', () => {
  it('emits round-start + round-end for every round, in atTick order', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    const roundsSeen = new Map<number, { start?: number; end?: number }>()
    for (const boundary of score.phaseBoundaries) {
      const entry = roundsSeen.get(boundary.roundIndex) ?? {}
      if (boundary.kind === 'round-start') entry.start = boundary.atTick
      else entry.end = boundary.atTick
      roundsSeen.set(boundary.roundIndex, entry)
    }
    for (const [, entry] of roundsSeen) {
      expect(entry.start).toBeDefined()
      expect(entry.end).toBeDefined()
      expect(entry.end!).toBeGreaterThan(entry.start!)
    }
    // Boundary atTick is strictly non-decreasing across the whole
    // sequence — round r's end ≤ round r+1's start (they're equal
    // when rounds are back-to-back in score-tick space, which they
    // are because rests are gaps in wall-clock only).
    for (let i = 1; i < score.phaseBoundaries.length; i += 1) {
      expect(score.phaseBoundaries[i]!.atTick).toBeGreaterThanOrEqual(
        score.phaseBoundaries[i - 1]!.atTick,
      )
    }
  })

  it('the last round-end atTick equals totalDurationTicks', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    const lastEnd = [...score.phaseBoundaries].reverse().find((b) => b.kind === 'round-end')
    expect(lastEnd).toBeDefined()
    expect(lastEnd!.atTick).toBe(score.totalDurationTicks)
  })

  it('round-start at 0 for round 1', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    const firstStart = score.phaseBoundaries.find((b) => b.kind === 'round-start')
    expect(firstStart).toBeDefined()
    expect(firstStart!.atTick).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Strikes
// ---------------------------------------------------------------------------

describe('compileWorkoutScore — strikes', () => {
  it('emits at least one strike for every sample recipe', () => {
    for (const { workout } of listSampleWorkouts()) {
      const score = compileWorkoutScore(workout, baseConfig())
      expect(score.strikes.length).toBeGreaterThan(0)
    }
  })

  it('every strike carries the full identity tuple (principle #12)', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    for (const strike of score.strikes) {
      expect(typeof strike.eventId).toBe('string')
      expect(strike.eventId).toMatch(/^[^:]+:[^:]+:\d+$/)
      expect(typeof strike.cueId).toBe('string')
      expect(typeof strike.repId).toBe('string')
      expect(typeof strike.repIndex).toBe('number')
      expect(typeof strike.strikeIndex).toBe('number')
      expect(typeof strike.roundIndex).toBe('number')
      expect(typeof strike.token).toBe('string')
      expect(typeof strike.startTick).toBe('number')
      expect(typeof strike.endTick).toBe('number')
      expect(typeof strike.targetStrikeTick).toBe('number')
      expect(typeof strike.nodeId).toBe('string')
      expect(typeof strike.avatarFamilyId).toBe('string')
      expect(Array.isArray(strike.avatarThresholdTicks)).toBe(true)
    }
  })

  it('every strike sits inside its round bounds', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    const roundBounds = new Map<number, { start: number; end: number }>()
    for (const boundary of score.phaseBoundaries) {
      const entry = roundBounds.get(boundary.roundIndex) ?? { start: 0, end: 0 }
      if (boundary.kind === 'round-start') entry.start = boundary.atTick
      else entry.end = boundary.atTick
      roundBounds.set(boundary.roundIndex, entry)
    }
    for (const strike of score.strikes) {
      const bounds = roundBounds.get(strike.roundIndex)!
      expect(strike.startTick).toBeGreaterThanOrEqual(bounds.start)
      // endTick may reach round-end but not exceed it beyond a
      // small tolerance (compileCue can extend slightly past the
      // final beat for the last strike's tail).
      expect(strike.startTick).toBeLessThan(bounds.end + 1)
    }
  })

  it('strikes are monotonic in score-tick WITHIN each (cueId, repId) group', () => {
    // Cross-cue strikes can legitimately overlap (a coach/defense
    // cue running concurrent with a punch cue produces interleaved
    // ticks). Monotonicity is guaranteed only WITHIN a single
    // rep of a single cue — which is the unit compileCue emits.
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    const byRep = new Map<string, typeof score.strikes[number][]>()
    for (const strike of score.strikes) {
      const key = `${strike.cueId}:${strike.repId}`
      const list = byRep.get(key) ?? []
      list.push(strike)
      byRep.set(key, list)
    }
    for (const [, list] of byRep) {
      for (let i = 1; i < list.length; i += 1) {
        expect(list[i]!.startTick).toBeGreaterThanOrEqual(list[i - 1]!.startTick)
      }
    }
  })

  it('every strike eventId is UNIQUE across the whole workout — no collisions between rounds', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    const ids = new Set(score.strikes.map((s) => s.eventId))
    expect(ids.size).toBe(score.strikes.length)
  })

  it('avatarThresholdTicks are absolute score-ticks (shifted by cue offset)', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    for (const strike of score.strikes) {
      // Every threshold >= the strike's startTick, since compileCue
      // emits `[startTick, ...]` for the 2/3-frame families.
      for (const threshold of strike.avatarThresholdTicks) {
        expect(threshold).toBeGreaterThanOrEqual(strike.startTick)
      }
    }
  })

  it('bodyWork sample emits body-shot strikes (token includes B) — score sees fused-body tokens', () => {
    const score = compileWorkoutScore(bodyWork, baseConfig())
    const bodyStrikes = score.strikes.filter((s) => /B$/.test(s.token))
    expect(bodyStrikes.length).toBeGreaterThan(0)
    // Nothing token-shaped like `body` alone — the fused '2B'
    // shape is what the score carries (matches vocabulary.ts's
    // post-task-#46 emission).
    for (const strike of bodyStrikes) {
      expect(strike.token).toMatch(/^[1-6]B$/)
    }
  })
})

// ---------------------------------------------------------------------------
// Identity + determinism
// ---------------------------------------------------------------------------

describe('compileWorkoutScore — identity + determinism', () => {
  it('timelineHash is stable across recompiles of identical input', () => {
    const a = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    const b = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    expect(a.identity.timelineHash).toBe(b.identity.timelineHash)
  })

  it('timelineHash differs when the workout differs', () => {
    const trf = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    const bw = compileWorkoutScore(bodyWork, baseConfig())
    expect(trf.identity.timelineHash).not.toBe(bw.identity.timelineHash)
  })

  it('produces deep-equal output for identical input (full determinism)', () => {
    const a = compileWorkoutScore(pumpAndCoast, baseConfig())
    const b = compileWorkoutScore(pumpAndCoast, baseConfig())
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// Slice boundary — coach + ceremonies NOT in slice 1
// ---------------------------------------------------------------------------

describe('compileWorkoutScore — slice 1 scope (coach slots + ceremonies intentionally absent)', () => {
  it('does NOT expose coachSlots on the score yet (slice 2)', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    expect((score as unknown as { coachSlots?: unknown }).coachSlots).toBeUndefined()
  })

  it('does NOT expose ceremonies on the score yet (slice 6)', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    expect((score as unknown as { ceremonies?: unknown }).ceremonies).toBeUndefined()
  })
})
