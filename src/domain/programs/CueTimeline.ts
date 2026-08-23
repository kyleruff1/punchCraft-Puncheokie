/**
 * Cue timeline expansion (M32-03, doc §27 steps 3 and 5).
 *
 * Turns a `GeneratedWorkout` plus the athlete's stance and cadence into the
 * flat, fully-timed structure the CueEngine walks. **All** beat math, stance
 * resolution, repeat expansion and window clamping happen here, once, at
 * load — after this, the engine and the matcher work in plain milliseconds
 * and never think about beats again.
 *
 * That concentration is deliberate. Timing bugs are the expensive kind to
 * find at the bag, and they are far easier to catch in one pure function
 * with a fake clock than spread across an engine that is also managing
 * lifecycle state.
 *
 * Windows are clamped here rather than in the engine (a settled decision):
 * M32-04 asserts the invariant on load and treats a violation as a
 * programming error rather than re-deriving it.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports, and no
 * `Date.now()` (spec §15.1, §18.3).
 */

import { beatsToMs, maxBeatOffset, tokenOffsetsMs } from '../workout/cadence'
import { resolveEffectiveStance, resolveHand } from './StanceMapper'
import type { GeneratedWorkout } from '../workout/GeneratedWorkout'
import type { PunchType } from '../punch/PunchEvent'
import type { Stance, WorkoutBlock, WorkoutToken } from '../workout/WorkoutTokens'

// ---------------------------------------------------------------------------
// Tunables. Every one of these is a placeholder until M36-03 tunes them
// against real punching, which is why they are named constants rather than
// numbers buried in the expansion.
// ---------------------------------------------------------------------------

/** Doc §18.3: the next combination appears dimmed at T−1.50s. */
export const DEFAULT_PREVIEW_LEAD_MS = 1_500
/** Doc §18.3: the voice speaks the combination at T−0.75s. */
export const DEFAULT_ANNOUNCE_LEAD_MS = 750

/**
 * Acceptance grace either side of a cue (doc §6).
 *
 * Asymmetric on purpose: a punch landing slightly late is ordinary — the
 * athlete heard the cue and moved — whereas one landing well before it was
 * called was not a response to the cue at all. Being generous after and
 * stricter before matches how the miss actually happens.
 */
export const DEFAULT_GRACE_BEFORE_MS = 200
export const DEFAULT_GRACE_AFTER_MS = 350

export interface CueLeadTimes {
  previewMs: number
  announceMs: number
}

export interface ExpandOptions {
  leadTimes?: Partial<CueLeadTimes>
  graceBeforeMs?: number
  graceAfterMs?: number
}

// ---------------------------------------------------------------------------

export interface ExpectedPunch {
  /** Index into the cue's own `tokens` array. */
  tokenIndex: number
  hand: 'left' | 'right'
  /**
   * The broad family the *cue* implies — never something observed. Present
   * so a tier that can use it (#130) may, and so a summary can echo what was
   * asked for. On FightCamp v1 nothing verifies it (D12).
   */
  type?: PunchType
}

export interface CueInstance {
  id: string
  blockId: string
  repeatIndex: number
  tokens: WorkoutToken[]
  tokenOffsetsMs: number[]
  expectedPunches: ExpectedPunch[]
  /** Defense, footwork and coach tokens: shown, never scored (D4). */
  displayOnlyTokenIndexes: number[]
  previewAt: number
  announceAt: number
  scheduledStartMs: number
  scheduledEndMs: number
  windowStartMs: number
  windowEndMs: number
  spokenPhrase?: string
}

export interface RoundTimeline {
  roundIndex: number
  workDurationMs: number
  cues: CueInstance[]
  stanceChanges: { atMs: number; toStance: Stance }[]
  /**
   * Blocks this expansion could not lay out as cues — `volume-burst` and
   * `open-pressure`, whose timeline support arrives in M33-06.
   *
   * Additive to the binding interface, and deliberately not silent: these
   * blocks are a large share of the authored samples, so dropping them
   * without a trace would make the live screen look broken rather than
   * incomplete.
   */
  deferredBlockIds: string[]
}

/** Block kinds this expansion lays out. M33-06 adds the remaining two. */
const EXPANDABLE_KINDS = new Set<WorkoutBlock['kind']>([
  'exact-combo',
  'repeated-combo',
  'defense-counter',
  'footwork-exit',
  'active-recovery',
])

/**
 * The technique family a cue number implies (doc §2).
 *
 * This describes the *prescription*, not a measurement — the cue tells the
 * athlete to throw a hook; nothing here claims one was thrown.
 */
const IMPLIED_TYPE: Record<1 | 2 | 3 | 4 | 5 | 6, PunchType> = {
  1: 'straight',
  2: 'straight',
  3: 'hook',
  4: 'hook',
  5: 'uppercut',
  6: 'uppercut',
}

/**
 * Expand a workout into per-round cue timelines.
 *
 * Pure and deterministic: the same `(workout, defaultStance, bpm)` always
 * produces a deep-equal result (spec §13.6), which is what makes a stored
 * session recalculable.
 */
export function expandTimeline(
  workout: GeneratedWorkout,
  defaultStance: Stance,
  bpm: number,
  options: ExpandOptions = {},
): RoundTimeline[] {
  const leadTimes: CueLeadTimes = {
    previewMs: options.leadTimes?.previewMs ?? DEFAULT_PREVIEW_LEAD_MS,
    announceMs: options.leadTimes?.announceMs ?? DEFAULT_ANNOUNCE_LEAD_MS,
  }
  const defaultGraceBefore = options.graceBeforeMs ?? DEFAULT_GRACE_BEFORE_MS
  const defaultGraceAfter = options.graceAfterMs ?? DEFAULT_GRACE_AFTER_MS

  return workout.schedule.map((round, roundIndex) => {
    const cues: CueInstance[] = []
    const stanceChanges: RoundTimeline['stanceChanges'] = []
    const deferredBlockIds: string[] = []

    // A round always begins in the athlete's default stance; a change is
    // recorded only where the stance actually differs from the one before.
    let previousStance: Stance = defaultStance

    const blocks = [...round.blocks].sort((a, b) => a.startOffsetMs - b.startOffsetMs)

    for (const block of blocks) {
      const effectiveStance = resolveEffectiveStance(block.stance, defaultStance)

      // Recorded at the block boundary — never mid-combination (doc §11).
      if (effectiveStance !== previousStance) {
        stanceChanges.push({ atMs: block.startOffsetMs, toStance: effectiveStance })
        previousStance = effectiveStance
      }

      if (!EXPANDABLE_KINDS.has(block.kind)) {
        deferredBlockIds.push(block.id)
        continue
      }

      cues.push(
        ...expandBlock(block, {
          bpm,
          effectiveStance,
          workDurationMs: round.workDurationMs,
          leadTimes,
          graceBeforeMs: block.graceBeforeMs ?? defaultGraceBefore,
          graceAfterMs: block.graceAfterMs ?? defaultGraceAfter,
        }),
      )
    }

    cues.sort((a, b) => a.scheduledStartMs - b.scheduledStartMs)
    truncateWindowsAtNextCue(cues)

    return {
      roundIndex,
      workDurationMs: round.workDurationMs,
      cues,
      stanceChanges,
      deferredBlockIds,
    }
  })
}

/**
 * A cue's acceptance window ends no later than the next cue begins.
 *
 * `graceAfterMs` is added to a cue's end without any knowledge of how soon
 * the next one starts, so a block whose `gapBeats` converts to less than the
 * grace produces overlapping windows. That is not hypothetical: block
 * `startOffsetMs` values are authored in milliseconds at one cadence while
 * everything inside a block is derived from beats, so re-expanding a sample
 * below its authoring BPM stretches the combos into the following block.
 * PacingEngine's ±10–15% adjustment (M33-05) does exactly that, and the
 * shipped samples overlap at 85 BPM today.
 *
 * Two consequences made this worth clamping here rather than tolerating
 * downstream: a punch inside the overlap would be creditable to two cues at
 * once (spec §28.2 needs exactly one), and the engine's "one cue in flight"
 * model (doc §20) would be violated while the athlete is already being told
 * the next combination.
 *
 * The floor is the cue's own start, so a window is never inverted. Note the
 * truncated end can precede `scheduledEndMs` when the overlap is severe —
 * the engine closes such a cue out of `active` rather than waiting for it to
 * reach `accepting`.
 *
 * Expects `cues` sorted by `scheduledStartMs`.
 */
function truncateWindowsAtNextCue(cues: CueInstance[]): void {
  for (let i = 0; i < cues.length - 1; i++) {
    const cue = cues[i] as CueInstance
    const next = cues[i + 1] as CueInstance
    cue.windowEndMs = Math.max(cue.windowStartMs, Math.min(cue.windowEndMs, next.scheduledStartMs))
  }
}

interface BlockContext {
  bpm: number
  effectiveStance: Stance
  workDurationMs: number
  leadTimes: CueLeadTimes
  graceBeforeMs: number
  graceAfterMs: number
}

function expandBlock(block: WorkoutBlock, ctx: BlockContext): CueInstance[] {
  const offsets = tokenOffsetsMs(block.tokens, ctx.bpm)
  const comboSpanMs = beatsToMs(maxBeatOffset(block.tokens), ctx.bpm)
  const gapMs = beatsToMs(block.gapBeats, ctx.bpm)

  // A repeat of 1 and no repeat are the same thing; treating them alike
  // keeps `exact-combo` and `repeated-combo` on one code path.
  const repeats = Math.max(1, block.repeat ?? 1)

  const expectedPunches: ExpectedPunch[] = []
  const displayOnlyTokenIndexes: number[] = []

  block.tokens.forEach((token, tokenIndex) => {
    if (token.kind === 'punch') {
      expectedPunches.push({
        tokenIndex,
        hand: resolveHand(token.number, ctx.effectiveStance),
        type: IMPLIED_TYPE[token.number],
      })
    } else {
      // Defense, footwork and coach tokens are shown and never scored, and
      // never counted toward completion (D4, doc §21).
      displayOnlyTokenIndexes.push(tokenIndex)
    }
  })

  const instances: CueInstance[] = []

  for (let repeatIndex = 0; repeatIndex < repeats; repeatIndex++) {
    const scheduledStartMs = block.startOffsetMs + repeatIndex * (comboSpanMs + gapMs)
    const scheduledEndMs = scheduledStartMs + comboSpanMs

    instances.push({
      id: `${block.id}#${repeatIndex}`,
      blockId: block.id,
      repeatIndex,
      tokens: block.tokens,
      tokenOffsetsMs: offsets,
      expectedPunches,
      displayOnlyTokenIndexes,
      // Floored at 0 rather than widening the window: a cue right at the
      // bell simply gets a shorter preview.
      previewAt: Math.max(0, scheduledStartMs - ctx.leadTimes.previewMs),
      announceAt: Math.max(0, scheduledStartMs - ctx.leadTimes.announceMs),
      scheduledStartMs,
      scheduledEndMs,
      // Clamped to the work interval at *both* ends: a window never precedes
      // the bell or outlives the round, so an event in rest or pause can
      // never be accepted (doc §6, spec §18.2).
      //
      // The upper clamp on the start is not redundant. `repeat` lays
      // instances at a beat-derived stride that expansion never checks
      // against the round length, so a repeated combo can be scheduled
      // wholly past the bell — most easily by re-expanding a workout below
      // its authoring cadence, which is what PacingEngine (M33-05) does.
      // Without it such a cue gets `windowStartMs > windowEndMs`: an
      // inverted window that no clamp assertion downstream is looking for.
      // Clamped, it becomes an empty window at the bell, which is the
      // truthful description of a cue the round never reaches.
      windowStartMs: Math.min(
        ctx.workDurationMs,
        Math.max(0, scheduledStartMs - ctx.graceBeforeMs),
      ),
      windowEndMs: Math.min(ctx.workDurationMs, scheduledEndMs + ctx.graceAfterMs),
      ...(block.spokenPhrase === undefined ? {} : { spokenPhrase: block.spokenPhrase }),
    })
  }

  return instances
}

/**
 * Every cue in a round, flattened — the shape the engine and the matcher
 * actually iterate.
 */
export function allCues(timelines: readonly RoundTimeline[]): CueInstance[] {
  return timelines.flatMap((t) => t.cues)
}

/** Total expected punches across a timeline. Completion counts these only. */
export function expectedPunchCount(timelines: readonly RoundTimeline[]): number {
  return allCues(timelines).reduce((sum, cue) => sum + cue.expectedPunches.length, 0)
}
