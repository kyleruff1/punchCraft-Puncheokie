/**
 * Per-cell stab-role resolution (M40-28).
 *
 * The bug this replaces: roles were hardcoded pool indices, so when the
 * right hand rotated the entry tone onto the fifth, the jab and the cross
 * sounded the IDENTICAL pitch. Resolution now happens per cell at compile
 * time, against that cell's own pool and its user-selected entry tone.
 */
import { compileBrassCube, naturalPoolOf, DORIAN_CHORD_BANK } from '../instrument/brassCube'
import {
  compileHarmonicField,
  stabRolesAt,
  TENSION_ORDERED_DORIAN_NODES,
} from '../instrument/harmonicField'
import { launchPatchById } from '../instrument/punchPatch'
import {
  noteForVoice,
  reportStabDistinctness,
  resolveStabRoles,
  ROLE_CANDIDATES,
  type StabFamilyVoice,
} from '../instrument/stabRoleResolver'

const DM9 = naturalPoolOf(DORIAN_CHORD_BANK.find((c) => c.name === 'Dm9')!)
const VOICES: readonly StabFamilyVoice[] = [
  'jab',
  'cross',
  'leadHook',
  'rearHook',
  'leadUppercut',
  'rearUppercut',
]

function compiledField() {
  const patch = launchPatchById('dorian-brass-v2')
  return compileHarmonicField(patch.id, patch.harmonicField!, compileBrassCube(patch))
}

describe('the entry selection is preserved', () => {
  it('the jab ALWAYS plays the cell’s selected entry tone, at every rotation', () => {
    for (const entry of DM9) {
      expect(resolveStabRoles(DM9, entry).jabNote).toBe(entry)
    }
  })

  it('across all 36 cells the jab equals the cell’s own entry tone', () => {
    const field = compiledField()
    for (let x = 0; x < 6; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        expect(stabRolesAt(field, x, y).jabNote).toBe(field.cells[x * 6 + y]!.entryTone)
      }
    }
  })
})

describe('the collision the model exists to fix', () => {
  it('when rotation puts the entry tone ON the fifth, the cross MOVES', () => {
    const fifth = DM9[2]!
    const roles = resolveStabRoles(DM9, fifth)
    expect(roles.jabNote).toBe(fifth)
    // The old hardcoded model returned the fifth here too — identical pitch.
    expect(roles.crossNote).not.toBe(fifth)
    // It takes the next candidate in Kyle's list: the upper anchor.
    expect(roles.crossNote).toBe(DM9[5])
  })

  it('every family resolves to a real tone of that pool — never an invented pitch', () => {
    for (const entry of DM9) {
      const roles = resolveStabRoles(DM9, entry)
      for (const voice of VOICES) expect(DM9).toContain(noteForVoice(roles, voice))
    }
  })
})

describe('separation across the whole field', () => {
  it('all six voices are distinct in every one of the 36 cells', () => {
    const field = compiledField()
    for (let x = 0; x < 6; x += 1) {
      for (let y = 0; y < 6; y += 1) {
        const roles = stabRolesAt(field, x, y)
        const notes = VOICES.map((v) => noteForVoice(roles, v))
        expect(new Set(notes).size).toBe(VOICES.length)
      }
    }
  })

  it('the compiled field reports ZERO forced collisions for the Dorian world', () => {
    // Not a promise the compiler makes universally — a six-tone pool CAN
    // run out of separated notes. It is a pin: if a future world or
    // rotation change regresses separation, this fails loudly.
    expect(compiledField().stabCollisions).toEqual([])
  })

  it('the collision report names the pair when a pool cannot separate them', () => {
    // A degenerate pool: every slot the same note.
    const flat = [60, 60, 60, 60, 60, 60]
    const report = reportStabDistinctness('flat', resolveStabRoles(flat, 60))
    expect(report.collisions.length).toBeGreaterThan(0)
    expect(report.collisions[0]!.midiNote).toBe(60)
    expect(report.cellId).toBe('flat')
  })
})

describe('the resolver is deterministic and compiled once', () => {
  it('same pool + entry tone → identical assignment', () => {
    expect(resolveStabRoles(DM9, DM9[0]!)).toEqual(resolveStabRoles(DM9, DM9[0]!))
  })

  it('the resolved map rides the field and is covered by its hash', () => {
    const a = compiledField()
    const b = compiledField()
    expect(a.stabRoles).toHaveLength(36)
    expect(a.compiledFieldHash).toBe(b.compiledFieldHash)
    expect(JSON.stringify(a.stabRoles)).toBe(JSON.stringify(b.stabRoles))
  })

  it('candidate lists follow the ruling: weight for the cross, colour for the hook', () => {
    expect(ROLE_CANDIDATES.cross[0]).toBe('fifth')
    expect(ROLE_CANDIDATES.leadHook[0]).toBe('third')
    expect(ROLE_CANDIDATES.rearHook[0]).toBe('color')
    expect(ROLE_CANDIDATES.leadUppercut[0]).toBe('extension')
    expect(ROLE_CANDIDATES.rearUppercut[0]).toBe('upper-anchor')
  })

  it('every node in the world resolves without throwing', () => {
    for (const node of TENSION_ORDERED_DORIAN_NODES) {
      const pool = naturalPoolOf(node.chord)
      for (const entry of pool) {
        expect(() => resolveStabRoles(pool, entry)).not.toThrow()
      }
    }
  })
})
