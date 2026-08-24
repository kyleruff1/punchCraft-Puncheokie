import { MOTIFS, motifsFor } from '../comboLibrary'
import { parseCombo, punchTokens } from '../WorkoutTokens'
import { defaultRecipe } from '../WorkoutRecipe'

describe('MOTIFS integrity', () => {
  it('has unique ids', () => {
    const ids = MOTIFS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every notation parses and its metadata matches the tokens', () => {
    for (const motif of MOTIFS) {
      const tokens = parseCombo(motif.notation)
      const punches = punchTokens(tokens)

      // length is the punch-token count.
      expect(motif.length).toBe(punches.length)

      // punches lists exactly the distinct punch numbers used.
      const numbers = [...new Set(punches.map((p) => p.number))].sort()
      expect(motif.punches.slice().sort()).toEqual(numbers)

      // hasBody agrees with the tokens.
      expect(motif.hasBody).toBe(punches.some((p) => p.body))

      // offsets, when present, cover every token.
      if (motif.offsets) expect(motif.offsets.length).toBe(tokens.length)
    }
  })

  it('tags roles by their command tokens', () => {
    for (const motif of MOTIFS) {
      const tokens = parseCombo(motif.notation)
      if (motif.role === 'defense') {
        expect(tokens.some((t) => t.kind === 'defense')).toBe(true)
        expect(motif.defense).toBeDefined()
      }
      if (motif.role === 'footwork') {
        expect(tokens.some((t) => t.kind === 'footwork')).toBe(true)
        expect(motif.footwork).toBeDefined()
      }
      if (motif.role === 'combo') {
        expect(tokens.every((t) => t.kind === 'punch')).toBe(true)
      }
    }
  })
})

describe('motifsFor', () => {
  it('the default recipe yields a broad pool across all roles', () => {
    const recipe = defaultRecipe()
    const all = motifsFor(recipe)
    expect(all.length).toBeGreaterThan(10)
    expect(all.some((m) => m.role === 'combo')).toBe(true)
    expect(all.some((m) => m.role === 'defense')).toBe(true)
    expect(all.some((m) => m.role === 'footwork')).toBe(true)
  })

  it('never returns a motif using a disabled punch', () => {
    const recipe = { ...defaultRecipe(), enabledPunches: [1, 2] as (1 | 2)[] }
    for (const motif of motifsFor(recipe)) {
      expect(motif.punches.every((n) => n === 1 || n === 2)).toBe(true)
    }
  })

  it('respects the maximum combo length', () => {
    const recipe = { ...defaultRecipe(), maximumComboPunches: 2 }
    for (const motif of motifsFor(recipe)) expect(motif.length).toBeLessThanOrEqual(2)
  })

  it('respects the complexity ceiling', () => {
    const recipe = { ...defaultRecipe(), comboComplexity: 2 as const }
    for (const motif of motifsFor(recipe)) expect(motif.complexity).toBeLessThanOrEqual(2)
  })

  it('drops defense and footwork motifs when their frequency is off', () => {
    const recipe = { ...defaultRecipe(), defenseFrequency: 'off' as const, footworkFrequency: 'off' as const }
    const pool = motifsFor(recipe)
    expect(pool.every((m) => m.role === 'combo')).toBe(true)
  })

  it('drops body motifs when body shots are disabled', () => {
    const recipe = { ...defaultRecipe(), bodyShotPercent: 0 }
    expect(motifsFor(recipe).every((m) => !m.hasBody)).toBe(true)
  })

  it('gates defense motifs on the enabled command set', () => {
    const recipe = { ...defaultRecipe(), enabledDefense: ['slip'] as ['slip'] }
    const defense = motifsFor(recipe, { roles: ['defense'] })
    expect(defense.length).toBeGreaterThan(0)
    expect(defense.every((m) => m.defense === 'slip')).toBe(true)
  })
})
