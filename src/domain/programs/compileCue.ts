/**
 * `compileCue` — one authored cue in, one immutable compiled
 * timeline out (M39-V2 Phase 3b, Kyle amendments 2026-08-30).
 *
 * The heart of V2. Every downstream consumer — ring engine, avatar
 * dispatcher, tracker matcher, coach lane, diagnostics — reads the
 * result of this function. Nothing else recomputes timing.
 *
 * ## What the compiler does
 *
 * 1. **Expands repetitions** into `CompiledRep` instances. A combo
 *    authored with `repeat: 3` produces three reps, each with its
 *    own `strikeEventIds[]` and `coachEventIds[]`. Strike ids are
 *    three-level (`${cueId}:${repId}:${strikeIndex}`) so
 *    `1-1-2 × 3` yields nine unique strike occurrences — the fix
 *    for the V1c avatar short-circuit on repeated tokens.
 *
 * 2. **Compiles both coach vocabulary tracks** (numeric + technique)
 *    always, regardless of the currently-selected vocabulary. The
 *    runtime picks which track to play at dispatch time; the
 *    strike array is shared. A vocabulary swap between reps is
 *    free — no recompilation.
 *
 * 3. **Populates many-to-many coach ↔ strike links.** A strike can
 *    be covered by a pre-call PLUS reinforced by a synchronized
 *    reminder PLUS included in a shared-block sustained
 *    instruction — all at once. One coach event can teach many
 *    strikes ("Double jab" = one utterance, two strikes).
 *
 * 4. **Stamps a timeline fingerprint** (`TimelineIdentity`) so
 *    consumers can verify "same timeline" across worklet copies
 *    and native-module boundaries without reference equality.
 *
 * ## What the compiler does NOT do
 *
 * - **Play audio.** The compiler emits `CompiledCoachEvent.assetId`
 *   references; the audio backend (Phase 4) does the actual
 *   dispatch with latency compensation.
 * - **Advance the transport.** The compiler works in absolute
 *   transport ticks; `MetronomeTransport` (Phase 1') is where the
 *   clock actually runs.
 * - **Own repetition scheduling.** `strikeStartTick` + `startTick`
 *   /`endTick` describe when things SHOULD happen; the frame-clock
 *   dispatcher (Phase 5) reads them per-frame.
 *
 * Pure module. No React, no audio, no clock. Same purity rules as
 * `TimingEngine.ts` — spec §15.1.
 */

import {
  type CoachContentKind,
  type CoachEventLink,
  type CoachStrikeRelation,
  type VoicePolicy,
} from '../coach/VoicePolicy'
import { strikeFor, type StrikeToken } from '../strikes/strikeCatalog'
import {
  callSlotDurationMs,
  msAtTick,
  tickAt,
  ticksPerUnit,
  type BeatDivision,
  type CoachTempo,
} from '../timing/TimingEngine'
import { comboSignatureFromStrikes } from './comboSignature'
import { hashTimelineContent, type TimelineIdentity } from './timelineHash'

// ---------------------------------------------------------------------------
// Input shapes — authored data the compiler consumes.
// These are lightweight lift-outs from Kyle's blueprint; the existing
// CueTimeline / WorkoutBlock world bridges into these at the caller
// layer (Phase 3c) so this module stays purely about compilation.
// ---------------------------------------------------------------------------

/**
 * One authored strike inside a combo pattern. Position lives on the
 * simple 12-step authoring grid (`AUTHORING_STEPS_PER_PULSE = 12`);
 * the compiler lowers to transport ticks via `tickAtAuthoringStep`.
 *
 * `spanSteps` reserves visual ownership — usually 1 (one execution
 * slot); larger values are for tokens that hold visually longer than
 * their beat (a slow "1" during a technical block).
 */
export interface AuthoredStrike {
  token: StrikeToken
  atStep: number
  spanSteps?: number
  accent?: 'setup' | 'normal' | 'power' | 'finish'
  /**
   * Optional per-strike sync-mode override. When absent, resolves
   * from the cue's `VoicePolicy.defaultTiming` — the "author each
   * strike explicitly OR fall back to the cue default" rule.
   */
  syncMode?: CoachStrikeRelation
}

/**
 * One authored combination — the pattern independent of workout
 * placement. Multiple cues can reference the same combo id with
 * different tempos / rep counts / coach lines.
 */
export interface ComboPattern {
  id: string
  strikes: readonly AuthoredStrike[]
  /**
   * Total author-steps allocated to one pass of the combo. Usually
   * `Math.max(...strikes.map(s => s.atStep + (s.spanSteps ?? 1)))`,
   * but authored explicitly so a syncopated combo can leave trailing
   * empty steps (a rest at the end of the phrase).
   */
  totalSteps: number
}

/**
 * How many times the combo repeats inside this cue, and how coach
 * audio behaves across the repetitions.
 */
export interface RepetitionPlan {
  count: number
  /** Author-steps of silence between reps. */
  gapSteps: number
  /**
   * Rep indexes to fire coach audio on, when the
   * `VoicePolicy.repeatFrequency` is `selected-reps`. Ignored for
   * every other frequency.
   */
  selectedRepIndexes?: readonly number[]
}

/**
 * A coach asset the compiler can reference. The audio backend
 * (Phase 4) does the actual playback; the compiler cares only about
 * the id and the phrase's musical duration so it can back-schedule
 * the pre-call window.
 */
export interface CoachAssetRef {
  assetId: string
  /** Musical duration of the phrase after mapping to the transport. */
  mappedDurationTicks: number
  /**
   * Optional per-strike anchor offsets INSIDE the phrase.
   * Used for `taughtStrikeOffsetsTicks` validation in Phase 4b.
   * Absent for shapes where the phrase doesn't teach a rhythm
   * (sustained instructions, coast intros, encouragements).
   */
  taughtStrikeOffsetsTicks?: readonly number[]
}

/**
 * Per-cue context handed to the resolver so it can key catalog
 * lookups on the specific combo being compiled. Combo-announce
 * clips are keyed by combination (`1-1-2b-numbers`); the resolver
 * needs the signature to fetch the right clip. Other content kinds
 * (sustained-instruction, coast-intro, encouragement) currently
 * ignore this field — new context fields are added as new content
 * kinds land.
 */
export interface CoachAssetContext {
  /**
   * Canonical combo signature (e.g., `1-1-2b`) built from the cue's
   * strike list. Empty string when the cue has zero strikes (the
   * bridge already refuses to emit a ProgramCue for those, so
   * runtime resolvers never see an empty signature — the field is
   * present for the pure-domain shape).
   */
  comboSignature: string
}

/**
 * The compiler's per-cue coach asset lookup — one function taking
 * (contentKind, vocabulary, ctx) and returning the asset ref or
 * `undefined` if the library has no rendering. The compiler emits
 * `CompiledCoachEvent`s only for kinds the resolver has assets for;
 * absent assets produce silent gaps, which is valid runtime
 * behavior (the block still runs, coach just doesn't speak that
 * event).
 *
 * A single-track resolver (numeric OR technique) is legal too — the
 * compiler produces an empty `events[]` for the missing vocabulary.
 */
export type CoachAssetResolver = (
  contentKind: CoachContentKind,
  vocabulary: 'numeric' | 'technique',
  context: CoachAssetContext,
) => CoachAssetRef | undefined

/**
 * The input to `compileCue`. `roundId` scopes cue and strike
 * identifiers so a workout's compiled cues don't collide across
 * rounds. `executeAtTick` is the absolute transport tick where the
 * FIRST rep's first strike lands — the compiler back-schedules the
 * rep 0 pre-call (if any) from there.
 */
export interface ProgramCue {
  roundId: string
  cueId: string
  combo: ComboPattern
  repetition: RepetitionPlan
  executeAtTick: number
  executionDivision: BeatDivision
  baseBpm: number
  voicePolicy: VoicePolicy
  /**
   * Ticks between the audible end of a pre-call and the strike it
   * teaches. Kyle: "brief response gap" (60–125 ms at 60 BPM).
   * Compiler assumes 60 transport ticks by default (≈62.5 ms) when
   * omitted.
   */
  responseGapTicks?: number
  /** How the compiler resolves coach assets. */
  coachAssets: CoachAssetResolver
  revision: number
}

// ---------------------------------------------------------------------------
// Output shapes — the compiled timeline.
// ---------------------------------------------------------------------------

export interface CompiledStrikeEvent {
  eventId: string
  cueId: string
  repId: string
  repIndex: number
  strikeIndex: number
  token: StrikeToken
  /** Transport tick when the ring lights + avatar begins its frame family. */
  startTick: number
  /** Transport tick when the ring releases + avatar returns to guard. */
  endTick: number
  /**
   * Transport tick when the intended physical strike lands. Usually
   * `startTick + (endTick - startTick) × 0.5`; authored differently
   * for tokens with a non-midpoint impact.
   */
  targetStrikeTick: number
  /**
   * Ordered transport ticks at which the avatar advances frames.
   * Two-frame family: `[startTick, midpointTick]`.
   * Three-frame family: `[startTick, firstThresholdTick, secondThresholdTick]`.
   * The frame at index `i` shows from `avatarThresholdTicks[i]` until
   * `avatarThresholdTicks[i+1]` (or `endTick` for the last).
   */
  avatarThresholdTicks: readonly number[]
  nodeId: string
  avatarFamilyId: string
  accent: 'setup' | 'normal' | 'power' | 'finish'
  syncMode: CoachStrikeRelation | 'silent'
  coachLinks: readonly CoachEventLink[]
}

export interface CompiledCoachEvent {
  eventId: string
  cueId: string
  repId: string | null // null for once-per-cue events not tied to a rep
  vocabulary: 'numeric' | 'technique'
  contentKind: CoachContentKind
  relation: CoachStrikeRelation
  /** Desired audible onset — the audio backend subtracts device latency at dispatch. */
  desiredAudibleStartTick: number
  desiredAudibleEndTick: number
  strikeEventIds: readonly string[]
  assetId: string
  runId: string
}

export interface CompiledCoachTrack {
  vocabulary: 'numeric' | 'technique'
  events: readonly CompiledCoachEvent[]
}

export interface CompiledRep {
  repId: string
  repIndex: number
  startTick: number
  endTick: number
  strikeEventIds: readonly string[]
  coachEventIds: readonly string[]
}

export interface CompiledCueTimeline {
  identity: TimelineIdentity
  reps: readonly CompiledRep[]
  /** Canonical execution timeline — independent of coach vocabulary. */
  strikes: readonly CompiledStrikeEvent[]
  coachTracks: {
    numeric: CompiledCoachTrack
    technique: CompiledCoachTrack
  }
  executionStartTick: number
  executionEndTick: number
  cueEndTick: number
}

// ---------------------------------------------------------------------------
// Compiler.
// ---------------------------------------------------------------------------

const DEFAULT_RESPONSE_GAP_TICKS = 60

/**
 * Compile one authored `ProgramCue` into an immutable
 * `CompiledCueTimeline`. Every consumer reads the result — nothing
 * else recomputes timing.
 */
export function compileCue(cue: ProgramCue): CompiledCueTimeline {
  const strikes: CompiledStrikeEvent[] = []
  const numericEvents: CompiledCoachEvent[] = []
  const techniqueEvents: CompiledCoachEvent[] = []
  const reps: CompiledRep[] = []

  const responseGap = cue.responseGapTicks ?? DEFAULT_RESPONSE_GAP_TICKS
  const unitTicks = ticksPerUnit(cue.executionDivision)
  const gapTicks = cue.repetition.gapSteps * unitTicks
  const passTicks = cue.combo.totalSteps * unitTicks

  // Canonical signature for the combo this cue speaks — combo-announce
  // resolvers key on this to fetch the pre-rendered clip. Derived here
  // so every ProgramCue is looked up the same way regardless of who
  // constructed it (the bridge, a test, a future authoring path).
  const coachAssetContext: CoachAssetContext = {
    comboSignature: comboSignatureFromStrikes(cue.combo.strikes),
  }

  const shouldFireForRep = (repIndex: number): boolean => {
    switch (cue.voicePolicy.repeatFrequency) {
      case 'once-per-cue':
        return repIndex === 0
      case 'once-per-rep':
        return true
      case 'first-rep-only':
        return repIndex === 0
      case 'selected-reps':
        return (cue.repetition.selectedRepIndexes ?? []).includes(repIndex)
      case 'authored-events':
        // Non-rep-tied events (coast check-ins etc.) are produced by
        // a separate authoring path — not this per-rep fire loop.
        return false
    }
  }

  for (let repIndex = 0; repIndex < Math.max(1, cue.repetition.count); repIndex += 1) {
    const repId = `rep-${repIndex}`
    const repStartTick = cue.executeAtTick + repIndex * (passTicks + gapTicks)
    const repEndTick = repStartTick + passTicks

    // ---- strikes ----------------------------------------------------------
    const repStrikeIds: string[] = []
    for (let strikeIndex = 0; strikeIndex < cue.combo.strikes.length; strikeIndex += 1) {
      const authored = cue.combo.strikes[strikeIndex]!
      const startTick = repStartTick + authored.atStep * unitTicks
      const endTick = startTick + (authored.spanSteps ?? 1) * unitTicks
      const strikeEventId = `${cue.cueId}:${repId}:${strikeIndex}`
      const definition = strikeFor(
        Number(authored.token.replace('B', '')) as 1 | 2 | 3 | 4 | 5 | 6,
        authored.token.endsWith('B'),
      )
      if (!definition) {
        throw new Error(`compileCue: unknown strike token ${authored.token}`)
      }
      const syncMode =
        authored.syncMode ??
        (cue.voicePolicy.defaultTiming === 'independent'
          ? 'precall'
          : (cue.voicePolicy.defaultTiming as CoachStrikeRelation))
      strikes.push({
        eventId: strikeEventId,
        cueId: cue.cueId,
        repId,
        repIndex,
        strikeIndex,
        token: authored.token,
        startTick,
        endTick,
        targetStrikeTick: startTick + Math.round((endTick - startTick) / 2),
        avatarThresholdTicks: [startTick, startTick + Math.round((endTick - startTick) / 2)],
        nodeId: definition.nodeId,
        avatarFamilyId: `avatar.${definition.avatarFrameKey.number}${definition.avatarFrameKey.body ? 'b' : ''}`,
        accent: authored.accent ?? 'normal',
        syncMode,
        coachLinks: [], // filled below
      })
      repStrikeIds.push(strikeEventId)
    }

    // ---- coach events for this rep ---------------------------------------
    const repCoachIds: string[] = []
    if (shouldFireForRep(repIndex)) {
      for (const vocabulary of ['numeric', 'technique'] as const) {
        const asset = cue.coachAssets(
          cue.voicePolicy.contentKind,
          vocabulary,
          coachAssetContext,
        )
        if (!asset) continue

        const eventId = `${cue.cueId}:${repId}:coach:${vocabulary}:${cue.voicePolicy.contentKind}`
        const relation: CoachStrikeRelation =
          cue.voicePolicy.defaultTiming === 'independent'
            ? 'precall'
            : (cue.voicePolicy.defaultTiming as CoachStrikeRelation)

        // Precall: audible END lands `responseGap` before the first strike;
        // START is `mappedDurationTicks` earlier.
        // Synchronized: audible START = strike's startTick.
        // Shared-block: audible span = full rep (start of first strike → end of last).
        let audibleStart: number
        let audibleEnd: number
        switch (relation) {
          case 'precall':
            audibleEnd = repStartTick - responseGap
            audibleStart = audibleEnd - asset.mappedDurationTicks
            break
          case 'synchronized':
            audibleStart = repStartTick
            audibleEnd = audibleStart + asset.mappedDurationTicks
            break
          case 'shared-block':
            audibleStart = repStartTick
            audibleEnd = repEndTick
            break
          case 'checkin':
            // Authored-events path — not fired from per-rep loop.
            continue
        }

        const strikesTaught =
          relation === 'shared-block' || relation === 'precall'
            ? [...repStrikeIds]
            : repStrikeIds.length > 0
              ? [repStrikeIds[0]!]
              : []

        const event: CompiledCoachEvent = {
          eventId,
          cueId: cue.cueId,
          repId,
          vocabulary,
          contentKind: cue.voicePolicy.contentKind,
          relation,
          desiredAudibleStartTick: audibleStart,
          desiredAudibleEndTick: audibleEnd,
          strikeEventIds: strikesTaught,
          assetId: asset.assetId,
          runId: `${cue.roundId}:${cue.cueId}:${repId}:${vocabulary}`,
        }
        if (vocabulary === 'numeric') numericEvents.push(event)
        else techniqueEvents.push(event)
        repCoachIds.push(eventId)

        // Populate coachLinks on the strikes this event teaches (both
        // vocab tracks reference the same strikes — a strike's link
        // count is 0..2 per relation, matching the tracks that speak
        // it). The strike stores the LINK per event so a runtime
        // consumer can find a specific vocab event.
        for (const sid of strikesTaught) {
          const strike = strikes.find((s) => s.eventId === sid)
          if (strike) {
            ;(strike.coachLinks as CoachEventLink[]).push({
              coachEventId: eventId,
              relation,
            })
          }
        }
      }
    }

    reps.push({
      repId,
      repIndex,
      startTick: repStartTick,
      endTick: repEndTick,
      strikeEventIds: repStrikeIds,
      coachEventIds: repCoachIds,
    })
  }

  const executionStartTick = cue.executeAtTick
  const lastRep = reps[reps.length - 1]!
  const executionEndTick = lastRep.endTick

  const identity: TimelineIdentity = {
    revision: cue.revision,
    cueId: cue.cueId,
    timelineHash: hashTimelineContent({
      strikes,
      numeric: numericEvents,
      technique: techniqueEvents,
    }),
  }

  return {
    identity,
    reps,
    strikes,
    coachTracks: {
      numeric: { vocabulary: 'numeric', events: numericEvents },
      technique: { vocabulary: 'technique', events: techniqueEvents },
    },
    executionStartTick,
    executionEndTick,
    cueEndTick: executionEndTick,
  }
}

// ---------------------------------------------------------------------------
// Small helpers a caller (Phase 3c) can lean on when bridging from
// existing WorkoutBlock / CueInstance shapes.
// ---------------------------------------------------------------------------

/**
 * Convert a compiled strike's `startTick` to milliseconds against
 * a given master BPM. Consumers that still speak in ms
 * (RhythmSpine's `TokenBeat.atMs`, CueEngine's `until` cap) use
 * this bridge until they move fully to tick math.
 */
export function strikeStartMsFor(
  strike: CompiledStrikeEvent,
  baseBpm: number,
): number {
  return msAtTick(strike.startTick, baseBpm)
}

/**
 * Absolute transport tick at a given elapsed millisecond, using the
 * cue's baseBpm. Convenience wrapper — the compiler's caller often
 * has an ms-relative scheduledStartMs and needs the tick to feed
 * `compileCue`'s `executeAtTick`.
 */
export function tickAtElapsedMs(elapsedMs: number, baseBpm: number): number {
  return tickAt(elapsedMs, baseBpm)
}

/** Re-export the slot-duration helper so callers don't need a second import. */
export function slotDurationMsFor(tempo: CoachTempo): number {
  return callSlotDurationMs(tempo)
}
