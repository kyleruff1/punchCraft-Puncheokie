/**
 * The ArpOperation algebra and motif compiler (M40-21, technique-motif-design
 * §§7-9 + §14, second-pass am. 5).
 *
 * AMENDMENT 5 — the abstract/resolved split. A phrase window is 960 ticks
 * while the default harmonic commit window is 480, so a phrase can begin
 * under one chord and close under another. The accumulator therefore
 * collects SEMANTIC OPERATIONS, never concrete pool indices; the motif is
 * resolved against the cell sounding AT THE COMMIT:
 *
 *     punches → AbstractTechniqueMotif (operations, no notes)
 *             → [commit tick, sounding cell]
 *             → CompiledTechniqueMotif (resolvedPoolIndices)
 *
 * Concrete indices are never computed from whichever chord happened to be
 * active when the first punch landed.
 *
 * THE ROLE-GROUP READING (flagged for Kyle's sign-off, #325). The design's
 * §9 contour letters (F · C · 5 · U · 5 · C · 5 · F) are read as ROLE
 * GROUPS with member rotation, not as fixed roles: the two `C` steps visit
 * the Color group's two members in turn (third, then color) rather than
 * repeating one tone. That reading is what makes 1-2-3-2 compile to the
 * design's illustration exactly — see the golden.
 *
 * Pure and deterministic (rule 12: same field state + tokens + velocities →
 * the same motif, always). No clocks, no randomness, no RN imports.
 */
import type { StrikeToken } from './gestureSchema'
import type { ToneRoleGroupId } from './harmonicField'
import {
  strikeSignatureKeyOf,
  type StrikeFamily,
  type StrikeSignatureKey,
} from './strikeArticulationCatalog'

/** Roles a `land` operation may target (design rule 8 + token 5's settle). */
export type LandRole = 'root' | 'fifth' | 'upper-anchor' | 'extension'

/**
 * One semantic step. Every operation names WHERE it goes in role terms —
 * it can be resolved against any legal pool, which is the whole point of
 * the abstract/resolved split.
 */
export type ArpOperation =
  | { kind: 'advance'; group: ToneRoleGroupId }
  | { kind: 'skip'; group: ToneRoleGroupId }
  | { kind: 'reverse'; group: ToneRoleGroupId }
  | { kind: 'land'; role: LandRole }
  | { kind: 'octave-pulse'; octave: -1 | 1 }
  | { kind: 'lower-inversion' }

/**
 * Role → natural-pool slot. Mirrors harmonicField's UNIFORM_ROLES exactly:
 * 0 root · 1 third · 2 fifth · 3 color · 4 extension · 5 upper-anchor.
 */
const ROLE_SLOT: Readonly<Record<LandRole, number>> = {
  root: 0,
  fifth: 2,
  extension: 4,
  'upper-anchor': 5,
}

/**
 * Group members, ascending — the same grouping harmonicField validates.
 * member[0] is the group's STEP tone, member[1] its LEAP tone.
 */
const GROUP_MEMBERS: Readonly<Record<ToneRoleGroupId, readonly [number, number]>> = {
  foundation: [0, 2], // root, fifth
  color: [1, 3], // third, color
  air: [4, 5], // extension, upper-anchor
}

/** Rule 8's stable finals: root, fifth, upper root/anchor. */
const STABLE_SLOTS: readonly number[] = [ROLE_SLOT.root, ROLE_SLOT.fifth, ROLE_SLOT['upper-anchor']]

/**
 * Per-token operation templates (design §§4,7,9). Composed from the
 * catalog's family + emphasis so the two modules can never drift: setup
 * emphasis steps and sets up, power emphasis leaps and lands.
 */
function templateFor(key: StrikeSignatureKey, atPhraseEnd: boolean): readonly ArpOperation[] {
  const power = key.hand === 'physical-right'
  const body = key.target === 'body'
  const ops: ArpOperation[] = []
  // A body shot is the same idea in a lower inversion (never a new scale).
  if (body) ops.push({ kind: 'lower-inversion' })

  switch (key.family) {
    case 'straight':
      if (power) {
        // 2 · "Skip one pool tone, then land firmly." Rule 8: the phrase's
        // final tone is stable — a closing cross lands on the root, a
        // mid-phrase cross takes the upper-anchor leap.
        ops.push({ kind: 'skip', group: 'foundation' })
        ops.push({ kind: 'land', role: atPhraseEnd ? 'root' : 'upper-anchor' })
      } else {
        // 1 · "Step upward through two adjacent legal tones."
        ops.push({ kind: 'advance', group: 'foundation' })
        ops.push({ kind: 'advance', group: 'color' })
      }
      break
    case 'hook':
      // 3/4 · "Reverse into a short pendulum arc" — the hook pivots on the
      // tone it just left, then arcs. Rule 9: never a new chord.
      ops.push({ kind: 'reverse', group: 'foundation' })
      ops.push({ kind: 'advance', group: 'color' })
      // 4 · "Mirrored pendulum … stronger landing."
      if (power) ops.push({ kind: 'land', role: 'upper-anchor' })
      break
    case 'uppercut':
      // 5 · "advance 2, octave-pulse up, settle extension"
      // 6 · "advance 3, octave-pulse up, land root/fifth"
      ops.push({ kind: 'skip', group: power ? 'air' : 'foundation' })
      ops.push({ kind: 'octave-pulse', octave: 1 })
      // Rule 10: uppercuts rise but SETTLE inside the pool.
      ops.push({ kind: 'land', role: power ? 'fifth' : 'extension' })
      break
  }
  return ops
}

// ---------------------------------------------------------------------------
// The abstract motif (what a phrase collects).
// ---------------------------------------------------------------------------

export interface AbstractTechniqueMotif {
  motifId: string
  sourceStrikeEventIds: readonly string[]
  sourceTokens: readonly StrikeToken[]
  operations: readonly ArpOperation[]
  /** Per-operation accent 0..1, carried from each punch's velocity. */
  accentValues: readonly number[]
  family: StrikeFamily | 'mixed'
  /** The tick the phrase closed on; resolution happens at or after it. */
  commitTick: number
  /**
   * Punches beyond the explicit cap became ENERGY, not notes (rule 11):
   * more punches raise gate/accent/depth, never the note count.
   */
  energy: { extraPunchCount: number; totalImpact: number; averageVelocity: number }
}

export interface PhrasePunch {
  eventId: string
  token: StrikeToken
  /** 0..1 — drives accent, never note choice. */
  velocity01: number
}

/** Design §12: at most four explicit identities per phrase; extras = energy. */
export const MAX_EXPLICIT_PHRASE_PUNCHES = 4
/** Rule 2: a motif is at most eight arp steps. */
export const MAX_MOTIF_STEPS = 8

function familyOf(tokens: readonly StrikeToken[]): StrikeFamily | 'mixed' {
  const families = new Set(tokens.map((t) => strikeSignatureKeyOf(t).family))
  const [only] = [...families]
  return families.size === 1 && only ? only : 'mixed'
}

/**
 * Compile a phrase's punches into an ABSTRACT motif — operations only, no
 * notes. Order is preserved (rule 1); at most four punches contribute
 * explicit operations and the rest become energy (rule 11); the operation
 * list is capped at eight steps (rule 2).
 */
export function compileAbstractMotif(
  punches: readonly PhrasePunch[],
  commitTick: number,
): AbstractTechniqueMotif | null {
  if (punches.length === 0) return null
  const explicit = punches.slice(0, MAX_EXPLICIT_PHRASE_PUNCHES)
  const extras = punches.slice(MAX_EXPLICIT_PHRASE_PUNCHES)

  const operations: ArpOperation[] = []
  const accentValues: number[] = []
  // Rule 2 counts arp STEPS, not operations: 'lower-inversion' shapes the
  // phrase's register without sounding a step of its own, so it is free.
  let steps = 0
  explicit.forEach((punch, index) => {
    const atPhraseEnd = index === explicit.length - 1
    for (const op of templateFor(strikeSignatureKeyOf(punch.token), atPhraseEnd)) {
      const emits = op.kind !== 'lower-inversion'
      if (emits && steps >= MAX_MOTIF_STEPS) break
      if (emits) steps += 1
      operations.push(op)
      accentValues.push(punch.velocity01)
    }
  })

  const totalImpact = punches.reduce((sum, p) => sum + p.velocity01, 0)
  return {
    motifId: `m${commitTick}-${explicit.map((p) => p.token).join('')}`,
    sourceStrikeEventIds: punches.map((p) => p.eventId),
    sourceTokens: explicit.map((p) => p.token),
    operations,
    accentValues,
    family: familyOf(explicit.map((p) => p.token)),
    commitTick,
    energy: {
      extraPunchCount: extras.length,
      totalImpact: Math.round(totalImpact * 100) / 100,
      averageVelocity: Math.round((totalImpact / punches.length) * 100) / 100,
    },
  }
}

// ---------------------------------------------------------------------------
// Resolution (amendment 5): abstract motif + the cell sounding AT the commit.
// ---------------------------------------------------------------------------

export interface CompiledTechniqueMotif {
  motifId: string
  sourceStrikeEventIds: readonly string[]
  sourceTokens: readonly StrikeToken[]
  /** The cell sounding at the RESOLUTION commit — never the first punch's. */
  resolvedHarmonicCellId: string
  resolvedPoolIndices: readonly number[]
  octaveOffsets: readonly number[]
  accentValues: readonly number[]
  gateMultipliers: readonly number[]
  family: StrikeFamily | 'mixed'
  commitTick: number
  expiresAtTick: number
}

export interface ResolveMotifOptions {
  cellId: string
  /** Ticks the motif stays valid after its commit (one pulse by default). */
  lifetimeTicks?: number
}

/**
 * Resolve an abstract motif against a sounding cell.
 *
 * Group-member rotation (the flagged reading): repeated `advance` visits to
 * a group alternate its members, so the design's two `C` steps become the
 * third and then the color tone. `skip` always takes the group's leap tone;
 * `reverse` pivots on the group's last emitted tone.
 */
export function resolveTechniqueMotif(
  abstract: AbstractTechniqueMotif,
  options: ResolveMotifOptions,
): CompiledTechniqueMotif {
  const advanceVisits: Record<string, number> = {}
  const lastEmitted: Record<string, number> = {}
  const poolIndices: number[] = []
  const octaveOffsets: number[] = []
  const gateMultipliers: number[] = []
  const accents: number[] = []
  let phraseOctave = 0
  let lastIndex = 0
  let octaveJumpUsed = false

  abstract.operations.forEach((op, i) => {
    const accent = abstract.accentValues[i] ?? 0.5
    switch (op.kind) {
      case 'lower-inversion':
        // No step of its own — it darkens and lowers what follows.
        phraseOctave = -1
        return
      case 'advance': {
        const members = GROUP_MEMBERS[op.group]
        const visit = advanceVisits[op.group] ?? 0
        advanceVisits[op.group] = visit + 1
        lastIndex = members[visit % members.length] ?? members[0]
        lastEmitted[op.group] = lastIndex
        poolIndices.push(lastIndex)
        octaveOffsets.push(phraseOctave)
        gateMultipliers.push(1)
        accents.push(accent)
        return
      }
      case 'skip': {
        // The group's LEAP tone — a decisive move, longer gate.
        lastIndex = GROUP_MEMBERS[op.group][1]
        lastEmitted[op.group] = lastIndex
        poolIndices.push(lastIndex)
        octaveOffsets.push(phraseOctave)
        gateMultipliers.push(1.15)
        accents.push(accent)
        return
      }
      case 'reverse': {
        // The pendulum pivot: re-sound the tone this group last left.
        lastIndex = lastEmitted[op.group] ?? GROUP_MEMBERS[op.group][0]
        poolIndices.push(lastIndex)
        octaveOffsets.push(phraseOctave)
        gateMultipliers.push(1.25) // hooks sit wider
        accents.push(accent)
        return
      }
      case 'land': {
        lastIndex = ROLE_SLOT[op.role]
        // A landing belongs to whichever group owns that slot.
        for (const [group, members] of Object.entries(GROUP_MEMBERS)) {
          if (members.includes(lastIndex)) lastEmitted[group] = lastIndex
        }
        poolIndices.push(lastIndex)
        octaveOffsets.push(phraseOctave)
        gateMultipliers.push(1.3) // land firmly
        accents.push(Math.min(1, accent * 1.1))
        return
      }
      case 'octave-pulse': {
        // Rule 6: AT MOST ONE octave jump per phrase. A second uppercut in
        // the same phrase still sounds — it just stays in register rather
        // than stacking octaves.
        const jump = octaveJumpUsed ? 0 : op.octave
        if (!octaveJumpUsed) octaveJumpUsed = true
        poolIndices.push(lastIndex)
        octaveOffsets.push(phraseOctave + jump)
        gateMultipliers.push(0.85) // a brief pulse
        accents.push(accent)
        return
      }
    }
  })

  // Rule 8: a phrase ENDS on a stable tone. A contour that would drift to
  // a colour or extension is landed on the nearest stable slot — the
  // phrase keeps its shape and gains a resolution rather than trailing off.
  const finalIndex = poolIndices[poolIndices.length - 1]
  if (finalIndex !== undefined && !STABLE_SLOTS.includes(finalIndex)) {
    // Prefer a landing that does not simply repeat the tone before it — a
    // rising phrase resolves upward to the anchor rather than sagging back
    // onto the note it just left.
    const previous = poolIndices[poolIndices.length - 2]
    const candidates = STABLE_SLOTS.filter((slot) => slot !== previous)
    const pool = candidates.length > 0 ? candidates : STABLE_SLOTS
    const nearest = pool.reduce((best, slot) =>
      Math.abs(slot - finalIndex) < Math.abs(best - finalIndex) ? slot : best,
    )
    poolIndices[poolIndices.length - 1] = nearest
    gateMultipliers[gateMultipliers.length - 1] = 1.3 // it is a landing now
  }

  const lifetime = options.lifetimeTicks ?? 960
  return {
    motifId: abstract.motifId,
    sourceStrikeEventIds: abstract.sourceStrikeEventIds,
    sourceTokens: abstract.sourceTokens,
    resolvedHarmonicCellId: options.cellId,
    resolvedPoolIndices: poolIndices,
    octaveOffsets,
    accentValues: accents.map((a) => Math.round(a * 100) / 100),
    gateMultipliers,
    family: abstract.family,
    commitTick: abstract.commitTick,
    expiresAtTick: abstract.commitTick + lifetime,
  }
}

/** Rule 5/10 helper: does this motif stay inside the six-tone pool? */
export function motifStaysInPool(motif: CompiledTechniqueMotif): boolean {
  return motif.resolvedPoolIndices.every((i) => i >= 0 && i <= 5)
}

/** Rule 8: a phrase ends on a stable tone (root, fifth, or upper anchor). */
export function endsOnStableTone(motif: CompiledTechniqueMotif): boolean {
  const last = motif.resolvedPoolIndices[motif.resolvedPoolIndices.length - 1]
  return last === ROLE_SLOT.root || last === ROLE_SLOT.fifth || last === ROLE_SLOT['upper-anchor']
}
