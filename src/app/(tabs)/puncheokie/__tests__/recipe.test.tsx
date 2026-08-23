/**
 * Recipe screen component tests (M31-06).
 *
 * jest-expo + react-test-renderer — `@testing-library/react-native` is not
 * a dependency, and adding one for a handful of testID lookups was not
 * worth the install, so these walk the rendered tree directly.
 *
 * expo-router is stubbed: `Stack.Screen` and `Link` only affect navigation
 * chrome, and the assertions here are about controls, conflicts and copy.
 */
import React from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'

jest.mock('expo-router', () => {
  // Named function declarations so react/display-name is satisfied; the
  // factory touches React only in type position, which is erased, so
  // jest.mock hoisting stays safe.
  function Stack() {
    return null
  }
  function Screen() {
    return null
  }
  Stack.Screen = Screen
  function Link({ children }: { children: React.ReactNode }) {
    return children
  }
  return { Stack, Link }
})

import RecipeScreen from '../recipe'
import PuncheokieLanding from '../index'
import { useWorkoutStore } from '@state/useWorkoutStore'
import { listSampleWorkouts } from '@domain/workout/samples'
import { GOAL_TIERS } from '@domain/workout/punchGoals'

const store = () => useWorkoutStore.getState()

/**
 * Rendered trees are tracked and unmounted after each test. A tree left
 * mounted keeps subscribing to the store, so the next test's setup writes
 * would re-render it outside act() and emit warnings that have nothing to
 * do with the test being run.
 */
const mounted: ReactTestRenderer[] = []

function render(element: React.JSX.Element): ReactTestRenderer {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(element)
  })
  mounted.push(tree)
  return tree
}

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount()
  })
})

/**
 * Every string rendered under a node, concatenated in render order.
 *
 * `ReactTestInstance.children` holds child instances, not text, so this
 * walks the subtree; joining with '' keeps adjacent JSX fragments reading
 * as the single sentence the athlete sees.
 */
function textOf(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join('')
}

function allText(tree: ReactTestRenderer): string {
  return textOf(tree.root)
}

function press(tree: ReactTestRenderer, testID: string): void {
  act(() => {
    tree.root.findByProps({ testID }).props.onPress()
  })
}

beforeEach(() => {
  act(() => {
    store().resetRecipe()
    // resetRecipe deliberately leaves the panel as the athlete left it, so
    // each test collapses it explicitly rather than inheriting the previous
    // test's state.
    store().setAdvancedOpen(false)
  })
})

describe('primary controls dispatch the right patch', () => {
  it.each([
    ['duration-60', 'durationMinutes', 60],
    ['focus-movement', 'focus', 'movement'],
    ['bias-rear', 'bias', 'rear'],
    ['voice-mode-full', 'voiceMode', 'full'],
    ['voice-vocabulary-names', 'voiceVocabulary', 'names'],
    ['plan-goal-seeking', 'adaptationMode', 'goal-seeking'],
  ] as const)('%s sets %s', (testID, field, expected) => {
    const tree = render(<RecipeScreen />)
    press(tree, testID)
    expect(store().recipe[field]).toBe(expected)
  })

  it('maps the stance control onto both stance fields', () => {
    const tree = render(<RecipeScreen />)

    press(tree, 'stance-southpaw')
    expect(store().recipe.defaultStance).toBe('southpaw')
    expect(store().recipe.stanceMode).toBe('fixed')

    // Choosing a switch mode keeps the stance already chosen as the
    // starting stance rather than silently resetting it to orthodox.
    press(tree, 'stance-switch-by-round')
    expect(store().recipe.stanceMode).toBe('switch-by-round')
    expect(store().recipe.defaultStance).toBe('southpaw')
  })

  it('sets the goal from a tier preset at the current duration', () => {
    const tree = render(<RecipeScreen />)
    press(tree, 'tier-hard')
    expect(store().recipe.totalPunchGoal).toBe(GOAL_TIERS.hard[store().recipe.durationMinutes])
  })

  it('steps the goal by 50 in each direction', () => {
    const tree = render(<RecipeScreen />)
    const before = store().recipe.totalPunchGoal
    press(tree, 'goal-plus')
    expect(store().recipe.totalPunchGoal).toBe(before + 50)
    press(tree, 'goal-minus')
    expect(store().recipe.totalPunchGoal).toBe(before)
  })
})

describe('summary card', () => {
  it('always shows the expected active pace (doc §8)', () => {
    const tree = render(<RecipeScreen />)
    const pace = tree.root.findByProps({ testID: 'expected-active-pace' })
    expect(textOf(pace)).toContain('Expected active pace')
    expect(textOf(pace)).toContain(`${store().summary.expectedActivePace}`)
  })

  it('recomputes when duration changes', () => {
    const tree = render(<RecipeScreen />)
    const before = textOf(tree.root.findByProps({ testID: 'recipe-summary-card' }))
    press(tree, 'duration-60')
    const after = textOf(tree.root.findByProps({ testID: 'recipe-summary-card' }))
    expect(after).not.toEqual(before)
    expect(after).toContain('60 minutes')
  })
})

describe('conflicts', () => {
  it('renders the jab-disabled conflict with text and an icon, not colour alone', () => {
    act(() => {
      store().setRecipe({ enabledPunches: [2, 4, 6], bias: 'lead' })
    })
    const tree = render(<RecipeScreen />)
    const text = allText(tree)

    // The severity word carries the meaning; the tint only reinforces it.
    expect(text).toContain('Error')
    // Every conflict states what to change, so the screen is never a dead end.
    const notices = tree.root.findAll(
      (node) =>
        typeof node.props.testID === 'string' && node.props.testID.startsWith('conflict-'),
    )
    expect(notices.length).toBeGreaterThan(0)
    for (const notice of notices) {
      expect(notice.props.accessibilityRole).toBe('alert')
    }
  })

  it('shows the Extreme warning when the goal reaches that tier (doc §10)', () => {
    const tree = render(<RecipeScreen />)
    press(tree, 'tier-extreme')
    expect(() => tree.root.findByProps({ testID: 'extreme-warning' })).not.toThrow()
  })

  it('shows no warning at a moderate tier', () => {
    const tree = render(<RecipeScreen />)
    press(tree, 'tier-steady')
    expect(tree.root.findAllByProps({ testID: 'extreme-warning' })).toHaveLength(0)
  })
})

describe('start with a sample', () => {
  it('lists all three M31-05 samples by name and key', () => {
    const tree = render(<RecipeScreen />)
    const text = allText(tree)
    for (const sample of listSampleWorkouts()) {
      expect(text).toContain(sample.name)
      expect(() => tree.root.findByProps({ testID: `sample-${sample.key}` })).not.toThrow()
    }
  })

  it('selects and deselects a sample', () => {
    const tree = render(<RecipeScreen />)
    press(tree, 'sample-switch-by-round')
    expect(store().selectedSampleKey).toBe('switch-by-round')
    press(tree, 'sample-switch-by-round')
    expect(store().selectedSampleKey).toBeUndefined()
  })
})

describe('scoring language (D4)', () => {
  it('calls scoring a hand-sequence match and never promises technique accuracy', () => {
    const tree = render(<RecipeScreen />)
    const text = allText(tree)
    expect(text).toContain('hand-sequence match')
    expect(text).not.toMatch(/technique (accuracy|recognition)/i)
  })

  it('gates Start until the live screen exists (M32-08)', () => {
    const tree = render(<RecipeScreen />)
    expect(tree.root.findByProps({ testID: 'start-button' }).props.disabled).toBe(true)
    expect(allText(tree)).toContain('The live screen arrives in M32.')
  })
})

describe('advanced panel (M31-07)', () => {
  it('renders nothing from the menu while collapsed', () => {
    const tree = render(<RecipeScreen />)
    expect(tree.root.findAllByProps({ testID: 'enablement-menu' })).toHaveLength(0)
  })

  it('expands without mutating any value (doc §8)', () => {
    const tree = render(<RecipeScreen />)
    const before = store().recipe
    press(tree, 'advanced-affordance')
    expect(store().advancedOpen).toBe(true)
    expect(store().recipe).toEqual(before)
    expect(() => tree.root.findByProps({ testID: 'enablement-menu' })).not.toThrow()
  })

  it('keeps its open state in the store, so it survives a remount', () => {
    const first = render(<RecipeScreen />)
    press(first, 'advanced-affordance')
    // A fresh render stands in for navigating away and back inside the tab.
    const second = render(<RecipeScreen />)
    expect(() => second.root.findByProps({ testID: 'enablement-menu' })).not.toThrow()
  })

  it('updates the summary card in the same interaction as a menu change', () => {
    const tree = render(<RecipeScreen />)
    press(tree, 'advanced-affordance')
    const before = textOf(tree.root.findByProps({ testID: 'recipe-summary-card' }))
    act(() => {
      const node = tree.root.findByProps({ testID: 'punch-5' })
      node.props.onValueChange(!node.props.value)
    })
    expect(store().recipe.enabledPunches).not.toContain(5)
    expect(textOf(tree.root.findByProps({ testID: 'recipe-summary-card' }))).not.toEqual(before)
  })
})

describe('landing screen', () => {
  it('carries the approved copy and never mentions beats (D3)', () => {
    const tree = render(<PuncheokieLanding />)
    const text = allText(tree)
    expect(text).toContain(
      'Numbered combinations run on an independent workout clock: every cue, rest, and round is scheduled by punchCraft on the tablet, never by a song.',
    )
    expect(text).toContain('labeled as a hand-sequence match')
    expect(text.toLowerCase()).not.toContain('beat')
  })

  it('offers the entry point into the recipe screen', () => {
    const tree = render(<PuncheokieLanding />)
    expect(allText(tree)).toContain('Set up a workout')
  })
})
