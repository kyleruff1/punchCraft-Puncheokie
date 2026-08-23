/**
 * Recipe store (M31-06).
 *
 * The property worth guarding here is that `conflicts` and `summary` are
 * never stale: the screen reads them directly, so a missed recompute would
 * show the athlete a summary describing a recipe they no longer have.
 */
import {
  conflictsForField,
  getRecipe,
  patchRecipe,
  useWorkoutStore,
} from '../useWorkoutStore'
import { buildRoundSchedule } from '@domain/workout/roundSchedule'
import { summarizeRecipe } from '@domain/workout/recipeSummary'
import { validateRecipe } from '@domain/workout/recipeValidation'
import { defaultRecipe } from '@domain/workout/WorkoutRecipe'

const store = () => useWorkoutStore.getState()

beforeEach(() => {
  store().resetRecipe()
})

describe('initial state', () => {
  it('starts from defaultRecipe with no sample selected', () => {
    expect(store().recipe).toEqual(defaultRecipe())
    expect(store().selectedSampleKey).toBeUndefined()
  })

  it('starts with the Advanced panel collapsed (doc §8 progressive disclosure)', () => {
    expect(useWorkoutStore.getInitialState().advancedOpen).toBe(false)
  })

  it('starts clean — the default recipe raises no conflicts', () => {
    // defaultRecipe() exists to put the athlete into a usable workout
    // immediately; if it validated with errors that promise would be broken.
    expect(store().conflicts.filter((c) => c.severity === 'error')).toEqual([])
  })

  it('derives summary from the default recipe', () => {
    const recipe = defaultRecipe()
    expect(store().summary).toEqual(summarizeRecipe(recipe, buildRoundSchedule(recipe.durationMinutes)))
  })
})

describe('setRecipe', () => {
  it('patches only the named fields', () => {
    store().setRecipe({ focus: 'movement' })
    expect(store().recipe.focus).toBe('movement')
    expect(store().recipe.durationMinutes).toBe(defaultRecipe().durationMinutes)
  })

  it('recomputes the summary when duration changes', () => {
    const before = store().summary
    store().setRecipe({ durationMinutes: 60 })
    const after = store().summary
    expect(after).not.toEqual(before)
    expect(after).toEqual(summarizeRecipe(store().recipe, buildRoundSchedule(60)))
  })

  it('recomputes conflicts when the jab is disabled with a lead bias', () => {
    store().setRecipe({ enabledPunches: [2, 4, 6], bias: 'lead' })
    const conflicts = store().conflicts
    expect(conflicts.length).toBeGreaterThan(0)
    expect(conflicts.some((c) => c.severity === 'error')).toBe(true)
  })

  it('keeps conflicts and summary consistent with the recipe after any patch', () => {
    // Recomputing one but not the other is the failure this asserts against.
    const patches = [
      { durationMinutes: 40 as const },
      { totalPunchGoal: 4_000 },
      { focus: 'hands' as const },
      { enabledPunches: [] },
      { bodyShotPercent: 90 },
    ]
    for (const patch of patches) {
      store().setRecipe(patch)
      const recipe = store().recipe
      expect(store().conflicts).toEqual(validateRecipe(recipe))
      expect(store().summary).toEqual(
        summarizeRecipe(recipe, buildRoundSchedule(recipe.durationMinutes)),
      )
    }
  })

  it('keeps state serializable — no functions or class instances in the data', () => {
    store().setRecipe({ durationMinutes: 30 })
    const { recipe, conflicts, summary } = store()
    expect(JSON.parse(JSON.stringify({ recipe, conflicts, summary }))).toEqual({
      recipe,
      conflicts,
      summary,
    })
  })
})

describe('sample selection', () => {
  it('stores and clears the selected key', () => {
    store().selectSample('switch-by-round')
    expect(store().selectedSampleKey).toBe('switch-by-round')
    store().selectSample(undefined)
    expect(store().selectedSampleKey).toBeUndefined()
  })

  it('is cleared by resetRecipe', () => {
    store().selectSample('establish-the-jab-20')
    store().resetRecipe()
    expect(store().selectedSampleKey).toBeUndefined()
  })
})

describe('advanced panel state', () => {
  it('opens and closes', () => {
    store().setAdvancedOpen(true)
    expect(store().advancedOpen).toBe(true)
    store().setAdvancedOpen(false)
    expect(store().advancedOpen).toBe(false)
  })

  it('survives resetRecipe — collapsing a panel the athlete opened would hide their controls', () => {
    store().setAdvancedOpen(true)
    store().resetRecipe()
    expect(store().advancedOpen).toBe(true)
    store().setAdvancedOpen(false)
  })
})

describe('conflictsForField', () => {
  it('returns only conflicts naming that field', () => {
    store().setRecipe({ enabledPunches: [] })
    const all = store().conflicts
    const forPunches = conflictsForField(all, 'enabledPunches')
    expect(forPunches.length).toBeGreaterThan(0)
    for (const conflict of forPunches) expect(conflict.fields).toContain('enabledPunches')
  })

  it('returns an empty array for an unaffected field', () => {
    expect(conflictsForField(store().conflicts, 'seed')).toEqual([])
  })
})

describe('module-level helpers', () => {
  it('let non-React callers read and patch the recipe', () => {
    patchRecipe({ cadenceProfile: 'sprint' })
    expect(getRecipe().cadenceProfile).toBe('sprint')
  })
})
