/**
 * Round goal allocation (#192).
 *
 * The invariant that carries everything: the targets sum **exactly** to the
 * goal. A plan whose rounds add to 1,198 when the athlete asked for 1,200
 * is quietly misrepresenting what it will ask of them.
 */
import {
  EXACT_COMBO_DENSITY_CEILING_PER_MIN,
  allocateRoundTargets,
  assessDensity,
} from '../goalAllocation'
import { buildRoundSchedule, type WorkoutDurationMinutes } from '../roundSchedule'
import { establishTheJab20, switchByRound, threeRoundFundamentals } from '../samples'
import type { ProgramRound, WorkoutBlock } from '../WorkoutTokens'
import type { WorkoutFocus } from '../punchGoals'

const FOCUSES: WorkoutFocus[] = ['hands', 'balanced', 'movement']
const DURATIONS: WorkoutDurationMinutes[] = [20, 30, 40, 60]

/** A schedule with no blocks laid out, as the recipe screen has it. */
function bareSchedule(minutes: WorkoutDurationMinutes): ProgramRound[] {
  return buildRoundSchedule(minutes).entries.map((entry, index) => ({
    id: `r${index}`,
    order: index + 1,
    kind: entry.kind,
    countsTowardGoal: entry.countsTowardGoal,
    theme: 'Test',
    workDurationMs: entry.workDurationMs,
    restAfterMs: entry.restAfterMs,
    targetPunches: 0,
    blocks: [],
  }))
}

function block(over: Partial<WorkoutBlock> = {}): WorkoutBlock {
  return {
    id: 'b',
    kind: 'exact-combo',
    startOffsetMs: 0,
    durationMs: 60_000,
    stance: 'inherit',
    tokens: [],
    gapBeats: 1,
    ...over,
  }
}

function roundWith(blocks: WorkoutBlock[], countsTowardGoal = true): ProgramRound {
  return {
    id: 'r',
    order: 1,
    kind: 'round',
    countsTowardGoal,
    theme: 'Test',
    workDurationMs: 180_000,
    restAfterMs: 60_000,
    targetPunches: 0,
    blocks,
  }
}

// ---------------------------------------------------------------------------

describe('the sum invariant', () => {
  it.each(
    DURATIONS.flatMap((minutes) => FOCUSES.map((focus) => [minutes, focus] as const)),
  )('sums exactly to the goal at %s minutes with %s focus', (minutes, focus) => {
    const schedule = bareSchedule(minutes)
    for (const goal of [800, 1_000, 1_237, 2_000, 4_500]) {
      const targets = allocateRoundTargets(goal, schedule, focus)
      expect(targets.reduce((a, b) => a + b, 0)).toBe(goal)
    }
  })

  it('sums exactly for goals that divide badly', () => {
    // Seven rounds, a prime goal: the remainder has to go somewhere.
    const schedule = bareSchedule(40)
    const targets = allocateRoundTargets(997, schedule, 'balanced')
    expect(targets.reduce((a, b) => a + b, 0)).toBe(997)
  })

  it('sums exactly across the shipped samples', () => {
    for (const workout of [threeRoundFundamentals, establishTheJab20, switchByRound]) {
      const targets = allocateRoundTargets(1_500, workout.schedule, 'balanced')
      expect(targets.reduce((a, b) => a + b, 0)).toBe(1_500)
    }
  })
})

describe('non-scoring rounds get nothing (doc §9)', () => {
  it('assigns zero to warm-up and cooldown', () => {
    const schedule = bareSchedule(60)
    const targets = allocateRoundTargets(3_000, schedule, 'balanced')
    schedule.forEach((round, index) => {
      if (!round.countsTowardGoal) expect(targets[index]).toBe(0)
    })
  })

  it('still sums to the goal with non-scoring rounds present', () => {
    const schedule = bareSchedule(60)
    expect(schedule.some((r) => !r.countsTowardGoal)).toBe(true)
    expect(allocateRoundTargets(3_000, schedule, 'balanced').reduce((a, b) => a + b, 0)).toBe(3_000)
  })

  it('gives every round zero when nothing counts', () => {
    const schedule = [roundWith([], false), roundWith([], false)]
    expect(allocateRoundTargets(1_000, schedule, 'balanced')).toEqual([0, 0])
  })
})

describe('weighting', () => {
  it('gives equal rounds equal targets', () => {
    const schedule = [roundWith([]), roundWith([]), roundWith([])]
    expect(allocateRoundTargets(300, schedule, 'balanced')).toEqual([100, 100, 100])
  })

  it('gives a count-scored round a larger share than an enumerated one', () => {
    // A burst absorbs far more output per minute than a named combination,
    // so asking both rounds for the same count would under-use one and
    // over-ask the other (doc §14, §17).
    const enumerated = roundWith([block({ kind: 'exact-combo' })])
    const burst = roundWith([block({ kind: 'volume-burst' })])
    const [a, b] = allocateRoundTargets(1_000, [enumerated, burst], 'balanced')
    expect(b!).toBeGreaterThan(a!)
  })

  it('scales the burst advantage with focus (doc §10)', () => {
    // Under a movement focus even a burst leaves time for footwork, so it
    // pulls less of the round's share than the same burst under hands.
    const enumerated = roundWith([block({ kind: 'exact-combo' })])
    const burst = roundWith([block({ kind: 'volume-burst' })])

    const hands = allocateRoundTargets(1_000, [enumerated, burst], 'hands')
    const movement = allocateRoundTargets(1_000, [enumerated, burst], 'movement')
    expect(hands[1]!).toBeGreaterThan(movement[1]!)
  })

  it('weights a longer round above a shorter one', () => {
    const short = { ...roundWith([]), workDurationMs: 60_000 }
    const long = { ...roundWith([]), workDurationMs: 180_000 }
    const [a, b] = allocateRoundTargets(400, [short, long], 'balanced')
    expect(b!).toBeGreaterThan(a!)
  })
})

describe('determinism (spec §13.6)', () => {
  it('returns an identical array for identical inputs', () => {
    const schedule = bareSchedule(30)
    const first = allocateRoundTargets(1_500, schedule, 'balanced')
    expect(allocateRoundTargets(1_500, schedule, 'balanced')).toEqual(first)
  })

  it('spreads a remainder deterministically rather than by array identity', () => {
    const schedule = [roundWith([]), roundWith([]), roundWith([])]
    // 100 over 3 equal rounds: 33/33/34 in some fixed order, every time.
    const targets = allocateRoundTargets(100, schedule, 'balanced')
    expect(targets.reduce((a, b) => a + b, 0)).toBe(100)
    expect(allocateRoundTargets(100, schedule, 'balanced')).toEqual(targets)
  })
})

describe('edge cases', () => {
  it('allocates nothing for a zero or negative goal', () => {
    const schedule = bareSchedule(20)
    expect(allocateRoundTargets(0, schedule, 'balanced').every((t) => t === 0)).toBe(true)
    expect(allocateRoundTargets(-50, schedule, 'balanced').every((t) => t === 0)).toBe(true)
  })

  it('handles an empty schedule', () => {
    expect(allocateRoundTargets(1_000, [], 'balanced')).toEqual([])
  })

  it('never allocates a negative target', () => {
    const schedule = bareSchedule(60)
    for (const target of allocateRoundTargets(2_500, schedule, 'movement')) {
      expect(target).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('the high-goal rule (doc §17)', () => {
  it('reports a reachable target as needing no volume blocks', () => {
    // 180 punches over 3 minutes at 3 per combo is 20 combos/minute, under
    // the ceiling.
    const assessment = assessDensity(180, 180_000, 3)
    expect(assessment.needsVolumeBlocks).toBe(false)
    expect(assessment.suggestedVolumeShare).toBe(0)
  })

  it('reports a target above the ceiling as needing volume blocks', () => {
    // The plan must add volume rather than compress every pause until the
    // commands stop being intelligible.
    const assessment = assessDensity(600, 180_000, 3)
    expect(assessment.needsVolumeBlocks).toBe(true)
    expect(assessment.suggestedVolumeShare).toBeGreaterThan(0)
  })

  it('caps the suggested volume share at the whole round', () => {
    const assessment = assessDensity(10_000, 180_000, 2)
    expect(assessment.suggestedVolumeShare).toBeLessThanOrEqual(1)
  })

  it('puts the boundary exactly at the ceiling', () => {
    const comboLength = 4
    const activeMinutes = 3
    const atCeiling = EXACT_COMBO_DENSITY_CEILING_PER_MIN * comboLength * activeMinutes
    expect(assessDensity(atCeiling, 180_000, comboLength).needsVolumeBlocks).toBe(false)
    expect(assessDensity(atCeiling + comboLength * activeMinutes, 180_000, comboLength)
      .needsVolumeBlocks).toBe(true)
  })

  it('reports the implied pace it judged on', () => {
    expect(assessDensity(360, 180_000, 3).impliedPacePerMin).toBe(120)
  })

  it('degrades safely on nonsense input', () => {
    expect(assessDensity(100, 0, 3).needsVolumeBlocks).toBe(false)
    expect(assessDensity(100, 180_000, 0).needsVolumeBlocks).toBe(false)
  })
})
