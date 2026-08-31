/**
 * The pre-computed dispatch script for a whole workout (M39-V2 Phase 6
 * verification infrastructure, Kyle 2026-08-30).
 *
 * The 2026-08-30 on-glass QA proved the runtime coach path was
 * DERIVING dispatch on the fly per cue — and the derivations were
 * mismatched with what the visual layer displayed. Kyle's structural
 * response: the whole audio + ring schedule for a workout must
 * compile ONCE, at plan-time, into an immutable script; the runtime
 * dispatcher must READ from that script; a session's actual
 * dispatches must be diffable against the script by an autonomous
 * harness.
 *
 * This module is the compiler. It composes over the shipped V2
 * plumbing:
 *
 *  - `expandTimeline` — expands a `GeneratedWorkout` into cues.
 *  - `compileRoundRhythmMap` — schedules coach events per cue.
 *  - `compileRoundSpine` — attaches `CompiledCueTimeline` per cue
 *    (Phase 4-vi-a).
 *
 * It ADDS a script-flattening pass: every `RhythmEvent` becomes one or
 * more `ScriptEntry`s (per-word phrase → `coach.play` per token;
 * per-phrase announce → `coach.phrase`; tokenDue per cue → `ring.tokenDue`;
 * round boundaries → `bell`), plus a schedule-fault detector that
 * flags adjacent-cue collisions where the second cue's phrase would
 * start before the first cue's phrase (+ release grace) finishes.
 *
 * The output is a versioned JSON structure — safe to serialize, safe
 * to diff, safe to store as a session artifact next to the monitor's
 * logcat capture.
 *
 * ## What this does NOT do
 *
 * - It does NOT touch the runtime dispatcher. Consumers of this
 *   script land in a separate workstream (W3).
 * - It does NOT re-schedule cues to avoid collisions — it just flags
 *   them. Rewriting the compiled schedule is a future compiler pass
 *   (the collision report tells us which authored blocks need
 *   loosening).
 * - It does NOT compute per-word standalone clip durations — those
 *   aren't in a plan-time manifest today (runtime caches them from
 *   the loaded AudioPlayer). Per-word entries carry an estimated
 *   duration; the analyzer treats them as informational.
 *
 * Pure TypeScript: no React, no Expo, no clock, no file I/O. Same
 * purity rules as every other `src/domain/programs/*` module.
 */
import type { GeneratedWorkout } from '../workout/GeneratedWorkout'
import type { Stance } from '../workout/WorkoutTokens'
import type { StrikeToken } from '../strikes/strikeCatalog'
import { DEFAULT_REP_ID, strikeIdFor } from '../strikes/strikeCatalog'
import type { VoiceAssetId } from '../coach/VoiceOutputPort'
import { expandTimeline, type CueInstance, type RoundTimeline } from './CueTimeline'
import {
  compileRoundRhythmMap,
  type CompileOptions as RhythmCompileOptions,
  type RhythmEvent,
  type RoundRhythmMap,
} from './RhythmMap'
import { comboPhraseAssets } from '../coach/vocabulary'

// ---------------------------------------------------------------------------
// Types — versioned + serializable
// ---------------------------------------------------------------------------

export const WORKOUT_SCRIPT_VERSION = 'workout-script/1' as const

/**
 * The full dispatch script for one workout. Every audible + visible
 * dispatch across every round is enumerated at compile time.
 */
export interface CompiledWorkoutScript {
  version: typeof WORKOUT_SCRIPT_VERSION
  workoutId: string
  seed: string
  /** Wall-clock at compile — stamped by the caller (pure module has no clock). */
  compiledAtEpochMs: number
  /** Sum of all round workDurationMs. Excludes rest windows. */
  totalDurationMs: number
  /**
   * How the script was compiled — copied verbatim from the input config
   * so the analyzer can reconstruct the assumptions.
   */
  config: {
    stance: Stance
    bpm: number
    vocabulary: 'numbers' | 'techniques'
    perWordEstimateMs: number
    interCueReleaseGraceMs: number
  }
  rounds: readonly CompiledRoundScript[]
}

export interface CompiledRoundScript {
  roundIndex: number
  workDurationMs: number
  /** All script entries, sorted ascending by `atMs`. */
  entries: readonly ScriptEntry[]
  /** Adjacent-cue collision detections — informational, not a compile error. */
  scheduleFaults: readonly ScheduleFault[]
}

/**
 * One dispatch. `atMs` is round-relative work-elapsed ms — same clock
 * `CueEngine.tick` and `announcer.onTick` walk. `sourceEventId`
 * threads back to the originating `RhythmEvent.id` when the entry
 * came from a compiled RhythmMap event.
 */
export type ScriptEntry =
  | ScriptCoachPlay
  | ScriptCoachPhrase
  | ScriptRingTokenDue
  | ScriptCeremony
  | ScriptBell

export interface ScriptEntryBase {
  atMs: number
  cueId: string
  /** Optional back-reference to `RhythmEvent.id` when this entry is
   * derived from a map event. Diagnostic use only. */
  sourceEventId?: string
}

export interface ScriptCoachPlay extends ScriptEntryBase {
  kind: 'coach.play'
  repId: string
  assetId: VoiceAssetId
  /** Best-known duration; undefined means "unmeasured — informational". */
  expectedDurationMs: number | undefined
  vocabulary: 'numbers' | 'techniques'
  /** The per-word tokenIndex inside the cue, when this came from
   * a per-word split. Absent for standalone plays. */
  tokenIndex?: number
}

export interface ScriptCoachPhrase extends ScriptEntryBase {
  kind: 'coach.phrase'
  repId: string
  /** The full asset sequence for the whole utterance. */
  assets: readonly VoiceAssetId[]
  /** Measured length of the phrase clip when the announce library has one. */
  expectedDurationMs: number
  vocabulary: 'numbers' | 'techniques'
  /** The combination this phrase teaches (e.g. `'1-2b-3'`). */
  combination: string
}

export interface ScriptRingTokenDue extends ScriptEntryBase {
  kind: 'ring.tokenDue'
  repId: string
  tokenIndex: number
  strikeId: string
  token: StrikeToken | 'defense' | 'footwork' | 'coach'
}

export interface ScriptCeremony extends ScriptEntryBase {
  kind: 'ceremony'
  /** `'set-callout'` / `'instruction'` / `'phase-announce'` / `'encouragement'`. */
  ceremonyKind: string
  /** The asset id or text token being announced. */
  asset: string
  expectedDurationMs: number | undefined
}

export interface ScriptBell extends ScriptEntryBase {
  kind: 'bell'
  phase: 'round-start' | 'round-end'
}

export interface ScheduleFault {
  /** `'phrase-collision'` etc. */
  kind: 'phrase-collision'
  atMs: number
  cueId: string
  previousCueId: string
  overlapMs: number
  message: string
}

// ---------------------------------------------------------------------------
// Inputs — what the caller must supply
// ---------------------------------------------------------------------------

export interface ScriptConfig {
  stance: Stance
  /** Coach tempo in the workout's beat-grid units (usually cadence-derived). */
  bpm: number
  vocabulary: 'numbers' | 'techniques'
  /** Wall-clock epoch stamp for the compiled artifact. */
  compiledAtEpochMs: number
  /**
   * Measured phrase length for a combination at a cadence, or undefined
   * when the announce library has none — matches `RhythmMap.CompileOptions.durationFor`.
   */
  durationFor: (combination: string, cadence: string) => number | undefined
  /**
   * Conservative estimated duration for a single per-word standalone
   * clip when the runtime hasn't measured one yet. 500 ms matches
   * `FALLBACK_CLIP_MS` in VoiceOutputExpo when a player reports 0.
   */
  perWordEstimateMs?: number
  /**
   * Grace between consecutive coach phrases — matches
   * `COACH_LANE_RELEASE_GRACE_MS` (50 ms). Used only for
   * collision detection.
   */
  interCueReleaseGraceMs?: number
  /**
   * Optional passthrough of RhythmMap-specific options the caller
   * already builds (encouragement, setup callouts, instruction clips).
   * Left partial — the compiler fills sane defaults.
   */
  rhythmMapOpts?: Partial<Omit<RhythmCompileOptions, 'cadence' | 'durationFor'>>
}

const DEFAULT_PER_WORD_ESTIMATE_MS = 500
const DEFAULT_INTER_CUE_RELEASE_GRACE_MS = 50

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/**
 * Compile a workout into its full dispatch script. Pure. Same input
 * → same output. Safe to serialize as JSON directly.
 *
 * The compiler runs the same round expansion + rhythm-map compile the
 * runner already runs — the resulting script is a data-shape
 * projection of those computations, not a re-derivation.
 */
export function compileWorkoutScript(
  workout: GeneratedWorkout,
  config: ScriptConfig,
): CompiledWorkoutScript {
  const perWordEstimateMs = config.perWordEstimateMs ?? DEFAULT_PER_WORD_ESTIMATE_MS
  const interCueReleaseGraceMs =
    config.interCueReleaseGraceMs ?? DEFAULT_INTER_CUE_RELEASE_GRACE_MS

  const timeline = expandTimeline(workout, config.stance, config.bpm)

  const rounds: CompiledRoundScript[] = timeline.map((round) => {
    const map = compileRoundRhythmMap(round, {
      cadence: workout.recipe.cadenceProfile,
      durationFor: config.durationFor,
      ...(config.rhythmMapOpts ?? {}),
    })
    return compileRoundScript(round, map, {
      vocabulary: config.vocabulary,
      perWordEstimateMs,
      interCueReleaseGraceMs,
      durationFor: config.durationFor,
      cadence: workout.recipe.cadenceProfile,
    })
  })

  const totalDurationMs = rounds.reduce((sum, r) => sum + r.workDurationMs, 0)

  return {
    version: WORKOUT_SCRIPT_VERSION,
    workoutId: workout.id,
    seed: workout.recipe.seed,
    compiledAtEpochMs: config.compiledAtEpochMs,
    totalDurationMs,
    config: {
      stance: config.stance,
      bpm: config.bpm,
      vocabulary: config.vocabulary,
      perWordEstimateMs,
      interCueReleaseGraceMs,
    },
    rounds,
  }
}

// ---------------------------------------------------------------------------
// Per-round flattening
// ---------------------------------------------------------------------------

interface RoundCompileCtx {
  vocabulary: 'numbers' | 'techniques'
  perWordEstimateMs: number
  interCueReleaseGraceMs: number
  durationFor: (combination: string, cadence: string) => number | undefined
  cadence: string
}

function compileRoundScript(
  round: RoundTimeline,
  map: RoundRhythmMap,
  ctx: RoundCompileCtx,
): CompiledRoundScript {
  const entries: ScriptEntry[] = []
  const cuesById = new Map<string, CueInstance>()
  for (const cue of round.cues) cuesById.set(cue.id, cue)

  // Bell at round start + at bell (workDurationMs). Bell entries are
  // idealized (no jitter); the analyzer uses them to segment the
  // capture.
  entries.push({
    kind: 'bell',
    atMs: 0,
    cueId: '__round__',
    phase: 'round-start',
  })
  entries.push({
    kind: 'bell',
    atMs: round.workDurationMs,
    cueId: '__round__',
    phase: 'round-end',
  })

  // Ring tokenDue entries, per cue × per token, from the beat grid
  // (matches CueEngine.fireDueTokens). Count-scored cues don't emit
  // per-token events — their `expectedPunches` is empty and the
  // engine skips them; leave them out of the ring track.
  for (const cue of round.cues) {
    if (cue.scoring !== 'sequence') continue
    for (let i = 0; i < cue.tokenOffsetsMs.length; i += 1) {
      const offset = cue.tokenOffsetsMs[i] ?? 0
      const token = cue.tokens[i]
      const tokenLabel: StrikeToken | 'defense' | 'footwork' | 'coach' =
        token?.kind === 'punch'
          ? ((token.body ? `${token.number}B` : `${token.number}`) as StrikeToken)
          : token?.kind ?? 'coach'
      entries.push({
        kind: 'ring.tokenDue',
        atMs: cue.scheduledStartMs + offset,
        cueId: cue.id,
        repId: DEFAULT_REP_ID,
        tokenIndex: i,
        strikeId: strikeIdFor(cue.id, DEFAULT_REP_ID, i),
        token: tokenLabel,
      })
    }
  }

  // Coach + ceremony entries, translated from the compiled RhythmMap
  // events. The map is the authority for coach timing; this pass
  // just re-shapes each event into one or more ScriptEntry(s) the
  // analyzer can compare against actual voice.play emissions.
  for (const event of map.events) {
    const derived = scriptEntriesFromRhythmEvent(event, cuesById, ctx)
    for (const entry of derived) entries.push(entry)
  }

  // Sort by atMs, stable — the map's events are already sorted but
  // ring + bell entries slot in and disturb the order.
  entries.sort((a, b) => a.atMs - b.atMs)

  return {
    roundIndex: round.roundIndex,
    workDurationMs: round.workDurationMs,
    entries,
    scheduleFaults: detectPhraseCollisions(entries, ctx.interCueReleaseGraceMs),
  }
}

/**
 * Translate one `RhythmEvent` into its script entries. A `call` /
 * `refire` event with `mode: 'per-word'` fans out into multiple
 * `coach.play` entries; with `mode: 'phrase'` collapses into one
 * `coach.phrase`. `set-callout` / `instruction` / `encouragement`
 * become `ceremony` entries.
 *
 * When the cue has no matching entry (a `__round__` synthetic event),
 * the entries are threaded under the event's own cueId so the
 * analyzer's grouping stays honest.
 */
function scriptEntriesFromRhythmEvent(
  event: RhythmEvent,
  cuesById: Map<string, CueInstance>,
  ctx: RoundCompileCtx,
): ScriptEntry[] {
  const payload = event.payload as unknown
  switch (event.kind) {
    case 'call':
    case 'refire': {
      const call = payload as {
        mode?: 'phrase' | 'per-word'
        combination?: string
        cadence?: string
      } | null
      const cue = cuesById.get(event.cueId)
      if (!cue || !call) return []
      const combination = call.combination ?? ''
      const cadence = call.cadence ?? ctx.cadence
      const mode = call.mode ?? 'per-word'
      if (mode === 'phrase') {
        const measured = ctx.durationFor(combination, cadence)
        const assets = comboPhraseAssets(cue.tokens)
        return [
          {
            kind: 'coach.phrase',
            atMs: event.atMs,
            cueId: event.cueId,
            repId: DEFAULT_REP_ID,
            sourceEventId: event.id,
            assets,
            expectedDurationMs: measured ?? assets.length * ctx.perWordEstimateMs,
            vocabulary: ctx.vocabulary,
            combination,
          },
        ]
      }
      // per-word: one coach.play per asset, staggered by the estimated
      // per-word duration. The compiler doesn't know the exact
      // inter-word gap the announcer uses (planPhrase's tightness is
      // clip-length-dependent), so this is a nominal placement — the
      // analyzer tolerates timing-drift on per-word entries.
      const assets = comboPhraseAssets(cue.tokens)
      return assets.map((assetId, tokenIndex) => ({
        kind: 'coach.play' as const,
        atMs: event.atMs + tokenIndex * ctx.perWordEstimateMs,
        cueId: event.cueId,
        repId: DEFAULT_REP_ID,
        sourceEventId: event.id,
        assetId,
        expectedDurationMs: ctx.perWordEstimateMs,
        vocabulary: ctx.vocabulary,
        tokenIndex,
      }))
    }
    case 'set-callout': {
      const p = payload as { asset?: string; recite?: string } | null
      if (!p) return []
      return [
        {
          kind: 'ceremony',
          atMs: event.atMs,
          cueId: event.cueId,
          sourceEventId: event.id,
          ceremonyKind: 'set-callout',
          asset: p.asset ?? p.recite ?? '(unknown)',
          expectedDurationMs: undefined,
        },
      ]
    }
    case 'instruction': {
      const p = payload as { text?: string; module?: number; durationMs?: number } | null
      if (!p) return []
      return [
        {
          kind: 'ceremony',
          atMs: event.atMs,
          cueId: event.cueId,
          sourceEventId: event.id,
          ceremonyKind: 'instruction',
          asset: p.text ?? '(unknown)',
          expectedDurationMs: p.durationMs,
        },
      ]
    }
    case 'encouragement': {
      const p = payload as { asset?: string } | null
      if (!p?.asset) return []
      return [
        {
          kind: 'ceremony',
          atMs: event.atMs,
          cueId: event.cueId,
          sourceEventId: event.id,
          ceremonyKind: 'encouragement',
          asset: p.asset,
          expectedDurationMs: undefined,
        },
      ]
    }
    // phase-announce / tone / other kinds — not currently voiced in a
    // way the analyzer needs to track. Represented as ceremony for
    // completeness.
    default:
      return [
        {
          kind: 'ceremony',
          atMs: event.atMs,
          cueId: event.cueId,
          sourceEventId: event.id,
          ceremonyKind: event.kind,
          asset: '(no-payload)',
          expectedDurationMs: undefined,
        },
      ]
  }
}

/**
 * Adjacent-cue phrase collision detection. Walks coach entries in
 * `atMs` order; when a coach entry starts before the previous coach
 * entry's estimated end (+ release grace), records a fault.
 *
 * Not a compile error — the runtime's tolerance for collisions is
 * a runtime concern. The fault is informational: it tells the QA
 * process which authored blocks pack tighter than the current
 * phrase library can honor.
 */
function detectPhraseCollisions(
  entries: readonly ScriptEntry[],
  releaseGraceMs: number,
): ScheduleFault[] {
  const faults: ScheduleFault[] = []
  let prevCoachEnd = -Infinity
  let prevCueId = ''
  for (const entry of entries) {
    if (entry.kind !== 'coach.play' && entry.kind !== 'coach.phrase') continue
    const duration =
      entry.kind === 'coach.phrase'
        ? entry.expectedDurationMs
        : entry.expectedDurationMs ?? 0
    if (entry.atMs < prevCoachEnd && entry.cueId !== prevCueId) {
      faults.push({
        kind: 'phrase-collision',
        atMs: entry.atMs,
        cueId: entry.cueId,
        previousCueId: prevCueId,
        overlapMs: prevCoachEnd - entry.atMs,
        message: `${entry.cueId} coach starts ${prevCoachEnd - entry.atMs} ms before ${prevCueId} coach + release grace ends`,
      })
    }
    prevCoachEnd = entry.atMs + duration + releaseGraceMs
    prevCueId = entry.cueId
  }
  return faults
}
