/**
 * Recipe conflict detection (M31-04, doc §12).
 *
 * The rule under test is doc §12's: a conflict is always SURFACED, never
 * silently resolved. Every assertion here is really checking that the
 * athlete is told, rather than the generator quietly picking a winner
 * between two settings they deliberately chose.
 */

import { canGenerate, validateRecipe, type RecipeConflict } from '../recipeValidation'
import { defaultRecipe, type WorkoutRecipe } from '../WorkoutRecipe'
import { GOAL_TIERS } from '../punchGoals'

const recipe = (over: Partial<WorkoutRecipe> = {}): WorkoutRecipe => ({ ...defaultRecipe(), ...over })
const codes = (r: WorkoutRecipe): string[] => validateRecipe(r).map((c) => c.code)

describe('defaultRecipe', () => {
  it('validates with zero conflicts', () => {
    expect(validateRecipe(defaultRecipe())).toEqual([])
  })

  it('can generate', () => {
    expect(canGenerate(validateRecipe(defaultRecipe()))).toBe(true)
  })

  it('is deterministic — the same call yields the same recipe', () => {
    // defaultRecipe() must stay pure so tests and the Recipe screen agree.
    expect(defaultRecipe()).toEqual(defaultRecipe())
  })

  it('enables every command it sets a non-off frequency for', () => {
    const d = defaultRecipe()
    if (d.defenseFrequency !== 'off') expect(d.enabledDefense.length).toBeGreaterThan(0)
    if (d.footworkFrequency !== 'off') expect(d.enabledFootwork.length).toBeGreaterThan(0)
  })
})

describe('every conflict carries actionable text', () => {
  it('never returns an empty message or resolution', () => {
    // A conflict that names a problem without saying what to change leaves
    // the athlete stuck on the same screen.
    const wrecked = recipe({
      enabledPunches: [],
      defenseFrequency: 'heavy',
      enabledDefense: [],
      footworkFrequency: 'moderate',
      enabledFootwork: [],
      totalPunchGoal: 99_999,
    })
    const conflicts = validateRecipe(wrecked)
    expect(conflicts.length).toBeGreaterThan(0)
    for (const c of conflicts) {
      expect(c.message.trim().length).toBeGreaterThan(0)
      expect(c.resolution.trim().length).toBeGreaterThan(0)
      expect(c.fields.length).toBeGreaterThan(0)
    }
  })

  it('reports every conflict at once rather than the first', () => {
    const wrecked = recipe({
      defenseFrequency: 'heavy',
      enabledDefense: [],
      footworkFrequency: 'moderate',
      enabledFootwork: [],
    })
    expect(validateRecipe(wrecked).length).toBeGreaterThanOrEqual(2)
  })
})

describe('(a) no punches enabled', () => {
  it('is an error', () => {
    const conflicts = validateRecipe(recipe({ enabledPunches: [] }))
    const conflict = conflicts.find((c) => c.code === 'no-punches-enabled')
    expect(conflict?.severity).toBe('error')
    expect(canGenerate(conflicts)).toBe(false)
  })
})

describe('(b) jab disabled — the doc §12 worked example', () => {
  it('is an ERROR when the recipe also asks for a lead-hand bias', () => {
    // The two settings directly contradict: lead bias wants more lead-hand
    // punches while the most common one is switched off.
    const conflicts = validateRecipe(recipe({ enabledPunches: [2, 3, 4, 5, 6], bias: 'lead' }))
    const conflict = conflicts.find((c) => c.code === 'jab-disabled-with-lead-bias')
    expect(conflict?.severity).toBe('error')
    expect(conflict?.fields).toEqual(expect.arrayContaining(['enabledPunches', 'bias']))
    expect(canGenerate(conflicts)).toBe(false)
  })

  it('is a WARNING otherwise — a no-jab drill is legitimate', () => {
    const conflicts = validateRecipe(recipe({ enabledPunches: [2, 3, 4, 5, 6], bias: 'balanced' }))
    const conflict = conflicts.find((c) => c.code === 'jab-disabled')
    expect(conflict?.severity).toBe('warning')
    expect(canGenerate(conflicts)).toBe(true)
  })

  it('is never silently ignored (doc §12)', () => {
    for (const bias of ['balanced', 'lead', 'rear', 'left', 'right'] as WorkoutRecipe['bias'][]) {
      const conflicts = validateRecipe(recipe({ enabledPunches: [2, 3, 4, 5, 6], bias }))
      expect(conflicts.some((c) => c.code.startsWith('jab-disabled'))).toBe(true)
    }
  })

  it('does not fire when the jab is enabled', () => {
    expect(codes(recipe({ bias: 'lead' })).some((c) => c.startsWith('jab-disabled'))).toBe(false)
  })

  it('does not double-report when no punches are enabled at all', () => {
    // An empty list is already reported by (a); adding "the jab is missing"
    // would be noise.
    const found = codes(recipe({ enabledPunches: [] }))
    expect(found).toContain('no-punches-enabled')
    expect(found.some((c) => c.startsWith('jab-disabled'))).toBe(false)
  })
})

describe('(c) frequency set with an empty command list', () => {
  it.each([
    ['defense', { defenseFrequency: 'light', enabledDefense: [] }, 'enabledDefense-empty-with-frequency'],
    ['footwork', { footworkFrequency: 'heavy', enabledFootwork: [] }, 'enabledFootwork-empty-with-frequency'],
  ] as Array<[string, Partial<WorkoutRecipe>, string]>)('is an error for %s', (_label, over, code) => {
    const conflicts = validateRecipe(recipe(over))
    expect(conflicts.find((c) => c.code === code)?.severity).toBe('error')
  })

  it('does not fire when the frequency is off', () => {
    const conflicts = validateRecipe(
      recipe({ defenseFrequency: 'off', enabledDefense: [], footworkFrequency: 'off', enabledFootwork: [] }),
    )
    expect(conflicts.filter((c) => c.code.includes('empty-with-frequency'))).toEqual([])
  })
})

describe('(d) goal above the Extreme tier', () => {
  it('is a warning, not a block', () => {
    const conflicts = validateRecipe(
      recipe({ durationMinutes: 20, totalPunchGoal: GOAL_TIERS.extreme[20] + 500, maximumComboPunches: 5 }),
    )
    const conflict = conflicts.find((c) => c.code === 'goal-above-extreme-tier')
    expect(conflict?.severity).toBe('warning')
    expect(canGenerate(conflicts)).toBe(true)
  })

  it('does not fire at exactly the Extreme value', () => {
    const conflicts = validateRecipe(recipe({ durationMinutes: 20, totalPunchGoal: GOAL_TIERS.extreme[20] }))
    expect(conflicts.some((c) => c.code === 'goal-above-extreme-tier')).toBe(false)
  })
})

describe('(e) goal unreachable at the chosen combo length', () => {
  it('warns when the required combination rate leaves no room between cues', () => {
    // 2000 punches over 15 active minutes is 133/min; with 2-punch combos
    // that needs ~67 combinations a minute.
    const conflicts = validateRecipe(
      recipe({ durationMinutes: 20, totalPunchGoal: 2000, maximumComboPunches: 2 }),
    )
    const conflict = conflicts.find((c) => c.code === 'goal-unreachable-at-combo-length')
    expect(conflict?.severity).toBe('warning')
    expect(conflict?.message).toMatch(/combinations a minute/)
  })

  it('does not fire for a comfortable pairing', () => {
    expect(codes(recipe({ durationMinutes: 20, totalPunchGoal: 1000, maximumComboPunches: 5 }))).not.toContain(
      'goal-unreachable-at-combo-length',
    )
  })
})

describe('body-shot share (M31-07)', () => {
  it('treats 0 as a normal value — head shots only, not a conflict', () => {
    // The advanced panel gates the share behind a Body variations switch,
    // so switching it off must not raise an error.
    expect(codes(recipe({ bodyShotPercent: 0 }))).not.toContain('body-shot-percent-out-of-range')
    expect(codes(recipe({ bodyShotPercent: 0 }))).not.toContain('body-shots-only')
  })

  it('rejects a share outside 0-100 as an error', () => {
    for (const value of [-1, 101, 250]) {
      const conflicts = validateRecipe(recipe({ bodyShotPercent: value }))
      const conflict = conflicts.find((c) => c.code === 'body-shot-percent-out-of-range')
      expect(conflict?.severity).toBe('error')
      expect(conflict?.fields).toEqual(['bodyShotPercent'])
      expect(conflict?.resolution).toBeTruthy()
    }
  })

  it('warns rather than blocks at 100 percent — a body-only drill is legitimate', () => {
    const conflicts = validateRecipe(recipe({ bodyShotPercent: 100 }))
    const conflict = conflicts.find((c) => c.code === 'body-shots-only')
    expect(conflict?.severity).toBe('warning')
    expect(canGenerate(conflicts)).toBe(true)
  })

  it('raises nothing for ordinary shares', () => {
    for (const value of [5, 20, 50, 95]) {
      expect(codes(recipe({ bodyShotPercent: value }))).toEqual([])
    }
  })
})

describe('extraPunchPolicy (M31-07)', () => {
  it('defaults to neutral', () => {
    expect(defaultRecipe().extraPunchPolicy).toBe('neutral')
  })

  it('never raises a conflict on its own — every value is valid', () => {
    for (const policy of ['encouraged', 'neutral', 'discouraged'] as const) {
      expect(validateRecipe(recipe({ extraPunchPolicy: policy }))).toEqual([])
    }
  })
})

describe('canGenerate', () => {
  it('is blocked by errors but not by warnings', () => {
    const warningOnly: RecipeConflict[] = [
      { code: 'w', fields: ['seed'], severity: 'warning', message: 'm', resolution: 'r' },
    ]
    const withError: RecipeConflict[] = [
      ...warningOnly,
      { code: 'e', fields: ['seed'], severity: 'error', message: 'm', resolution: 'r' },
    ]
    expect(canGenerate(warningOnly)).toBe(true)
    expect(canGenerate(withError)).toBe(false)
    expect(canGenerate([])).toBe(true)
  })
})
