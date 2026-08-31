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
import { expandTimeline } from '../CueTimeline'
import { TRANSPORT_TICKS_PER_PULSE } from '../../timing/TimingEngine'
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
      preloadMarginTicks: 300, // default from workoutScore.ts
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

  it('places each strike at its AUTHORED offset — the cue offset is counted exactly once', () => {
    // Regression, GH #305 blocker 1. `compileWorkoutScore` used to add
    // `ticksAtMs(cue.scheduledStartMs)` on top of a compiled tick that
    // already contained it (`programCueBridge` puts the same offset in
    // `executeAtTick`, and `compileCue` builds every strike from
    // `executeAtTick + …`). Every event therefore landed at roughly
    // TWICE its authored offset into the round, and none of the 38
    // tests here noticed — they all asserted ordering and bounds,
    // which a uniform doubling preserves. This one asserts the
    // absolute position, so a re-offset fails loudly.
    const bpm = 120
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig({ bpm }))
    const timeline = expandTimeline(threeRoundFundamentals, 'orthodox', bpm)

    // Round 0 starts at tick 0, so a round-0 cue's first strike lands on
    // the cue's authored millisecond offset, expressed in ticks. (Only
    // the FIRST strike: positions WITHIN a cue come off `compileCue`'s
    // step grid, which is a separate mapping from `tokenOffsetsMs`.)
    const round0 = timeline[0]!
    const msToTicks = (ms: number) => Math.round(ms / (60_000 / (60 * TRANSPORT_TICKS_PER_PULSE)))

    let checked = 0
    for (const cue of round0.cues) {
      const first = score.strikes.find((s) => s.cueId === cue.id && s.roundIndex === 0)
      if (!first) continue
      // ±1 tick for the independent rounding on each side.
      expect(Math.abs(first.startTick - msToTicks(cue.scheduledStartMs))).toBeLessThanOrEqual(1)
      checked += 1
    }
    // Guard the guard: a lookup that silently matched nothing would
    // make the loop above vacuously true.
    expect(checked).toBeGreaterThan(10)

    // And the round's content must fit inside the round. Under the
    // double-count the last round-0 strike sat at 209 s of a 240 s
    // round instead of 104 s — the tell that everything was stretched.
    const lastStrike = score.strikes.filter((s) => s.roundIndex === 0).at(-1)!
    const lastCue = round0.cues.at(-1)!
    expect(lastStrike.startTick).toBeLessThanOrEqual(msToTicks(lastCue.windowEndMs))
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

describe('compileWorkoutScore — slice boundary (ceremonies still intentionally absent)', () => {
  it('exposes coachSlots on the score (slice 2 shipped)', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    expect(Array.isArray(score.coachSlots)).toBe(true)
  })

  it('does NOT expose ceremonies on the score yet (slice 6)', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    expect((score as unknown as { ceremonies?: unknown }).ceremonies).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Slice 2 — coachSlots
// ---------------------------------------------------------------------------

/**
 * A CoachAssetResolver stub that returns fixed asset ids for
 * both vocabularies. Duration proportional to vocabulary to
 * exercise the CONSERVATIVE reservation window (technique is
 * always longer here so the slot's end matches technique.end).
 */
const stubCoachAssets = (
  contentKind: string,
  vocabulary: 'numeric' | 'technique',
) => ({
  assetId: `stub:${contentKind}:${vocabulary}`,
  mappedDurationTicks: vocabulary === 'numeric' ? 240 : 480,
})

describe('compileWorkoutScore — coach slots (slice 2)', () => {
  it('emits ZERO coachSlots when the resolver is the default NULL resolver', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    expect(score.coachSlots.length).toBe(0)
  })

  it('emits coachSlots when a resolver returns non-null asset refs', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, {
      ...baseConfig(),
      coachAssets: stubCoachAssets,
    })
    expect(score.coachSlots.length).toBeGreaterThan(0)
    for (const slot of score.coachSlots) {
      expect(typeof slot.slotId).toBe('string')
      expect(typeof slot.cueId).toBe('string')
      expect(typeof slot.roundIndex).toBe('number')
      expect(typeof slot.contentKind).toBe('string')
      expect(typeof slot.relation).toBe('string')
      expect(Array.isArray(slot.strikeEventIds)).toBe(true)
      expect(typeof slot.desiredAudibleEndTick).toBe('number')
      expect(typeof slot.reservationStartTick).toBe('number')
      expect(typeof slot.reservationEndTick).toBe('number')
      expect(typeof slot.vocabLockAtTick).toBe('number')
    }
  })

  it('every slot carries BOTH numeric + technique variants when both vocabs resolve', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, {
      ...baseConfig(),
      coachAssets: stubCoachAssets,
    })
    for (const slot of score.coachSlots) {
      expect(slot.variants.numeric).toBeDefined()
      expect(slot.variants.technique).toBeDefined()
      expect(slot.variants.numeric!.vocabulary).toBe('numeric')
      expect(slot.variants.technique!.vocabulary).toBe('technique')
    }
  })

  it('each variant carries assetId, measuredDurationTicks, capabilities, absolute ticks', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, {
      ...baseConfig(),
      coachAssets: stubCoachAssets,
    })
    const slot = score.coachSlots[0]!
    for (const variant of [slot.variants.numeric!, slot.variants.technique!]) {
      expect(typeof variant.assetId).toBe('string')
      expect(variant.measuredDurationTicks).toBeGreaterThanOrEqual(0)
      // audibleStartTick CAN be negative — a precall for the very
      // first strike of the workout begins before round-start
      // (tick 0). The runtime dispatcher clamps to 0 or drops
      // events that start before the transport is running; the
      // score simply records the authored intent.
      expect(Number.isFinite(variant.audibleStartTick)).toBe(true)
      expect(variant.audibleEndTick).toBeGreaterThan(variant.audibleStartTick)
      expect(Array.isArray(variant.taughtStrikeAnchors)).toBe(true)
      expect(Array.isArray(variant.capabilities.allowedRelations)).toBe(true)
    }
  })

  it('reservation window is the CONSERVATIVE union — end = max of variants, start = min (principle #4)', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, {
      ...baseConfig(),
      coachAssets: stubCoachAssets,
    })
    for (const slot of score.coachSlots) {
      const numEnd = slot.variants.numeric?.audibleEndTick
      const techEnd = slot.variants.technique?.audibleEndTick
      const ends = [numEnd, techEnd].filter((x): x is number => x !== undefined)
      expect(slot.desiredAudibleEndTick).toBe(Math.max(...ends))
      const numStart = slot.variants.numeric?.audibleStartTick
      const techStart = slot.variants.technique?.audibleStartTick
      const starts = [numStart, techStart].filter((x): x is number => x !== undefined)
      expect(slot.reservationStartTick).toBe(Math.min(...starts))
      expect(slot.reservationEndTick).toBe(slot.desiredAudibleEndTick)
    }
  })

  it('vocabLockAtTick is reservationStart minus the configured preload margin (principle #8)', () => {
    const preloadMarginTicks = 500
    const score = compileWorkoutScore(threeRoundFundamentals, {
      ...baseConfig(),
      coachAssets: stubCoachAssets,
      preloadMarginTicks,
    })
    for (const slot of score.coachSlots) {
      expect(slot.vocabLockAtTick).toBe(slot.reservationStartTick - preloadMarginTicks)
    }
    expect(score.config.preloadMarginTicks).toBe(preloadMarginTicks)
  })

  it('capabilities default to permissive (all three relations allowed)', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, {
      ...baseConfig(),
      coachAssets: stubCoachAssets,
    })
    for (const slot of score.coachSlots) {
      for (const variant of [slot.variants.numeric, slot.variants.technique]) {
        if (!variant) continue
        expect(variant.capabilities.allowedRelations).toEqual(
          expect.arrayContaining(['precall', 'synchronized', 'shared-block']),
        )
      }
    }
  })

  it('accepts a caller override for capabilities and stamps them on the variant', () => {
    const strictCapabilities = {
      allowedRelations: ['precall'] as const,
      minimumSynchronizedSlotTicks: 500,
    }
    const score = compileWorkoutScore(threeRoundFundamentals, {
      ...baseConfig(),
      coachAssets: stubCoachAssets,
      coachCapabilitiesFor: () => strictCapabilities,
    })
    for (const slot of score.coachSlots) {
      for (const variant of [slot.variants.numeric, slot.variants.technique]) {
        if (!variant) continue
        expect(variant.capabilities.allowedRelations).toEqual(['precall'])
        expect(variant.capabilities.minimumSynchronizedSlotTicks).toBe(500)
      }
    }
  })

  it('emits a single-variant slot when the resolver returns undefined for one vocab', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, {
      ...baseConfig(),
      coachAssets: (contentKind, vocabulary) =>
        vocabulary === 'numeric' ? stubCoachAssets(contentKind, vocabulary) : undefined,
    })
    expect(score.coachSlots.length).toBeGreaterThan(0)
    for (const slot of score.coachSlots) {
      expect(slot.variants.numeric).toBeDefined()
      expect(slot.variants.technique).toBeUndefined()
    }
  })

  it('slotIds are unique across the entire score', () => {
    const score = compileWorkoutScore(threeRoundFundamentals, {
      ...baseConfig(),
      coachAssets: stubCoachAssets,
    })
    const ids = new Set(score.coachSlots.map((s) => s.slotId))
    expect(ids.size).toBe(score.coachSlots.length)
  })

  it('coachSlots shift the timelineHash — hash depends on coach content', () => {
    const withCoach = compileWorkoutScore(threeRoundFundamentals, {
      ...baseConfig(),
      coachAssets: stubCoachAssets,
    })
    const withoutCoach = compileWorkoutScore(threeRoundFundamentals, baseConfig())
    expect(withCoach.identity.timelineHash).not.toBe(withoutCoach.identity.timelineHash)
  })

  it('is fully deterministic — identical inputs (config + resolver) → deep-equal output including slots', () => {
    const a = compileWorkoutScore(threeRoundFundamentals, {
      ...baseConfig(),
      coachAssets: stubCoachAssets,
    })
    const b = compileWorkoutScore(threeRoundFundamentals, {
      ...baseConfig(),
      coachAssets: stubCoachAssets,
    })
    expect(a).toEqual(b)
  })
})
