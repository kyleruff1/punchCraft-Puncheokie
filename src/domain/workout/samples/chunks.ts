/**
 * Choreographed section chunks — the reusable, ID-addressable spots that
 * new workouts link together (Kyle, 2026-09-03).
 *
 * A CHUNK is one fully-choreographed section: `{ motif, rate, reps }` (+
 * optional stance). Everything downstream of a section is a pure function
 * of that core — the per-bar calls (keyed by motif), the avatar strike/
 * retract/guard cycle, and the timing (offsets, stride, breath) — so a
 * chunk carries its whole choreography wherever it is linked. The only
 * per-spot thing is the spoken LEAD-IN copy, which stays at the link site
 * (`SectionRef.leadIn`): every authored lead-in is bespoke today, so it is
 * an attribute of WHERE a chunk is used, not of the chunk itself.
 *
 * The chunk `id` is the stable, human-readable "minute ID" Kyle links by
 * (`jab-cross-hook-cross-x18`). It is IDENTITY: tune a chunk's reps and
 * you make a NEW chunk (identity includes the exact dose — his call), so a
 * given id always means the exact same choreography. `chunkSignature`
 * gives the content fingerprint used to prove no two chunks are the same
 * spot.
 *
 * This layer is ADDITIVE: `resolveRound` expands chunk-referencing rounds
 * back into the exact `ClickRound`/`ClickRow` shape BEFORE `clickSpecs`
 * ever runs, so the timeline compiler, audio slots, manifests, and runner
 * see precisely what they see for a hand-authored map — zero downstream
 * change.
 */
import { parseCombo } from '../WorkoutTokens'
import { rowMeasures, type ClickRate, type ClickRound, type ClickRow } from './clickMaps'

export interface SectionChunk {
  /** The "minute ID" — stable human slug, unique across CHUNKS, the link handle. */
  id: string
  /** Bar notation — 4 or 8 segments, '.' for a rest slot. */
  motif: string
  rate: ClickRate
  reps: number
  /** Stance the chunk is choreographed for, when it is stance-specific. */
  stance?: 'orthodox' | 'southpaw'
}

/** A chunk linked into a round: the chunk id + the bespoke spoken copy for THIS spot. */
export interface SectionRef {
  /** CHUNKS key — the minute ID. */
  chunk: string
  /** Authored spoken lead-in for this spot (numerals spelled out), as on ClickRow. */
  leadIn: string
  /** Setup pad (whole measures) for THIS spot — a per-spot property like leadIn, not chunk identity. */
  setupMeasures?: number
}

/** A round authored by linking chunks instead of literal rows. */
export interface ClickRoundRef {
  theme: string
  sections: SectionRef[]
  stance?: 'orthodox' | 'southpaw'
  rest?: string
}

/**
 * Content fingerprint of a chunk's choreography. Two chunks with the same
 * signature ARE the same spot — `chunksSelfCheck` forbids that. A plain
 * canonical string (not a crypto hash): this is runtime code in the RN
 * bundle where `node:crypto` is unavailable, and the string is both unique
 * and legible.
 */
export function chunkSignature(c: Pick<SectionChunk, 'motif' | 'rate' | 'reps' | 'stance'>): string {
  return `${c.motif}|@${c.rate}|x${c.reps}|${c.stance ?? '-'}`
}

/** Measures one rep-block of a chunk occupies — for round-budget math when composing. */
export function chunkMeasures(c: SectionChunk): number {
  return rowMeasures({ motif: c.motif, rate: c.rate, reps: c.reps, leadIn: '' })
}

/**
 * The seeded library: the 12 `(motif, rate, reps)` tuples that already
 * recur across the ten predetermined workouts — the demonstrably "common
 * spots we link together." Slugs are technique names (jab/cross/hook/
 * rear-hook/upper/rear-upper, `body-` for a body shot) joined by `-`, a
 * rate tag (`` straight · `-th` time-and-a-half · `-dt` double-time), and
 * the rep dose. More chunks are added as new workouts need them.
 */
export const CHUNKS: Record<string, SectionChunk> = {
  'jab-cross-hook-cross-x18': { id: 'jab-cross-hook-cross-x18', motif: '1-2-3-2', rate: 1, reps: 18 },
  'jab-cross-hook-cross-x15': { id: 'jab-cross-hook-cross-x15', motif: '1-2-3-2', rate: 1, reps: 15 },
  'jab-cross-hook-cross-x13': { id: 'jab-cross-hook-cross-x13', motif: '1-2-3-2', rate: 1, reps: 13 },
  'jab-jab-cross-x9': { id: 'jab-jab-cross-x9', motif: '1-1-2-.', rate: 1, reps: 9 },
  'jab-jab-cross-th-x18': { id: 'jab-jab-cross-th-x18', motif: '1-1-2-.', rate: 1.5, reps: 18 },
  'jab-jab-cross-dt-x18': { id: 'jab-jab-cross-dt-x18', motif: '1-1-2-.', rate: 2, reps: 18 },
  'jab-jab-jab-jab-x9': { id: 'jab-jab-jab-jab-x9', motif: '1-1-1-1', rate: 1, reps: 9 },
  // Reps below track the Variant-B opener-pad rebalance (fit-round-openers,
  // 2026-09-04): both occurrences of each spot were trimmed symmetrically, so
  // the tuples moved rather than vanished.
  'jab-rear-upper-hook-th-x18': { id: 'jab-rear-upper-hook-th-x18', motif: '1-6-3-.', rate: 1.5, reps: 18 },
  'body-jab-pump-dt-x27': { id: 'body-jab-pump-dt-x27', motif: '1b-1b-1b-1b', rate: 2, reps: 27 },
  'body-jab-jab-cross-th-x18': { id: 'body-jab-jab-cross-th-x18', motif: '1b-1-2-.', rate: 1.5, reps: 18 },
  'jab-cross-hook-dt-x24': { id: 'jab-cross-hook-dt-x24', motif: '1-2-3-.', rate: 2, reps: 24 },
  'jab-cross-hook-dt-x22': { id: 'jab-cross-hook-dt-x22', motif: '1-2-3-.', rate: 2, reps: 22 },
  // Minted by the same rebalance: pace-pusher r4's trim landed on an
  // existing 1-2-3-2 time-and-a-half row's dose, making a new shared spot.
  'jab-cross-hook-cross-th-x20': { id: 'jab-cross-hook-cross-th-x20', motif: '1-2-3-2', rate: 1.5, reps: 20 },

  // -------------------------------------------------------------------------
  // The quick catalogue (quickWorkouts.ts, 2026-09-07): two rounds × 4:00
  // each. Dose is identity, so a quick workout's spot at a new rep count is
  // a NEW chunk even when its motif is an old friend. Grouped by the
  // workout that minted it; a chunk minted by one workout and reused by
  // another appears once, under the first.
  //
  // Naming, extending the rule above: rest slots are dropped from the slug,
  // except a bar with two or more TRAILING rests takes `-coast`, the
  // interior-rest bar `1-.-2-.` is `jab-hold-cross`, and a four-of-a-kind
  // bar is `<slug>-pump`.
  // -------------------------------------------------------------------------

  // Jab School
  'jab-jab-jab-jab-x13': { id: 'jab-jab-jab-jab-x13', motif: '1-1-1-1', rate: 1, reps: 13 },
  'jab-jab-cross-dt-x30': { id: 'jab-jab-cross-dt-x30', motif: '1-1-2-.', rate: 2, reps: 30 },
  'jab-cross-jab-cross-x14': { id: 'jab-cross-jab-cross-x14', motif: '1-2-1-2', rate: 1, reps: 14 },
  'body-jab-pump-dt-x18': { id: 'body-jab-pump-dt-x18', motif: '1b-1b-1b-1b', rate: 2, reps: 18 },
  'jab-jab-cross-hook-th-x16': { id: 'jab-jab-cross-hook-th-x16', motif: '1-1-2-3', rate: 1.5, reps: 16 },
  'jab-jab-jab-jab-th-x30': { id: 'jab-jab-jab-jab-th-x30', motif: '1-1-1-1', rate: 1.5, reps: 30 },

  // One-Two
  'jab-cross-coast-x15': { id: 'jab-cross-coast-x15', motif: '1-2-.-.', rate: 1, reps: 15 },
  'jab-cross-coast-th-x26': { id: 'jab-cross-coast-th-x26', motif: '1-2-.-.', rate: 1.5, reps: 26 },
  'jab-cross-coast-dt-x28': { id: 'jab-cross-coast-dt-x28', motif: '1-2-.-.', rate: 2, reps: 28 },
  'jab-jab-cross-x16': { id: 'jab-jab-cross-x16', motif: '1-1-2-.', rate: 1, reps: 16 },
  'jab-jab-cross-th-x24': { id: 'jab-jab-cross-th-x24', motif: '1-1-2-.', rate: 1.5, reps: 24 },
  'jab-cross-jab-cross-th-x26': { id: 'jab-cross-jab-cross-th-x26', motif: '1-2-1-2', rate: 1.5, reps: 26 },

  // Hook Line
  'jab-cross-hook-x15': { id: 'jab-cross-hook-x15', motif: '1-2-3-.', rate: 1, reps: 15 },
  'hook-cross-hook-th-x18': { id: 'hook-cross-hook-th-x18', motif: '3-2-3-.', rate: 1.5, reps: 18 },
  'jab-cross-hook-rear-hook-x9': { id: 'jab-cross-hook-rear-hook-x9', motif: '1-2-3-4', rate: 1, reps: 9 },
  'jab-cross-hook-rear-hook-x13': { id: 'jab-cross-hook-rear-hook-x13', motif: '1-2-3-4', rate: 1, reps: 13 },
  'hook-rear-hook-hook-rear-hook-x10': { id: 'hook-rear-hook-hook-rear-hook-x10', motif: '3-4-3-4', rate: 1, reps: 10 },
  'jab-rear-hook-hook-cross-th-x20': { id: 'jab-rear-hook-hook-cross-th-x20', motif: '1-4-3-2', rate: 1.5, reps: 20 },
  'jab-cross-hook-dt-x26': { id: 'jab-cross-hook-dt-x26', motif: '1-2-3-.', rate: 2, reps: 26 },

  // The Square
  'jab-rear-hook-cross-hook-x9': { id: 'jab-rear-hook-cross-hook-x9', motif: '1-4-2-3', rate: 1, reps: 9 },
  'jab-rear-hook-cross-hook-th-x14': { id: 'jab-rear-hook-cross-hook-th-x14', motif: '1-4-2-3', rate: 1.5, reps: 14 },
  'jab-cross-hook-cross-jab-rear-hook-hook-cross-x14': { id: 'jab-cross-hook-cross-jab-rear-hook-hook-cross-x14', motif: '1-2-3-2-1-4-3-2', rate: 1, reps: 14 },
  'jab-rear-hook-hook-cross-x13': { id: 'jab-rear-hook-hook-cross-x13', motif: '1-4-3-2', rate: 1, reps: 13 },
  'jab-cross-hook-rear-hook-th-x20': { id: 'jab-cross-hook-rear-hook-th-x20', motif: '1-2-3-4', rate: 1.5, reps: 20 },
  'jab-rear-hook-hook-cross-dt-x26': { id: 'jab-rear-hook-hook-cross-dt-x26', motif: '1-4-3-2', rate: 2, reps: 26 },

  // Uppercut Lane
  'jab-cross-upper-cross-x13': { id: 'jab-cross-upper-cross-x13', motif: '1-2-5-2', rate: 1, reps: 13 },
  'upper-rear-upper-upper-th-x16': { id: 'upper-rear-upper-upper-th-x16', motif: '5-6-5-.', rate: 1.5, reps: 16 },
  'jab-rear-upper-hook-cross-x8': { id: 'jab-rear-upper-hook-cross-x8', motif: '1-6-3-2', rate: 1, reps: 8 },
  'jab-upper-cross-dt-x19': { id: 'jab-upper-cross-dt-x19', motif: '1-5-2-.', rate: 2, reps: 19 },
  'jab-cross-upper-rear-upper-x12': { id: 'jab-cross-upper-rear-upper-x12', motif: '1-2-5-6', rate: 1, reps: 12 },
  'rear-upper-hook-rear-upper-hook-x8': { id: 'rear-upper-hook-rear-upper-hook-x8', motif: '6-3-6-3', rate: 1, reps: 8 },
  'cross-upper-cross-th-x18': { id: 'cross-upper-cross-th-x18', motif: '2-5-2-.', rate: 1.5, reps: 18 },
  'upper-cross-hook-dt-x19': { id: 'upper-cross-hook-dt-x19', motif: '5-2-3-.', rate: 2, reps: 19 },

  // Downstairs
  'jab-body-cross-jab-body-cross-x13': { id: 'jab-body-cross-jab-body-cross-x13', motif: '1-2b-1-2b', rate: 1, reps: 13 },
  'body-jab-body-cross-coast-x9': { id: 'body-jab-body-cross-coast-x9', motif: '1b-2b-.-.', rate: 1, reps: 9 },
  'jab-body-cross-hook-th-x22': { id: 'jab-body-cross-hook-th-x22', motif: '1-2b-3-.', rate: 1.5, reps: 22 },
  'body-cross-body-hook-body-cross-x13': { id: 'body-cross-body-hook-body-cross-x13', motif: '2b-3b-2b-.', rate: 1, reps: 13 },
  'jab-cross-body-hook-cross-x13': { id: 'jab-cross-body-hook-cross-x13', motif: '1-2-3b-2', rate: 1, reps: 13 },
  'jab-cross-body-hook-th-x26': { id: 'jab-cross-body-hook-th-x26', motif: '1-2-3b-.', rate: 1.5, reps: 26 },
  'jab-cross-body-hook-cross-th-x22': { id: 'jab-cross-body-hook-cross-th-x22', motif: '1-2-3b-2', rate: 1.5, reps: 22 },

  // Level Change
  'body-jab-jab-cross-x14': { id: 'body-jab-jab-cross-x14', motif: '1b-1-2-.', rate: 1, reps: 14 },
  'jab-cross-body-jab-cross-x10': { id: 'jab-cross-body-jab-cross-x10', motif: '1-2-1b-2', rate: 1, reps: 10 },
  'jab-body-jab-cross-dt-x20': { id: 'jab-body-jab-cross-dt-x20', motif: '1-1b-2-.', rate: 2, reps: 20 },
  'body-jab-cross-jab-cross-th-x24': { id: 'body-jab-cross-jab-cross-th-x24', motif: '1b-2-1-2', rate: 1.5, reps: 24 },
  'jab-body-cross-hook-body-rear-hook-x13': { id: 'jab-body-cross-hook-body-rear-hook-x13', motif: '1-2b-3-4b', rate: 1, reps: 13 },
  'jab-cross-body-hook-cross-x9': { id: 'jab-cross-body-hook-cross-x9', motif: '1-2-3b-2', rate: 1, reps: 9 },
  'body-jab-jab-cross-dt-x26': { id: 'body-jab-jab-cross-dt-x26', motif: '1b-1-2-.', rate: 2, reps: 26 },

  // Southpaw Mirror
  'jab-jab-cross-x8': { id: 'jab-jab-cross-x8', motif: '1-1-2-.', rate: 1, reps: 8 },
  'jab-cross-hook-dt-x17': { id: 'jab-cross-hook-dt-x17', motif: '1-2-3-.', rate: 2, reps: 17 },
  'jab-body-cross-hook-th-x18': { id: 'jab-body-cross-hook-th-x18', motif: '1-2b-3-.', rate: 1.5, reps: 18 },

  // Speed Burst
  'jab-jab-cross-dt-x34': { id: 'jab-jab-cross-dt-x34', motif: '1-1-2-.', rate: 2, reps: 34 },
  'cross-hook-cross-dt-x18': { id: 'cross-hook-cross-dt-x18', motif: '2-3-2-.', rate: 2, reps: 18 },
  'jab-cross-hook-th-x32': { id: 'jab-cross-hook-th-x32', motif: '1-2-3-.', rate: 1.5, reps: 32 },
  'jab-cross-jab-cross-hook-cross-coast-dt-x20': { id: 'jab-cross-jab-cross-hook-cross-coast-dt-x20', motif: '1-2-1-2-3-2-.-.', rate: 2, reps: 20 },
  'cross-hook-cross-dt-x34': { id: 'cross-hook-cross-dt-x34', motif: '2-3-2-.', rate: 2, reps: 34 },

  // Heavy Two
  'cross-hook-cross-th-x26': { id: 'cross-hook-cross-th-x26', motif: '2-3-2-.', rate: 1.5, reps: 26 },
  'hook-cross-hook-dt-x22': { id: 'hook-cross-hook-dt-x22', motif: '3-2-3-.', rate: 2, reps: 22 },
  'jab-cross-upper-cross-th-x22': { id: 'jab-cross-upper-cross-th-x22', motif: '1-2-5-2', rate: 1.5, reps: 22 },
  'jab-jab-cross-hook-cross-upper-cross-x14': { id: 'jab-jab-cross-hook-cross-upper-cross-x14', motif: '1-1-2-3-2-5-2-.', rate: 1, reps: 14 },

  // Coast & Reset
  'jab-coast-x8': { id: 'jab-coast-x8', motif: '1-.-.-.', rate: 1, reps: 8 },
  'cross-pump-dt-x10': { id: 'cross-pump-dt-x10', motif: '2-2-2-2', rate: 2, reps: 10 },
  'jab-hold-cross-x14': { id: 'jab-hold-cross-x14', motif: '1-.-2-.', rate: 1, reps: 14 },
  'cross-hook-coast-x9': { id: 'cross-hook-coast-x9', motif: '2-3-.-.', rate: 1, reps: 9 },
  'jab-cross-coast-x9': { id: 'jab-cross-coast-x9', motif: '1-2-.-.', rate: 1, reps: 9 },
  'cross-hook-coast-th-x20': { id: 'cross-hook-coast-th-x20', motif: '2-3-.-.', rate: 1.5, reps: 20 },
  'jab-coast-x10': { id: 'jab-coast-x10', motif: '1-.-.-.', rate: 1, reps: 10 },
  'jab-cross-hook-cross-th-x14': { id: 'jab-cross-hook-cross-th-x14', motif: '1-2-3-2', rate: 1.5, reps: 14 },

  // Six Count
  'jab-cross-hook-rear-hook-upper-rear-upper-coast-x10': { id: 'jab-cross-hook-rear-hook-upper-rear-upper-coast-x10', motif: '1-2-3-4-5-6-.-.', rate: 1, reps: 10 },
  'jab-rear-upper-hook-th-x20': { id: 'jab-rear-upper-hook-th-x20', motif: '1-6-3-.', rate: 1.5, reps: 20 },
  'jab-cross-hook-cross-jab-cross-upper-cross-x8': { id: 'jab-cross-hook-cross-jab-cross-upper-cross-x8', motif: '1-2-3-2-1-2-5-2', rate: 1, reps: 8 },
  'jab-cross-hook-rear-hook-upper-rear-upper-coast-x8': { id: 'jab-cross-hook-rear-hook-upper-rear-upper-coast-x8', motif: '1-2-3-4-5-6-.-.', rate: 1, reps: 8 },
  'jab-cross-upper-rear-upper-x9': { id: 'jab-cross-upper-rear-upper-x9', motif: '1-2-5-6', rate: 1, reps: 9 },
}

/** Look a chunk up by its minute ID, failing loudly on an unknown one. */
export function getChunk(id: string): SectionChunk {
  const chunk = CHUNKS[id]
  if (!chunk) throw new Error(`unknown chunk '${id}'. Known: ${Object.keys(CHUNKS).join(', ')}`)
  return chunk
}

/**
 * Expand a chunk-referencing round into the exact `ClickRound` shape a
 * hand-authored map produces. This is the whole backward-compat trick:
 * nothing downstream can tell the round was composed from chunks.
 */
export function resolveRound(ref: ClickRoundRef): ClickRound {
  return {
    theme: ref.theme,
    ...(ref.stance ? { stance: ref.stance } : {}),
    ...(ref.rest ? { rest: ref.rest } : {}),
    rows: ref.sections.map((s): ClickRow => {
      const c = getChunk(s.chunk)
      return {
        motif: c.motif,
        rate: c.rate,
        reps: c.reps,
        leadIn: s.leadIn,
        ...(s.setupMeasures !== undefined ? { setupMeasures: s.setupMeasures } : {}),
      }
    }),
  }
}

/**
 * Integrity gate (peer of `clickMapsSelfCheck`): every chunk id matches
 * its key, motifs parse, rates and reps are legal, and — the point of the
 * whole scheme — no two chunks share a content signature (you cannot
 * author the same spot twice). Returns [] when clean; a Jest test pins it.
 */
export function chunksSelfCheck(): string[] {
  const errs: string[] = []
  const bySig = new Map<string, string>()
  for (const [key, c] of Object.entries(CHUNKS)) {
    if (c.id !== key) errs.push(`${key}: id '${c.id}' does not match its key`)
    if (![1, 1.5, 2].includes(c.rate)) errs.push(`${c.id}: illegal rate ${c.rate}`)
    if (!Number.isInteger(c.reps) || c.reps <= 0) errs.push(`${c.id}: reps must be a positive integer, got ${c.reps}`)
    try {
      parseCombo(c.motif)
    } catch (e) {
      errs.push(`${c.id}: motif '${c.motif}' does not parse (${String(e)})`)
    }
    const sig = chunkSignature(c)
    const clash = bySig.get(sig)
    if (clash) errs.push(`${c.id}: same choreography as '${clash}' (signature ${sig}) — chunks must be distinct spots`)
    else bySig.set(sig, c.id)
  }
  return errs
}
