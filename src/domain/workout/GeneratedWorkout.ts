/**
 * GeneratedWorkout — a recipe expanded into a runnable schedule (doc §26).
 *
 * `PunchProgram` is deliberately absent. C5/D8 retired editable programs in
 * favour of recipe + seeded generator, and §4's interface was simply never
 * removed; **D14** retires it explicitly. Rounds are reached through
 * `GeneratedWorkout.schedule`, and a check across the backlog found the only
 * issues still naming `PunchProgram` were M24-01/M24-03, both closed as
 * superseded. Recording the deviation here because M31-01's Interfaces block
 * still lists it.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import type { ProgramRound, WorkoutBlock } from './WorkoutTokens'
import type { WorkoutRecipe } from './WorkoutRecipe'

export interface GeneratedWorkout {
  id: string
  recipe: WorkoutRecipe
  schedule: ProgramRound[]
  /** One entry per scored round, in order. Warm-up/cooldown are excluded. */
  roundPunchTargets: number[]
  expectedTechniqueDistribution: Record<string, number>
  estimatedActivePunchesPerMinute: number
  warnings: string[]
}

export interface WorkoutValidationError {
  code: string
  /** Dotted path to the offending value, e.g. `schedule[2].blocks[0].durationMs`. */
  path: string
  message: string
}

/** Rounds that carry punch goals — everything except warm-up and cooldown (doc §9). */
export function scoredRounds(schedule: readonly ProgramRound[]): ProgramRound[] {
  return schedule.filter((r) => r.countsTowardGoal)
}

function validateBlock(
  block: WorkoutBlock,
  round: ProgramRound,
  roundIndex: number,
  blockIndex: number,
  errors: WorkoutValidationError[],
): void {
  const path = `schedule[${roundIndex}].blocks[${blockIndex}]`

  if (block.startOffsetMs < 0) {
    errors.push({ code: 'block-negative-start', path: `${path}.startOffsetMs`, message: `startOffsetMs must be >= 0, got ${block.startOffsetMs}` })
  }
  if (block.durationMs <= 0) {
    errors.push({ code: 'block-nonpositive-duration', path: `${path}.durationMs`, message: `durationMs must be > 0, got ${block.durationMs}` })
  }
  if (block.startOffsetMs + block.durationMs > round.workDurationMs) {
    errors.push({
      code: 'block-overruns-round',
      path,
      message: `block ends at ${block.startOffsetMs + block.durationMs}ms but the round's work interval is ${round.workDurationMs}ms`,
    })
  }

  // Acceptance windows are clamped to the active work interval (D5), which is
  // only meaningful if tokens are ordered. A decreasing offset would also make
  // "the earliest unfilled expected punch" (§28.2) ambiguous.
  let previous = Number.NEGATIVE_INFINITY
  block.tokens.forEach((token, tokenIndex) => {
    if (token.beatOffset < previous) {
      errors.push({
        code: 'token-offsets-not-ordered',
        path: `${path}.tokens[${tokenIndex}].beatOffset`,
        message: `beatOffset ${token.beatOffset} is earlier than the previous token's ${previous}`,
      })
    }
    previous = token.beatOffset
  })

  if (block.repeat !== undefined && block.kind !== 'repeated-combo') {
    errors.push({
      code: 'repeat-on-wrong-block-kind',
      path: `${path}.repeat`,
      message: `repeat is only meaningful on 'repeated-combo', not '${block.kind}'`,
    })
  }
  if (block.gapBeats < 0) {
    errors.push({ code: 'negative-gap', path: `${path}.gapBeats`, message: `gapBeats must be >= 0, got ${block.gapBeats}` })
  }
}

/**
 * Check every structural rule and return all violations.
 *
 * **Never throws, and never stops at the first error.** A generator or a
 * hand-authored sample should learn about all of its problems in one pass —
 * fixing them one exception at a time is the slow path, and callers
 * (M31-05 samples, M35-03 generator output) gate on the full list.
 */
export function validateGeneratedWorkout(workout: GeneratedWorkout): WorkoutValidationError[] {
  const errors: WorkoutValidationError[] = []
  const schedule = workout.schedule

  if (schedule.length === 0) {
    errors.push({ code: 'empty-schedule', path: 'schedule', message: 'a workout must contain at least one round' })
  }

  let previousOrder = Number.NEGATIVE_INFINITY
  schedule.forEach((round, roundIndex) => {
    const path = `schedule[${roundIndex}]`

    if (round.order < previousOrder) {
      errors.push({
        code: 'rounds-not-ordered',
        path: `${path}.order`,
        message: `round order ${round.order} follows ${previousOrder}; rounds must be in ascending order`,
      })
    }
    previousOrder = round.order

    // countsTowardGoal is false for exactly warm-up and cooldown (doc §9).
    const shouldCount = round.kind === 'round'
    if (round.countsTowardGoal !== shouldCount) {
      errors.push({
        code: 'counts-toward-goal-mismatch',
        path: `${path}.countsTowardGoal`,
        message: `kind '${round.kind}' requires countsTowardGoal === ${shouldCount}, got ${round.countsTowardGoal}`,
      })
    }

    if (round.workDurationMs <= 0) {
      errors.push({ code: 'round-nonpositive-work', path: `${path}.workDurationMs`, message: `workDurationMs must be > 0, got ${round.workDurationMs}` })
    }
    if (round.restAfterMs < 0) {
      errors.push({ code: 'round-negative-rest', path: `${path}.restAfterMs`, message: `restAfterMs must be >= 0, got ${round.restAfterMs}` })
    }

    round.blocks.forEach((block, blockIndex) => {
      validateBlock(block, round, roundIndex, blockIndex, errors)
    })
  })

  const scored = scoredRounds(schedule)
  if (workout.roundPunchTargets.length !== scored.length) {
    errors.push({
      code: 'round-targets-length-mismatch',
      path: 'roundPunchTargets',
      message: `expected one target per scored round (${scored.length}), got ${workout.roundPunchTargets.length}`,
    })
  }

  return errors
}
