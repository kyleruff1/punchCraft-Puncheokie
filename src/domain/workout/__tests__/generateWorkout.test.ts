import { generateWorkout } from '../generateWorkout'
import { validateGeneratedWorkout, scoredRounds } from '../GeneratedWorkout'
import { buildRoundSchedule } from '../roundSchedule'
import { defaultRecipe, type WorkoutRecipe } from '../WorkoutRecipe'
import { GOAL_TIERS } from '../punchGoals'
import { punchTokens } from '../WorkoutTokens'
import type { PunchNumber } from '../WorkoutTokens'

const recipe = (over: Partial<WorkoutRecipe> = {}): WorkoutRecipe => ({
  ...defaultRecipe(),
  seed: 'test-seed',
  ...over,
})

/** Every enumerated punch a workout prescribes, block by block. */
function allPunches(workout: ReturnType<typeof generateWorkout>) {
  return workout.schedule.flatMap((round) => round.blocks.flatMap((b) => punchTokens(b.tokens)))
}

describe('generateWorkout — validity across the recipe matrix', () => {
  const durations = [20, 30, 40, 60] as const
  const focuses = ['hands', 'balanced', 'movement'] as const
  const cadences = ['technical', 'steady', 'pressure', 'sprint'] as const
  const biases = ['balanced', 'lead', 'rear'] as const

  const cases: WorkoutRecipe[] = []
  for (const durationMinutes of durations) {
    for (const focus of focuses) {
      for (const cadenceProfile of cadences) {
        for (const bias of biases) {
          cases.push(
            recipe({
              durationMinutes,
              focus,
              cadenceProfile,
              bias,
              totalPunchGoal: GOAL_TIERS.hard[durationMinutes],
            }),
          )
        }
      }
    }
  }

  it.each(cases.map((r) => [`${r.durationMinutes}m/${r.focus}/${r.cadenceProfile}/${r.bias}`, r] as const))(
    'produces a structurally valid workout for %s',
    (_label, r) => {
      const workout = generateWorkout(r)
      expect(validateGeneratedWorkout(workout)).toEqual([])
    },
  )

  it('is valid for every goal tier', () => {
    for (const tier of ['technique', 'steady', 'hard', 'high-volume', 'extreme'] as const) {
      const workout = generateWorkout(recipe({ totalPunchGoal: GOAL_TIERS[tier][20] }))
      expect(validateGeneratedWorkout(workout)).toEqual([])
    }
  })
})

describe('generateWorkout — targets and structure', () => {
  it('round targets sum exactly to the goal', () => {
    for (const durationMinutes of [20, 30, 40, 60] as const) {
      const goal = GOAL_TIERS.steady[durationMinutes]
      const workout = generateWorkout(recipe({ durationMinutes, totalPunchGoal: goal }))
      const sum = workout.roundPunchTargets.reduce((a, b) => a + b, 0)
      expect(sum).toBe(goal)
    }
  })

  it('emits one round target per scored round', () => {
    const workout = generateWorkout(recipe({ durationMinutes: 30 }))
    const schedule = buildRoundSchedule(30)
    expect(workout.roundPunchTargets).toHaveLength(schedule.scoredRoundCount)
    expect(scoredRounds(workout.schedule)).toHaveLength(schedule.scoredRoundCount)
  })

  it('closes with a non-scored cooldown and scores exactly the rounds', () => {
    // No warm-up at any duration since D21 — see roundSchedule's SHAPES.
    const workout = generateWorkout(recipe({ durationMinutes: 30 }))
    const kinds = workout.schedule.map((r) => r.kind)
    expect(kinds[0]).toBe('round')
    expect(kinds[kinds.length - 1]).toBe('cooldown')
    for (const round of workout.schedule) {
      expect(round.countsTowardGoal).toBe(round.kind === 'round')
    }
  })

  it('escalates: later scored rounds reach longer combinations than the first', () => {
    const workout = generateWorkout(recipe({ durationMinutes: 40, comboComplexity: 5, maximumComboPunches: 5 }))
    const scored = scoredRounds(workout.schedule)
    const maxLen = (round: (typeof scored)[number]) =>
      Math.max(0, ...round.blocks.map((b) => punchTokens(b.tokens).length))
    const first = maxLen(scored[0]!)
    const last = maxLen(scored[scored.length - 1]!)
    expect(last).toBeGreaterThan(first)
  })
})

describe('generateWorkout — determinism', () => {
  it('reproduces an identical plan for the same recipe', () => {
    const r = recipe({ seed: 'reproducible', durationMinutes: 40 })
    expect(generateWorkout(r)).toEqual(generateWorkout(r))
  })

  it('produces a different plan for a different seed', () => {
    const a = generateWorkout(recipe({ seed: 'seed-a', durationMinutes: 40 }))
    const b = generateWorkout(recipe({ seed: 'seed-b', durationMinutes: 40 }))
    expect(a.schedule).not.toEqual(b.schedule)
  })
})

describe('generateWorkout — respects enablement', () => {
  it('never prescribes a disabled punch', () => {
    const enabledPunches: PunchNumber[] = [1, 2, 3]
    const workout = generateWorkout(recipe({ enabledPunches }))
    for (const punch of allPunches(workout)) {
      expect(enabledPunches).toContain(punch.number)
    }
  })

  it('never enumerates a combo longer than the maximum', () => {
    const workout = generateWorkout(recipe({ maximumComboPunches: 3 }))
    for (const round of workout.schedule) {
      for (const block of round.blocks) {
        expect(punchTokens(block.tokens).length).toBeLessThanOrEqual(3)
      }
    }
  })

  it('produces a valid workout even from a single enabled punch', () => {
    const workout = generateWorkout(recipe({ enabledPunches: [1], bodyShotPercent: 0 }))
    expect(validateGeneratedWorkout(workout)).toEqual([])
    expect(allPunches(workout).every((p) => p.number === 1)).toBe(true)
  })
})

describe('generateWorkout — distribution', () => {
  it('is jab-heavy under a balanced bias', () => {
    const workout = generateWorkout(recipe({ durationMinutes: 40 }))
    const dist = workout.expectedTechniqueDistribution
    // A body jab is a jab — the corpus's body-variation phase (D26) sends
    // the same lead hand downstairs, so §15's jab dominance sums both.
    const jab = (dist['1'] ?? 0) + (dist['1b'] ?? 0)
    for (const [key, share] of Object.entries(dist)) {
      if (key === '1' || key === '1b') continue
      expect(jab).toBeGreaterThanOrEqual(share)
    }
  })

  it('shifts rear-hand share up under a rear bias', () => {
    const rearShare = (dist: Record<string, number>) =>
      Object.entries(dist)
        .filter(([key]) => [2, 4, 6].includes(Number(key.replace('b', ''))))
        .reduce((sum, [, share]) => sum + share, 0)

    // A single draw can land the two biases equal by luck of the block
    // deals (it did, at generator 1.2.0), so the property is asserted on
    // the average across seeds rather than one workout.
    const seeds = ['bias-a', 'bias-b', 'bias-c', 'bias-d']
    const mean = (bias: 'lead' | 'rear') =>
      seeds.reduce(
        (sum, seed) =>
          sum +
          rearShare(
            generateWorkout(recipe({ durationMinutes: 40, bias, seed }))
              .expectedTechniqueDistribution,
          ),
        0,
      ) / seeds.length
    expect(mean('rear')).toBeGreaterThan(mean('lead'))
  })
})

describe('generateWorkout — warnings', () => {
  it('warns and adds volume blocks for an extreme goal at high cadence', () => {
    const workout = generateWorkout(
      recipe({ durationMinutes: 60, totalPunchGoal: GOAL_TIERS.extreme[60], cadenceProfile: 'sprint' }),
    )
    expect(validateGeneratedWorkout(workout)).toEqual([])
    // D26: the clock is filled first; an unreachable goal surfaces as drift.
    expect(workout.warnings.some((w) => w.includes('differ from the goal'))).toBe(true)
    const hasVolumeBlock = workout.schedule.some((r) =>
      r.blocks.some((b) => b.kind === 'volume-burst' || b.kind === 'open-pressure'),
    )
    expect(hasVolumeBlock).toBe(true)
  })

  it('has no warnings for a comfortable steady workout', () => {
    const workout = generateWorkout(recipe({ durationMinutes: 20, totalPunchGoal: GOAL_TIERS.technique[20] }))
    expect(workout.warnings).toEqual([])
  })
})
