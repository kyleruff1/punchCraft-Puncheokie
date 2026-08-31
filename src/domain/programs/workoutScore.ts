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

import type {
  CoachAssetResolver,
  CompiledCoachEvent,
  CompiledStrikeEvent,
} from './compileCue'
import { expandTimeline } from './CueTimeline'
import { compileCueFromInstance, NULL_COACH_ASSET_RESOLVER } from './programCueBridge'
import { hashTimelineContent } from './timelineHash'
import type { CoachContentKind, CoachStrikeRelation } from '../coach/VoicePolicy'
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
  /**
   * How the compiler resolves a coach asset for a
   * (contentKind, vocabulary) pair. Default is
   * `NULL_COACH_ASSET_RESOLVER` — no coach events emitted, only
   * strikes + boundaries. Slice 3's runtime consumer passes a
   * resolver backed by the shipped combo-announce +
   * technique-standalone manifests.
   */
  coachAssets?: CoachAssetResolver
  /**
   * Milliseconds between the vocabulary lock deadline and the
   * slot's earliest possible dispatch (principle #8). A vocab
   * switch landing before `vocabLockAtTick` still affects the
   * next slot; after, the slot stays locked. Default 300 ticks
   * (~312 ms at 60 BPM) — matches the preload margin the runtime
   * coach lane uses today.
   */
  preloadMarginTicks?: number
  /**
   * Per-variant capability table (principle #9). Called once per
   * `(contentKind, vocabulary)` pair the compiler emits; the
   * returned capabilities are stamped on the variant. Default is
   * permissive — all three relations allowed with no minimum
   * synchronized slot length. Slice 3's runtime consumer + Sprint
   * cadence overrides land here.
   */
  coachCapabilitiesFor?: (
    contentKind: CoachContentKind,
    vocabulary: 'numeric' | 'technique',
  ) => CoachVariantCapabilities
}

const DEFAULT_PRELOAD_MARGIN_TICKS = 300

const DEFAULT_CAPABILITIES: CoachVariantCapabilities = Object.freeze({
  allowedRelations: Object.freeze(['precall', 'synchronized', 'shared-block']) as unknown as readonly (
    'precall' | 'synchronized' | 'shared-block'
  )[],
})

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

// ---------------------------------------------------------------------------
// Coach slots — Slice 2 (M39-V2 W1-b)
// ---------------------------------------------------------------------------

/**
 * Per-asset capability constraints (principle #9). Callers with
 * a tier-aware policy (Sprint cadence + long technique names,
 * for example) supply their own via `config.coachCapabilitiesFor`;
 * the compiler defaults to permissive.
 */
export interface CoachVariantCapabilities {
  allowedRelations: readonly ('precall' | 'synchronized' | 'shared-block')[]
  minimumSynchronizedSlotTicks?: number
}

/**
 * A single strike anchor inside a phrase's timeline. `provenance`
 * says how the anchor was determined (principle #13):
 *   - `measured-word-onset` — extracted from a waveform analysis
 *   - `manually-authored`   — a human wrote it (e.g., "double jab"
 *                             second anchor with no acoustic landmark)
 *   - `interpolated`        — computed between other anchors
 *   - `phrase-template`     — inherited from the phrase template
 *
 * Hard acoustic fit-check applies ONLY where `measured-word-onset`
 * exists; other provenances validate against logical ordering +
 * musical interval + phrase duration.
 */
export interface TaughtStrikeAnchor {
  offsetTicks: number
  provenance: 'measured-word-onset' | 'manually-authored' | 'interpolated' | 'phrase-template'
  confidence?: number
}

/**
 * One vocabulary realization of a coach slot. Numeric + technique
 * variants of the same semantic slot share one CONSERVATIVE
 * reservation window on the parent slot (principle #4). The
 * runtime picks the asset at dispatch time.
 */
export interface CompiledCoachVariant {
  vocabulary: 'numeric' | 'technique'
  assetId: string
  measuredDurationTicks: number
  /** Score-absolute — the audible start of this variant. */
  audibleStartTick: number
  /** Score-absolute — the audible end of this variant. */
  audibleEndTick: number
  taughtStrikeAnchors: readonly TaughtStrikeAnchor[]
  capabilities: CoachVariantCapabilities
  /**
   * Set when the compiler had to transform the authored request
   * to fit the variant's capabilities (e.g., a long technique
   * name in a sprint-cadence synchronized slot could not fit).
   * Absent when no transformation was necessary.
   */
  transformReason?:
    | 'compact-alias-substituted'
    | 'moved-to-precall'
    | 'converted-to-numeric'
    | 'coach-silent'
}

/**
 * The semantic coach slot: one call the coach makes at a specific
 * moment, in one of two possible vocabularies. Runtime dispatch
 * picks a vocabulary at dispatch time; the slot's reservation
 * window is the CONSERVATIVE union of both variants so any
 * mid-cue vocab switch cannot collide with the next slot
 * (principle #4).
 */
export interface CompiledCoachSlot {
  slotId: string
  cueId: string
  repId: string | null
  roundIndex: number
  contentKind: CoachContentKind
  relation: CoachStrikeRelation
  /** Score-absolute strike-event ids this slot teaches / reinforces. */
  strikeEventIds: readonly string[]
  /** Score-absolute — where BOTH variants must have finished by. */
  desiredAudibleEndTick: number
  /** Score-absolute — earliest possible dispatch across the variants. */
  reservationStartTick: number
  /** Score-absolute — reservation window closes at max end across variants. */
  reservationEndTick: number
  /**
   * Score-absolute — vocab lock deadline (principle #8). A
   * `reservationStartTick - preloadMarginTicks`; vocab switches
   * landing before this affect this slot; after, this slot is
   * locked and the next slot inherits the switch.
   */
  vocabLockAtTick: number
  variants: {
    numeric?: CompiledCoachVariant
    technique?: CompiledCoachVariant
  }
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
    preloadMarginTicks: number
  }
  strikes: readonly CompiledScoreStrike[]
  coachSlots: readonly CompiledCoachSlot[]
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
  const coachAssets = config.coachAssets ?? NULL_COACH_ASSET_RESOLVER
  const preloadMarginTicks = config.preloadMarginTicks ?? DEFAULT_PRELOAD_MARGIN_TICKS
  const capabilitiesFor = config.coachCapabilitiesFor ?? defaultCapabilitiesFor

  const strikes: CompiledScoreStrike[] = []
  const coachSlots: CompiledCoachSlot[] = []
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
        coachAssets,
        revision: config.revision,
      })
      if (!compiled) continue
      for (const strike of compiled.strikes) {
        strikes.push(offsetStrike(strike, cueStartTick, round.roundIndex))
      }
      for (const slot of buildCoachSlots(
        compiled.coachTracks.numeric.events,
        compiled.coachTracks.technique.events,
        cueStartTick,
        round.roundIndex,
        preloadMarginTicks,
        capabilitiesFor,
      )) {
        coachSlots.push(slot)
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

  const timelineHash = hashTimelineContent({ strikes, coachSlots, phaseBoundaries })

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
      preloadMarginTicks,
    },
    strikes,
    coachSlots,
    phaseBoundaries,
  }
}

/**
 * Group per-cue numeric + technique coach events into semantic
 * coach slots. Two events are the SAME slot iff they share
 * `(cueId, repId, contentKind, relation, strikeEventIds sorted-joined)`
 * — that tuple is the semantic identity across vocabularies.
 * Events with no matching partner appear as a single-variant slot.
 *
 * Slot timing:
 *   - `desiredAudibleEndTick` = max of both variants' audible ends
 *     (per plan principle #4: shorter variant starts later so both
 *     finish at the same semantic endpoint).
 *   - `reservationStartTick` = min of both variants' audible starts
 *     — the conservative "who starts first" moment.
 *   - `reservationEndTick`   = `desiredAudibleEndTick` — the
 *     reservation window closes when the longer variant would.
 *   - `vocabLockAtTick`      = `reservationStartTick - preloadMarginTicks`.
 */
function buildCoachSlots(
  numericEvents: readonly CompiledCoachEvent[],
  techniqueEvents: readonly CompiledCoachEvent[],
  cueStartTick: number,
  roundIndex: number,
  preloadMarginTicks: number,
  capabilitiesFor: (
    contentKind: CoachContentKind,
    vocabulary: 'numeric' | 'technique',
  ) => CoachVariantCapabilities,
): CompiledCoachSlot[] {
  const bySlotKey = new Map<
    string,
    { key: string; numeric?: CompiledCoachEvent; technique?: CompiledCoachEvent }
  >()

  for (const event of numericEvents) {
    const key = slotKeyFor(event)
    const entry = bySlotKey.get(key) ?? { key }
    entry.numeric = event
    bySlotKey.set(key, entry)
  }
  for (const event of techniqueEvents) {
    const key = slotKeyFor(event)
    const entry = bySlotKey.get(key) ?? { key }
    entry.technique = event
    bySlotKey.set(key, entry)
  }

  const slots: CompiledCoachSlot[] = []
  // Preserve emission order: the numeric track's order, then any
  // technique-only events not seen in numeric.
  const seenKeys = new Set<string>()
  const ordered: Array<{ key: string; numeric?: CompiledCoachEvent; technique?: CompiledCoachEvent }> = []
  for (const event of numericEvents) {
    const key = slotKeyFor(event)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    ordered.push(bySlotKey.get(key)!)
  }
  for (const event of techniqueEvents) {
    const key = slotKeyFor(event)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    ordered.push(bySlotKey.get(key)!)
  }

  for (const entry of ordered) {
    const { numeric, technique } = entry
    // At least one variant must exist to form a slot.
    const seed = numeric ?? technique
    if (!seed) continue
    const numericVariant = numeric
      ? buildVariant(numeric, 'numeric', cueStartTick, capabilitiesFor)
      : undefined
    const techniqueVariant = technique
      ? buildVariant(technique, 'technique', cueStartTick, capabilitiesFor)
      : undefined
    const audibleEnds: number[] = []
    const audibleStarts: number[] = []
    if (numericVariant) {
      audibleEnds.push(numericVariant.audibleEndTick)
      audibleStarts.push(numericVariant.audibleStartTick)
    }
    if (techniqueVariant) {
      audibleEnds.push(techniqueVariant.audibleEndTick)
      audibleStarts.push(techniqueVariant.audibleStartTick)
    }
    const reservationStartTick = Math.min(...audibleStarts)
    const desiredAudibleEndTick = Math.max(...audibleEnds)
    const slot: CompiledCoachSlot = {
      slotId: `${seed.cueId}:${seed.repId ?? 'cue'}:${seed.contentKind}:${seed.relation}:${seed.strikeEventIds.slice().sort().join(',')}`,
      cueId: seed.cueId,
      repId: seed.repId,
      roundIndex,
      contentKind: seed.contentKind,
      relation: seed.relation,
      strikeEventIds: seed.strikeEventIds,
      desiredAudibleEndTick,
      reservationStartTick,
      reservationEndTick: desiredAudibleEndTick,
      vocabLockAtTick: reservationStartTick - preloadMarginTicks,
      variants: {
        ...(numericVariant ? { numeric: numericVariant } : {}),
        ...(techniqueVariant ? { technique: techniqueVariant } : {}),
      },
    }
    slots.push(slot)
  }
  return slots
}

function slotKeyFor(event: CompiledCoachEvent): string {
  return `${event.cueId}:${event.repId ?? 'cue'}:${event.contentKind}:${event.relation}:${event.strikeEventIds.slice().sort().join(',')}`
}

function buildVariant(
  event: CompiledCoachEvent,
  vocabulary: 'numeric' | 'technique',
  cueStartTick: number,
  capabilitiesFor: (
    contentKind: CoachContentKind,
    vocabulary: 'numeric' | 'technique',
  ) => CoachVariantCapabilities,
): CompiledCoachVariant {
  const audibleStartTick = cueStartTick + event.desiredAudibleStartTick
  const audibleEndTick = cueStartTick + event.desiredAudibleEndTick
  return {
    vocabulary,
    assetId: event.assetId,
    measuredDurationTicks: Math.max(0, event.desiredAudibleEndTick - event.desiredAudibleStartTick),
    audibleStartTick,
    audibleEndTick,
    // Slice 2 stamps `phrase-template` on every anchor as a
    // provenance floor — the underlying compileCue doesn't yet
    // surface per-word measured onsets on `CompiledCoachEvent`.
    // A future slice thread measured anchors through when the
    // phrase manifest carries them.
    taughtStrikeAnchors: [],
    capabilities: capabilitiesFor(event.contentKind, vocabulary),
  }
}

function defaultCapabilitiesFor(): CoachVariantCapabilities {
  return DEFAULT_CAPABILITIES
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
