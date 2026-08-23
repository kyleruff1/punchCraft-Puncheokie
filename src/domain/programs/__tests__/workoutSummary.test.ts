/**
 * Workout summary (M33-08).
 *
 * The load-bearing test is the golden recomputation: the same persisted
 * rows must produce a deep-equal summary, because that is what makes a
 * stored workout recalculable after a logic change (spec §8.6, §19.1, D8).
 *
 * The rest are honesty checks — velocity disclosed rather than implied,
 * sequence figures labelled rather than asserted, and absence rendered as
 * absence rather than as zero.
 */
import {
  WORKOUT_SUMMARY_CALCULATION_VERSION,
  computeWorkoutSummary,
  connectionCompleteness,
  type SummaryCueOutcome,
  type SummaryCueResult,
} from '../workoutSummary'
import { threeRoundFundamentals } from '../../workout/samples'
import type { GeneratedWorkout } from '../../workout/GeneratedWorkout'

const WORKOUT: GeneratedWorkout = threeRoundFundamentals

/** Every block id, so fixtures can attribute rows to real rounds. */
const BLOCK_IDS = WORKOUT.schedule.map((r) => r.blocks.map((b) => b.id))

function row(over: Partial<SummaryCueResult> = {}): SummaryCueResult {
  return {
    blockId: BLOCK_IDS[0]![0]!,
    tokenIndex: 0,
    expectedHand: 'left',
    outcome: 'matched',
    offsetMs: 0,
    velocityRaw: 10,
    velocityUnit: 'tracker-unit',
    capabilityTier: 'hand-timestamp',
    ...over,
  }
}

/** A fixture spanning all three rounds with a mix of outcomes. */
function fixtureRows(): SummaryCueResult[] {
  const rows: SummaryCueResult[] = []
  WORKOUT.schedule.forEach((round, roundIndex) => {
    const blockId = BLOCK_IDS[roundIndex]![0]!
    for (let i = 0; i < 10; i++) {
      rows.push(
        row({
          blockId,
          tokenIndex: i,
          expectedHand: i % 2 === 0 ? 'left' : 'right',
          outcome: i < 7 ? 'matched' : i < 9 ? 'hand-mismatch' : 'missed',
          velocityRaw: 8 + (i % 4),
        }),
      )
    }
  })
  return rows
}

const summary = (
  rows: SummaryCueResult[] = fixtureRows(),
  over: Partial<Parameters<typeof computeWorkoutSummary>[0]> = {},
) => computeWorkoutSummary({ workout: WORKOUT, cueResults: rows, ...over })

// ---------------------------------------------------------------------------

describe('golden recomputation (spec §8.6, §19.1, D8)', () => {
  it('produces a deep-equal summary from the same persisted rows', () => {
    // This is the property that makes history survive a logic change: the
    // stored rows are the input, and the version pins the output.
    const rows = fixtureRows()
    const live = computeWorkoutSummary({ workout: WORKOUT, cueResults: rows })

    // Round-trip the rows through JSON, as persistence would.
    const persisted = JSON.parse(JSON.stringify(rows)) as SummaryCueResult[]
    const recomputed = computeWorkoutSummary({ workout: WORKOUT, cueResults: persisted })

    expect(recomputed).toEqual(live)
  })

  it('is stamped with its own calculation version', () => {
    expect(summary().calculationVersion).toBe(WORKOUT_SUMMARY_CALCULATION_VERSION)
  })

  it('does not depend on row order', () => {
    const rows = fixtureRows()
    const forward = computeWorkoutSummary({ workout: WORKOUT, cueResults: rows })
    const reversed = computeWorkoutSummary({ workout: WORKOUT, cueResults: [...rows].reverse() })
    expect(reversed).toEqual(forward)
  })

  it('mutates nothing it was given', () => {
    const rows = fixtureRows()
    const before = JSON.stringify(rows)
    computeWorkoutSummary({ workout: WORKOUT, cueResults: rows })
    expect(JSON.stringify(rows)).toBe(before)
  })
})

describe('reads the realized stream, never the recipe (D8)', () => {
  it('grades against the recipe goal but counts from the rows', () => {
    const result = summary()
    expect(result.target).toBe(WORKOUT.recipe.totalPunchGoal)
    // 9 of every 10 rows landed, across three rounds.
    expect(result.totalPunches).toBe(27)
  })

  it('carries the seed and generator version so the plan can be reproduced', () => {
    const result = summary()
    expect(result.seed).toBe(WORKOUT.recipe.seed)
    expect(result.generatorVersion).toBe(WORKOUT.recipe.generatorVersion)
  })
})

describe('what counts as a landed punch', () => {
  it.each([
    ['matched', true],
    ['hand-mismatch', true],
    ['type-mismatch', true],
    ['late', true],
    ['missed', false],
    ['during-pause', false],
  ] as Array<[SummaryCueOutcome, boolean]>)('%s counts as landed: %s', (outcome, counts) => {
    // A wrong-hand punch was still thrown; a missed one was not. Counting a
    // hand mismatch as "nothing happened" would erase work the athlete did.
    const result = summary([row({ outcome })])
    expect(result.totalPunches).toBe(counts ? 1 : 0)
  })

  it('counts extras toward the total (doc §21)', () => {
    const result = summary(fixtureRows(), { extraPunches: 5 })
    expect(result.totalPunches).toBe(32)
    expect(result.extraPunches).toBe(5)
  })
})

describe('velocity is disclosed, never implied (spec §8.5, §4.3)', () => {
  it('states the representation for tracker units', () => {
    expect(summary().velocityRepresentation).toMatch(/tracker units/i)
    expect(summary().velocityRepresentation).toMatch(/not a physical measurement/i)
  })

  it('says so plainly when nothing was recorded', () => {
    const rows = fixtureRows().map((r) => ({ ...r, velocityRaw: null, velocityUnit: null }))
    const result = summary(rows)
    expect(result.velocityRepresentation).toMatch(/no velocity/i)
    // Absent, not zero (D11).
    expect(result.avgVelocity).toBeUndefined()
    expect(result.peakVelocity).toBeUndefined()
  })

  it('names a calibrated unit when one was stored', () => {
    const rows = fixtureRows().map((r) => ({ ...r, velocityUnit: 'm/s' }))
    expect(summary(rows).velocityRepresentation).toMatch(/calibrated/i)
  })

  it('never labels velocity with a physical unit it was not given', () => {
    expect(JSON.stringify(summary())).not.toMatch(/\bmph\b|\bm\/s\b|newton|joule/i)
  })

  it('reports average and peak from the stored values', () => {
    const rows = [row({ velocityRaw: 6 }), row({ velocityRaw: 10 }), row({ velocityRaw: 14 })]
    const result = summary(rows)
    expect(result.avgVelocity).toBe(10)
    expect(result.peakVelocity).toBe(14)
  })
})

describe('the sequence figure is labelled, never asserted (D4)', () => {
  it('says hand-sequence match at the tier this hardware reaches', () => {
    expect(summary().sequenceScoreLabel).toBe('hand-sequence match')
  })

  it('says technique match only at a distinct-type tier', () => {
    const rows = fixtureRows().map((r) => ({ ...r, capabilityTier: 'hand-distinct-type' }))
    expect(summary(rows).sequenceScoreLabel).toBe('technique match')
  })

  it('computes the percentage over expectations only', () => {
    // 7 matched of every 10 rows.
    expect(summary().handSequenceMatchPercent).toBe(70)
  })

  it('omits the percentage rather than reporting zero when nothing was expected', () => {
    const result = summary([])
    expect(result.handSequenceMatchPercent).toBeUndefined()
  })

  it('never uses the words technique accuracy', () => {
    expect(JSON.stringify(summary())).not.toMatch(/technique accuracy/i)
  })
})

describe('per-round breakdown', () => {
  it('produces one entry per round, in order', () => {
    const result = summary()
    expect(result.perRound).toHaveLength(WORKOUT.schedule.length)
    expect(result.perRound.map((r) => r.roundIndex)).toEqual([0, 1, 2])
  })

  it('carries each round theme', () => {
    expect(summary().perRound[0]?.theme).toBe(WORKOUT.schedule[0]?.theme)
  })

  it('grades each round against its own target', () => {
    const result = summary()
    for (const round of result.perRound) {
      expect(round.grade.delta).toBe(round.actual - round.target)
    }
  })

  it('splits left and right per round', () => {
    const round = summary().perRound[0]!
    expect(round.leftRight.left + round.leftRight.right).toBe(round.actual)
  })

  it('counts a round with nothing recorded as not completed', () => {
    // Not "completed with zero" — nobody reached it.
    const onlyFirst = fixtureRows().filter((r) => r.blockId === BLOCK_IDS[0]![0])
    expect(summary(onlyFirst).completedRounds).toBe(1)
  })

  it('identifies the most productive round', () => {
    const rows = [
      ...Array.from({ length: 3 }, () => row({ blockId: BLOCK_IDS[0]![0]! })),
      ...Array.from({ length: 9 }, () => row({ blockId: BLOCK_IDS[1]![0]! })),
    ]
    expect(summary(rows).mostProductiveRound).toBe(1)
  })
})

describe('adaptations', () => {
  it('counts how many the plan made', () => {
    const result = summary(fixtureRows(), {
      adaptations: [
        { decidedAtMonotonicMs: 1_000, boundary: 'rest' },
        { decidedAtMonotonicMs: 2_000, boundary: 'round' },
      ],
    })
    expect(result.adaptationCount).toBe(2)
  })

  it('reports zero when the plan was fixed', () => {
    expect(summary().adaptationCount).toBe(0)
  })
})

describe('connection completeness is kept separate', () => {
  it('reports the share of active time a tracker was streaming', () => {
    expect(connectionCompleteness(90_000, 180_000)).toBe(50)
  })

  it('never exceeds 100', () => {
    expect(connectionCompleteness(200_000, 180_000)).toBe(100)
  })

  it('handles a zero-length workout', () => {
    expect(connectionCompleteness(0, 0)).toBe(0)
  })

  it('is not part of the summary object', () => {
    // It describes the radio, not the athlete. Folding it in beside their
    // counts would invite reading a dropout as a performance dip (D13).
    expect(Object.keys(summary())).not.toContain('connectionCompleteness')
  })
})

describe('edge cases', () => {
  it('handles a workout with no recorded results', () => {
    const result = summary([])
    expect(result.totalPunches).toBe(0)
    expect(result.completedRounds).toBe(0)
    expect(result.grade.outcome).toBe('short')
  })

  it('computes an average rate over scored rounds only', () => {
    // Three 3-minute rounds: 27 punches over 9 minutes = 3/min.
    expect(summary().avgRatePerMin).toBe(3)
  })
})
