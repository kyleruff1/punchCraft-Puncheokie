/**
 * Punch-goal tiers (M31-03, doc §10).
 *
 * The matrix is asserted cell for cell, and the focus-scaling constants are
 * checked against the doc's *bands* for every cell rather than spot-checked
 * — rounding to the nearest 50 is where a factor could quietly leave its
 * band at the small end of the table.
 */

import {
  FOCUS_BANDS,
  GOAL_TIERS,
  TIER_LABELS,
  impliedTargets,
  intensityLabel,
  suggestGoal,
  type IntensityTier,
  type WorkoutFocus,
} from '../punchGoals'
import { buildRoundSchedule, type WorkoutDurationMinutes } from '../roundSchedule'

const DURATIONS: WorkoutDurationMinutes[] = [20, 30, 40, 60]
const TIERS: IntensityTier[] = ['technique', 'steady', 'hard', 'high-volume', 'extreme']
const FOCUSES: WorkoutFocus[] = ['hands', 'balanced', 'movement']

describe('GOAL_TIERS — doc §10 matrix', () => {
  it.each([
    ['technique', 800, 1200, 1600, 2400],
    ['steady', 1000, 1500, 2000, 3000],
    ['hard', 1200, 1800, 2400, 3600],
    ['high-volume', 1500, 2250, 3000, 4500],
    ['extreme', 2000, 3000, 4000, 6000],
  ] as Array<[IntensityTier, number, number, number, number]>)(
    '%s is %i / %i / %i / %i',
    (tier, m20, m30, m40, m60) => {
      expect(GOAL_TIERS[tier][20]).toBe(m20)
      expect(GOAL_TIERS[tier][30]).toBe(m30)
      expect(GOAL_TIERS[tier][40]).toBe(m40)
      expect(GOAL_TIERS[tier][60]).toBe(m60)
    },
  )

  it('increases monotonically with tier at every duration', () => {
    for (const minutes of DURATIONS) {
      for (let i = 1; i < TIERS.length; i++) {
        expect(GOAL_TIERS[TIERS[i]!][minutes]).toBeGreaterThan(GOAL_TIERS[TIERS[i - 1]!][minutes])
      }
    }
  })

  it('increases monotonically with duration at every tier', () => {
    for (const tier of TIERS) {
      for (let i = 1; i < DURATIONS.length; i++) {
        expect(GOAL_TIERS[tier][DURATIONS[i]!]).toBeGreaterThan(GOAL_TIERS[tier][DURATIONS[i - 1]!])
      }
    }
  })
})

describe('suggestGoal', () => {
  it('uses the tier value unchanged for a hands focus', () => {
    for (const minutes of DURATIONS) {
      for (const tier of TIERS) {
        expect(suggestGoal(minutes, tier, 'hands')).toBe(GOAL_TIERS[tier][minutes])
      }
    }
  })

  it('keeps EVERY cell inside its doc §10 band after rounding to 50', () => {
    // This is the assertion that matters: the constants sit mid-band, but
    // rounding could push a small cell outside. Checking all 15 cells x 2
    // scaled focuses rather than spot-checking.
    for (const minutes of DURATIONS) {
      for (const tier of TIERS) {
        const base = GOAL_TIERS[tier][minutes]
        for (const focus of ['balanced', 'movement'] as WorkoutFocus[]) {
          const ratio = suggestGoal(minutes, tier, focus) / base
          expect(ratio).toBeGreaterThanOrEqual(FOCUS_BANDS[focus].min)
          expect(ratio).toBeLessThanOrEqual(FOCUS_BANDS[focus].max)
        }
      }
    }
  })

  it('always returns a multiple of 50', () => {
    for (const minutes of DURATIONS) {
      for (const tier of TIERS) {
        for (const focus of FOCUSES) {
          expect(suggestGoal(minutes, tier, focus) % 50).toBe(0)
        }
      }
    }
  })

  it('orders movement <= balanced <= hands for every cell', () => {
    for (const minutes of DURATIONS) {
      for (const tier of TIERS) {
        const movement = suggestGoal(minutes, tier, 'movement')
        const balanced = suggestGoal(minutes, tier, 'balanced')
        const hands = suggestGoal(minutes, tier, 'hands')
        expect(movement).toBeLessThanOrEqual(balanced)
        expect(balanced).toBeLessThanOrEqual(hands)
      }
    }
  })
})

describe('impliedTargets — doc §10 20-minute vectors', () => {
  const schedule20 = buildRoundSchedule(20)

  it.each([
    [800, 200, 50],
    [1000, 250, 63],
    [1200, 300, 75],
    [1500, 375, 94],
    [2000, 500, 125],
  ])('a %i goal is %i per round and about %i per active minute', (goal, perRound, perMinute) => {
    const targets = impliedTargets(goal, schedule20)
    expect(targets.perScoredRound).toBe(perRound)
    expect(Math.round(targets.activePunchesPerMinute)).toBe(perMinute)
  })

  it('computes the rate against active seconds, not total session time', () => {
    // 20 minutes of session is only 16 minutes of punching; using session
    // time would understate the required pace by a fifth.
    const targets = impliedTargets(1000, schedule20)
    expect(targets.activePunchesPerMinute).toBeCloseTo(1000 / 16, 6)
    expect(targets.activePunchesPerMinute).not.toBeCloseTo(1000 / 20, 3)
  })

  it('excludes the cooldown from the per-round divisor', () => {
    const schedule30 = buildRoundSchedule(30)
    expect(impliedTargets(1500, schedule30).perScoredRound).toBeCloseTo(1500 / 6, 6)
  })
})

describe('intensityLabel', () => {
  it('names the exact tier for every matrix value', () => {
    for (const minutes of DURATIONS) {
      for (const tier of TIERS) {
        const described = intensityLabel(GOAL_TIERS[tier][minutes], minutes)
        expect(described.tier).toBe(tier)
        expect(described.label).toBe(TIER_LABELS[tier])
      }
    }
  })

  it('warns on the Extreme tier (doc §10, §25)', () => {
    for (const minutes of DURATIONS) {
      const described = intensityLabel(GOAL_TIERS.extreme[minutes], minutes)
      expect(described.warning).toBeDefined()
      expect(described.warning).toMatch(/high-volume/i)
    }
  })

  it('does not warn on any other tier', () => {
    for (const minutes of DURATIONS) {
      for (const tier of TIERS.filter((t) => t !== 'extreme')) {
        expect(intensityLabel(GOAL_TIERS[tier][minutes], minutes).warning).toBeUndefined()
      }
    }
  })

  it('snaps a between-tiers goal to the nearest tier', () => {
    // 20min: steady 1000, hard 1200. 1150 is nearer hard.
    expect(intensityLabel(1150, 20).tier).toBe('hard')
    expect(intensityLabel(1050, 20).tier).toBe('steady')
  })

  it('describes an exact midpoint conservatively, choosing the lower tier', () => {
    // 1100 is equidistant from steady (1000) and hard (1200). Flattering the
    // athlete's selection upward would misrepresent what they chose.
    expect(intensityLabel(1100, 20).tier).toBe('steady')
  })

  it('clamps beyond both ends of the table', () => {
    expect(intensityLabel(1, 20).tier).toBe('technique')
    expect(intensityLabel(999_999, 20).tier).toBe('extreme')
  })
})
