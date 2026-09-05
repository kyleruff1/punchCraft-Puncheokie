/**
 * Compile a brass-cube patch section into the CompiledBrassCubeMap — the
 * single 36-cell mapping MIDI, cube visual, and recorder all share
 * (brass-cube-design "Suggested compiled cube structure"). Pools, rotations,
 * and bass notes are computed HERE, once, at compile time; the gesture
 * compiler and the bridge only replay the numbers.
 *
 * Pure and deterministic: same patch → byte-identical map, and
 * patchHash = mapHashOf(patch) — the SAME value compilePunchPatch computes
 * for the same patch — so hello/gesture hashes agree with no new plumbing.
 */
import type { ArpeggiatorBackend, RetriggerPolicy } from './gestureSchema'
import { mapHashOf } from './gestureSchema'
// Type-only, elided at runtime — punchPatch imports values back from here.
import type { PunchPatch } from './punchPatch'

export type BrassZone = 0 | 1 | 2 | 3 | 4 | 5

export type ArpPatternId = 'up' | 'down' | 'fanfare' | 'pendulum' | 'punch-weave'

/**
 * One row of the left-hand chord bank. `toneClasses` are the SIX pitch
 * classes of the design table row, in listed order, root first — a trailing
 * X′ upper root is just the root's class again (Dm9 = [2,5,9,0,4,2]); the
 * ascending-lift rule places it in the right octave with no special case.
 */
export interface BrassChordDefinition {
  name: string
  rootPitchClass: number
  toneClasses: readonly [number, number, number, number, number, number]
}

/** One rung of the activity ladder (design "Activity controls speed"). */
export interface BrassActivityLayer {
  layer: 0 | 1 | 2 | 3
  notesPerMinute: 60 | 120 | 180 | 240
  gateRatio: number
  patternDepth: number
  lfoDepth: number
  wahMultiplier: number
  transientMultiplier: number
}

/** The brass-cube section a PunchPatch may carry (patch data, not code). */
export interface BrassCubeSection {
  leftChordBank: readonly BrassChordDefinition[]
  patternId: ArpPatternId
  activityLayers: readonly [
    BrassActivityLayer,
    BrassActivityLayer,
    BrassActivityLayer,
    BrassActivityLayer,
  ]
  arpBackend: ArpeggiatorBackend
  retrigger: RetriggerPolicy
  /** Doc-numbered MIDI channels (1-based; the bridge converts to wire). */
  bassMidiChannel: number
  arpMidiChannel: number
  accentMidiChannel: number
  accentGateMs: number
}

/** Pattern indices index the ROTATED pool (applied after rotation). */
export const ARP_PATTERNS: Record<ArpPatternId, readonly number[]> = {
  up: [0, 1, 2, 3, 4, 5],
  down: [5, 4, 3, 2, 1, 0],
  fanfare: [0, 2, 4, 1, 3, 5],
  pendulum: [0, 2, 4, 5, 3, 1],
  'punch-weave': [0, 2, 1, 3, 2, 4, 3, 5],
}

/** The D Dorian chord bank, one chord per left zone (design table). */
export const DORIAN_CHORD_BANK: readonly BrassChordDefinition[] = [
  { name: 'Dm9', rootPitchClass: 2, toneClasses: [2, 5, 9, 0, 4, 2] },
  { name: 'F6/9', rootPitchClass: 5, toneClasses: [5, 9, 0, 2, 7, 5] },
  { name: 'G9', rootPitchClass: 7, toneClasses: [7, 11, 2, 5, 9, 7] },
  { name: 'Am11', rootPitchClass: 9, toneClasses: [9, 0, 4, 7, 2, 9] },
  { name: 'C6/9', rootPitchClass: 0, toneClasses: [0, 4, 7, 9, 2, 0] },
  { name: 'Dm11', rootPitchClass: 2, toneClasses: [2, 5, 9, 0, 4, 7] },
]

/**
 * The activity ladder: rate/gate/depth per the design's tables (gate 0.45
 * pins "42–48%", patternDepth 3 pins "first 2–3 notes"); lfoDepth reuses
 * the established energy-layer ladder. lfoDepth/wahMultiplier are carried
 * for the DAW/visual future — at launch only notesPerMinute/gateRatio/
 * patternDepth/transientMultiplier are load-bearing.
 */
export const BRASS_ACTIVITY_LAYERS = [
  {
    layer: 0,
    notesPerMinute: 60,
    gateRatio: 0.75,
    patternDepth: 3,
    lfoDepth: 0.05,
    wahMultiplier: 0.8,
    transientMultiplier: 0.8,
  },
  {
    layer: 1,
    notesPerMinute: 120,
    gateRatio: 0.65,
    patternDepth: 4,
    lfoDepth: 0.2,
    wahMultiplier: 1.0,
    transientMultiplier: 1.0,
  },
  {
    layer: 2,
    notesPerMinute: 180,
    gateRatio: 0.55,
    patternDepth: 6,
    lfoDepth: 0.45,
    wahMultiplier: 1.15,
    transientMultiplier: 1.1,
  },
  {
    layer: 3,
    notesPerMinute: 240,
    gateRatio: 0.45,
    patternDepth: 8,
    lfoDepth: 0.75,
    wahMultiplier: 1.3,
    transientMultiplier: 1.2,
  },
] as const satisfies BrassCubeSection['activityLayers']

/** The "Recommended first build" section, verbatim from the design. */
export const DORIAN_BRASS_CUBE_SECTION: BrassCubeSection = {
  leftChordBank: DORIAN_CHORD_BANK,
  patternId: 'punch-weave',
  activityLayers: BRASS_ACTIVITY_LAYERS,
  arpBackend: 'punchbridge-tick',
  retrigger: 'quantized-rotate',
  bassMidiChannel: 2,
  arpMidiChannel: 3,
  accentMidiChannel: 4,
  accentGateMs: 120,
}

/**
 * Kyle's deterministic rotation primitive, verbatim from the design doc:
 * walk the list cyclically from `startIndex`, lifting each note by +12
 * until it clears its predecessor. The single lift engine — every pool
 * and rotation below goes through it.
 */
export function rotateAscending(notes: readonly number[], startIndex: number): number[] {
  if (notes.length === 0) {
    throw new Error('Cannot rotate an empty note pool')
  }

  const result: number[] = []
  let previous = Number.NEGATIVE_INFINITY

  for (let offset = 0; offset < notes.length; offset += 1) {
    const sourceIndex = (startIndex + offset) % notes.length

    let note = notes[sourceIndex] ?? 0

    while (note <= previous) {
      note += 12
    }

    result.push(note)
    previous = note
  }

  return result
}

/**
 * The natural six-note pool: root placed in the scientific octave-3
 * register (C3=48 … B3=59, the register holding the Dm9 anchor D3=50),
 * then every listed tone lifted to the smallest MIDI note of its class
 * strictly above its predecessor. Dm9 → [50,53,57,60,64,74] (R3 golden).
 */
export function naturalPoolOf(chord: BrassChordDefinition): number[] {
  return rotateAscending([48 + chord.rootPitchClass, ...chord.toneClasses.slice(1)], 0)
}

function pitchClassOf(note: number): number {
  return ((note % 12) + 12) % 12
}

/**
 * Rotate the pool so the selected tone is the lowest note (design
 * "Rotating the arpeggio to the selected start note"). NOT Kyle's literal
 * 6-note rotation — that would emit D6 F6 atop his own zone-2 worked
 * example; the example wins (R3). Instead: dedupe the pool's pitch classes
 * keeping first occurrence, walk that class cycle from the selected slot's
 * class, and ascending-lift from the selected note. rotatedPool[0] is
 * always naturalPool[startIndex].
 */
export function rotatedPoolOf(naturalPool: readonly number[], startIndex: number): number[] {
  const classes: number[] = []
  for (const note of naturalPool) {
    const pc = pitchClassOf(note)
    if (!classes.includes(pc)) classes.push(pc)
  }
  const start = naturalPool[startIndex]
  if (start === undefined) throw new Error(`rotatedPoolOf: no pool slot ${startIndex}`)
  const s = classes.indexOf(pitchClassOf(start))
  const seq: number[] = []
  for (let k = 1; k <= 5; k += 1) {
    seq.push(classes[(s + k) % classes.length] ?? 0)
  }
  return rotateAscending([start, ...seq], 0)
}

/**
 * Held bass = chord root two octaves below the pool root, floor-clamped to
 * C1=24 for Mojito's register (clamp inactive for the launch bank).
 */
export function bassNoteOf(pool: readonly number[]): number {
  return Math.max(24, (pool[0] ?? 24) - 24)
}

/** Step interval for a rate — exact float (333.33…), never a rounded constant. */
export function stepMsFor(notesPerMinute: number): number {
  return 60000 / notesPerMinute
}

/** One compiled X/Y harmonic state (design's sketch, verbatim fields). */
export interface CompiledBrassCubeCell {
  cellId: string
  leftZone: BrassZone
  rightZone: BrassZone
  chordName: string
  bassMidiNote: number
  naturalPool: readonly number[]
  rotatedPool: readonly number[]
  startIndex: BrassZone
  startMidiNote: number
  arpPattern: readonly number[]
}

export interface CompiledBrassCubeMap {
  schemaVersion: 1
  patchId: string
  patchHash: string
  zoneCount: 6
  /** 36, row-major cells[leftZone*6 + rightZone] (cubeCompiler convention). */
  cells: readonly CompiledBrassCubeCell[]
  pattern: readonly number[]
  patternId: ArpPatternId
  activityLayers: BrassCubeSection['activityLayers']
  arpBackend: ArpeggiatorBackend
  retrigger: RetriggerPolicy
  bassMidiChannel: number
  arpMidiChannel: number
  accentMidiChannel: number
  accentGateMs: number
}

const BRASS_ZONES: readonly BrassZone[] = [0, 1, 2, 3, 4, 5]

export function compileBrassCube(patch: PunchPatch): CompiledBrassCubeMap {
  const section = patch.brassCube
  if (!section) throw new Error(`patch "${patch.id}" has no brassCube section`)
  if (patch.zoneCount !== 6) {
    throw new Error(`brass cube needs zoneCount 6, got ${patch.zoneCount}`)
  }
  if (section.leftChordBank.length !== 6) {
    throw new Error(`brass chord bank needs 6 chords, got ${section.leftChordBank.length}`)
  }

  const pattern = ARP_PATTERNS[section.patternId]
  const cells: CompiledBrassCubeCell[] = []

  for (const leftZone of BRASS_ZONES) {
    const chord = section.leftChordBank[leftZone]
    if (!chord) throw new Error(`brass chord bank missing zone ${leftZone}`)
    const naturalPool = naturalPoolOf(chord)
    const bassMidiNote = bassNoteOf(naturalPool)
    for (const rightZone of BRASS_ZONES) {
      const rotatedPool = rotatedPoolOf(naturalPool, rightZone)
      cells.push({
        cellId: `L${leftZone}R${rightZone}`,
        leftZone,
        rightZone,
        chordName: chord.name,
        bassMidiNote,
        naturalPool,
        rotatedPool,
        startIndex: rightZone,
        startMidiNote: rotatedPool[0] ?? naturalPool[0] ?? 0,
        arpPattern: pattern,
      })
    }
  }

  return {
    schemaVersion: 1,
    patchId: patch.id,
    patchHash: mapHashOf(patch),
    zoneCount: 6,
    cells,
    pattern,
    patternId: section.patternId,
    activityLayers: section.activityLayers,
    arpBackend: section.arpBackend,
    retrigger: section.retrigger,
    bassMidiChannel: section.bassMidiChannel,
    arpMidiChannel: section.arpMidiChannel,
    accentMidiChannel: section.accentMidiChannel,
    accentGateMs: section.accentGateMs,
  }
}

/** Cell lookup with both axes clamped to 0..5, like cubeCompiler's cellAt. */
export function brassCellAt(
  map: CompiledBrassCubeMap,
  leftZone: number,
  rightZone: number,
): CompiledBrassCubeCell {
  const clampedLeft = Math.max(0, Math.min(5, leftZone))
  const clampedRight = Math.max(0, Math.min(5, rightZone))
  const cell = map.cells[clampedLeft * 6 + clampedRight]
  if (!cell) throw new Error(`brass cell (${clampedLeft},${clampedRight}) missing`)
  return cell
}
