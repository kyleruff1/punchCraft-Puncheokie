/**
 * Round fill — the 7-phase build-up round (Rhythm Map M3, D26).
 *
 * Reverses the recorded "a round that ends early simply ends" doctrine:
 * a scored round is now COVERED TO THE BELL, built on Kyle's corpus
 * template — a build-up ladder is the round's spine, taught stage by
 * stage, and the athlete finishes on pressure repetition of the completed
 * pattern:
 *
 *   1 base pattern            ~17%   the ladder's opening rung, repeated
 *   2 first build-up stage    ~17%   one component added
 *   3 timed volume burst      ~11%   the base pattern, count-measured
 *   4 second build-up stage   ~17%   the ladder grows again
 *   5 base with body variation ~14%  an approved B-transformation
 *   6 movement / defense      ~10%   counters and exits (frequency-gated)
 *   7 pressure repetition     ~14%   the completed pattern, gap tightened;
 *                                    the final round flurries instead
 *
 * The proportions scale to the round length; a bounded repair pass extends
 * phase 7 until the blocks span the work window, so an under-filled round
 * is impossible by construction rather than merely discouraged. The fill
 * is Set-shaped (D18-D20): nothing here gates on timing, punches credit on
 * order and hand.
 *
 * Selection is seeded-RNG only, from curated content: corpus build-up
 * ladders (tier-gated, clip-gated via `voiceReady`) with the legacy motif
 * library for defense/footwork counters and as the fallback when no ladder
 * survives the gates. Body variation comes ONLY from the approved
 * transformation patterns (GR: never sprinkle random b-suffixes), and only
 * when the transformed notation is itself renderable content.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import { BUILD_UP_SETS, canonicalNotation, type BuildUpSet, type ComboTier } from './corpusMotifs'
import { msToBeats } from './cadence'
import { MIN_GAP_BEATS } from './goalAllocation'
import { blocksSpanMs, layBlocks, roundPunchCount, type BlockSpec } from './samples/authoring'
import { motifsFor, type Motif } from './comboLibrary'
import { parseCombo } from './WorkoutTokens'
import { tierFor, type WorkoutRecipe, type Frequency } from './WorkoutRecipe'
import { makeRng, type Rng } from './seededRandom'
import {
  familyPatternFor,
  MANDATORY_SAME_MOVE_MS,
  pickCallout,
  type ReserveMsFor,
  type SetupPatternId,
} from './setupCallouts'
import { GENERATOR_VERSION } from './versions'
import type { ProgramRound, SetupCallout, WorkoutBlock } from './WorkoutTokens'

/** A round's position in the workout, 0 at the first scored round, 1 at the last. */
export type CurvePosition = number

// ---------------------------------------------------------------------------
// Tuning knobs (carried over from the pre-D26 generator where still apt)
// ---------------------------------------------------------------------------

export const MAX_BURST_DURATION_BEATS = 40
export const MIN_BURST_TARGET_PUNCHES = 8
export const BEATS_PER_BURST_PUNCH = 3

/** Phase shares of the work window — Kyle's template, normalized. */
const PHASE_SHARE = {
  base: 0.17,
  build1: 0.17,
  volume: 0.11,
  build2: 0.17,
  bodyVariation: 0.14,
  movement: 0.1,
  pressure: 0.14,
} as const

/** Repair-pass bound: extending pressure reps must terminate loudly. */
const MAX_REPAIR_PASSES = 24

/**
 * Voice cadence bands in order (doc §17). A phase may shift the CALLED
 * rendering a band up (bursts, pressure) or down (movement) from the
 * workout's profile — the beat grid stays put; the recording changes.
 */
const CADENCE_BANDS = ['technical', 'steady', 'pressure', 'sprint'] as const

export function shiftCadence(profile: string, delta: number): string {
  const index = CADENCE_BANDS.indexOf(profile as (typeof CADENCE_BANDS)[number])
  if (index < 0) return profile
  return CADENCE_BANDS[Math.max(0, Math.min(CADENCE_BANDS.length - 1, index + delta))] as string
}

/** Complexity ceiling for a round: 2 early, 5 late (before the recipe cap). */
export function complexityCeilingAt(p: CurvePosition): number {
  return 2 + Math.round(p * 3)
}

/** Length ceiling for a round: 2 early, 5 late (before the recipe cap). */
export function lengthCeilingAt(p: CurvePosition): number {
  return 2 + Math.round(p * 3)
}

/** Gap between combos: roomy early, tighter late, never below intelligibility. */
export function gapBeatsAt(p: CurvePosition): number {
  return Math.max(MIN_GAP_BEATS, 1.4 - p * 0.5)
}

/** Representative per-round call count for a defense/footwork frequency band (doc §12). */
export function callsPerRound(freq: Frequency, rng: Rng): number {
  switch (freq) {
    case 'off':
      return 0
    case 'light':
      return 2 + rng.int(2) // 2-3
    case 'moderate':
      return 5 + rng.int(4) // 5-8
    case 'heavy':
      return 9 + rng.int(6) // 9-14
  }
}

// ---------------------------------------------------------------------------
// Block-spec builders — every spec passes `validateGeneratedWorkout`.
// ---------------------------------------------------------------------------

export function comboSpecFor(
  id: string,
  notation: string,
  repeat: number,
  gapBeats: number,
  offsets?: number[],
): BlockSpec {
  const spec: BlockSpec = {
    id,
    kind: 'repeated-combo',
    notation,
    gapBeats,
    repeat: Math.max(1, repeat),
  }
  if (offsets) spec.offsets = offsets
  return spec
}

export function commandSpecFor(id: string, motif: Motif, gapBeats: number): BlockSpec {
  const spec: BlockSpec = {
    id,
    kind: motif.role === 'defense' ? 'defense-counter' : 'footwork-exit',
    notation: motif.notation,
    gapBeats,
  }
  if (motif.offsets) spec.offsets = motif.offsets
  return spec
}

export function volumeSpecFor(
  id: string,
  kind: 'volume-burst' | 'open-pressure',
  notation: string,
  durationBeats: number,
  targetPunches: number,
  gapBeats: number,
  offsets?: number[],
): BlockSpec {
  const spec: BlockSpec = {
    id,
    kind,
    notation,
    gapBeats,
    durationBeats,
    targetPunches,
  }
  if (offsets) spec.offsets = offsets
  return spec
}

/** Span a spec list would occupy once laid — the budget guard. */
export function spanWith(specs: readonly BlockSpec[], candidate: BlockSpec, bpm: number): number {
  return blocksSpanMs(layBlocks([...specs, candidate], bpm))
}

// ---------------------------------------------------------------------------
// Ladder selection
// ---------------------------------------------------------------------------

const TIER_RANK: Record<ComboTier, number> = { beginner: 0, intermediate: 1, advanced: 2 }

interface LadderStagePick {
  notation: string
  punchCount: number
}

interface LadderPick {
  set: BuildUpSet
  /** Usable stages in order, notations canonical (clip-key form). */
  stages: LadderStagePick[]
}

function usableLadders(
  recipe: WorkoutRecipe,
  voiceReady: (notation: string) => boolean,
  maxLen: number,
): LadderPick[] {
  const tier = tierFor(recipe)
  const enabled = new Set<number>(recipe.enabledPunches)
  const picks: LadderPick[] = []

  for (const set of BUILD_UP_SETS) {
    if (TIER_RANK[set.tier] > TIER_RANK[tier]) continue
    const stages: LadderStagePick[] = []
    for (const stage of set.stages) {
      if (stage.punchCount > maxLen) break
      const notation = canonicalNotation(stage.tokens)
      const tokens = parseCombo(notation)
      const punchesUsed = tokens
        .filter((t) => t.kind === 'punch')
        .map((t) => (t as { number: number }).number)
      if (!punchesUsed.every((n) => enabled.has(n))) break
      if (stage.punchCount > 1 && !voiceReady(notation)) break
      stages.push({ notation, punchCount: stage.punchCount })
    }
    // A ladder needs at least a base and one build to teach anything.
    if (stages.length >= 2) picks.push({ set, stages })
  }
  return picks
}

/**
 * Body variation via the approved transformation patterns only: one punch
 * gains a body suffix, first-to-last, and the result must itself be
 * curated, renderable content — never an invented notation (GR03/GR08).
 */
function bodyVariationOf(
  notation: string,
  voiceReady: (notation: string) => boolean,
): string | null {
  const parts = notation.split('-')
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] as string
    if (!/^[1-6]$/.test(part)) continue
    const candidate = [...parts.slice(0, i), `${part}b`, ...parts.slice(i + 1)].join('-')
    try {
      parseCombo(candidate)
    } catch {
      continue
    }
    if (voiceReady(candidate)) return candidate
  }
  return null
}

// ---------------------------------------------------------------------------
// The fill
// ---------------------------------------------------------------------------

export interface FillOptions {
  /**
   * Whether a notation has a rendered whole-phrase clip. Injected from the
   * app layer (the manifest lives outside the domain); defaulting to
   * "everything is ready" keeps the domain testable and matches the state
   * once a corpus batch lands.
   */
  voiceReady?: (notation: string) => boolean
  /**
   * Set Ceremonies: prices a pre-set call-out (sentence + optional
   * recitation + tail, measured durations + slack) so the fill can
   * reserve lead-in time for it. Injected from the app layer; absent =
   * feature off and generation is unchanged.
   */
  setupCallouts?: { reserveMsFor: ReserveMsFor }
}

export interface FilledRound {
  round: ProgramRound
  /** No ladder survived the recipe gates — the legacy path filled instead. */
  usedFallback: boolean
}

interface RoundEntryLike {
  workDurationMs: number
  restAfterMs: number
}

export function fillScoredRound(
  order: number,
  target: number,
  p: CurvePosition,
  entry: RoundEntryLike,
  recipe: WorkoutRecipe,
  bpm: number,
  rng: Rng,
  opts: FillOptions = {},
): FilledRound {
  const voiceReady = opts.voiceReady ?? (() => true)
  // Set Ceremonies: a SEPARATE rng stream so callout draws never disturb
  // the main stream's sequence (rng call order is the determinism
  // contract), keyed like the main one plus the round.
  const calloutRng = makeRng(
    `${recipe.seed}|${GENERATOR_VERSION}|callouts|r${order}`,
  )
  const calloutFor = (
    pattern: SetupPatternId,
    notation?: string,
  ): SetupCallout | undefined =>
    opts.setupCallouts
      ? pickCallout(pattern, calloutRng, opts.setupCallouts.reserveMsFor, notation)
      : undefined
  const workMs = entry.workDurationMs
  const gap = gapBeatsAt(p)
  const specs: BlockSpec[] = []
  let blockCount = 0
  const nextId = (): string => `gen-r${order}-b${blockCount++}`
  const span = (): number => blocksSpanMs(layBlocks(specs, bpm))
  const phaseBudget = (share: number): number => Math.round(workMs * share)

  const query = { maxLength: lengthCeilingAt(p), complexityCeiling: complexityCeilingAt(p) }
  const defenseMotifs = motifsFor(recipe, { ...query, roles: ['defense'] })
  const footworkMotifs = motifsFor(recipe, { ...query, roles: ['footwork'] })
  const legacyCombos = motifsFor(recipe, { ...query, roles: ['combo'] })

  // ---- pick the round's ladder: its tier tracks the arc position (an
  // advanced athlete still opens the workout on fundamentals), the stage
  // length tracks the escalation curve, and the weighting keeps the corpus
  // jab-led (§15: 35-55% jab share) while honouring the lead/rear bias.
  // The escalation ceiling, with headroom for the ladder to actually BUILD:
  // a round that opens on twos still teaches toward a four-count, and the
  // late rounds reach the recipe's cap.
  const maxLen = Math.min(recipe.maximumComboPunches, lengthCeilingAt(p) + 2)
  const ladders = usableLadders(recipe, voiceReady, maxLen)
  const recipeRank = TIER_RANK[tierFor(recipe)]
  const wantedRank = Math.min(recipeRank, Math.round(p * recipeRank))
  const punchShares = (l: LadderPick): { jab: number; lead: number; rear: number } => {
    const tokens = (l.stages[l.stages.length - 1] as LadderStagePick).notation.split('-')
    const numbers = tokens.map((t) => Number.parseInt(t, 10)).filter((n) => n >= 1 && n <= 6)
    const total = Math.max(1, numbers.length)
    return {
      jab: numbers.filter((n) => n === 1).length / total,
      lead: numbers.filter((n) => n % 2 === 1).length / total,
      rear: numbers.filter((n) => n % 2 === 0).length / total,
    }
  }
  const completedLen = (l: LadderPick): number =>
    (l.stages[l.stages.length - 1] as LadderStagePick).punchCount
  // The final round must land on the workout's longest patterns — the
  // escalation the arc promised (§16). Earlier rounds pick freely.
  const reaching = ladders.filter((l) => completedLen(l) >= maxLen)
  const pool = p >= 1 && reaching.length > 0 ? reaching : ladders
  const ladder =
    pool.length > 0
      ? rng.weightedPick(pool, (l) => {
          const rank = TIER_RANK[l.set.tier]
          let w = rank === wantedRank ? 4 : rank < wantedRank ? 2 : 1
          const shares = punchShares(l)
          // §15's 35-55% jab share, held at the corpus-selection level.
          w *= 1 + 3 * shares.jab
          if (recipe.bias === 'lead') w *= 1 + 2 * shares.lead
          if (recipe.bias === 'rear') w *= 1 + 2 * shares.rear
          return w
        })
      : null

  let usedFallback = false

  if (ladder) {
    const stages = ladder.stages
    const base = stages.find((s) => s.punchCount >= 2) ?? (stages[0] as LadderStagePick)
    const baseIndex = stages.indexOf(base)
    const build1 = stages[Math.min(baseIndex + 1, stages.length - 1)] as LadderStagePick
    const build2 = stages[Math.min(baseIndex + 2, stages.length - 1)] as LadderStagePick
    const completed = stages[stages.length - 1] as LadderStagePick

    /**
     * One phase = one repeated-combo block whose reps chase the phase's
     * PUNCH share of the round target and whose gap is solved so the block
     * spans the phase's TIME share — the gap is the free variable that
     * reconciles duration-fill (D26) with the athlete's goal. Reps stay in
     * the coach's 2..12 drilling band; the gap stays between
     * intelligibility and dead air.
     */
    const addRepeatPhase = (
      pick: LadderStagePick,
      budgetMs: number,
      desiredPunches: number,
      tighten = 1,
      cadence?: string,
      callout?: SetupCallout,
    ): void => {
      const probe = comboSpecFor(nextId(), pick.notation, 1, 0)
      const comboOnlyMs = blocksSpanMs(layBlocks([probe], bpm))
      blockCount -= 1 // probe only; reclaim the id
      if (comboOnlyMs <= 0) return
      const comboBeats = msToBeats(comboOnlyMs, bpm)
      // A ceremony's reservation comes out of THIS phase's budget — the
      // gap-solve reconciles the smaller window, so the round still
      // spans to the bell and no neighbour moves.
      const reserveMs = callout?.reserveMs ?? 0
      const budgetBeats = msToBeats(Math.max(1_000, budgetMs - reserveMs), bpm)
      const wantedReps = Math.round(desiredPunches / Math.max(1, pick.punchCount))
      const reps = Math.max(2, Math.min(12, wantedReps))
      const solvedGap = budgetBeats / reps - comboBeats
      const gapBeats = Math.max(MIN_GAP_BEATS, Math.min(5, solvedGap * tighten))
      // With the gap clamped, honour the TIME budget over the punch share:
      // duration is the D26 contract, punches are the recipe's wish.
      const fitReps = Math.max(2, Math.min(12, Math.floor(budgetBeats / (comboBeats + gapBeats))))
      const spec = comboSpecFor(nextId(), pick.notation, Math.min(reps, fitReps), gapBeats)
      if (cadence !== undefined) spec.cadence = cadence
      if (callout !== undefined) {
        spec.leadInBeats = msToBeats(reserveMs, bpm)
        spec.setupCallout = callout
      }
      if (spanWith(specs, spec, bpm) <= workMs) specs.push(spec)
      else blockCount -= 1
    }

    /**
     * Punch budget for a phase — its share of the round's allocated goal,
     * shaved for the structural overhead the template adds regardless
     * (defense/footwork counters, burst floors, the repair tail). The
     * calibration keeps realized totals within a few percent of the goal.
     */
    const effTarget = Math.round(target * 0.88)
    const phasePunches = (share: number): number => Math.max(4, Math.round(effTarget * share))

    // 1 — base pattern. The round opens with a ceremony: the last round
    // gets its send-off, the first gets the pattern introduction, and
    // middle rounds get the family flavor of the base notation.
    const lastRound = p >= 1
    const basePattern: SetupPatternId = lastRound
      ? 'co-final-round'
      : p <= 0
        ? 'co-first-look'
        : familyPatternFor(base.notation)
    addRepeatPhase(
      base,
      phaseBudget(PHASE_SHARE.base),
      phasePunches(0.17),
      1,
      undefined,
      calloutFor(basePattern, base.notation),
    )
    // 2 — first build-up stage: "Let's get ready for the buildup…"
    addRepeatPhase(
      build1,
      phaseBudget(PHASE_SHARE.build1),
      phasePunches(0.17),
      1,
      undefined,
      calloutFor('co-buildup-start', build1.notation),
    )

    // 3 — timed volume burst on the base pattern, punches from the goal.
    {
      const allJab = base.notation
        .toLowerCase()
        .split('-')
        .every((t) => t.replace('b', '') === '1')
      const callout = calloutFor(allJab ? 'co-jab-volume' : 'co-volume')
      const reserveMs = callout?.reserveMs ?? 0
      const budgetBeats = Math.floor(
        msToBeats(Math.max(1_000, phaseBudget(PHASE_SHARE.volume) - reserveMs), bpm),
      )
      const durationBeats = Math.min(Math.max(8, budgetBeats), MAX_BURST_DURATION_BEATS)
      const targetPunches = Math.max(MIN_BURST_TARGET_PUNCHES, Math.round(effTarget * 0.13))
      const spec = volumeSpecFor(nextId(), 'volume-burst', base.notation, durationBeats, targetPunches, gap)
      spec.cadence = shiftCadence(recipe.cadenceProfile, 1)
      if (callout !== undefined) {
        spec.leadInBeats = msToBeats(reserveMs, bpm)
        spec.setupCallout = callout
      }
      if (spanWith(specs, spec, bpm) <= workMs) specs.push(spec)
      else blockCount -= 1
    }

    // 4 — second build-up stage: "we're adding a piece."
    addRepeatPhase(
      build2,
      phaseBudget(PHASE_SHARE.build2),
      phasePunches(0.17),
      1,
      undefined,
      calloutFor('co-buildup-next', build2.notation),
    )

    // 5 — base with an approved body variation (falls back to the base).
    // Only an ACTUAL variation earns "let's go downstairs" — repeating
    // the plain base again announces nothing new.
    {
      const variation =
        recipe.bodyShotPercent > 0 ? bodyVariationOf(base.notation, voiceReady) : null
      addRepeatPhase(
        variation ? { notation: variation, punchCount: base.punchCount } : base,
        phaseBudget(PHASE_SHARE.bodyVariation),
        phasePunches(0.14),
        1,
        undefined,
        variation ? calloutFor('co-downstairs') : undefined,
      )
    }

    // 6 — movement / defense counters, frequency-gated.
    {
      let defenseLeft = defenseMotifs.length > 0 ? Math.min(2, callsPerRound(recipe.defenseFrequency, rng)) : 0
      let footworkLeft = footworkMotifs.length > 0 ? Math.min(1, callsPerRound(recipe.footworkFrequency, rng)) : 0
      const movementDeadline = span() + phaseBudget(PHASE_SHARE.movement)
      let guard = 0
      let movementAnnounced = false
      while ((defenseLeft > 0 || footworkLeft > 0) && span() < movementDeadline && guard++ < 8) {
        const pool = defenseLeft > 0 ? defenseMotifs : footworkMotifs
        const spec = commandSpecFor(nextId(), rng.pick(pool), gap)
        spec.cadence = shiftCadence(recipe.cadenceProfile, -1)
        if (!movementAnnounced) {
          const callout = calloutFor('co-movement')
          if (callout !== undefined) {
            spec.leadInBeats = msToBeats(callout.reserveMs, bpm)
            spec.setupCallout = callout
          }
          movementAnnounced = true
        }
        if (spanWith(specs, spec, bpm) > workMs) {
          blockCount -= 1
          break
        }
        specs.push(spec)
        if (defenseLeft > 0) defenseLeft -= 1
        else footworkLeft -= 1
      }
    }

    // 7 — pressure: the completed pattern, gap tightened; the final round
    // flurries on the base loop instead (tier-scaled, sprints use short loops).
    if (lastRound) {
      const tier = tierFor(recipe)
      const flurrySeconds = tier === 'beginner' ? 15 : tier === 'intermediate' ? 20 : 25
      const durationBeats = Math.min(
        MAX_BURST_DURATION_BEATS,
        Math.floor(msToBeats(flurrySeconds * 1000, bpm)),
      )
      const loop = base.punchCount <= 2 ? base : ((stages.find((s) => s.punchCount <= 2) ?? base) as LadderStagePick)
      const deficit = Math.max(0, target - roundPunchCount(layBlocks(specs, bpm)))
      const targetPunches = Math.max(MIN_BURST_TARGET_PUNCHES, Math.min(deficit, flurrySeconds * 2))
      const spec = volumeSpecFor(nextId(), 'open-pressure', loop.notation, durationBeats, targetPunches, 0)
      spec.cadence = 'sprint'
      const callout = calloutFor('co-flurry')
      if (callout !== undefined) {
        spec.leadInBeats = msToBeats(callout.reserveMs, bpm)
        spec.setupCallout = callout
      }
      if (spanWith(specs, spec, bpm) <= workMs) specs.push(spec)
      else blockCount -= 1
    }
    addRepeatPhase(
      completed,
      phaseBudget(PHASE_SHARE.pressure),
      phasePunches(0.22),
      0.7,
      shiftCadence(recipe.cadenceProfile, 1),
      calloutFor('co-pressure', completed.notation),
    )
  } else {
    // No ladder survives the recipe (narrow enabledPunches, tiny combo cap,
    // clips not yet rendered) — fall back to weighted legacy selection so
    // the round still fills.
    usedFallback = true
    let guard = 0
    while (span() < workMs * 0.86 && legacyCombos.length > 0 && guard++ < 200) {
      const motif = rng.pick(legacyCombos)
      const spec = comboSpecFor(nextId(), motif.notation, 2 + rng.int(3), gap, motif.offsets)
      if (spanWith(specs, spec, bpm) > workMs) {
        blockCount -= 1
        break
      }
      specs.push(spec)
    }
  }

  // ---- coverage repair (D26): extend the closing pattern until the blocks
  // span the bell. Bounded; a round that cannot be filled is a content bug
  // the property tests surface, not a silent tail.
  {
    const jabShareOf = (notation: string): number => {
      const nums = notation.split('-').map((t) => Number.parseInt(t, 10)).filter((n) => n >= 1)
      return nums.length === 0 ? 0 : nums.filter((n) => n === 1).length / nums.length
    }
    const repairPick =
      ladder === null
        ? null
        : [...ladder.stages]
            .filter((s) => s.punchCount >= 2)
            .sort((a, b) => jabShareOf(b.notation) - jabShareOf(a.notation))[0] ?? null
    const closing =
      (repairPick
        ? comboSpecFor('probe-repair', repairPick.notation, 1, gap)
        : undefined) ??
      [...specs].reverse().find((s) => s.kind === 'repeated-combo') ??
      specs[specs.length - 1]
    if (repairPick) blockCount += 0 // probe spec above never enters the list
    let guard = 0
    while (closing && workMs - span() > 4_000 && guard++ < MAX_REPAIR_PASSES) {
      const spec = comboSpecFor(
        nextId(),
        closing.notation,
        2,
        Math.max(MIN_GAP_BEATS, gap * 0.8),
        closing.offsets,
      )
      if (spanWith(specs, spec, bpm) > workMs) {
        blockCount -= 1
        break
      }
      specs.push(spec)
    }
  }

  // ---- mandatory same-move announcement (Set Ceremonies, Kyle's rule):
  // any contiguous run of one notation longer than a minute MUST be
  // announced — "settle in" — so the athlete knows the stretch is
  // deliberate. The repair tail is the usual culprit (it can extend the
  // closing pattern 60-90s). If the added reservation pushes the span
  // past the bell, trailing repair reps are dropped to pay for it.
  if (opts.setupCallouts) {
    const laid = layBlocks(specs, bpm)
    let runStart = 0
    while (runStart < specs.length) {
      const first = specs[runStart] as BlockSpec
      let runEnd = runStart + 1
      while (
        runEnd < specs.length &&
        (specs[runEnd] as BlockSpec).notation === first.notation &&
        (specs[runEnd] as BlockSpec).kind === 'repeated-combo' &&
        first.kind === 'repeated-combo'
      ) {
        runEnd += 1
      }
      const startMs = laid[runStart]?.startOffsetMs ?? 0
      const last = laid[runEnd - 1]
      const runMs = last === undefined ? 0 : last.startOffsetMs + last.durationMs - startMs
      if (runMs > MANDATORY_SAME_MOVE_MS && first.setupCallout === undefined) {
        const allJab = first.notation
          .toLowerCase()
          .split('-')
          .every((t) => t.replace('b', '') === '1')
        const callout = calloutFor(allJab ? 'co-jab-volume' : 'co-settle-in')
        if (callout !== undefined) {
          first.leadInBeats = (first.leadInBeats ?? 0) + msToBeats(callout.reserveMs, bpm)
          first.setupCallout = callout
          let guard = 0
          while (
            blocksSpanMs(layBlocks(specs, bpm)) > workMs &&
            specs.length - 1 > runStart &&
            guard++ < MAX_REPAIR_PASSES
          ) {
            specs.pop()
          }
        }
      }
      runStart = runEnd
    }
  }

  const blocks = layBlocks(specs, bpm)
  const round: ProgramRound = {
    id: `gen-r${order}`,
    order,
    kind: 'round',
    countsTowardGoal: true,
    theme: ladder ? ladder.set.name : roundThemeFor(p),
    workDurationMs: entry.workDurationMs,
    restAfterMs: entry.restAfterMs,
    // Derived from the laid blocks, never asserted (D26: targets are an
    // OUTPUT of the fill, not an input to it).
    targetPunches: roundPunchCount(blocks),
    blocks,
  }
  return { round, usedFallback }
}

export function roundThemeFor(p: CurvePosition): string {
  if (p < 0.34) return 'Find your range'
  if (p < 0.67) return 'Build combinations'
  return 'Empty the tank'
}

/** Milliseconds the round's blocks actually span — the D26 coverage check. */
export function roundSpanMs(blocks: readonly WorkoutBlock[]): number {
  return blocksSpanMs(blocks)
}
