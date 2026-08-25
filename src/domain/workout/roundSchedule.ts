/**
 * Round schedules (M31-03, doc §9).
 *
 * The first release keeps the standard 3:00 work / 1:00 rest structure so
 * generation and target math stay predictable. There are deliberately **no
 * override parameters** — a user-configurable schedule would make every
 * downstream calculation (goal allocation, pacing, the recipe summary)
 * depend on an open-ended input for no first-release benefit (doc §9).
 *
 * Warm-up and cooldown are real work intervals that the SessionEngine runs
 * (#107), but they carry no punch goal: `countsTowardGoal` is false for
 * exactly those two, which is the same rule `ProgramRound` enforces (M31-01).
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

export type WorkoutDurationMinutes = 20 | 30 | 40 | 60

export interface RoundScheduleEntry {
  kind: 'warm-up' | 'round' | 'cooldown'
  workDurationMs: number
  restAfterMs: number
  countsTowardGoal: boolean
}

export interface RoundSchedule {
  durationMinutes: WorkoutDurationMinutes
  entries: RoundScheduleEntry[]
  /** Rounds carrying a punch goal — excludes warm-up and cooldown. */
  scoredRoundCount: number
  /**
   * Doc §9's "Active work time", in seconds. **Scored rounds only** — the
   * warm-up and cooldown occupy session time but are not punching time, so
   * including them would deflate every derived pace.
   */
  activeSeconds: number
}

const SECOND_MS = 1_000
const ROUND_WORK_MS = 240 * SECOND_MS // 4:00 (D21, was 3:00)
const REST_MS = 60 * SECOND_MS // 1:00
const WARM_UP_MS = 120 * SECOND_MS // 2:00, 30-minute schedule only
const COOLDOWN_MS = 60 * SECOND_MS // 1:00

interface ScheduleShape {
  rounds: number
  warmUp: boolean
}

/**
 * Round counts per duration (D21). Rests sit between rounds, so there are
 * `rounds - 1`.
 *
 * The arithmetic is exact and that is the point: a round, its rest and the
 * shared cooldown make `300 * rounds` seconds, so every duration divides
 * cleanly by five minutes. A "40 minute workout" takes forty minutes.
 *
 * **The 30-minute shape loses its warm-up.** Doc §9 gave that one duration a
 * two-minute warm-up — an asymmetry no other length had — and at 4:00 rounds
 * there is no integer round count that keeps it *and* lands on thirty minutes
 * (five rounds gives 27:00, six gives 32:00). Exact durations won: an athlete
 * who asked for thirty minutes should not be kept for thirty-two. If the
 * warm-up is wanted back it belongs to every duration, not one, and the
 * schedule should lengthen honestly to say so.
 */
const SHAPES: Record<WorkoutDurationMinutes, ScheduleShape> = {
  20: { rounds: 4, warmUp: false },
  30: { rounds: 6, warmUp: false },
  40: { rounds: 8, warmUp: false },
  60: { rounds: 12, warmUp: false },
}

/**
 * Build the fixed schedule for a duration.
 *
 * Entry order is the order they run: optional warm-up, then rounds with a
 * rest after each except the last, then the cooldown. The final round has
 * `restAfterMs: 0` because the cooldown follows it directly — a rest there
 * would double-count against the session length.
 */
export function buildRoundSchedule(minutes: WorkoutDurationMinutes): RoundSchedule {
  const shape = SHAPES[minutes]
  const entries: RoundScheduleEntry[] = []

  if (shape.warmUp) {
    entries.push({
      kind: 'warm-up',
      workDurationMs: WARM_UP_MS,
      restAfterMs: 0,
      countsTowardGoal: false,
    })
  }

  for (let i = 0; i < shape.rounds; i++) {
    const isLast = i === shape.rounds - 1
    entries.push({
      kind: 'round',
      workDurationMs: ROUND_WORK_MS,
      restAfterMs: isLast ? 0 : REST_MS,
      countsTowardGoal: true,
    })
  }

  entries.push({
    kind: 'cooldown',
    workDurationMs: COOLDOWN_MS,
    restAfterMs: 0,
    countsTowardGoal: false,
  })

  return {
    durationMinutes: minutes,
    entries,
    scoredRoundCount: shape.rounds,
    activeSeconds: (shape.rounds * ROUND_WORK_MS) / SECOND_MS,
  }
}

/** Total wall time of a schedule in ms — work plus rests, every entry. */
export function totalScheduleMs(schedule: RoundSchedule): number {
  return schedule.entries.reduce((sum, e) => sum + e.workDurationMs + e.restAfterMs, 0)
}
