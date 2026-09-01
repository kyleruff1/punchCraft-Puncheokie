/**
 * `CueInstance` → `ProgramCue` bridge (M39-V2 Phase 4-vi).
 *
 * The V1c runtime carries `CueInstance` — an expansion product with
 * `tokens[]`, `tokenOffsetsMs[]`, `scheduledStartMs`, etc. Phase 3b's
 * `compileCue` produces `CompiledCueTimeline` from a `ProgramCue` —
 * an authoring-side shape with a `combo`, `repetition`, `executeAtTick`,
 * and a coach asset resolver.
 *
 * This module is the ONE place the two worlds meet. Consumers walk a
 * `RoundTimeline`, call `programCueFromInstance` per cue, feed the
 * result to `compileCue`, and stamp the compiled timeline back onto
 * the cue (or onto the spine schedule). No consumer reaches through
 * to CueInstance internals to construct a ProgramCue; the bridge is
 * the authority.
 *
 * ## What survives the bridge
 *
 * - Punch tokens become `AuthoredStrike[]`. Defense, footwork, and
 *   coach tokens are skipped — the compiled timeline is a STRIKE
 *   timeline, and a non-punch token has no strike identity in the
 *   Phase 3 sense.
 * - Strike PLACEMENT is `atTick`, converted from the cue's
 *   `tokenOffsetsMs` — the same tempo-scaled offsets the rings run on,
 *   so the compiled score and the ring grid are ONE grid. `atStep` is
 *   carried only as the compiler's step fallback. (This comment used to
 *   claim `atStep` was derived from `beatOffset`; it never was — the
 *   ordinal-only placement froze every strike 500 ms apart at any tempo,
 *   and the false comment is part of why that survived. GH #305.)
 * - Each CueInstance represents ONE rep of its authored block
 *   (`expandBlock` already mints per-repeat cueIds), so the bridge
 *   emits `{ count: 1, gapSteps: 0 }` — a single rep. Multi-rep
 *   expansion belongs upstream in the authoring layer once Phase 5
 *   collapses `expandBlock` into `compileCue`.
 * - `executeAtTick` is derived from `scheduledStartMs` × the coach
 *   tempo's ticks-per-ms. The bridge picks that up from the cadence
 *   name via `divisionForCadenceProfile`.
 *
 * ## What DOESN'T survive
 *
 * A CueInstance with zero punch tokens (defense-only, footwork-only,
 * or a coast marker) returns `null`. Downstream consumers should read
 * that as "no compiled timeline for this cue" and fall back to the
 * V1c dispatch path — the same behavior a compiled cue with an empty
 * resolver produces (silent coach, no strike events).
 *
 * ## Coach asset resolver
 *
 * The bridge accepts a resolver so callers plug in whatever asset
 * lookups they have. Tests pass a stub; the runtime will pass a
 * resolver that pulls from `phraseManifest` / `comboAnnounceManifest`
 * / `sustainedManifest` / `coastManifest`. A resolver returning
 * undefined for every kind is legal — the compiler produces a
 * timeline with empty coach tracks, which is exactly what a cue with
 * no rendered coach content should get.
 */
import {
  DEFAULT_COMBO_POLICY,
  type VoicePolicy as V2VoicePolicy,
} from '../coach/VoicePolicy'
import type { CueInstance } from './CueTimeline'
import {
  compileCue,
  type CoachAssetResolver,
  type CompiledCueTimeline,
  type ProgramCue,
} from './compileCue'
import type { StrikeToken } from '../strikes/strikeCatalog'
import {
  TRANSPORT_TICKS_PER_PULSE,
  type BeatDivision,
} from '../timing/TimingEngine'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Standard base BPM the transport runs at (Kyle spec — the master
 * pulse is 60; cadence profiles are subdivisions).
 */
const BASE_BPM = 60

/** Ms per transport tick at the base BPM. */
const MS_PER_TRANSPORT_TICK = 60_000 / (BASE_BPM * TRANSPORT_TICKS_PER_PULSE)

/**
 * Ticks at `ms` on the transport clock. Rounded to the nearest
 * integer — the timeline hash and every downstream tick reads an
 * int, and fractional ticks would break identity comparisons.
 */
function ticksAtMs(ms: number): number {
  return Math.round(ms / MS_PER_TRANSPORT_TICK)
}

const CADENCE_TO_DIVISION: Record<string, BeatDivision> = {
  technical: 1,
  steady: 2,
  pressure: 3,
  sprint: 4,
}

function divisionForCue(cue: CueInstance): BeatDivision {
  if (cue.cadence && cue.cadence in CADENCE_TO_DIVISION) {
    return CADENCE_TO_DIVISION[cue.cadence]!
  }
  // Default to steady (2) when the cue doesn't name a cadence — matches
  // the V1c fallback used when a block's cadence is absent.
  return 2
}

/**
 * Canonicalize a workout punch token to a `StrikeToken`. The catalog
 * uses uppercase B (`1B`, `2B`, ...); WorkoutToken carries the punch
 * number + a `body` boolean.
 */
function strikeTokenFor(number: number, body: boolean): StrikeToken {
  return (body ? `${number}B` : `${number}`) as StrikeToken
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

export interface ProgramCueBridgeOptions {
  /** Scopes the compiled cue's identifiers so cross-round collisions never happen. */
  roundId: string
  /** How the compiled timeline resolves its coach assets. */
  coachAssets: CoachAssetResolver
  /**
   * V2 voice policy for this cue. Defaults to `DEFAULT_COMBO_POLICY`
   * — combo-announce, precall, once-per-rep — which matches the V1c
   * discrete-combo default. Callers with an authored V2 policy pass
   * it in; the legacy V1c string policy (`per-punch` / `announce-
   * then-work` / …) is NOT bridged here — Phase 5 collapses the two.
   */
  voicePolicy?: V2VoicePolicy
  /**
   * Ticks between the audible end of a pre-call and the strike it
   * teaches. Forwarded to `ProgramCue.responseGapTicks`; the
   * compiler defaults to 60 ticks (≈62.5 ms at 60 BPM) when omitted.
   */
  responseGapTicks?: number
  /** Monotonic revision number, forwarded to the compiled identity. */
  revision?: number
}

/**
 * Convert a `CueInstance` to a `ProgramCue`. Returns `null` when the
 * cue has zero punch tokens (defense-only, footwork-only, coast) —
 * those have no compiled-timeline strike content, and the runtime
 * should fall back to the V1c dispatch path for them.
 *
 * Pure. Does not read or write the CueInstance itself; the caller
 * feeds the return value into `compileCue`.
 */
export function programCueFromInstance(
  cue: CueInstance,
  opts: ProgramCueBridgeOptions,
): ProgramCue | null {
  const punchIndexes: number[] = []
  for (let i = 0; i < cue.tokens.length; i += 1) {
    if (cue.tokens[i]!.kind === 'punch') punchIndexes.push(i)
  }
  if (punchIndexes.length === 0) return null

  // Placement comes from `tokenOffsetsMs` — the SAME tempo-scaled authored
  // offsets the rings and the beat projection run on — converted to ticks.
  // `atStep: ordinal` is kept only as the compiler's documented fallback;
  // before GH #305 it was the ONLY placement, which put every strike on a
  // fixed 500 ms lattice regardless of workout tempo (measured identical
  // at 85 and 240 BPM), 2-7× off the ring grid. One grid now.
  const offsetTicks = punchIndexes.map((tokenIndex) =>
    ticksAtMs(cue.tokenOffsetsMs[tokenIndex] ?? 0),
  )
  const strikes = punchIndexes.map((tokenIndex, ordinal) => {
    const token = cue.tokens[tokenIndex] as Extract<
      CueInstance['tokens'][number],
      { kind: 'punch' }
    >
    const atTick = offsetTicks[ordinal]!
    // A strike's window runs to the next strike; the last reuses the
    // previous gap (a lone strike keeps the step-based span — with no
    // second offset there is no tempo evidence to derive one from).
    const nextTick = offsetTicks[ordinal + 1]
    const prevTick = offsetTicks[ordinal - 1]
    const endAtTick =
      nextTick !== undefined
        ? nextTick
        : prevTick !== undefined
          ? atTick + (atTick - prevTick)
          : undefined
    return {
      token: strikeTokenFor(token.number, token.body),
      atStep: ordinal,
      atTick,
      ...(endAtTick !== undefined ? { endAtTick } : {}),
    }
  })

  const lastStrike = strikes[strikes.length - 1]!
  const combo = {
    id: `${cue.id}:combo`,
    strikes,
    totalSteps: strikes.length,
    // Real span of one pass, so the (production-dormant) rep stride
    // cannot lie either. Falls back to nothing for a lone strike whose
    // end is step-derived.
    ...(lastStrike.endAtTick !== undefined ? { totalTicks: lastStrike.endAtTick } : {}),
  }

  return {
    roundId: opts.roundId,
    cueId: cue.id,
    combo,
    // CueInstance is already ONE rep — expandBlock mints per-repeat cueIds.
    repetition: { count: 1, gapSteps: 0 },
    executeAtTick: ticksAtMs(cue.scheduledStartMs),
    executionDivision: divisionForCue(cue),
    baseBpm: BASE_BPM,
    voicePolicy: opts.voicePolicy ?? DEFAULT_COMBO_POLICY,
    coachAssets: opts.coachAssets,
    revision: opts.revision ?? 1,
    ...(opts.responseGapTicks !== undefined
      ? { responseGapTicks: opts.responseGapTicks }
      : {}),
  }
}

/**
 * Compile a `CueInstance` into a `CompiledCueTimeline` in one call.
 * Returns `null` when the bridge returns null (non-punch cue).
 *
 * Convenience wrapper around `programCueFromInstance` + `compileCue`.
 */
export function compileCueFromInstance(
  cue: CueInstance,
  opts: ProgramCueBridgeOptions,
): CompiledCueTimeline | null {
  const programCue = programCueFromInstance(cue, opts)
  if (programCue === null) return null
  return compileCue(programCue)
}

/**
 * A conservative default resolver that returns undefined for every
 * kind. Useful when the caller wants a compiled timeline for its
 * strike events only — the coach tracks come back empty.
 */
export const NULL_COACH_ASSET_RESOLVER: CoachAssetResolver = () => undefined
