/**
 * Curated combination library for the workout generator (M35).
 *
 * The generator draws its combinations from this hand-authored table rather
 * than composing digit strings on the fly — real, coach-shaped combos read as
 * a workout a person would write, and (the deciding reason) a fixed corpus is
 * what the Voice Coach's whole-phrase clips are rendered against. Every
 * `notation` here is scanned by `tools/voice/make-phrase-clips.mjs`, so a
 * combo the generator can emit is a combo the cornerman can say in one take.
 *
 * Variety comes from selection and parametric variation (repeat counts, gaps,
 * body-shot weighting, defense/footwork interleaving) applied by the
 * generator — not from inventing notations at run time, which would emit
 * combos with no clip.
 *
 * Notation uses only the `WorkoutTokens` vocabulary (punch numbers 1–6 with an
 * optional `b`, and the exact defense/footwork spelling words). A test parses
 * every entry through `parseCombo` so a typo can never reach the generator.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import type {
  PunchNumber,
  DefenseCommand,
  FootworkCommand,
} from './WorkoutTokens'
import type { WorkoutRecipe } from './WorkoutRecipe'

/** What a motif is structurally, which the generator maps onto a `BlockKind`. */
export type MotifRole = 'combo' | 'defense' | 'footwork'

export interface Motif {
  id: string
  /** Combo notation, parsed via `parseCombo`. The voice pipeline scans this. */
  notation: string
  role: MotifRole
  /** Distinct punch numbers used — for `enabledPunches` filtering. */
  punches: PunchNumber[]
  /** Punch-token count (excludes defense/footwork tokens) — for length caps. */
  length: number
  complexity: 1 | 2 | 3 | 4 | 5
  /** True when the motif lands a body shot (a trailing-`b` punch). */
  hasBody: boolean
  /**
   * Musical beat offsets, one per token (including defense/footwork tokens),
   * mirroring the sample authoring. Omit for even integer spacing.
   */
  offsets?: number[]
  /** The defense command, for `role: 'defense'` gating on `enabledDefense`. */
  defense?: DefenseCommand
  /** The footwork command, for `role: 'footwork'` gating on `enabledFootwork`. */
  footwork?: FootworkCommand
}

/**
 * The corpus. Grouped by role and roughly by complexity; the ids are stable
 * so a generated block's provenance can be traced back to its motif.
 *
 * A note on offsets: a quick one-two sits at [0, 0.75] (the doc §4 fragment
 * the fundamentals sample opens with), triples add ~0.75/beat, and a defense
 * entry gives the slip/roll a full beat before the counter starts — the same
 * spacing the hand-authored samples use.
 */
export const MOTIFS: readonly Motif[] = [
  // -- combos: jab foundation (complexity 1) --------------------------------
  { id: 'm-jab', notation: '1', role: 'combo', punches: [1], length: 1, complexity: 1, hasBody: false },
  { id: 'm-double-jab', notation: '1-1', role: 'combo', punches: [1], length: 2, complexity: 1, hasBody: false, offsets: [0, 0.75] },
  { id: 'm-one-two', notation: '1-2', role: 'combo', punches: [1, 2], length: 2, complexity: 1, hasBody: false, offsets: [0, 0.75] },

  // -- combos: short straights (complexity 2) -------------------------------
  { id: 'm-one-one-two', notation: '1-1-2', role: 'combo', punches: [1, 2], length: 3, complexity: 2, hasBody: false, offsets: [0, 0.75, 1.5] },
  { id: 'm-one-two-one', notation: '1-2-1', role: 'combo', punches: [1, 2], length: 3, complexity: 2, hasBody: false, offsets: [0, 0.75, 1.5] },
  { id: 'm-two-three', notation: '2-3', role: 'combo', punches: [2, 3], length: 2, complexity: 2, hasBody: false, offsets: [0, 0.75] },
  { id: 'm-body-cross', notation: '1-2b', role: 'combo', punches: [1, 2], length: 2, complexity: 2, hasBody: true, offsets: [0, 0.75] },

  // -- combos: three-punch (complexity 3) -----------------------------------
  { id: 'm-one-two-three', notation: '1-2-3', role: 'combo', punches: [1, 2, 3], length: 3, complexity: 3, hasBody: false, offsets: [0, 0.75, 1.5] },
  { id: 'm-one-two-body-three', notation: '1-2b-3', role: 'combo', punches: [1, 2, 3], length: 3, complexity: 3, hasBody: true, offsets: [0, 0.75, 1.5] },
  { id: 'm-jab-rear-upper', notation: '1-6', role: 'combo', punches: [1, 6], length: 2, complexity: 3, hasBody: false, offsets: [0, 0.75] },
  { id: 'm-one-two-lead-upper', notation: '1-2-5', role: 'combo', punches: [1, 2, 5], length: 3, complexity: 3, hasBody: false, offsets: [0, 0.75, 1.5] },

  // -- combos: four-punch (complexity 4) ------------------------------------
  { id: 'm-one-two-three-two', notation: '1-2-3-2', role: 'combo', punches: [1, 2, 3], length: 4, complexity: 4, hasBody: false, offsets: [0, 0.75, 1.5, 2.25] },
  { id: 'm-one-two-three-rear-upper', notation: '1-2-3-6', role: 'combo', punches: [1, 2, 3, 6], length: 4, complexity: 4, hasBody: false, offsets: [0, 0.75, 1.5, 2.25] },
  { id: 'm-body-cross-three-two', notation: '1-2b-3-2', role: 'combo', punches: [1, 2, 3], length: 4, complexity: 4, hasBody: true, offsets: [0, 0.75, 1.5, 2.25] },
  { id: 'm-body-jab-three-two', notation: '1b-2-3-2', role: 'combo', punches: [1, 2, 3], length: 4, complexity: 4, hasBody: true, offsets: [0, 0.75, 1.5, 2.25] },
  { id: 'm-uppercut-flurry', notation: '2-3-6', role: 'combo', punches: [2, 3, 6], length: 3, complexity: 4, hasBody: false, offsets: [0, 0.6, 1.2] },
  { id: 'm-jab-rear-hook-cross', notation: '1-4-3-2', role: 'combo', punches: [1, 2, 3, 4], length: 4, complexity: 4, hasBody: false, offsets: [0, 0.75, 1.5, 2.25] },

  // -- combos: five-punch finishers (complexity 5) --------------------------
  { id: 'm-one-two-three-two-one', notation: '1-2-3-2-1', role: 'combo', punches: [1, 2, 3], length: 5, complexity: 5, hasBody: false, offsets: [0, 0.75, 1.5, 2.25, 3] },
  { id: 'm-double-jab-three-two', notation: '1-1-2-3-2', role: 'combo', punches: [1, 2, 3], length: 5, complexity: 5, hasBody: false, offsets: [0, 0.75, 1.5, 2.25, 3] },
  { id: 'm-body-head-flurry', notation: '1-2b-3-2b', role: 'combo', punches: [1, 2, 3], length: 4, complexity: 5, hasBody: true, offsets: [0, 0.75, 1.5, 2.25] },

  // -- defense counters ------------------------------------------------------
  { id: 'm-slip-cross', notation: 'slip-2', role: 'defense', defense: 'slip', punches: [2], length: 1, complexity: 2, hasBody: false, offsets: [0, 1] },
  { id: 'm-slip-one-two', notation: 'slip-1-2', role: 'defense', defense: 'slip', punches: [1, 2], length: 2, complexity: 2, hasBody: false, offsets: [0, 1, 1.75] },
  { id: 'm-slip-cross-hook-cross', notation: 'slip-2-3-2', role: 'defense', defense: 'slip', punches: [2, 3], length: 3, complexity: 3, hasBody: false, offsets: [0, 1, 1.75, 2.5] },
  { id: 'm-roll-hook-cross', notation: 'roll-3-2', role: 'defense', defense: 'roll', punches: [2, 3], length: 2, complexity: 3, hasBody: false, offsets: [0, 1, 1.75] },
  { id: 'm-roll-one-two', notation: 'roll-1-2', role: 'defense', defense: 'roll', punches: [1, 2], length: 2, complexity: 3, hasBody: false, offsets: [0, 1, 1.75] },
  { id: 'm-duck-cross-hook', notation: 'duck-2-3', role: 'defense', defense: 'duck', punches: [2, 3], length: 2, complexity: 3, hasBody: false, offsets: [0, 1, 1.75] },
  { id: 'm-pull-one-two', notation: 'pull-1-2', role: 'defense', defense: 'pull', punches: [1, 2], length: 2, complexity: 3, hasBody: false, offsets: [0, 1, 1.75] },
  { id: 'm-weave-hook-cross', notation: 'bob and weave-3-2', role: 'defense', defense: 'bob-weave', punches: [2, 3], length: 2, complexity: 4, hasBody: false, offsets: [0, 1, 1.75] },

  // -- footwork exits --------------------------------------------------------
  { id: 'm-one-two-pivot', notation: '1-2-pivot', role: 'footwork', footwork: 'pivot', punches: [1, 2], length: 2, complexity: 3, hasBody: false, offsets: [0, 0.75, 1.75] },
  { id: 'm-double-jab-step', notation: '1-1-step off', role: 'footwork', footwork: 'step-off', punches: [1], length: 2, complexity: 2, hasBody: false, offsets: [0, 0.75, 1.75] },
  { id: 'm-one-two-circle', notation: '1-2-circle', role: 'footwork', footwork: 'circle', punches: [1, 2], length: 2, complexity: 3, hasBody: false, offsets: [0, 0.75, 1.75] },
  { id: 'm-one-two-three-pivot', notation: '1-2-3-pivot', role: 'footwork', footwork: 'pivot', punches: [1, 2, 3], length: 3, complexity: 4, hasBody: false, offsets: [0, 0.75, 1.5, 2.5] },
]

/** A query narrowing the corpus for one round of generation. */
export interface MotifQuery {
  /** Cap on punch-token length, before the recipe's `maximumComboPunches`. */
  maxLength?: number
  /** Cap on complexity, before the recipe's `comboComplexity`. */
  complexityCeiling?: number
  /** Restrict to these roles; defaults to all. */
  roles?: readonly MotifRole[]
}

/**
 * The motifs a recipe permits under a query.
 *
 * Enablement is a hard filter: a motif survives only if every punch it uses is
 * enabled, its length and complexity sit under both the query and the recipe
 * caps, and — for a defense or footwork motif — its command is enabled and its
 * frequency is not `off`. Body motifs drop out entirely when `bodyShotPercent`
 * is zero; above that, the generator weights them rather than this filter.
 */
export function motifsFor(recipe: WorkoutRecipe, query: MotifQuery = {}): Motif[] {
  const enabledPunches = new Set<PunchNumber>(recipe.enabledPunches)
  const enabledDefense = new Set<DefenseCommand>(recipe.enabledDefense)
  const enabledFootwork = new Set<FootworkCommand>(recipe.enabledFootwork)
  const maxLength = Math.min(query.maxLength ?? Number.POSITIVE_INFINITY, recipe.maximumComboPunches)
  const complexityCeiling = Math.min(query.complexityCeiling ?? 5, recipe.comboComplexity)
  const roles = query.roles ? new Set(query.roles) : null

  return MOTIFS.filter((motif) => {
    if (roles && !roles.has(motif.role)) return false
    if (motif.length > maxLength) return false
    if (motif.complexity > complexityCeiling) return false
    if (motif.hasBody && recipe.bodyShotPercent <= 0) return false
    if (!motif.punches.every((n) => enabledPunches.has(n))) return false

    if (motif.role === 'defense') {
      if (recipe.defenseFrequency === 'off') return false
      if (!motif.defense || !enabledDefense.has(motif.defense)) return false
    }
    if (motif.role === 'footwork') {
      if (recipe.footworkFrequency === 'off') return false
      if (!motif.footwork || !enabledFootwork.has(motif.footwork)) return false
    }
    return true
  })
}
