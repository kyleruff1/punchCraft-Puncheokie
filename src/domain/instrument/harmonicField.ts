/**
 * The Harmonic Field — annotation and navigation layer OVER the brass cube
 * (harmonic-field-v2 §§1-10, foundation slice M40-16, amended per Kyle's
 * plan review). The field never computes pools or bass notes: it embeds the
 * existing CompiledBrassCubeMap (the single lift engine stays
 * `rotateAscending`) and adds what v2 needs — tension-ordered nodes with
 * STABLE chord ids, validated tone-role groups, the edge graph, and the
 * exhaustive-min-cost voice-leading table. The dense movement-projection
 * table is deliberately DEFERRED to the telegraphing phases (its dimensions
 * depend on the not-yet-final gesture grammar).
 *
 * Identity discipline (review amendment 4):
 *   worldManifestHash  — mapHashOf(section): authored source identity.
 *   FIELD_COMPILER_VERSION — semantic compilation rules identity.
 *   compiledFieldHash  — mapHashOf(normalized compiled output): the RUNTIME
 *                        compatibility identity (a layout-only refactor
 *                        keeps it; a semantics change moves it).
 *   effectivePatchHash — the patch hash (the section rides in the patch),
 *                        carried by the existing mapHash plumbing.
 *
 * Voice-leading invariant (review amendment 5 / §10 scope): the table maps
 * NATURAL pools node-to-node; right-hand rotation is applied AFTER voice
 * leading and never redefines pool-slot identity — so 6×6 node pairs are
 * sufficient and cell-pair (36×36) tables are unnecessary.
 *
 * Pure and deterministic: no clocks, no randomness, no RN imports
 * (domainPurity). Same section → byte-identical field.
 */
import {
  brassCellAt,
  DORIAN_CHORD_BANK,
  type BrassChordDefinition,
  type CompiledBrassCubeMap,
} from './brassCube'
import { mapHashOf } from './gestureSchema'

/** Bump when compilation SEMANTICS change (not on layout refactors). */
export const FIELD_COMPILER_VERSION = 'field-compiler-1'

/** Musical job of one pool slot (v2 §6 — roles, not array positions). */
export type ToneRole = 'root' | 'third' | 'fifth' | 'color' | 'extension' | 'upper-anchor'

export type StabilityCategory = 'home' | 'stable' | 'motion' | 'tension'

export type MovementClass = 'stay' | 'resolve' | 'step' | 'skip' | 'tension' | 'release'

/** Surface resolutions the TYPE knows; a patch exposes a capability subset. */
export type FreedomProfileId = 'safe-3x3' | 'guided-4x4' | 'full-6x6'

export type NavigationMode = 'absolute' | 'orbit'

export type CommitWindowMs = 250 | 500 | 1000

/** Right-axis role bands (v2 §6): Foundation / Color / Air. */
export type ToneRoleGroupId = 'foundation' | 'color' | 'air'

export interface ToneRoleGroup {
  group: ToneRoleGroupId
  /** Natural-pool slots in this band, ascending. */
  poolIndices: readonly number[]
}

/**
 * One annotated chord node. `chordId` is the STABLE identity (sample
 * routing, edges, voice-leading keys); `chord` embeds the immutable chord
 * data by value so the manifest hash covers it transitively.
 */
export interface HarmonicNode {
  /** Stable id — never a display label ('dm9' …). */
  chordId: string
  displayName: string
  chord: BrassChordDefinition
  /** Slot in the RENDERED tablet bank (v1 zone order) for this chord. */
  legacySampleBankSlot: number
  /** 0 = home … 1 = maximum modal tension (v2 §5 table). */
  tension01: number
  stability: StabilityCategory
  /** Role per NATURAL-pool slot, ascending (root is always slot 0). */
  toneRoles: readonly [ToneRole, ToneRole, ToneRole, ToneRole, ToneRole, ToneRole]
  /** Explicit right-axis grouping — validated at compile, never inferred. */
  toneRoleGroups: readonly [ToneRoleGroup, ToneRoleGroup, ToneRoleGroup]
}

/** One movement in the field graph. Legality is a FREEDOM FLOOR, not a cost. */
export interface HarmonicEdge {
  from: string
  to: string
  movementClass: MovementClass
  tensionDelta: number
  bassLeapSemitones: number
  /** Ordinal freedom floor: 0 safe · 1 guided · 2 full. */
  minimumFreedom: 0 | 1 | 2
  /** Finite always; compared only among edges legal at the active freedom. */
  cost: number
}

/** What a field patch actually supports this slice (review amendment 3). */
export interface HarmonicFieldCapabilities {
  supportedFreedomModes: readonly FreedomProfileId[]
  supportedNavigationModes: readonly NavigationMode[]
  supportedOutputs: readonly ('bridge' | 'tablet' | 'both')[]
}

/** The harmonic-field section a PunchPatch may carry (patch DATA). */
export interface HarmonicFieldSection {
  worldId: string
  /** TENSION ORDER — must equal the patch's brassCube.leftChordBank order. */
  nodes: readonly HarmonicNode[]
  edges: readonly HarmonicEdge[]
  capabilities: HarmonicFieldCapabilities
  freedom: FreedomProfileId
  navigation: NavigationMode
  /** Harmonic commit grid (v2 §12) as a UI value; ticks are compiled. */
  commitWindowMs: CommitWindowMs
}

/** 60 BPM master pulse = 960 transport ticks (review amendment 1). */
export const TRANSPORT_TICKS_PER_BEAT = 960

/** Compile a commit window into transport ticks: 250→240, 500→480, 1000→960. */
export function commitIntervalTicksOf(windowMs: CommitWindowMs): 240 | 480 | 960 {
  return ((windowMs / 1000) * TRANSPORT_TICKS_PER_BEAT) as 240 | 480 | 960
}

const UNIFORM_ROLES: HarmonicNode['toneRoles'] = [
  'root',
  'third',
  'fifth',
  'color',
  'extension',
  'upper-anchor',
]

/** Foundation {root, fifth} · Color {third, color} · Air {extension, anchor}. */
const UNIFORM_ROLE_GROUPS: HarmonicNode['toneRoleGroups'] = [
  { group: 'foundation', poolIndices: [0, 2] },
  { group: 'color', poolIndices: [1, 3] },
  { group: 'air', poolIndices: [4, 5] },
]

function bankChord(name: string): BrassChordDefinition {
  const chord = DORIAN_CHORD_BANK.find((c) => c.name === name)
  if (!chord) throw new Error(`harmonicField: no legacy bank chord named "${name}"`)
  return chord
}

/** The rendered tablet bank's slot per chord (v1 zone order — see manifest). */
const LEGACY_BANK_SLOTS: Readonly<Record<string, number>> = {
  'Dm9': 0,
  'F6/9': 1,
  'G9': 2,
  'Am11': 3,
  'C6/9': 4,
  'Dm11': 5,
}

function node(
  chordId: string,
  name: string,
  tension01: number,
  stability: StabilityCategory,
): HarmonicNode {
  const chord = bankChord(name)
  const legacySampleBankSlot = LEGACY_BANK_SLOTS[name]
  if (legacySampleBankSlot === undefined) {
    throw new Error(`harmonicField: no legacy bank slot for "${name}"`)
  }
  return {
    chordId,
    displayName: name,
    chord,
    legacySampleBankSlot,
    tension01,
    stability,
    toneRoles: UNIFORM_ROLES,
    toneRoleGroups: UNIFORM_ROLE_GROUPS,
  }
}

/**
 * The tension-ordered D Dorian nodes (v2 §5): Dm9 .00 → Dm11 .15 → F6/9 .32
 * → Am11 .48 → C6/9 .68 → G9 .90.
 */
export const TENSION_ORDERED_DORIAN_NODES: readonly HarmonicNode[] = [
  node('dm9', 'Dm9', 0.0, 'home'),
  node('dm11', 'Dm11', 0.15, 'stable'),
  node('f69', 'F6/9', 0.32, 'motion'),
  node('am11', 'Am11', 0.48, 'motion'),
  node('c69', 'C6/9', 0.68, 'tension'),
  node('g9', 'G9', 0.9, 'tension'),
]

/** The tension-ordered bank — the SAME six chord objects, v2 order. */
export const TENSION_ORDERED_CHORD_BANK: readonly BrassChordDefinition[] =
  TENSION_ORDERED_DORIAN_NODES.map((n) => n.chord)

function bassOf(chord: BrassChordDefinition): number {
  return Math.max(24, 48 + chord.rootPitchClass - 24)
}

/**
 * The full ordered-pair edge set (36 incl. self 'stay'), generated
 * deterministically from the ladder. minimumFreedom follows the §11
 * bass-leap ladder (safe ≤7 st, guided ≤9, else full).
 */
function buildDorianEdges(nodes: readonly HarmonicNode[]): readonly HarmonicEdge[] {
  const edges: HarmonicEdge[] = []
  nodes.forEach((from, fromIndex) => {
    nodes.forEach((to, toIndex) => {
      const tensionDelta = to.tension01 - from.tension01
      const bassLeapSemitones = Math.abs(bassOf(to.chord) - bassOf(from.chord))
      let movementClass: MovementClass
      if (fromIndex === toIndex) movementClass = 'stay'
      else if (to.stability === 'home') movementClass = 'resolve'
      else if (tensionDelta >= 0.3) movementClass = 'tension'
      else if (tensionDelta <= -0.3) movementClass = 'release'
      else if (Math.abs(fromIndex - toIndex) === 1) movementClass = 'step'
      else movementClass = 'skip'
      const minimumFreedom: 0 | 1 | 2 = bassLeapSemitones <= 7 ? 0 : bassLeapSemitones <= 9 ? 1 : 2
      const cost =
        movementClass === 'stay'
          ? 0
          : Math.round(10 + 40 * Math.abs(tensionDelta) + 5 * bassLeapSemitones)
      edges.push({
        from: from.chordId,
        to: to.chordId,
        movementClass,
        tensionDelta: Math.round(tensionDelta * 100) / 100,
        bassLeapSemitones,
        minimumFreedom,
        cost,
      })
    })
  })
  return edges
}

export const DORIAN_EDGES: readonly HarmonicEdge[] = buildDorianEdges(TENSION_ORDERED_DORIAN_NODES)

/** This slice's capability envelope (review amendment 3): BRIDGE only. */
export const FOUNDATION_CAPABILITIES: HarmonicFieldCapabilities = {
  supportedFreedomModes: ['safe-3x3', 'full-6x6'],
  supportedNavigationModes: ['absolute', 'orbit'],
  supportedOutputs: ['bridge'],
}

/** The "Recommended starting configuration" section (v2 final table). */
export const DORIAN_HARMONIC_FIELD_SECTION: HarmonicFieldSection = {
  worldId: 'dorian-brass',
  nodes: TENSION_ORDERED_DORIAN_NODES,
  edges: DORIAN_EDGES,
  capabilities: FOUNDATION_CAPABILITIES,
  freedom: 'safe-3x3',
  navigation: 'orbit',
  commitWindowMs: 500,
}

// ---------------------------------------------------------------------------
// Compilation
// ---------------------------------------------------------------------------

/** One annotated cell — the field's view over a CompiledBrassCubeCell. */
export interface HarmonicFieldCell {
  cellId: string
  x: number
  y: number
  chordId: string
  toneRole: ToneRole
  bassNote: number
  entryTone: number
  arpPool: readonly number[]
  tension01: number
  /** Cool→warm with tension (v2 §26 "color temperature = harmonic tension"). */
  colorHue: number
}

export interface CompiledHarmonicField {
  schemaVersion: 1
  patchId: string
  /** One-map invariant: equals the brass/cube compile of the SAME patch. */
  patchHash: string
  /** Authored source identity — caching/provenance, NOT runtime compat. */
  worldManifestHash: string
  compilerVersion: string
  /** RUNTIME compatibility identity: normalized compiled musical output. */
  compiledFieldHash: string
  section: HarmonicFieldSection
  brass: CompiledBrassCubeMap
  /** 36, row-major cells[x*6 + y] — same convention as the brass map. */
  cells: readonly HarmonicFieldCell[]
  /** 'fromChordId>toChordId' → target MIDI note per NATURAL-pool slot (6). */
  voiceLeadingTable: Readonly<Record<string, readonly number[]>>
}

function hueOf(tension01: number): number {
  // 210 (cool blue) at rest → 10 (hot red) at maximum modal tension.
  return Math.round(210 - 200 * Math.max(0, Math.min(1, tension01)))
}

function pitchClassOf(note: number): number {
  return ((note % 12) + 12) % 12
}

/** All 720 permutations of [0..5], generated deterministically (lex order). */
function permutations6(): number[][] {
  const out: number[][] = []
  const slots = [0, 1, 2, 3, 4, 5]
  const walk = (prefix: number[], rest: number[]): void => {
    if (rest.length === 0) {
      out.push(prefix)
      return
    }
    for (let i = 0; i < rest.length; i += 1) {
      walk([...prefix, rest[i] ?? 0], [...rest.slice(0, i), ...rest.slice(i + 1)])
    }
  }
  walk([], slots)
  return out
}

const ALL_PERMUTATIONS = permutations6()

/**
 * Voice-lead one NATURAL pool into another (v2 §11 rule 4, amended): a
 * GLOBAL minimum-cost one-to-one assignment over all 720 permutations —
 * never greedy. Cost prefers exact common notes, then common pitch classes
 * in a near register, then small movement; crossings are penalized (not
 * forbidden — a pinned common tone may justify one); ties break to the
 * lexicographically smallest permutation, so the result is deterministic.
 * "Retained" in the goldens means EXACT MIDI note when the note exists in
 * both pools; otherwise the pitch class lands in the nearest register.
 */
export function voiceLeadPool(
  fromPool: readonly number[],
  toPool: readonly number[],
): readonly number[] {
  let best: number[] | null = null
  let bestCost = Number.MAX_SAFE_INTEGER
  for (const perm of ALL_PERMUTATIONS) {
    let cost = 0
    for (let slot = 0; slot < 6; slot += 1) {
      const fromNote = fromPool[slot] ?? 0
      const toNote = toPool[perm[slot] ?? 0] ?? 0
      const distance = Math.abs(toNote - fromNote)
      if (toNote === fromNote) {
        cost -= 40 // exact common tone: strongly preferred
      } else if (pitchClassOf(toNote) === pitchClassOf(fromNote)) {
        cost += distance // same class, register drift only
      } else {
        cost += 4 * distance // real movement
      }
    }
    // Crossing penalty: target order should follow source order.
    for (let a = 0; a < 6; a += 1) {
      for (let b = a + 1; b < 6; b += 1) {
        const ta = toPool[perm[a] ?? 0] ?? 0
        const tb = toPool[perm[b] ?? 0] ?? 0
        if (ta > tb) cost += 25
      }
    }
    if (cost < bestCost) {
      bestCost = cost
      best = perm
    }
  }
  const chosen = best ?? [0, 1, 2, 3, 4, 5]
  return chosen.map((targetSlot) => toPool[targetSlot] ?? 0)
}

/** Validate one node's role groups (review amendment: never inferred). */
function validateRoleGroups(node: HarmonicNode): void {
  const seen = new Set<number>()
  for (const group of node.toneRoleGroups) {
    if (group.poolIndices.length !== 2) {
      throw new Error(
        `node ${node.chordId} group ${group.group} needs exactly 2 members this slice, got ${group.poolIndices.length}`,
      )
    }
    for (const index of group.poolIndices) {
      if (index < 0 || index > 5) {
        throw new Error(`node ${node.chordId} group ${group.group} slot ${index} out of range`)
      }
      if (seen.has(index)) {
        throw new Error(`node ${node.chordId} slot ${index} appears in two role groups`)
      }
      seen.add(index)
    }
  }
  if (seen.size !== 6) {
    throw new Error(`node ${node.chordId} role groups cover ${seen.size}/6 pool slots`)
  }
}

/**
 * Compile the field around an already-compiled brass map. Throws when the
 * section's node order disagrees with the brass bank order — order
 * agreement is an invariant, not a convention.
 */
export function compileHarmonicField(
  patchId: string,
  section: HarmonicFieldSection,
  brass: CompiledBrassCubeMap,
): CompiledHarmonicField {
  if (section.nodes.length !== 6) {
    throw new Error(`harmonic field needs 6 nodes, got ${section.nodes.length}`)
  }
  section.nodes.forEach((n, i) => {
    const compiledName = brassCellAt(brass, i, 0).chordName
    if (n.chord.name !== compiledName) {
      throw new Error(
        `field node ${i} is ${n.chord.name} but the brass bank compiled ${compiledName} — orders must agree`,
      )
    }
    validateRoleGroups(n)
  })

  const cells: HarmonicFieldCell[] = []
  for (let x = 0; x < 6; x += 1) {
    const n = section.nodes[x]
    if (!n) throw new Error(`harmonic field missing node ${x}`)
    for (let y = 0; y < 6; y += 1) {
      const brassCell = brassCellAt(brass, x, y)
      cells.push({
        cellId: brassCell.cellId,
        x,
        y,
        chordId: n.chordId,
        toneRole: n.toneRoles[y] ?? 'root',
        bassNote: brassCell.bassMidiNote,
        entryTone: brassCell.startMidiNote,
        arpPool: brassCell.rotatedPool,
        tension01: n.tension01,
        colorHue: hueOf(n.tension01),
      })
    }
  }

  const voiceLeadingTable: Record<string, readonly number[]> = {}
  section.nodes.forEach((from, fi) => {
    const fromPool = brassCellAt(brass, fi, 0).naturalPool
    section.nodes.forEach((to, ti) => {
      const toPool = brassCellAt(brass, ti, 0).naturalPool
      voiceLeadingTable[`${from.chordId}>${to.chordId}`] = voiceLeadPool(fromPool, toPool)
    })
  })

  // The runtime-compat identity: NORMALIZED musical output (nodes' musical
  // identity, every cell, role groups, legal edges, the VL table) + the
  // compiler version. Layout refactors that keep this object equal keep
  // the hash; semantic changes move it.
  const compiledFieldHash = mapHashOf({
    compilerVersion: FIELD_COMPILER_VERSION,
    nodes: section.nodes.map((n) => ({
      chordId: n.chordId,
      root: n.chord.rootPitchClass,
      toneClasses: n.chord.toneClasses,
      bankSlot: n.legacySampleBankSlot,
      tension01: n.tension01,
      roles: n.toneRoles,
      groups: n.toneRoleGroups,
    })),
    cells: cells.map((c) => ({
      id: c.cellId,
      chordId: c.chordId,
      bass: c.bassNote,
      entry: c.entryTone,
      pool: c.arpPool,
    })),
    edges: section.edges,
    voiceLeading: voiceLeadingTable,
    freedom: section.freedom,
    navigation: section.navigation,
    commitIntervalTicks: commitIntervalTicksOf(section.commitWindowMs),
  })

  return {
    schemaVersion: 1,
    patchId,
    patchHash: brass.patchHash,
    worldManifestHash: mapHashOf(section),
    compilerVersion: FIELD_COMPILER_VERSION,
    compiledFieldHash,
    section,
    brass,
    cells,
    voiceLeadingTable,
  }
}

/** Cell lookup, both axes clamped — mirrors brassCellAt. */
export function fieldCellAt(
  field: CompiledHarmonicField,
  x: number,
  y: number,
): HarmonicFieldCell {
  const cx = Math.max(0, Math.min(5, x))
  const cy = Math.max(0, Math.min(5, y))
  const cell = field.cells[cx * 6 + cy]
  if (!cell) throw new Error(`harmonic field cell (${cx},${cy}) missing`)
  return cell
}
