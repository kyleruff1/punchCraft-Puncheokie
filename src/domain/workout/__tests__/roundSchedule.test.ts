/**
 * Round schedules (M31-03, doc §9 as amended by D21).
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
    [20, 4, false],
    [30, 6, false],
    [40, 8, false],
    [60, 12, false],
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
    [20, 960],
    [30, 1440],
    [40, 1920],
    [60, 2880],
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

  it('has no warm-up at any duration (D21)', () => {
    // Doc §9 gave the 30-minute schedule alone a 2:00 warm-up. At 4:00 rounds
    // no integer round count keeps it and still lands on thirty minutes, and an
    // honest duration beat the asymmetry.
    for (const minutes of ALL_DURATIONS) {
      expect(buildRoundSchedule(minutes).entries.some((e) => e.kind === 'warm-up')).toBe(false)
    }
  })

  it('runs every scored round for exactly 4:00', () => {
    for (const minutes of ALL_DURATIONS) {
      for (const entry of buildRoundSchedule(minutes).entries.filter((e) => e.kind === 'round')) {
        expect(entry.workDurationMs).toBe(240_000)
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

  it('excludes the cooldown from activeSeconds', () => {
    // Including it would deflate every derived pace, since it is not punching
    // time.
    const schedule = buildRoundSchedule(30)
    const allWorkSeconds =
      schedule.entries.reduce((sum, e) => sum + e.workDurationMs, 0) / 1000
    expect(allWorkSeconds).toBeGreaterThan(schedule.activeSeconds)
    expect(schedule.activeSeconds).toBe(6 * 240)
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
      // A round, its rest and the shared cooldown make 300s per round, so
      // every duration is exactly `300 * rounds` seconds (D21).
      // 20min: 4x240 + 3x60 + 60 = 960 + 180 + 60 = 1200s. And so on.
      expect(totalScheduleMs(buildRoundSchedule(minutes))).toBe(expectedMinutes * 60_000)
    },
  )
})

describe('entry ordering', () => {
  it('runs rounds, then the cooldown', () => {
    const kinds = buildRoundSchedule(30).entries.map((e) => e.kind)
    expect(kinds[kinds.length - 1]).toBe('cooldown')
    expect(kinds.slice(0, -1).every((k) => k === 'round')).toBe(true)
  })

  it('starts with a round at every duration', () => {
    for (const minutes of ALL_DURATIONS) {
      expect(buildRoundSchedule(minutes).entries[0]?.kind).toBe('round')
    }
  })
})
