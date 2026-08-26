/**
 * Kyle's combination corpus v1, adapted into the motif shape the generator
 * consumes (Rhythm Map M1).
 *
 * The corpus (`./corpus/comboCorpusV1`) is the authored source of truth:
 * 60 tiered combinations with names, objectives and spoken groupings, 18
 * additive build-up ladders, 10 generator rules and 6 footwork wrappers.
 * This module is an ingestion adapter, not a re-authoring — every field
 * here is derived from a corpus row, and a test parses every notation
 * through `parseCombo` so a corpus typo can never reach the generator.
 *
 * Two conventions are load-bearing:
 *
 * - **Tokens are canonical; notation is an alias.** The corpus stores
 *   `["1","2B"]`; the dash string exists for display and for the voice
 *   pipeline's clip keys. Clip files are keyed by the LOWERCASE-b form
 *   (`1-2b.steady...wav` — 248 rendered clips predate the uppercase
 *   convention), so `canonicalNotation` normalizes through
 *   `parseCombo`/`formatCombo` and display code renders uppercase.
 *
 * - **These motifs are NOT merged into `MOTIFS` yet.** M1 is data-only:
 *   the generator keeps selecting from the legacy 31 until the round-fill
 *   engine (M3) consumes tiers, ladders and the generator rules — and
 *   until each batch of clips lands. Merging here would change every
 *   generated workout before the voice could keep up.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import {
  BUILD_UP_SETS,
  COMBO_CORPUS,
  OPTIONAL_FOOTWORK_WRAPPERS,
  type BuildUpSet,
  type ComboDefinition,
  type ComboTier,
} from './corpus/comboCorpusV1'
import { formatCombo, parseCombo, type PunchNumber } from './WorkoutTokens'
import type { Motif } from './comboLibrary'

export type { BuildUpSet, ComboDefinition, ComboTier }
export { BUILD_UP_SETS, COMBO_CORPUS, OPTIONAL_FOOTWORK_WRAPPERS }

/** A corpus-backed motif: the legacy shape plus the tiered metadata. */
export interface CorpusMotif extends Motif {
  tier: ComboTier
  /** The corpus row id (B01…A20) — provenance for blocks and round themes. */
  corpusId: string
  name: string
  objective: string
  /**
   * Spoken grouping, canonical-token form — drives the phrase compiler's
   * pause/emphasis structure ("One-FOUR… two-THREE… six-FIVE!").
   */
  spokenGroups: readonly (readonly string[])[]
  bodyShotCount: number
  jabLed: boolean
  use: ComboDefinition['use']
}

/**
 * The lowercase-b, `formatCombo`-canonical form of a corpus token list.
 *
 * Round-tripping through the parser is what guarantees the alias can never
 * disagree with the tokens — and that the result matches the clip keys the
 * voice library is rendered against.
 */
export function canonicalNotation(tokens: readonly string[]): string {
  return formatCombo(parseCombo(tokens.join('-')))
}

/**
 * Complexity mapping for corpus motifs.
 *
 * The corpus tiers by coordination difficulty; the legacy `complexity`
 * scale (1-5) still gates `motifsFor` filtering, so a deterministic
 * projection keeps both worlds consistent.
 */
function complexityFor(tier: ComboTier, punchCount: number): 1 | 2 | 3 | 4 | 5 {
  if (tier === 'beginner') return punchCount <= 2 ? 1 : 2
  if (tier === 'intermediate') return punchCount <= 4 ? 3 : 4
  return punchCount <= 7 ? 4 : 5
}

/**
 * Default beat offsets for corpus combos.
 *
 * The corpus authors rhythm via spoken groups rather than beat offsets, so
 * punches sit on an even 0.7-beat lattice — the spacing the hand-authored
 * samples use for straight runs. Ladder/phase rhythm arrives with the
 * round-fill engine; per-motif authored offsets can override later without
 * a schema change.
 */
function defaultOffsets(tokenCount: number): number[] {
  return Array.from({ length: tokenCount }, (_, i) => Number((i * 0.7).toFixed(2)))
}

function toMotif(combo: ComboDefinition): CorpusMotif {
  const notation = canonicalNotation(combo.tokens)
  const parsed = parseCombo(notation)
  const punches = [
    ...new Set(
      parsed
        .filter((t) => t.kind === 'punch')
        .map((t) => (t as { number: PunchNumber }).number),
    ),
  ]
  return {
    id: `c-${combo.id.toLowerCase()}`,
    notation,
    role: 'combo',
    punches,
    length: combo.punchCount,
    complexity: complexityFor(combo.tier, combo.punchCount),
    hasBody: combo.bodyShotCount > 0,
    offsets: defaultOffsets(parsed.length),
    tier: combo.tier,
    corpusId: combo.id,
    name: combo.name,
    objective: combo.objective,
    spokenGroups: combo.spokenGroups,
    bodyShotCount: combo.bodyShotCount,
    jabLed: combo.jabLed,
    use: combo.use,
  }
}

/**
 * Every corpus combination as a motif, in corpus order.
 *
 * Selection wiring (tier filters, ladder scheduling, generator rules) is
 * the round-fill engine's job — see the module note for why these stay out
 * of `MOTIFS` until then.
 */
export const CORPUS_MOTIFS: readonly CorpusMotif[] = COMBO_CORPUS.map(toMotif)

/** Corpus motifs indexed by corpus id (B01…A20). */
export const CORPUS_MOTIFS_BY_ID: ReadonlyMap<string, CorpusMotif> = new Map(
  CORPUS_MOTIFS.map((m) => [m.corpusId, m]),
)

/**
 * Every unique notation the corpus needs a whole-phrase clip for —
 * combinations plus the build-up stages that are not themselves corpus
 * rows. Single tokens are excluded (they are word clips, not phrases),
 * matching the voice pipeline's corpus scan.
 */
export function corpusPhraseNotations(): string[] {
  const notations = new Set<string>()
  for (const motif of CORPUS_MOTIFS) {
    if (motif.length > 1) notations.add(motif.notation)
  }
  for (const set of BUILD_UP_SETS) {
    for (const stage of set.stages) {
      if (stage.tokens.length > 1) notations.add(canonicalNotation(stage.tokens))
    }
  }
  return [...notations].sort()
}
