/**
 * Round schedules (M31-03, doc §9).
 *
 * These numbers are consumed by goal allocation, pacing and the recipe
 * summary, so an error here would propagate silently into every derived
 * figure the athlete sees. The table is asserted cell for cell, and the
 * totals are checked independently — the doc's own arithmetic is verified
 * rather than assumed.
 */

import {
  buildRoundSchedule,
  totalScheduleMs,
  type WorkoutDurationMinutes,
} from '../roundSchedule'

const ALL_DURATIONS: WorkoutDurationMinutes[] = [20, 30, 40, 60]

describe('buildRoundSchedule — doc §9 table', () => {
  it.each([
    [20, 5, false],
    [30, 7, true],
    [40, 10, false],
    [60, 15, false],
  ] as Array<[WorkoutDurationMinutes, number, boolean]>)(
    '%i minutes has %i scored rounds (warm-up: %s)',
    (minutes, rounds, hasWarmUp) => {
      const schedule = buildRoundSchedule(minutes)
      expect(schedule.scoredRoundCount).toBe(rounds)
      expect(schedule.entries.filter((e) => e.kind === 'round')).toHaveLength(rounds)
      expect(schedule.entries.some((e) => e.kind === 'warm-up')).toBe(hasWarmUp)
    },
  )

  it.each([
    [20, 900],
    [30, 1260],
    [40, 1800],
    [60, 2700],
  ] as Array<[WorkoutDurationMinutes, number]>)(
    '%i minutes has %i active seconds',
    (minutes, activeSeconds) => {
      expect(buildRoundSchedule(minutes).activeSeconds).toBe(activeSeconds)
    },
  )

  it('gives every duration exactly one cooldown', () => {
    for (const minutes of ALL_DURATIONS) {
      expect(buildRoundSchedule(minutes).entries.filter((e) => e.kind === 'cooldown')).toHaveLength(1)
    }
  })

  it('adds the 2:00 guided warm-up to the 30-minute schedule only', () => {
    const warmUp = buildRoundSchedule(30).entries.find((e) => e.kind === 'warm-up')
    expect(warmUp?.workDurationMs).toBe(120_000)
    for (const minutes of [20, 40, 60] as WorkoutDurationMinutes[]) {
      expect(buildRoundSchedule(minutes).entries.some((e) => e.kind === 'warm-up')).toBe(false)
    }
  })

  it('runs every scored round for exactly 3:00', () => {
    for (const minutes of ALL_DURATIONS) {
      for (const entry of buildRoundSchedule(minutes).entries.filter((e) => e.kind === 'round')) {
        expect(entry.workDurationMs).toBe(180_000)
      }
    }
  })

  it('places a 1:00 rest after every round except the last', () => {
    // A rest after the final round would double-count against the session
    // length, since the cooldown follows it directly.
    for (const minutes of ALL_DURATIONS) {
      const rounds = buildRoundSchedule(minutes).entries.filter((e) => e.kind === 'round')
      const rests = rounds.filter((r) => r.restAfterMs > 0)
      expect(rests).toHaveLength(rounds.length - 1)
      expect(rounds[rounds.length - 1]?.restAfterMs).toBe(0)
      for (const rest of rests) expect(rest.restAfterMs).toBe(60_000)
    }
  })
})

describe('countsTowardGoal', () => {
  it('is true for exactly the scored rounds', () => {
    for (const minutes of ALL_DURATIONS) {
      for (const entry of buildRoundSchedule(minutes).entries) {
        expect(entry.countsTowardGoal).toBe(entry.kind === 'round')
      }
    }
  })

  it('excludes warm-up and cooldown from activeSeconds', () => {
    // Including them would deflate every derived pace, since neither is
    // punching time.
    const schedule = buildRoundSchedule(30)
    const allWorkSeconds =
      schedule.entries.reduce((sum, e) => sum + e.workDurationMs, 0) / 1000
    expect(allWorkSeconds).toBeGreaterThan(schedule.activeSeconds)
    expect(schedule.activeSeconds).toBe(7 * 180)
  })
})

describe('schedule totals — verifying the doc\'s own arithmetic', () => {
  it.each([
    [20, 20],
    [30, 30],
    [40, 40],
    [60, 60],
  ] as Array<[WorkoutDurationMinutes, number]>)(
    '%i-minute schedule totals %i minutes of wall time',
    (minutes, expectedMinutes) => {
      // 20min: 5x180 + 4x60 + 60 = 900 + 240 + 60 = 1200s.
      // 30min: 120 + 7x180 + 6x60 + 60 = 1800s. And so on.
      expect(totalScheduleMs(buildRoundSchedule(minutes))).toBe(expectedMinutes * 60_000)
    },
  )
})

describe('entry ordering', () => {
  it('runs warm-up first, then rounds, then cooldown', () => {
    const kinds = buildRoundSchedule(30).entries.map((e) => e.kind)
    expect(kinds[0]).toBe('warm-up')
    expect(kinds[kinds.length - 1]).toBe('cooldown')
    expect(kinds.slice(1, -1).every((k) => k === 'round')).toBe(true)
  })

  it('starts with a round when there is no warm-up', () => {
    expect(buildRoundSchedule(20).entries[0]?.kind).toBe('round')
  })
})
