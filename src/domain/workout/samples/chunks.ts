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
  'jab-rear-upper-hook-th-x20': { id: 'jab-rear-upper-hook-th-x20', motif: '1-6-3-.', rate: 1.5, reps: 20 },
  'body-jab-pump-dt-x29': { id: 'body-jab-pump-dt-x29', motif: '1b-1b-1b-1b', rate: 2, reps: 29 },
  'body-jab-jab-cross-th-x18': { id: 'body-jab-jab-cross-th-x18', motif: '1b-1-2-.', rate: 1.5, reps: 18 },
  'jab-cross-hook-dt-x26': { id: 'jab-cross-hook-dt-x26', motif: '1-2-3-.', rate: 2, reps: 26 },
  'jab-cross-hook-dt-x22': { id: 'jab-cross-hook-dt-x22', motif: '1-2-3-.', rate: 2, reps: 22 },
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
      return { motif: c.motif, rate: c.rate, reps: c.reps, leadIn: s.leadIn }
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
