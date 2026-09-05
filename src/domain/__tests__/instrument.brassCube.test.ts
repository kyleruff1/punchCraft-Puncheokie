import {
  BRASS_LAYER_HYSTERESIS_PPS,
  BRASS_LAYER_THRESHOLDS_PPS,
  brassLayerFor,
  decayPps,
} from '../instrument/activityEnvelope'
import {
  ARP_PATTERNS,
  DORIAN_CHORD_BANK,
  bassNoteOf,
  brassCellAt,
  compileBrassCube,
  naturalPoolOf,
  rotatedPoolOf,
  stepMsFor,
} from '../instrument/brassCube'
import { compilePunchPatch } from '../instrument/cubeCompiler'
import { launchPatchById, type PunchPatch } from '../instrument/punchPatch'

const brassPatch = (): PunchPatch => launchPatchById('dorian-brass-cube')

describe('brassCube pools (R3 goldens)', () => {
  it('natural-pool goldens: all six chords compile to exactly the pinned arrays', () => {
    // Octave-placement rule: root in the scientific octave-3 register, then
    // every listed tone lifted to the smallest note of its class strictly
    // above its predecessor (brass-cube-design chord table).
    const expected: Array<[string, number[], number]> = [
      ['Dm9', [50, 53, 57, 60, 64, 74], 26],
      ['F6/9', [53, 57, 60, 62, 67, 77], 29],
      ['G9', [55, 59, 62, 65, 69, 79], 31],
      ['Am11', [57, 60, 64, 67, 74, 81], 33],
      ['C6/9', [48, 52, 55, 57, 62, 72], 24],
      ['Dm11', [50, 53, 57, 60, 64, 67], 26],
    ]
    expect(DORIAN_CHORD_BANK).toHaveLength(6)
    DORIAN_CHORD_BANK.forEach((chord, i) => {
      const [name, pool, bass] = expected[i]!
      expect(chord.name).toBe(name)
      expect(naturalPoolOf(chord)).toEqual(pool)
      expect(bassNoteOf(naturalPoolOf(chord))).toBe(bass)
    })
  })

  it('rotation golden: Dm9 startIndex 2 → A3 C4 E4 D5 F5 A5; 0 is identity; 5 starts at 74', () => {
    const dm9 = naturalPoolOf(DORIAN_CHORD_BANK[0]!)
    expect(rotatedPoolOf(dm9, 2)).toEqual([57, 60, 64, 74, 77, 81])
    expect(rotatedPoolOf(dm9, 0)).toEqual(dm9)
    expect(rotatedPoolOf(dm9, 5)[0]).toBe(74)
  })

  it('Punch Weave golden: [0,2,1,3,2,4,3,5] over unrotated Dm9 → D3 A3 F3 C4 A3 E4 C4 D5', () => {
    const dm9 = naturalPoolOf(DORIAN_CHORD_BANK[0]!)
    const weave = ARP_PATTERNS['punch-weave']
    expect(weave).toEqual([0, 2, 1, 3, 2, 4, 3, 5])
    expect(weave.map((i) => dm9[i])).toEqual([50, 57, 53, 60, 57, 64, 60, 74])
  })

  it('example-performance accents: L2R0 stabs G3 (55) and L2R4 stabs A4 (69)', () => {
    const map = compileBrassCube(brassPatch())
    expect(brassCellAt(map, 2, 0).startMidiNote).toBe(55)
    expect(brassCellAt(map, 2, 4).startMidiNote).toBe(69)
    expect(brassCellAt(map, 2, 0).chordName).toBe('G9')
  })
})

describe('compileBrassCube', () => {
  it('is deterministic: 36 row-major cells, stable bytes, one shared patchHash', () => {
    const patch = brassPatch()
    const a = compileBrassCube(patch)
    const b = compileBrassCube(patch)
    expect(a.cells).toHaveLength(36)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    // Row-major cells[leftZone*6 + rightZone], the cubeCompiler convention.
    for (let left = 0; left < 6; left += 1) {
      for (let right = 0; right < 6; right += 1) {
        const cell = a.cells[left * 6 + right]!
        expect(cell.cellId).toBe(`L${left}R${right}`)
        expect(cell.leftZone).toBe(left)
        expect(cell.rightZone).toBe(right)
        expect(cell.startIndex).toBe(right)
        expect(cell.startMidiNote).toBe(cell.rotatedPool[0])
      }
    }
    // ONE compiled map: the brass hash IS the cube hash for the same patch.
    expect(a.patchHash).toBe(compilePunchPatch(patch).patchHash)
    expect(a.patchHash).toMatch(/^[0-9a-f]{8}$/)
    expect(stepMsFor(240)).toBe(250)
    expect(stepMsFor(180)).toBeCloseTo(333.3333, 3)
  })

  it('throws without a brassCube section and on zoneCount ≠ 6', () => {
    expect(() => compileBrassCube(launchPatchById('two-handed-pentatonic'))).toThrow(
      /no brassCube section/,
    )
    expect(() => compileBrassCube({ ...brassPatch(), zoneCount: 5 })).toThrow(/zoneCount 6/)
  })

  it('brassCellAt clamps both axes like cellAt', () => {
    const map = compileBrassCube(brassPatch())
    expect(brassCellAt(map, -3, 99).cellId).toBe('L0R5')
    expect(brassCellAt(map, 7, -1).cellId).toBe('L5R0')
  })
})

describe('brass activity bands', () => {
  it('rises immediately, holds inside the hysteresis band, and decays on the shared curve', () => {
    expect(BRASS_LAYER_THRESHOLDS_PPS).toEqual([0.75, 1.75, 3.25])
    expect(BRASS_LAYER_HYSTERESIS_PPS).toBe(0.25)
    // Rise/hold commit immediately at the band edges.
    expect(brassLayerFor(0.74, 0)).toBe(0)
    expect(brassLayerFor(0.75, 0)).toBe(1)
    expect(brassLayerFor(1.75, 0)).toBe(2)
    expect(brassLayerFor(3.25, 1)).toBe(3)
    // Falling from layer 2: 1.6 pps is inside 1.75 − 0.25 → hold; 1.4 falls.
    expect(brassLayerFor(1.6, 2)).toBe(2)
    expect(brassLayerFor(1.4, 2)).toBe(1)
    // decayPps halves per ~1.386 s (tau 2.0 — the envelope's own curve).
    expect(decayPps(2, 2000 * Math.LN2)).toBeCloseTo(1, 10)
    expect(decayPps(4, 0)).toBe(4)
    expect(decayPps(4, -50)).toBe(4)
  })
})
