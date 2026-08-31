/**
 * The compiled workout score — the single-mapping executable
 * schedule for a whole workout (M39-V2 W1 Epic Slice 1, Kyle
 * amended plan 2026-08-30, principle #0).
 *
 * ## The rule
 *
 * `AuthoredWorkoutManifest` (i.e., a `GeneratedWorkout`) is the
 * sole semantic authoring source. `CompiledWorkoutScore` is the
 * sole executable scheduling source. A strike occurrence is
 * authored exactly once and receives one stable `eventId`. Ring
 * state, avatar state, tracker expectations, numeric coaching,
 * technique coaching, diagnostics, and QA all reference that
 * same occurrence.
 *
 * This slice compiles STRIKES + PHASE BOUNDARIES only. The
 * coach-slots table (slice 2), ceremonies + phase-announces
 * (slice 6), and the runtime consumers that read from the score
 * (slices 3 + 7) land in subsequent commits. Nothing at runtime
 * imports this module yet — the compiler is authored + tested
 * without behavior change.
 *
 * ## Score tick space
 *
 * The score's tick space is the transport's 60-BPM 960-PPQN
 * space — the same one `MetronomeTransport` publishes and
 * `MetronomePlayer` runs against. Cue-level ticks (from
 * `compileCue`) are already in this space; the score adds
 * round-level accumulation so every strike carries an ABSOLUTE
 * score-relative `startTick`.
 *
 * Rests are gaps in wall-clock but NOT in score ticks — the
 * transport stops during rest phases and restarts on
 * `work-entered`, so score tick = accumulated work-elapsed
 * time. Round R starts at `sum(round[0..R-1].workDurationTicks)`.
 *
 * ## Provenance
 *
 * Every strike carries `roundIndex` alongside the cue-local
 * `cueId` / `repId` / `strikeIndex` from `compileCue`, so a
 * consumer never has to parse the string `eventId` to figure
 * out where a strike lives in the workout (principle #12 —
 * strike ID has workout + round scope).
 *
 * The score-level `timelineHash` is a content-address of every
 * emitted strike + phase boundary; two consumers that agree on
 * the hash are looking at the same score. The runtime + QA
 * harness join on this hash in a later slice.
 *
 * Pure TypeScript — no clocks, no side effects, no React,
 * no Expo. Same purity rules as every other `src/domain/programs/`
 * module.
 */

import type { CompiledStrikeEvent } from './compileCue'
import { expandTimeline } from './CueTimeline'
import { compileCueFromInstance, NULL_COACH_ASSET_RESOLVER } from './programCueBridge'
import { hashTimelineContent } from './timelineHash'
import { TRANSPORT_TICKS_PER_PULSE } from '../timing/TimingEngine'
import type { StrikeToken } from '../strikes/strikeCatalog'
import type { GeneratedWorkout } from '../workout/GeneratedWorkout'
import type { Stance } from '../workout/WorkoutTokens'

// ---------------------------------------------------------------------------
// Score tick math
// ---------------------------------------------------------------------------

/** Base BPM the score's tick space runs at — matches the transport + `programCueBridge`. */
const BASE_BPM = 60
const MS_PER_TRANSPORT_TICK = 60_000 / (BASE_BPM * TRANSPORT_TICKS_PER_PULSE)

/**
 * Milliseconds → integer transport ticks. Rounded to keep the
 * hash + downstream comparisons integer-clean (matches the
 * bridge's `ticksAtMs`).
 */
function ticksAtMs(ms: number): number {
  return Math.round(ms / MS_PER_TRANSPORT_TICK)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkoutScoreConfig {
  stance: Stance
  bpm: number
  /**
   * Monotonic revision number for this compile. Bumped by the
   * caller on any authored change; also stamped into the
   * per-cue `CompiledCueTimeline.identity` via the bridge so
   * downstream can spot stale timelines.
   */
  revision: number
  /** Wall-clock timestamp — pure module has no clock. */
  compiledAtEpochMs: number
}

export interface WorkoutTimelineIdentity {
  workoutId: string
  revision: number
  /** FNV-1a 32-bit content hash of all strikes + phaseBoundaries. */
  timelineHash: string
}

/**
 * A single strike occurrence in score-relative tick space. The
 * cue-local fields (`eventId` / `cueId` / `repId` / `repIndex` /
 * `strikeIndex`) come from `compileCue` verbatim; `roundIndex`
 * is added by the score compiler for O(1) round-scope lookup.
 */
export interface CompiledScoreStrike {
  eventId: string
  cueId: string
  repId: string
  repIndex: number
  strikeIndex: number
  roundIndex: number
  token: StrikeToken
  /** Absolute score tick when the ring lights + avatar begins. */
  startTick: number
  /** Absolute score tick when the ring releases + avatar returns to guard. */
  endTick: number
  /** Absolute score tick when the intended physical strike lands. */
  targetStrikeTick: number
  nodeId: string
  avatarFamilyId: string
  /** Absolute score ticks at which the avatar advances frames. */
  avatarThresholdTicks: readonly number[]
}

export interface CompiledPhaseBoundary {
  kind: 'round-start' | 'round-end'
  roundIndex: number
  atTick: number
}

export interface CompiledWorkoutScore {
  version: 'workout-score/1'
  identity: WorkoutTimelineIdentity
  compiledAtEpochMs: number
  /** Sum of every round's `workDurationMs`, in ticks. Rest windows excluded. */
  totalDurationTicks: number
  config: {
    stance: Stance
    bpm: number
    revision: number
  }
  strikes: readonly CompiledScoreStrike[]
  phaseBoundaries: readonly CompiledPhaseBoundary[]
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/**
 * Compile a `GeneratedWorkout` into a `CompiledWorkoutScore`.
 * Pure — same inputs produce a byte-equal output including
 * `identity.timelineHash`.
 *
 * Steps:
 *   1. `expandTimeline` walks the workout's schedule → per-round
 *      `RoundTimeline[]`, each with a list of `CueInstance`s
 *      already scoped to their scheduled offsets in that round.
 *   2. For each round: emit a `round-start` boundary at the
 *      accumulated cursor tick, walk cues in order, offset each
 *      cue's strike ticks by the cue's `scheduledStartMs`
 *      (converted to score-tick), advance the cursor by the
 *      round's `workDurationMs`, emit `round-end` boundary.
 *   3. Hash the {strikes, phaseBoundaries} content into
 *      `identity.timelineHash`.
 *
 * `compileCueFromInstance` is what actually produces the
 * per-strike ticks (via `compileCue`); this compiler just
 * accumulates cross-round offsets and re-shapes the events into
 * a flat score-scoped list.
 */
export function compileWorkoutScore(
  workout: GeneratedWorkout,
  config: WorkoutScoreConfig,
): CompiledWorkoutScore {
  const rounds = expandTimeline(workout, config.stance, config.bpm)

  const strikes: CompiledScoreStrike[] = []
  const phaseBoundaries: CompiledPhaseBoundary[] = []
  let cursorTick = 0

  for (const round of rounds) {
    const roundStartTick = cursorTick
    phaseBoundaries.push({
      kind: 'round-start',
      roundIndex: round.roundIndex,
      atTick: roundStartTick,
    })

    for (const cue of round.cues) {
      const cueStartTick = roundStartTick + ticksAtMs(cue.scheduledStartMs)
      const compiled = compileCueFromInstance(cue, {
        roundId: `round-${round.roundIndex}`,
        coachAssets: NULL_COACH_ASSET_RESOLVER,
        revision: config.revision,
      })
      if (!compiled) continue
      for (const strike of compiled.strikes) {
        strikes.push(offsetStrike(strike, cueStartTick, round.roundIndex))
      }
    }

    const roundDurationTicks = ticksAtMs(round.workDurationMs)
    cursorTick = roundStartTick + roundDurationTicks
    phaseBoundaries.push({
      kind: 'round-end',
      roundIndex: round.roundIndex,
      atTick: cursorTick,
    })
  }

  const timelineHash = hashTimelineContent({ strikes, phaseBoundaries })

  return {
    version: 'workout-score/1',
    identity: {
      workoutId: workout.id,
      revision: config.revision,
      timelineHash,
    },
    compiledAtEpochMs: config.compiledAtEpochMs,
    totalDurationTicks: cursorTick,
    config: {
      stance: config.stance,
      bpm: config.bpm,
      revision: config.revision,
    },
    strikes,
    phaseBoundaries,
  }
}

/**
 * Shift a `CompiledStrikeEvent`'s ticks by `offsetTick` so the
 * cue-local emission from `compileCue` becomes score-absolute.
 * Also stamps the round index — the only field the score
 * compiler adds beyond `compileCue`'s output.
 */
function offsetStrike(
  strike: CompiledStrikeEvent,
  offsetTick: number,
  roundIndex: number,
): CompiledScoreStrike {
  return {
    eventId: strike.eventId,
    cueId: strike.cueId,
    repId: strike.repId,
    repIndex: strike.repIndex,
    strikeIndex: strike.strikeIndex,
    roundIndex,
    token: strike.token,
    startTick: offsetTick + strike.startTick,
    endTick: offsetTick + strike.endTick,
    targetStrikeTick: offsetTick + strike.targetStrikeTick,
    nodeId: strike.nodeId,
    avatarFamilyId: strike.avatarFamilyId,
    avatarThresholdTicks: strike.avatarThresholdTicks.map((t) => offsetTick + t),
  }
}
