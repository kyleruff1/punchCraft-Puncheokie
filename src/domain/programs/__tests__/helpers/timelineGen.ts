/**
 * Seeded random timelines for the M32-09 property test.
 *
 * Hand-rolled rather than `fast-check`: spec §11.2 locks the dependency set
 * and a property generator is not worth a version-lock discussion. A 32-bit
 * LCG is enough — the point is a wide, *reproducible* spread of timeline
 * geometry, not statistical quality.
 *
 * Everything is routed through `expandTimeline`, so a generated timeline is
 * always a real expansion: clamped windows, sorted cues, resolved stances.
 * That matters, because the property being tested is about the engine's
 * behaviour over valid timelines, not about surviving impossible input.
 *
 * Block layout is deliberately allowed to crowd: `startOffsetMs` advances by
 * a random fraction of each block's span, so repeats and neighbouring blocks
 * frequently collide. That is the geometry the shipped samples produce once
 * the cadence differs from the one they were authored at, and it is where
 * the engine's overlap handling actually gets exercised.
 *
 * Pure TypeScript — no timers, no `Date.now()` (spec §15.1, §18.3).
 */

import { beatsToMs, maxBeatOffset } from '../../../workout/cadence'
import { expandTimeline, type RoundTimeline } from '../../CueTimeline'
import { threeRoundFundamentals } from '../../../workout/samples'
import type { GeneratedWorkout } from '../../../workout/GeneratedWorkout'
import type {
  BlockKind,
  BlockStance,
  ProgramRound,
  PunchNumber,
  Stance,
  WorkoutBlock,
  WorkoutToken,
} from '../../../workout/WorkoutTokens'

/** Numerical Recipes' LCG constants; `>>> 0` keeps it in 32 unsigned bits. */
function lcg(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

const BLOCK_KINDS: BlockKind[] = [
  'exact-combo',
  'repeated-combo',
  'defense-counter',
  'footwork-exit',
  'active-recovery',
  // Deferred to M33-06 — present so the generator also covers the
  // "expands to no cues" path.
  'volume-burst',
  'open-pressure',
]

const STANCES: BlockStance[] = ['inherit', 'orthodox', 'southpaw', 'switch']
const GAP_BEATS = [0, 0.25, 0.5, 1, 2]
const BPMS = [80, 85, 100, 110, 120, 140, 150]

export interface GeneratedTimelineCase {
  seed: number
  bpm: number
  defaultStance: Stance
  graceBeforeMs: number
  graceAfterMs: number
  workout: GeneratedWorkout
  timelines: RoundTimeline[]
}

/**
 * A seeded, always-valid set of round timelines.
 *
 * Reproducible: the same seed always yields a deep-equal result, so a
 * failing property prints a seed a developer can paste straight back in.
 */
export function generateTimeline(seed: number): RoundTimeline[] {
  return generateCase(seed).timelines
}

/** `generateTimeline` plus the inputs that produced it, for failure output. */
export function generateCase(seed: number): GeneratedTimelineCase {
  const rnd = lcg(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1))

  const bpm = pick(BPMS)
  const defaultStance: Stance = rnd() < 0.5 ? 'orthodox' : 'southpaw'
  const graceBeforeMs = int(0, 8) * 100
  const graceAfterMs = int(0, 12) * 100

  const roundCount = int(1, 3)
  const schedule: ProgramRound[] = []

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex++) {
    const workDurationMs = int(20, 180) * 1_000
    const blocks: WorkoutBlock[] = []
    let cursorMs = 0
    let blockIndex = 0

    while (cursorMs < workDurationMs && blockIndex < 24) {
      const kind = pick(BLOCK_KINDS)
      const tokens = randomTokens(rnd, int)
      const gapBeats = pick(GAP_BEATS)
      const repeat = kind === 'repeated-combo' ? int(1, 6) : undefined
      const spanMs = beatsToMs(maxBeatOffset(tokens) + gapBeats, bpm) * (repeat ?? 1)

      const block: WorkoutBlock = {
        id: `s${seed}-r${roundIndex}-b${blockIndex}`,
        kind,
        startOffsetMs: cursorMs,
        // Authored duration is not what expansion uses; it only has to be
        // positive for the block to be well-formed.
        durationMs: Math.max(1, spanMs),
        stance: pick(STANCES),
        tokens,
        gapBeats,
        ...(repeat === undefined ? {} : { repeat }),
      }
      blocks.push(block)
      blockIndex++

      // 0.55–1.35 of the block's own span: below 1 the next block starts
      // before this one's repeats have finished, which is exactly the
      // crowding a re-tempoed sample produces.
      cursorMs += Math.max(120, spanMs * (0.55 + rnd() * 0.8))
    }

    schedule.push({
      id: `s${seed}-r${roundIndex}`,
      order: roundIndex + 1,
      kind: 'round',
      countsTowardGoal: true,
      theme: 'Generated',
      workDurationMs,
      restAfterMs: 60_000,
      targetPunches: 0,
      blocks,
    })
  }

  const workout: GeneratedWorkout = {
    ...threeRoundFundamentals,
    id: `generated-${seed}`,
    schedule,
    roundPunchTargets: schedule.map(() => 0),
  }

  return {
    seed,
    bpm,
    defaultStance,
    graceBeforeMs,
    graceAfterMs,
    workout,
    timelines: expandTimeline(workout, defaultStance, bpm, { graceBeforeMs, graceAfterMs }),
  }
}

function randomTokens(rnd: () => number, int: (lo: number, hi: number) => number): WorkoutToken[] {
  const count = int(1, 6)
  const tokens: WorkoutToken[] = []
  let beatOffset = 0

  for (let i = 0; i < count; i++) {
    const roll = rnd()
    if (roll < 0.7) {
      tokens.push({
        kind: 'punch',
        number: int(1, 6) as PunchNumber,
        body: rnd() < 0.25,
        beatOffset,
      })
    } else if (roll < 0.8) {
      tokens.push({ kind: 'defense', command: 'slip', beatOffset })
    } else if (roll < 0.9) {
      tokens.push({ kind: 'footwork', command: 'pivot', beatOffset })
    } else {
      tokens.push({ kind: 'coach', command: 'hands-up', beatOffset })
    }
    // Ascending offsets — `validateGeneratedWorkout` requires it, and
    // "the earliest unfilled expected punch" (§28.2) is otherwise ambiguous.
    beatOffset += rnd() < 0.2 ? 0.5 : 1
  }

  return tokens
}

/**
 * A seeded, ragged tick schedule over `[0, workDurationMs]`.
 *
 * Mixes fine and very coarse steps, repeats a value now and then, and
 * occasionally jumps backwards — a stalled caller must not be able to end a
 * round, so the engine has to ignore that rather than throw.
 */
export function generateTickSchedule(seed: number, workDurationMs: number): number[] {
  const rnd = lcg(seed ^ 0x5f37_59df)
  const steps = [7, 16, 33, 50, 137, 400, 1_500, 9_000]
  const ticks: number[] = []
  let t = 0

  while (t < workDurationMs && ticks.length < 4_000) {
    ticks.push(t)
    const roll = rnd()
    if (roll < 0.05) ticks.push(t) // duplicate: must be idempotent
    else if (roll < 0.08) ticks.push(Math.max(0, t - 5_000)) // backwards: ignored
    t += steps[Math.floor(rnd() * steps.length)] as number
  }

  ticks.push(workDurationMs)
  return ticks
}
