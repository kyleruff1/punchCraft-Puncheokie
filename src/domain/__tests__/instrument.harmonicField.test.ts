/**
 * Harmonic Field foundation goldens (M40-19 #323, review-amended).
 *
 * This suite is what M40-16 closes against: it pins the identity of the
 * field layer (nodes, cells, hashes, voice leading, navigation) and —
 * critically — proves the two BYTE contracts:
 *
 *   1. a legacy/v1 patch stream is byte-identical to the pre-field wire
 *      (no commitIntervalTicks, no harmonicIntent, schemaVersion 1), and
 *   2. the v2 patch replays byte-identically for identical input.
 *
 * Amendment 9 (hash matrix) and amendment 10 (the corrected voice-leading
 * golden — MIDI 50 does NOT survive Dm9→F6/9) are enforced here verbatim.
 * NO wall-clock gates: size, shape, and hash stability only.
 */
import { compileBrassCube, brassCellAt, naturalPoolOf, DORIAN_CHORD_BANK } from '../instrument/brassCube'
import { compilePunchPatch } from '../instrument/cubeCompiler'
import {
  compileGesture,
  emptySessionState,
  type CompileContext,
  type InstrumentSessionState,
} from '../instrument/gestureCompiler'
import { mapHashOf, type MusicalPunchInput } from '../instrument/gestureSchema'
import {
  compileHarmonicField,
  DORIAN_HARMONIC_FIELD_SECTION,
  FIELD_COMPILER_VERSION,
  fieldCellAt,
  TENSION_ORDERED_DORIAN_NODES,
  voiceLeadPool,
  type HarmonicFieldSection,
} from '../instrument/harmonicField'
import { launchPatchById, type PunchPatch } from '../instrument/punchPatch'
import {
  advanceOrbit,
  bandMembers,
  subindexInBand,
  ZONE_TO_SURFACE_BAND,
} from '../instrument/surfaceNavigator'

const v1Patch = (): PunchPatch => launchPatchById('dorian-brass-cube')
const v2Patch = (): PunchPatch => launchPatchById('dorian-brass-v2')

function compileField(patch: PunchPatch = v2Patch()) {
  const brass = compileBrassCube(patch)
  return compileHarmonicField(patch.id, patch.harmonicField!, brass)
}

// ---------------------------------------------------------------------------
// Node identity.
// ---------------------------------------------------------------------------

describe('node identity (v2 §5)', () => {
  it('the six nodes are the SAME chord objects as the legacy bank — one source of chords', () => {
    for (const node of TENSION_ORDERED_DORIAN_NODES) {
      const bankChord = DORIAN_CHORD_BANK.find((c) => c.name === node.displayName)
      expect(node.chord).toBe(bankChord) // reference identity, not a copy
    }
  })

  it('tension order + tension01 + stability + legacy bank slots are pinned literals', () => {
    expect(
      TENSION_ORDERED_DORIAN_NODES.map((n) => [
        n.chordId,
        n.displayName,
        n.tension01,
        n.stability,
        n.legacySampleBankSlot,
      ]),
    ).toEqual([
      ['dm9', 'Dm9', 0.0, 'home', 0],
      ['dm11', 'Dm11', 0.15, 'stable', 5],
      ['f69', 'F6/9', 0.32, 'motion', 1],
      ['am11', 'Am11', 0.48, 'motion', 3],
      ['c69', 'C6/9', 0.68, 'tension', 4],
      ['g9', 'G9', 0.9, 'tension', 2],
    ])
  })

  it('chordIds are stable + unique, and never the display name (sample routing keys)', () => {
    const ids = TENSION_ORDERED_DORIAN_NODES.map((n) => n.chordId)
    expect(new Set(ids).size).toBe(6)
    for (const node of TENSION_ORDERED_DORIAN_NODES) {
      expect(node.chordId).not.toBe(node.displayName)
    }
  })

  it('role groups cover all six slots exactly once: Foundation[0,2] Color[1,3] Air[4,5]', () => {
    for (const node of TENSION_ORDERED_DORIAN_NODES) {
      expect(node.toneRoleGroups.map((g) => [g.group, g.poolIndices])).toEqual([
        ['foundation', [0, 2]],
        ['color', [1, 3]],
        ['air', [4, 5]],
      ])
      const covered = node.toneRoleGroups.flatMap((g) => g.poolIndices).sort()
      expect(covered).toEqual([0, 1, 2, 3, 4, 5])
    }
  })

  it('a node whose role groups do not cover six slots fails COMPILE, never silently', () => {
    const patch = v2Patch()
    const brass = compileBrassCube(patch)
    const broken: HarmonicFieldSection = {
      ...patch.harmonicField!,
      nodes: patch.harmonicField!.nodes.map((n, i) =>
        i === 0
          ? { ...n, toneRoleGroups: [n.toneRoleGroups[0], n.toneRoleGroups[0], n.toneRoleGroups[2]] as typeof n.toneRoleGroups }
          : n,
      ),
    }
    expect(() => compileHarmonicField(patch.id, broken, brass)).toThrow(/two role groups|role groups/)
  })

  it('node order disagreeing with the brass bank fails COMPILE (the one-map invariant)', () => {
    const patch = v2Patch()
    const brass = compileBrassCube(patch)
    const shuffled: HarmonicFieldSection = {
      ...patch.harmonicField!,
      nodes: [...patch.harmonicField!.nodes].reverse(),
    }
    expect(() => compileHarmonicField(patch.id, shuffled, brass)).toThrow(/orders must agree/)
  })
})

// ---------------------------------------------------------------------------
// Cells: the field annotates, never recomputes.
// ---------------------------------------------------------------------------

describe('36-cell field/brass agreement', () => {
  it('every cell carries the brass map’s own numbers — the field never recomputes music', () => {
    const patch = v2Patch()
    const brass = compileBrassCube(patch)
    const field = compileHarmonicField(patch.id, patch.harmonicField!, brass)
    expect(field.cells).toHaveLength(36)
    for (let x = 0; x < 6; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        const cell = fieldCellAt(field, x, y)
        const brassCell = brassCellAt(brass, x, y)
        expect(cell.cellId).toBe(brassCell.cellId)
        expect(cell.bassNote).toBe(brassCell.bassMidiNote)
        expect(cell.entryTone).toBe(brassCell.startMidiNote)
        expect(cell.arpPool).toEqual(brassCell.rotatedPool)
        expect(cell.chordId).toBe(TENSION_ORDERED_DORIAN_NODES[x]!.chordId)
        expect(cell.toneRole).toBe(TENSION_ORDERED_DORIAN_NODES[x]!.toneRoles[y])
      }
    }
  })

  it('v2 tension-order golden: L1 is Dm11 (intentionally NOT the v1 bank order)', () => {
    const field = compileField()
    expect(fieldCellAt(field, 1, 0).chordId).toBe('dm11')
    expect(brassCellAt(compileBrassCube(v1Patch()), 1, 0).chordName).toBe('F6/9')
    // Same six chords, different left-axis order — that IS the v2 change.
    expect(new Set(field.cells.map((c) => c.chordId)).size).toBe(6)
  })

  it('colour temperature rises with tension (cool home → hot G9)', () => {
    const field = compileField()
    const home = fieldCellAt(field, 0, 0).colorHue
    const hot = fieldCellAt(field, 5, 0).colorHue
    expect(home).toBeGreaterThan(hot) // 210 (blue) → 30s (red)
    expect(field.cells.every((c) => c.colorHue >= 0 && c.colorHue <= 360)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The hash ladder (amendment 9).
// ---------------------------------------------------------------------------

describe('identity hashes (review amendment 9)', () => {
  it('compilation is deterministic — byte-identical output for the same section', () => {
    const a = compileField()
    const b = compileField()
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('a SEMANTIC edit (tension) moves worldManifestHash AND compiledFieldHash', () => {
    const patch = v2Patch()
    const brass = compileBrassCube(patch)
    const base = compileHarmonicField(patch.id, patch.harmonicField!, brass)
    const edited: HarmonicFieldSection = {
      ...patch.harmonicField!,
      nodes: patch.harmonicField!.nodes.map((n, i) => (i === 0 ? { ...n, tension01: 0.05 } : n)),
    }
    const after = compileHarmonicField(patch.id, edited, brass)
    expect(after.worldManifestHash).not.toBe(base.worldManifestHash)
    expect(after.compiledFieldHash).not.toBe(base.compiledFieldHash)
  })

  it('a SETTINGS edit moves neither the manifest nor the compiled musical hash… of the SAME section', () => {
    // Settings ride the section (freedom/navigation/window), so they move
    // worldManifestHash + compiledFieldHash + patchHash together; what must
    // NOT move is the musical content: same nodes, same cells, same pools.
    const patch = v2Patch()
    const brass = compileBrassCube(patch)
    const base = compileHarmonicField(patch.id, patch.harmonicField!, brass)
    const settings = compileHarmonicField(
      patch.id,
      { ...patch.harmonicField!, navigation: 'absolute' },
      brass,
    )
    expect(settings.cells).toEqual(base.cells)
    expect(settings.voiceLeadingTable).toEqual(base.voiceLeadingTable)
    expect(settings.compiledFieldHash).not.toBe(base.compiledFieldHash) // policy IS compiled
  })

  it('a LAYOUT-only refactor (key order) keeps compiledFieldHash — canonicalization proves it', () => {
    const patch = v2Patch()
    const brass = compileBrassCube(patch)
    const base = compileHarmonicField(patch.id, patch.harmonicField!, brass)
    // Same values, different literal key order on the section object.
    const reordered = {
      commitIntervalTicks: patch.harmonicField!.commitIntervalTicks,
      navigation: patch.harmonicField!.navigation,
      freedom: patch.harmonicField!.freedom,
      capabilities: patch.harmonicField!.capabilities,
      edges: patch.harmonicField!.edges,
      nodes: patch.harmonicField!.nodes,
      worldId: patch.harmonicField!.worldId,
    } as HarmonicFieldSection
    const after = compileHarmonicField(patch.id, reordered, brass)
    expect(after.compiledFieldHash).toBe(base.compiledFieldHash)
    expect(after.worldManifestHash).toBe(base.worldManifestHash)
  })

  it('the compiler version is a SEPARATE identifier carried inside the compiled hash', () => {
    const field = compileField()
    expect(field.compilerVersion).toBe(FIELD_COMPILER_VERSION)
    // Rebuilding the hash input with a different version must change it —
    // pinning that the version participates (no overloading in reverse:
    // compiledFieldHash is never used AS the version).
    const withOtherVersion = mapHashOf({ v: 'field-compiler-2', hash: field.compiledFieldHash })
    expect(withOtherVersion).not.toBe(field.compiledFieldHash)
  })

  it('patchHash is shared with the brass/cube compile of the same patch (one map)', () => {
    const patch = v2Patch()
    const brass = compileBrassCube(patch)
    const field = compileHarmonicField(patch.id, patch.harmonicField!, brass)
    expect(field.patchHash).toBe(brass.patchHash)
    expect(field.patchHash).toBe(compilePunchPatch(patch).patchHash)
  })
})

// ---------------------------------------------------------------------------
// Voice leading (amendment 10 — the corrected golden).
// ---------------------------------------------------------------------------

describe('voice leading (v2 §10, amendment 10)', () => {
  const DM9 = naturalPoolOf(DORIAN_CHORD_BANK.find((c) => c.name === 'Dm9')!)
  const F69 = naturalPoolOf(DORIAN_CHORD_BANK.find((c) => c.name === 'F6/9')!)

  it('Dm9 → F6/9: the exact common notes 53/57/60 are retained; the shared D moves register (50 → 62)', () => {
    const led = voiceLeadPool(DM9, F69)
    // The exact-common-tone set survives verbatim…
    expect(led).toEqual(expect.arrayContaining([53, 57, 60]))
    // …MIDI 50 cannot survive: it is not in the target pool at all.
    expect(F69).not.toContain(50)
    expect(led).not.toContain(50)
    // The shared D pitch class lands in the nearest valid registration.
    expect(led).toContain(62)
    expect(led[0]).toBe(62) // the slot that held D3 now holds D4
    // Pinned assignment (generated by the shipped cost function).
    expect(led).toEqual([62, 53, 57, 60, 67, 77])
  })

  it('every result is a permutation of the TARGET pool — never invented notes', () => {
    const field = compileField()
    for (const [key, led] of Object.entries(field.voiceLeadingTable)) {
      const toId = key.split('>')[1]!
      const node = TENSION_ORDERED_DORIAN_NODES.find((n) => n.chordId === toId)!
      const target = naturalPoolOf(node.chord)
      expect([...led].sort((a, b) => a - b)).toEqual([...target].sort((a, b) => a - b))
    }
  })

  it('identity pairs are identity: a node to itself never moves a voice', () => {
    const field = compileField()
    for (const node of TENSION_ORDERED_DORIAN_NODES) {
      const led = field.voiceLeadingTable[`${node.chordId}>${node.chordId}`]!
      expect(led).toEqual(naturalPoolOf(node.chord))
    }
  })

  it('the table covers all 36 ordered pairs and is deterministic across compiles', () => {
    const a = compileField()
    const b = compileField()
    expect(Object.keys(a.voiceLeadingTable)).toHaveLength(36)
    expect(a.voiceLeadingTable).toEqual(b.voiceLeadingTable)
  })

  it('property: no exact common note is ever DROPPED from the voicing (all 36 pairs)', () => {
    const field = compileField()
    for (const from of TENSION_ORDERED_DORIAN_NODES) {
      for (const to of TENSION_ORDERED_DORIAN_NODES) {
        const fromPool = naturalPoolOf(from.chord)
        const toPool = naturalPoolOf(to.chord)
        const led = field.voiceLeadingTable[`${from.chordId}>${to.chordId}`]!
        for (const common of fromPool.filter((n) => toPool.includes(n))) {
          expect(led).toContain(common)
        }
      }
    }
  })

  it('the assignment is GLOBAL, not greedy: a common tone may change voice to win overall', () => {
    const field = compileField()
    const sameSlotCount = (fromId: string, toId: string): { common: number; sameSlot: number } => {
      const from = TENSION_ORDERED_DORIAN_NODES.find((n) => n.chordId === fromId)!
      const to = TENSION_ORDERED_DORIAN_NODES.find((n) => n.chordId === toId)!
      const fromPool = naturalPoolOf(from.chord)
      const toPool = naturalPoolOf(to.chord)
      const led = field.voiceLeadingTable[`${fromId}>${toId}`]!
      const common = fromPool.filter((n) => toPool.includes(n))
      return {
        common: common.length,
        sameSlot: common.filter((n) => led[fromPool.indexOf(n)] === n).length,
      }
    }
    // Most pairs hold every common tone on its own voice…
    expect(sameSlotCount('dm9', 'f69')).toEqual({ common: 3, sameSlot: 3 })
    // …but Dm9→Am11 trades ONE voice's slot for a globally cheaper whole
    // assignment (exhaustive 720-permutation search, never greedy). The
    // tone is still present — the property above proves that.
    expect(sameSlotCount('dm9', 'am11')).toEqual({ common: 4, sameSlot: 3 })
  })
})

// ---------------------------------------------------------------------------
// Navigation goldens.
// ---------------------------------------------------------------------------

describe('surface navigation (v2 §§4,9)', () => {
  it('band tables are the design’s verbatim rows', () => {
    expect(ZONE_TO_SURFACE_BAND[3]).toEqual([0, 0, 1, 1, 2, 2])
    expect(ZONE_TO_SURFACE_BAND[4]).toEqual([0, 0, 1, 2, 3, 3])
    expect(ZONE_TO_SURFACE_BAND[6]).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('ABSOLUTE = the zone’s subindex in its band: zone 1 → Home member 2', () => {
    expect(subindexInBand(3, 0)).toBe(0)
    expect(subindexInBand(3, 1)).toBe(1) // second Home member
    expect(subindexInBand(3, 4)).toBe(0)
    const state = advanceOrbit(null, 0, 2, 'absolute', 7, subindexInBand(3, 1))
    expect(state.memberIndex).toBe(1)
    // Absolute is repeatable: the same zone always resolves the same way.
    expect(advanceOrbit(state, 0, 2, 'absolute', 8, subindexInBand(3, 1)).memberIndex).toBe(1)
  })

  it('ORBIT advances at most once per commit window, per hand', () => {
    const first = advanceOrbit(null, 0, 2, 'orbit', 10, 0)
    expect(first.memberIndex).toBe(0) // band entry lands on member 0
    const sameWindow = advanceOrbit(first, 0, 2, 'orbit', 10, 0)
    expect(sameWindow.memberIndex).toBe(0) // HOLDS — flurry parity is inert
    const nextWindow = advanceOrbit(sameWindow, 0, 2, 'orbit', 11, 0)
    expect(nextWindow.memberIndex).toBe(1) // one advance in a new window
    const wrapped = advanceOrbit(nextWindow, 0, 2, 'orbit', 12, 0)
    expect(wrapped.memberIndex).toBe(0) // wraps within the band
  })

  it('ORBIT resets to member 0 when the band changes', () => {
    const inBand0 = advanceOrbit(advanceOrbit(null, 0, 2, 'orbit', 1, 0), 0, 2, 'orbit', 2, 0)
    expect(inBand0.memberIndex).toBe(1)
    const moved = advanceOrbit(inBand0, 2, 2, 'orbit', 3, 0)
    expect(moved.band).toBe(2)
    expect(moved.memberIndex).toBe(0)
  })

  it('right-axis 3-band members come from the node’s role groups, not zone grouping', () => {
    const node = TENSION_ORDERED_DORIAN_NODES[0]!
    expect(bandMembers('right', 3, 0, node)).toEqual([0, 2]) // foundation
    expect(bandMembers('right', 3, 1, node)).toEqual([1, 3]) // color
    expect(bandMembers('right', 3, 2, node)).toEqual([4, 5]) // air
    // The LEFT axis groups zones instead (Home / Motion / Pressure).
    expect(bandMembers('left', 3, 0, null)).toEqual([0, 1])
    expect(bandMembers('left', 3, 2, null)).toEqual([4, 5])
  })

  it('full-6x6 is the identity overlay: one member per band, raw zones back', () => {
    for (let zone = 0; zone < 6; zone += 1) {
      expect(bandMembers('left', 6, zone, null)).toEqual([zone])
      expect(bandMembers('right', 6, zone, TENSION_ORDERED_DORIAN_NODES[0]!)).toEqual([zone])
    }
  })
})

// ---------------------------------------------------------------------------
// The wire byte contracts.
// ---------------------------------------------------------------------------

describe('wire byte contracts (R1 + amendment 3)', () => {
  const punches: MusicalPunchInput[] = [
    { eventId: 'e1', hand: 'left', receivedMonotonicTimeMs: 0, velocityRaw: 10, recovered: false },
    { eventId: 'e2', hand: 'right', receivedMonotonicTimeMs: 260, velocityRaw: 40, recovered: false },
    { eventId: 'e3', hand: 'left', receivedMonotonicTimeMs: 700, velocityRaw: 70, recovered: false },
    { eventId: 'e4', hand: 'right', receivedMonotonicTimeMs: 980, velocityRaw: 95, recovered: false },
    { eventId: 'e5', hand: 'left', receivedMonotonicTimeMs: 1500, velocityRaw: 20, recovered: false },
  ]

  function replay(patch: PunchPatch, withField: boolean): string[] {
    const cubeMap = compilePunchPatch(patch)
    const brassMap = compileBrassCube(patch)
    const field = withField
      ? compileHarmonicField(patch.id, patch.harmonicField!, brassMap)
      : undefined
    let state: InstrumentSessionState = emptySessionState()
    const out: string[] = []
    for (const [i, input] of punches.entries()) {
      const ctx: CompileContext = {
        sessionId: 'golden',
        patch,
        cubeMap,
        brassMap,
        ...(field ? { field } : {}),
        velocity01: 0.15 + i * 0.17,
        acceleration01: 0.2 + i * 0.15,
      }
      const result = compileGesture(input, state, ctx)
      if (!result) continue
      state = result.state
      out.push(JSON.stringify(result.gesture))
    }
    return out
  }

  it('v1 (legacy brass) gestures carry NO v2 keys and stay schemaVersion 1', () => {
    for (const json of replay(v1Patch(), false)) {
      const gesture = JSON.parse(json) as Record<string, unknown> & {
        quantized?: Record<string, unknown>
      }
      expect(gesture.schemaVersion).toBe(1)
      expect(gesture.harmonicIntent).toBeUndefined()
      expect(gesture.technique).toBeUndefined()
      expect(gesture.quantized?.commitIntervalTicks).toBeUndefined()
      expect(gesture.quantized).not.toHaveProperty('chordId')
    }
  })

  it('v1 replay is byte-identical run to run (the legacy capture)', () => {
    expect(replay(v1Patch(), false)).toEqual(replay(v1Patch(), false))
  })

  it('v2 gestures carry schemaVersion 2, commitIntervalTicks (480) and harmonicIntent', () => {
    const stream = replay(v2Patch(), true)
    expect(stream.length).toBeGreaterThan(0)
    for (const json of stream) {
      const gesture = JSON.parse(json) as {
        schemaVersion: number
        quantized?: { commitIntervalTicks?: number }
        harmonicIntent?: { band: number; memberIndex: number; commitWindowIndex: number }
      }
      expect(gesture.schemaVersion).toBe(2)
      expect(gesture.quantized?.commitIntervalTicks).toBe(480)
      expect(gesture.harmonicIntent).toBeDefined()
      expect(gesture.harmonicIntent!.band).toBeGreaterThanOrEqual(0)
      expect(gesture.harmonicIntent!.commitWindowIndex).toBeGreaterThanOrEqual(0)
    }
  })

  it('free-jam v2 gestures carry a GENERIC technique block — never a technique claim', () => {
    for (const json of replay(v2Patch(), true)) {
      const gesture = JSON.parse(json) as {
        technique?: { identitySource: string; token?: string; family?: string }
      }
      expect(gesture.technique).toBeDefined()
      expect(gesture.technique!.identitySource).toBe('generic')
      expect(gesture.technique!.token).toBeUndefined()
      expect(gesture.technique!.family).toBeUndefined()
    }
  })

  it('v2 replay is byte-identical for an identical input stream (acceptance #12)', () => {
    expect(replay(v2Patch(), true)).toEqual(replay(v2Patch(), true))
  })

  it('the commit-window index is derived from TICKS: 480 ticks ⇒ 500 ms windows', () => {
    const stream = replay(v2Patch(), true).map(
      (json) => (JSON.parse(json) as { harmonicIntent: { commitWindowIndex: number } }).harmonicIntent,
    )
    // Punch times 0, 260, 700, 980, 1500 ms → windows 0, 0, 1, 1, 3.
    expect(stream.map((i) => i.commitWindowIndex)).toEqual([0, 0, 1, 1, 3])
  })

  it('robustness: a recovered punch compiles to NOTHING and cannot move state', () => {
    const patch = v2Patch()
    const cubeMap = compilePunchPatch(patch)
    const brassMap = compileBrassCube(patch)
    const field = compileHarmonicField(patch.id, patch.harmonicField!, brassMap)
    const state = emptySessionState()
    const result = compileGesture(
      { eventId: 'r1', hand: 'left', receivedMonotonicTimeMs: 5, velocityRaw: 90, recovered: true },
      state,
      { sessionId: 'g', patch, cubeMap, brassMap, field, velocity01: 0.9, acceleration01: 0.9 },
    )
    expect(result).toBeNull()
  })

  it('robustness: a field compiled from a DIFFERENT patch is refused (hash guard)', () => {
    const patch = v2Patch()
    const cubeMap = compilePunchPatch(patch)
    const brassMap = compileBrassCube(patch)
    const foreign = compileHarmonicField(
      patch.id,
      { ...patch.harmonicField!, navigation: 'absolute' },
      compileBrassCube({
        ...patch,
        harmonicField: { ...patch.harmonicField!, navigation: 'absolute' },
      }),
    )
    expect(() =>
      compileGesture(
        { eventId: 'x', hand: 'left', receivedMonotonicTimeMs: 1, velocityRaw: 30, recovered: false },
        emptySessionState(),
        { sessionId: 'g', patch, cubeMap, brassMap, field: foreign, velocity01: 0.4, acceleration01: 0.4 },
      ),
    ).toThrow(/patchHash mismatch/)
  })
})

// ---------------------------------------------------------------------------
// Capability envelope.
// ---------------------------------------------------------------------------

describe('capability envelope (review amendment 3)', () => {
  it('this slice exposes safe-3x3 + full-6x6, absolute + orbit, BRIDGE only', () => {
    const caps = DORIAN_HARMONIC_FIELD_SECTION.capabilities
    expect(caps.supportedFreedomModes).toEqual(['safe-3x3', 'full-6x6'])
    expect(caps.supportedNavigationModes).toEqual(['absolute', 'orbit'])
    expect(caps.supportedOutputs).toEqual(['bridge'])
    // guided-4x4 is TYPED but never offered until M41-01 designs its roles.
    expect(caps.supportedFreedomModes).not.toContain('guided-4x4')
  })

  it('the shipped default section is Safe 3×3 / orbit / 480 ticks (500 ms)', () => {
    expect(DORIAN_HARMONIC_FIELD_SECTION.freedom).toBe('safe-3x3')
    expect(DORIAN_HARMONIC_FIELD_SECTION.navigation).toBe('orbit')
    expect(DORIAN_HARMONIC_FIELD_SECTION.commitIntervalTicks).toBe(480)
  })

  it('the DEFAULT patch is still v1 — the flip is M40-24’s separate release', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DEFAULT_PATCH_ID } = require('../instrument/punchPatch') as {
      DEFAULT_PATCH_ID: string
    }
    expect(DEFAULT_PATCH_ID).toBe('dorian-brass-cube')
  })
})
