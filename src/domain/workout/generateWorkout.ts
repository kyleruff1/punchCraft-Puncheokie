/**
 * Procedural workout generator (M35).
 *
 * Turns a `WorkoutRecipe` into a runnable `GeneratedWorkout` — the piece that
 * makes "Build a workout" mean something. It fills the fixed round schedule
 * with combinations drawn from the curated `comboLibrary`, escalating across
 * the workout the way a coach builds a session: singles and doubles to find
 * the range, longer combinations with movement in the middle, high-volume
 * pressure at the finish.
 *
 * **Deterministic (D8).** Every choice comes from a seeded RNG keyed on the
 * recipe's `seed` and `generatorVersion`, so the same recipe reproduces the
 * same plan — no `Math.random`, no clock reads (the domain-purity test
 * enforces both).
 *
 * **Voice-safe.** Combos are emitted from the library *verbatim* (only the
 * repeat count, gap and interleaving vary), never composed as fresh digit
 * strings — so every combination the generator can produce is one the Voice
 * Coach has a whole-phrase clip for.
 *
 * **Reuses the existing machinery** rather than re-deriving it: the schedule
 * (`buildRoundSchedule`), the exact-sum goal split (`allocateRoundTargets`),
 * the high-goal density rule (`assessDensity`), and the block layout / count
 * helpers (`layBlocks`, `roundPunchCount`, `blocksSpanMs`). The output is
 * gated by `validateGeneratedWorkout`, the same check the samples pass.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import { buildRoundSchedule, type RoundScheduleEntry } from './roundSchedule'
import { CADENCE_PROFILES, msToBeats } from './cadence'
import { allocateRoundTargets, assessDensity, MIN_GAP_BEATS } from './goalAllocation'
import {
  layBlocks,
  roundPunchCount,
  blockPunchCount,
  blocksSpanMs,
  type BlockSpec,
} from './samples/authoring'
import { isLeadNumber } from '../programs/StanceMapper'
import { motifsFor, type Motif } from './comboLibrary'
import { makeRng, type Rng } from './seededRandom'
import type { GeneratedWorkout } from './GeneratedWorkout'
import type { WorkoutRecipe, Frequency } from './WorkoutRecipe'
import type { ProgramRound, WorkoutBlock } from './WorkoutTokens'

/** A round's position in the workout, 0 at the first scored round, 1 at the last. */
type CurvePosition = number

/** Punches an between-rounds active-recovery breather asks for. */
const ACTIVE_RECOVERY_PUNCHES = 6

// ---------------------------------------------------------------------------
// Small tuning helpers — every knob the escalation curve turns.
// ---------------------------------------------------------------------------

/** Complexity ceiling for a round: 2 early, 5 late (before the recipe cap). */
function complexityCeilingAt(p: CurvePosition): number {
  return 2 + Math.round(p * 3)
}

/** Length ceiling for a round: 2 early, 5 late (before the recipe cap). */
function lengthCeilingAt(p: CurvePosition): number {
  return 2 + Math.round(p * 3)
}

/** Gap between combos: roomy early, tighter late, never below intelligibility. */
function gapBeatsAt(p: CurvePosition): number {
  return Math.max(MIN_GAP_BEATS, 1.4 - p * 0.5)
}

/** How many times to repeat one combo: short combos more, and more under pressure. */
function repeatFor(motif: Motif, p: CurvePosition, rng: Rng): number {
  let base: number
  if (motif.length <= 2) base = 2 + rng.int(2) // 2..3
  else if (motif.length === 3) base = 1 + rng.int(2) // 1..2
  else base = 1
  if (motif.length <= 2 && p > 0.6) base += 1
  return base
}

/** Representative per-round call count for a defense/footwork frequency band (doc §12). */
function callsPerRound(freq: Frequency, rng: Rng): number {
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

/**
 * Selection weight for a combo motif: jab-led combinations dominate (§15 wants
 * 35–55% jabs), bias tilts lead/rear, and body work scales with
 * `bodyShotPercent` around its 18% default.
 */
function comboWeight(motif: Motif, recipe: WorkoutRecipe): number {
  let w = motif.punches.includes(1) ? 3 : 1
  if (recipe.bias === 'lead' && motif.punches.some(isLeadNumber)) w *= 1.3
  if (recipe.bias === 'rear' && motif.punches.some((n) => !isLeadNumber(n))) w *= 1.3
  if (motif.hasBody) w *= recipe.bodyShotPercent / 18
  return w
}

/** Mean punch length of a motif pool, floored at 1 for the density estimate. */
function averageLength(motifs: readonly Motif[]): number {
  if (motifs.length === 0) return 1
  const sum = motifs.reduce((total, m) => total + m.length, 0)
  return Math.max(1, sum / motifs.length)
}

// ---------------------------------------------------------------------------
// Block-spec builders — every spec passes `validateGeneratedWorkout`.
// ---------------------------------------------------------------------------

/**
 * A repeated combo. Even a single play uses `repeated-combo` with `repeat: 1`
 * rather than `exact-combo`, matching the sample authoring — the repeat field
 * is only ever set on the kind the validator permits it on.
 */
function comboSpec(id: string, motif: Motif, repeat: number, gapBeats: number): BlockSpec {
  const spec: BlockSpec = {
    id,
    kind: 'repeated-combo',
    notation: motif.notation,
    gapBeats,
    repeat: Math.max(1, repeat),
  }
  if (motif.offsets) spec.offsets = motif.offsets
  return spec
}

/** A defense-counter or footwork-exit block, played once. */
function commandSpec(id: string, motif: Motif, gapBeats: number): BlockSpec {
  const spec: BlockSpec = {
    id,
    kind: motif.role === 'defense' ? 'defense-counter' : 'footwork-exit',
    notation: motif.notation,
    gapBeats,
  }
  if (motif.offsets) spec.offsets = motif.offsets
  return spec
}

/** A count-measured burst (volume-burst mid-workout, open-pressure to finish). */
function volumeSpec(
  id: string,
  kind: 'volume-burst' | 'open-pressure',
  motif: Motif,
  durationBeats: number,
  targetPunches: number,
  gapBeats: number,
): BlockSpec {
  const spec: BlockSpec = {
    id,
    kind,
    notation: motif.notation,
    gapBeats,
    durationBeats,
    targetPunches,
  }
  if (motif.offsets) spec.offsets = motif.offsets
  return spec
}

/** Span a spec list would occupy once laid — used to keep a round inside its window. */
function spanWith(specs: readonly BlockSpec[], candidate: BlockSpec, bpm: number): number {
  return blocksSpanMs(layBlocks([...specs, candidate], bpm))
}

/**
 * Append a count-measured block (volume-burst / open-pressure) asking for
 * `targetPunches`, sized to run out the remaining time in the round.
 *
 * The window is set from leftover *time*; the count target is passed in — the
 * two are independent in the model (doc §14), which is what lets a finisher be
 * sized by the punch deficit while still filling the clock. Skips itself if
 * there is not a musically useful window left.
 */
function addCountBlock(
  specs: BlockSpec[],
  id: string,
  kind: 'volume-burst' | 'open-pressure',
  motif: Motif,
  targetPunches: number,
  gapBeats: number,
  bpm: number,
  budgetMs: number,
): void {
  if (targetPunches <= 0) return
  const remainingMs = budgetMs - blocksSpanMs(layBlocks(specs, bpm))
  const durationBeats = Math.floor(msToBeats(remainingMs * 0.9, bpm))
  if (durationBeats < 4) return
  const spec = volumeSpec(id, kind, motif, durationBeats, targetPunches, gapBeats)
  if (spanWith(specs, spec, bpm) <= budgetMs) specs.push(spec)
}

// ---------------------------------------------------------------------------
// Round building
// ---------------------------------------------------------------------------

interface ScoredRoundResult {
  round: ProgramRound
  neededVolume: boolean
  emptyVocabulary: boolean
}

function buildScoredRound(
  order: number,
  target: number,
  p: CurvePosition,
  entry: RoundScheduleEntry,
  recipe: WorkoutRecipe,
  bpm: number,
  rng: Rng,
): ScoredRoundResult {
  const workDurationMs = entry.workDurationMs
  const budgetMs = workDurationMs
  const gap = gapBeatsAt(p)
  const query = { maxLength: lengthCeilingAt(p), complexityCeiling: complexityCeilingAt(p) }

  const comboMotifs = motifsFor(recipe, { ...query, roles: ['combo'] })
  const defenseMotifs = motifsFor(recipe, { ...query, roles: ['defense'] })
  const footworkMotifs = motifsFor(recipe, { ...query, roles: ['footwork'] })

  const isLast = p >= 1

  // The high-goal rule: past the intelligibility ceiling, part of the round
  // has to become count-measured rather than naming every punch.
  const density = assessDensity(target, workDurationMs, averageLength(comboMotifs))
  const volumePunches = density.needsVolumeBlocks ? Math.round(target * density.suggestedVolumeShare) : 0
  // Reserve the between-rounds breather so the realized count tracks the goal
  // instead of overshooting it by the closer. The final round's pressure
  // finisher is sized from whatever deficit remains, below.
  const closerReserve = isLast ? 0 : Math.min(ACTIVE_RECOVERY_PUNCHES, Math.max(0, target - volumePunches))
  const comboTarget = Math.max(0, target - volumePunches - closerReserve)

  const specs: BlockSpec[] = []
  let blockCount = 0
  const nextId = (): string => `gen-r${order}-b${blockCount++}`

  let defenseLeft = defenseMotifs.length > 0 ? callsPerRound(recipe.defenseFrequency, rng) : 0
  let footworkLeft = footworkMotifs.length > 0 ? callsPerRound(recipe.footworkFrequency, rng) : 0

  // --- enumerated combinations, interleaved with defense/footwork counters ---
  let punches = 0
  let guard = 0
  while (punches < comboTarget && guard++ < 300) {
    let spec: BlockSpec
    if (defenseLeft > 0 && rng.chance(0.18)) {
      spec = commandSpec(nextId(), rng.pick(defenseMotifs), gap)
      defenseLeft -= 1
    } else if (footworkLeft > 0 && rng.chance(0.18)) {
      spec = commandSpec(nextId(), rng.pick(footworkMotifs), gap)
      footworkLeft -= 1
    } else if (comboMotifs.length > 0) {
      const motif = rng.weightedPick(comboMotifs, (m) => comboWeight(m, recipe))
      spec = comboSpec(nextId(), motif, repeatFor(motif, p, rng), gap)
    } else {
      break // no combinations available under this recipe
    }

    if (spanWith(specs, spec, bpm) > budgetMs) {
      blockCount -= 1 // reclaim the id we minted but did not use
      break
    }
    specs.push(spec)
    punches = roundPunchCount(layBlocks(specs, bpm))
  }

  // --- count-measured volume, when the goal outruns enumerated combos --------
  const burstMotif = pickBurstMotif(comboMotifs, rng)
  if (volumePunches > 0 && burstMotif) {
    addCountBlock(specs, nextId(), isLast ? 'open-pressure' : 'volume-burst', burstMotif, volumePunches, isLast ? 0 : gap, bpm, budgetMs)
  }

  // --- close the round: a breather early, a pressure finish last ------------
  if (isLast) {
    // Whatever the goal still asks for becomes the finishing flurry — sized by
    // the punch deficit, not by leftover time, so it can't blow past the goal.
    const deficit = target - roundPunchCount(layBlocks(specs, bpm))
    if (deficit > 0 && burstMotif && !specs.some((s) => s.kind === 'open-pressure')) {
      addCountBlock(specs, nextId(), 'open-pressure', burstMotif, deficit, 0, bpm, budgetMs)
    }
  } else if (closerReserve > 0) {
    const recoverPunch = recipe.enabledPunches[0] ?? 1
    const spec: BlockSpec = {
      id: nextId(),
      kind: 'active-recovery',
      notation: String(recoverPunch),
      gapBeats: 1,
      durationBeats: 16,
      targetPunches: closerReserve,
    }
    if (spanWith(specs, spec, bpm) <= budgetMs) specs.push(spec)
  }

  const blocks = layBlocks(specs, bpm)
  const round: ProgramRound = {
    id: `gen-r${order}`,
    order,
    kind: 'round',
    countsTowardGoal: true,
    theme: roundTheme(p),
    workDurationMs: entry.workDurationMs,
    restAfterMs: entry.restAfterMs,
    // Derived from the laid blocks, never asserted, so target and content agree.
    targetPunches: roundPunchCount(blocks),
    blocks,
  }
  return { round, neededVolume: density.needsVolumeBlocks, emptyVocabulary: comboMotifs.length === 0 }
}

/** A short combo to drive a burst — prefer a punchy two-piece, else anything. */
function pickBurstMotif(comboMotifs: readonly Motif[], rng: Rng): Motif | null {
  const shorts = comboMotifs.filter((m) => m.length <= 2 && !m.hasBody)
  if (shorts.length > 0) return rng.pick(shorts)
  if (comboMotifs.length > 0) return rng.pick(comboMotifs)
  return null
}

/** A light auxiliary round (warm-up or cooldown) — shadow jabs, no goal. */
function buildAuxRound(
  order: number,
  entry: RoundScheduleEntry,
  recipe: WorkoutRecipe,
  bpm: number,
): ProgramRound {
  const jab = recipe.enabledPunches[0] ?? 1
  const isWarmUp = entry.kind === 'warm-up'
  const blockCount = isWarmUp ? 2 : 1
  const specs: BlockSpec[] = []
  for (let i = 0; i < blockCount; i++) {
    specs.push({
      id: `gen-${entry.kind}-b${i}`,
      kind: 'active-recovery',
      notation: String(jab),
      gapBeats: 1,
      durationBeats: 20,
      targetPunches: 8,
    })
  }
  const blocks = layBlocks(specs, bpm)
  return {
    id: `gen-${entry.kind}`,
    order,
    kind: entry.kind,
    countsTowardGoal: false,
    theme: isWarmUp ? 'Warm-up' : 'Cool down',
    workDurationMs: entry.workDurationMs,
    restAfterMs: entry.restAfterMs,
    targetPunches: roundPunchCount(blocks),
    blocks,
  }
}

function roundTheme(p: CurvePosition): string {
  if (p < 0.34) return 'Find your range'
  if (p < 0.67) return 'Build combinations'
  return 'Empty the tank'
}

// ---------------------------------------------------------------------------
// Distribution and assembly
// ---------------------------------------------------------------------------

/** Fold a round's realized punches into the running technique tally. */
function accumulateDistribution(blocks: readonly WorkoutBlock[], tally: Map<string, number>): void {
  for (const block of blocks) {
    const punchTokens = block.tokens.filter((t) => t.kind === 'punch')
    if (punchTokens.length === 0) continue
    // Spread the block's total punches across its distinct punch tokens — a
    // volume burst of '1-2' targeting 48 is 24 jabs and 24 crosses.
    const per = blockPunchCount(block) / punchTokens.length
    for (const token of punchTokens) {
      if (token.kind !== 'punch') continue
      const key = `${token.number}${token.body ? 'b' : ''}`
      tally.set(key, (tally.get(key) ?? 0) + per)
    }
  }
}

/**
 * Generate a runnable workout from a recipe.
 *
 * Deterministic in `(recipe, seed, generatorVersion)`. The result always
 * passes `validateGeneratedWorkout`; any compromise it had to make — volume
 * blocks to hit a high goal, a realized count that drifts from the goal, a
 * vocabulary too narrow to fill a round — is surfaced in `warnings` rather
 * than hidden.
 */
export function generateWorkout(recipe: WorkoutRecipe): GeneratedWorkout {
  const schedule = buildRoundSchedule(recipe.durationMinutes)
  const bpm = CADENCE_PROFILES[recipe.cadenceProfile].nominalBpm
  const rng = makeRng(`${recipe.seed}|${recipe.generatorVersion}`)

  const scoredCount = schedule.scoredRoundCount

  // Even split up front: equal-length rounds with no blocks yet weight equally,
  // and the largest-remainder split still sums to the goal exactly.
  const scoredShells: ProgramRound[] = schedule.entries
    .filter((e) => e.countsTowardGoal)
    .map((e, i) => ({
      id: `shell-${i}`,
      order: i,
      kind: 'round' as const,
      countsTowardGoal: true,
      theme: '',
      workDurationMs: e.workDurationMs,
      restAfterMs: e.restAfterMs,
      targetPunches: 0,
      blocks: [],
    }))
  const roundPunchTargets = allocateRoundTargets(recipe.totalPunchGoal, scoredShells, recipe.focus)

  const rounds: ProgramRound[] = []
  const warnings: string[] = []
  const tally = new Map<string, number>()
  let scoredIndex = 0
  let realizedTotal = 0
  let volumeRounds = 0
  let emptyRounds = 0

  schedule.entries.forEach((entry, order) => {
    if (!entry.countsTowardGoal) {
      rounds.push(buildAuxRound(order, entry, recipe, bpm))
      return
    }
    const p: CurvePosition = scoredCount <= 1 ? 0 : scoredIndex / (scoredCount - 1)
    const target = roundPunchTargets[scoredIndex] ?? 0
    const { round, neededVolume, emptyVocabulary } = buildScoredRound(order, target, p, entry, recipe, bpm, rng)
    rounds.push(round)
    accumulateDistribution(round.blocks, tally)
    realizedTotal += round.targetPunches
    if (neededVolume) volumeRounds += 1
    if (emptyVocabulary) emptyRounds += 1
    scoredIndex += 1
  })

  // Normalize the realized distribution to shares.
  const distribution: Record<string, number> = {}
  const grand = [...tally.values()].reduce((sum, v) => sum + v, 0)
  if (grand > 0) {
    for (const [key, value] of tally) distribution[key] = Math.round((value / grand) * 1000) / 1000
  }

  const activeMinutes = schedule.activeSeconds / 60

  if (emptyRounds > 0) {
    warnings.push(
      'The enabled punches, lengths or complexity were too narrow to fill every round — widen the vocabulary for a fuller workout.',
    )
  }
  if (volumeRounds > 0) {
    warnings.push(
      `Volume blocks were added in ${volumeRounds} round${volumeRounds === 1 ? '' : 's'} to reach the goal at this cadence — the coach stops naming every punch there (doc §17).`,
    )
  }
  if (recipe.totalPunchGoal > 0) {
    const drift = Math.abs(realizedTotal - recipe.totalPunchGoal) / recipe.totalPunchGoal
    if (drift > 0.1) {
      warnings.push(
        `Prescribed punches (${realizedTotal}) differ from the goal (${recipe.totalPunchGoal}) by ${Math.round(drift * 100)}% — the round targets still chase the goal.`,
      )
    }
  }

  return {
    id: `gen-${recipe.seed}`,
    recipe,
    schedule: rounds,
    roundPunchTargets,
    expectedTechniqueDistribution: distribution,
    estimatedActivePunchesPerMinute: activeMinutes > 0 ? Math.round(realizedTotal / activeMinutes) : 0,
    warnings,
  }
}
