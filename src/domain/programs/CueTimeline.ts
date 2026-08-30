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
import type {
  PunchNumber,
  SetupCallout,
  Stance,
  WorkoutBlock,
  WorkoutToken,
} from '../workout/WorkoutTokens'

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

/**
 * How a cue is judged.
 *
 * `sequence` cues name every punch and are matched token by token.
 * `count` cues (volume-burst, open-pressure) name a pattern and a target
 * and are judged on how many punches the tracker saw — the athlete is
 * working, not following a script (doc §14). Mixing the two in one scoring
 * path would mean either fabricating expectations for a burst or losing the
 * burst's output entirely.
 */
export type CueScoring = 'sequence' | 'count'

export interface CountScoredMeta {
  targetPunches: number
  /** Display only: the shape to keep throwing, e.g. `1-2`. */
  allowedPattern?: string
  /**
   * An open-pressure constraint, e.g. finish every exchange with a 2.
   * Display-only unless the tier can verify it — which on this hardware it
   * cannot (D12).
   */
  constraint?: { finisher?: PunchNumber; hand?: 'lead' | 'rear' }
  /** Lead-in before the burst starts counting. */
  countdownMs: number
}

export interface CueInstance {
  id: string
  blockId: string
  repeatIndex: number
  /** Voice cadence band from the block (M4) — absent means the workout's. */
  cadence?: string
  /** `sequence` unless this is a count-scored burst. */
  scoring: CueScoring
  /** Present only on `scoring: 'count'` cues. */
  countScored?: CountScoredMeta
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
  /**
   * The block's authored coaching text ("Breathe. More coming."). A11
   * (#265): carried onto the cue so a WS4 render pass can pair it
   * with a chatterbox clip. Read by no audio path in the current
   * sprint — WS4 wires the delivery.
   */
  instruction?: string
  /**
   * The pre-set call-out ceremony (Set Ceremonies) — present only on a
   * block's FIRST cue (repeatIndex 0): the ceremony announces the set,
   * not every rep. The rhythm map compiles it inside the fill's
   * reservation.
   */
  setupCallout?: SetupCallout
  /**
   * Scalable cadence rail (2026-08-28): when a phrase clip drives this
   * cue's timing, the compiler stamps per-token ring-fire offsets here so
   * ring N lights up in the same rhythm as the coach's spoken words —
   * ring N fires K ms after word N's audible envelope ends. Offsets are
   * relative to `scheduledStartMs`, same reference as `tokenOffsetsMs`.
   * Absent means the cue falls back to the beat-grid `tokenOffsetsMs`
   * (per-word calls, missing wordMarks, or non-phrase mode).
   */
  phraseTokenTimesMs?: number[]
  /**
   * M39-V1c plumbing (2026-08-30): engine-authored per-token ring-fire
   * times, relative to `scheduledStartMs` (same reference as
   * `tokenOffsetsMs`). Populated only when the recipe has
   * `metronome.enabled: true` AND the block was authored with an engine
   * rhythm (a follow-up chunk of V1c adds `BlockSpec.rhythm`). Absent
   * means the cue falls back to `phraseTokenTimesMs` (the rail), then
   * `tokenOffsetsMs` (the beat grid) — the pre-M39 order is preserved
   * verbatim for every legacy cue.
   */
  visualOffsetsMs?: number[]
  /**
   * M39-V1c plumbing (2026-08-30): engine-authored expected-strike times
   * (visualAtMs + `EXPECTED_STRIKE_DELAY_MS`, from `acceptance.ts`),
   * relative to `scheduledStartMs`. Used by `CueMatcher.scheduledMomentMs`
   * to compute the signed match offset. Populated in the same conditions
   * as `visualOffsetsMs`; absent falls back to `tokenOffsetsMs`.
   */
  expectedStrikeOffsetsMs?: number[]
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

/** Block kinds laid out as sequence cues, one token at a time. */
const SEQUENCE_KINDS = new Set<WorkoutBlock['kind']>([
  'exact-combo',
  'repeated-combo',
  'defense-counter',
  'footwork-exit',
])

/** Block kinds judged on tracker count rather than a named sequence (doc §14). */
// `coast` joins these (D23): it asks for output over a stated time rather
// than naming punches, so it expands to one cue with no expectations.
// `active-recovery` joins these (A12 / issue #266): it reserved 10.5-12 s of
// window under the sequence path but emitted a single cue (repeat defaulted
// to 1), leaving rings dark for the remainder. Under the count path it now
// carries its motif and A2's pulses walk the ring row across the full window;
// D4 still holds because expectedPunches stays [].
const COUNT_SCORED_KINDS = new Set<WorkoutBlock['kind']>([
  'volume-burst',
  'open-pressure',
  'coast',
  'active-recovery',
])

/**
 * Lead-in before a burst starts counting.
 *
 * Doc §14 asks for a short countdown so the athlete can set their feet
 * before output is measured — without it the first second of every burst
 * would be spent reacting rather than punching, and the count would
 * under-report the work.
 */
export const DEFAULT_BURST_COUNTDOWN_MS = 3_000

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

      if (COUNT_SCORED_KINDS.has(block.kind)) {
        cues.push(
          expandCountScoredBlock(block, {
            bpm,
            effectiveStance,
            workDurationMs: round.workDurationMs,
            leadTimes,
            graceBeforeMs: block.graceBeforeMs ?? defaultGraceBefore,
            graceAfterMs: block.graceAfterMs ?? defaultGraceAfter,
          }),
        )
        continue
      }

      if (!SEQUENCE_KINDS.has(block.kind)) {
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
      ...(block.cadence === undefined ? {} : { cadence: block.cadence }),
      scoring: 'sequence',
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
      ...(block.instruction === undefined ? {} : { instruction: block.instruction }),
      // The ceremony belongs to the set, not the rep: first cue only.
      ...(block.setupCallout === undefined || repeatIndex !== 0
        ? {}
        : { setupCallout: block.setupCallout }),
    })
  }

  return instances
}

/**
 * Lay out a volume-burst or open-pressure block as a single count-scored
 * cue spanning the whole block.
 *
 * One cue, not many: the block's whole point is that it is *not* a sequence
 * of named commands (doc §14). Slicing it into per-punch cues would
 * reintroduce exactly the enumeration the block exists to avoid, and would
 * invent expectations the athlete was never given.
 *
 * The tokens are still carried so the stage can show the allowed pattern,
 * but they produce **no** `expectedPunches` — nothing here is matched token
 * by token, and nothing in it can be "missed".
 */
function expandCountScoredBlock(block: WorkoutBlock, ctx: BlockContext): CueInstance {
  const offsets = tokenOffsetsMs(block.tokens, ctx.bpm)
  const scheduledStartMs = block.startOffsetMs
  const scheduledEndMs = scheduledStartMs + block.durationMs

  // Display-only: every token in a burst is a pattern to repeat, not a
  // command to answer once (D4).
  const displayOnlyTokenIndexes = block.tokens.map((_, index) => index)

  const constraint = openPressureConstraint(block)

  return {
    id: `${block.id}#burst`,
    blockId: block.id,
    repeatIndex: 0,
    ...(block.cadence === undefined ? {} : { cadence: block.cadence }),
    scoring: 'count',
    countScored: {
      targetPunches: block.targetPunches ?? 0,
      countdownMs: DEFAULT_BURST_COUNTDOWN_MS,
      ...(patternFor(block) ? { allowedPattern: patternFor(block)! } : {}),
      ...(constraint ? { constraint } : {}),
    },
    tokens: block.tokens,
    tokenOffsetsMs: offsets,
    expectedPunches: [],
    displayOnlyTokenIndexes,
    previewAt: Math.max(0, scheduledStartMs - ctx.leadTimes.previewMs),
    announceAt: Math.max(0, scheduledStartMs - ctx.leadTimes.announceMs),
    scheduledStartMs,
    scheduledEndMs,
    // Graces still apply and still clamp to the work interval: a burst's
    // window may not outlive the round any more than a combo's may.
    windowStartMs: Math.max(0, scheduledStartMs - ctx.graceBeforeMs),
    windowEndMs: Math.min(ctx.workDurationMs, scheduledEndMs + ctx.graceAfterMs),
    ...(block.spokenPhrase === undefined ? {} : { spokenPhrase: block.spokenPhrase }),
      ...(block.instruction === undefined ? {} : { instruction: block.instruction }),
    ...(block.setupCallout === undefined ? {} : { setupCallout: block.setupCallout }),
  }
}

/** The repeated shape, rendered from the block's own punch tokens. */
function patternFor(block: WorkoutBlock): string | undefined {
  const numbers = block.tokens
    .filter((t): t is Extract<WorkoutToken, { kind: 'punch' }> => t.kind === 'punch')
    .map((t) => `${t.number}${t.body ? 'b' : ''}`)
  return numbers.length > 0 ? numbers.join('-') : undefined
}

/**
 * An open-pressure block's finishing constraint, taken from its last punch.
 *
 * Only `open-pressure` carries one: a volume burst is "keep throwing this",
 * while open pressure is "punch freely, but finish every exchange with
 * *this*" (doc §14).
 */
function openPressureConstraint(
  block: WorkoutBlock,
): { finisher?: PunchNumber; hand?: 'lead' | 'rear' } | undefined {
  if (block.kind !== 'open-pressure') return undefined
  const punches = block.tokens.filter(
    (t): t is Extract<WorkoutToken, { kind: 'punch' }> => t.kind === 'punch',
  )
  const last = punches[punches.length - 1]
  if (!last) return undefined
  return { finisher: last.number, hand: last.number % 2 === 1 ? 'lead' : 'rear' }
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
