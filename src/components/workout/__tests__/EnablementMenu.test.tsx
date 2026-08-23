/**
 * Advanced panel enablement menus (M31-07).
 *
 * The assertions that matter here are the ones a later refactor could
 * silently break: that the serialized command values still match the doc
 * §12 vocabularies, that a toggle emits the exact patch the store expects,
 * and that a conflict appears at the switch that caused it.
 */
import React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

import { EnablementMenu } from '../EnablementMenu'
import { defaultRecipe, type WorkoutRecipe } from '@domain/workout/WorkoutRecipe'
import { validateRecipe, type RecipeConflict } from '@domain/workout/recipeValidation'

function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('')
}

function renderMenu(overrides: Partial<WorkoutRecipe> = {}): {
  tree: ReactTestRenderer
  patches: Array<Partial<WorkoutRecipe>>
  recipe: WorkoutRecipe
  conflicts: RecipeConflict[]
} {
  const recipe: WorkoutRecipe = { ...defaultRecipe(), ...overrides }
  const conflicts = validateRecipe(recipe)
  const patches: Array<Partial<WorkoutRecipe>> = []
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(
      <EnablementMenu
        recipe={recipe}
        conflicts={conflicts}
        onChange={(patch) => patches.push(patch)}
      />,
    )
  })
  return { tree, patches, recipe, conflicts }
}

/** Flip a switch the way the platform does — reporting the *new* value. */
function toggleSwitch(tree: ReactTestRenderer, testID: string): void {
  const node = tree.root.findByProps({ testID })
  act(() => {
    node.props.onValueChange(!node.props.value)
  })
}

function pressSegment(tree: ReactTestRenderer, testID: string): void {
  act(() => {
    tree.root.findByProps({ testID }).props.onPress()
  })
}

describe('doc §12 vocabularies', () => {
  it('renders a switch for every punch, defense, footwork and coaching command', () => {
    const { tree } = renderMenu()
    const ids = [
      ...[1, 2, 3, 4, 5, 6].map((n) => `punch-${n}`),
      ...['duck', 'bob-weave', 'slip', 'roll', 'pull'].map((c) => `defense-${c}`),
      ...['pivot', 'step-off', 'circle', 'cut-off-ring', 'reset'].map((c) => `footwork-${c}`),
      ...['double-up', 'put-it-on-em', 'touch-and-go', 'breathe', 'hands-up'].map(
        (c) => `coach-${c}`,
      ),
    ]
    for (const id of ids) {
      expect(() => tree.root.findByProps({ testID: id })).not.toThrow()
    }
  })

  it('shows the calls-per-round ranges on the frequency bands', () => {
    const { tree } = renderMenu()
    const text = textOf(tree.root)
    expect(text).toContain('Light · 2-3 per round')
    expect(text).toContain('Moderate · 5-8 per round')
    expect(text).toContain('Heavy · 9-14 per round')
  })

  it('groups the menus under the doc §12 headings', () => {
    const { tree } = renderMenu()
    const text = textOf(tree.root)
    for (const heading of ['Punches', 'Defense', 'Footwork', 'Coaching and pace calls']) {
      expect(text.toUpperCase()).toContain(heading.toUpperCase())
    }
  })
})

describe('toggles emit the right patch', () => {
  it('removes an enabled punch from the array', () => {
    const { tree, patches } = renderMenu()
    toggleSwitch(tree, 'punch-3')
    expect(patches).toHaveLength(1)
    expect(patches[0]?.enabledPunches).not.toContain(3)
    expect(patches[0]?.enabledPunches).toContain(1)
  })

  it('adds a disabled command back to the array', () => {
    const { tree, patches } = renderMenu({ enabledDefense: ['slip'] })
    toggleSwitch(tree, 'defense-roll')
    expect(patches[0]?.enabledDefense).toEqual(['slip', 'roll'])
  })

  it('sets the frequency band', () => {
    const { tree, patches } = renderMenu()
    pressSegment(tree, 'defense-frequency-heavy')
    expect(patches[0]).toEqual({ defenseFrequency: 'heavy' })
  })

  it('sets the cadence profile and the extra-punch policy', () => {
    const { tree, patches } = renderMenu()
    pressSegment(tree, 'cadence-sprint')
    pressSegment(tree, 'extra-punch-policy-discouraged')
    expect(patches).toEqual([
      { cadenceProfile: 'sprint' },
      { extraPunchPolicy: 'discouraged' },
    ])
  })

  it('never emits a full recipe — only the fields that changed', () => {
    // A patch carrying untouched fields would let a stale value overwrite a
    // concurrent change; the store merges patches, so they must be minimal.
    const { tree, patches } = renderMenu()
    toggleSwitch(tree, 'coach-breathe')
    expect(Object.keys(patches[0] ?? {})).toEqual(['enabledCoachCalls'])
  })
})

describe('body variations gate the body-shot share', () => {
  it('hides the share control when body variations are off', () => {
    const { tree } = renderMenu({ bodyShotPercent: 0 })
    expect(tree.root.findAllByProps({ testID: 'body-shot-percent' })).toHaveLength(0)
  })

  it('shows the share control when body variations are on', () => {
    const { tree } = renderMenu({ bodyShotPercent: 25 })
    expect(() => tree.root.findByProps({ testID: 'body-shot-percent-value' })).not.toThrow()
    expect(textOf(tree.root.findByProps({ testID: 'body-shot-percent-value' }))).toBe('25%')
  })

  it('zeroes the share when switched off and restores a usable share when switched on', () => {
    const off = renderMenu({ bodyShotPercent: 25 })
    toggleSwitch(off.tree, 'body-variations')
    expect(off.patches[0]).toEqual({ bodyShotPercent: 0 })

    const on = renderMenu({ bodyShotPercent: 0 })
    toggleSwitch(on.tree, 'body-variations')
    expect(on.patches[0]?.bodyShotPercent).toBeGreaterThan(0)
  })

  it('keeps the uppercase B to the badge, never to the notation (D10, doc §13)', () => {
    const { tree } = renderMenu({ bodyShotPercent: 20 })
    expect(textOf(tree.root)).toContain('B badge')
  })
})

describe('conflicts appear where they are caused', () => {
  it('renders the jab conflict at the Jab switch, not at the other punches', () => {
    const { tree } = renderMenu({ enabledPunches: [2, 4, 6], bias: 'lead' })

    const jabRow = tree.root.findByProps({ testID: 'punch-1-row' })
    expect(textOf(jabRow)).toContain('Error')
    expect(textOf(jabRow)).toContain('Enable the jab')

    const crossRow = tree.root.findByProps({ testID: 'punch-2-row' })
    expect(textOf(crossRow)).not.toContain('Error')
  })

  it('carries severity as words as well as tint (spec §19.4)', () => {
    const { tree } = renderMenu({ enabledPunches: [2, 4, 6], bias: 'balanced' })
    // Not lead-biased, so this one is a warning rather than an error.
    expect(textOf(tree.root)).toContain('Warning')
  })

  it('reports an empty defense list against a non-off frequency at the Defense group', () => {
    const { tree, conflicts } = renderMenu({ enabledDefense: [], defenseFrequency: 'moderate' })
    expect(conflicts.some((c) => c.code === 'enabledDefense-empty-with-frequency')).toBe(true)
    expect(textOf(tree.root)).toContain('none are enabled')
  })

  it('shows no conflict text for the default recipe', () => {
    const { tree, conflicts } = renderMenu()
    expect(conflicts.filter((c) => c.severity === 'error')).toEqual([])
    expect(textOf(tree.root)).not.toContain('Error')
  })
})
