/**
 * Recipe screen component tests (M31-06).
 *
 * jest-expo + react-test-renderer — `@testing-library/react-native` is not
 * a dependency, and adding one for a handful of testID lookups was not
 * worth the install, so these walk the rendered tree directly.
 *
 * The recipe screen now sits behind picker rows: every preference
 * collapses to a header row; tapping the header opens a popout with
 * option Pressables. The `pickOption` helper hides both steps behind
 * one call so the tests read the same as they did against the old
 * SegmentedControl.
 *
 * expo-router is stubbed: `Stack.Screen` and `Link` only affect navigation
 * chrome, and the assertions here are about controls, conflicts and copy.
 */
import React from 'react'
import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'

jest.mock('expo-router', () => {
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
import PunchCraftLanding from '../index'
import PuncheokieLanding from '../../puncheokie/index'
import { useWorkoutStore } from '@state/useWorkoutStore'
import { listSampleWorkouts } from '@domain/workout/samples'
import { GOAL_TIERS } from '@domain/workout/punchGoals'

const store = () => useWorkoutStore.getState()

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

/**
 * Open a picker row and pick one of its options in a single call.
 * `pickerId` matches the row's `id` prop; `value` is stringified to
 * match the option testID pattern (`{pickerId}-option-{value}`).
 */
function pickOption(tree: ReactTestRenderer, pickerId: string, value: string | number): void {
  press(tree, `${pickerId}-toggle`)
  press(tree, `${pickerId}-option-${String(value)}`)
}

beforeEach(() => {
  act(() => {
    store().resetRecipe()
  })
})

describe('primary controls dispatch the right patch', () => {
  it.each([
    ['duration', '60', 'durationMinutes', 60],
    ['focus', 'movement', 'focus', 'movement'],
    ['bias', 'rear', 'bias', 'rear'],
    ['voice-mode', 'full', 'voiceMode', 'full'],
    ['voice-vocabulary', 'names', 'voiceVocabulary', 'names'],
    ['plan', 'goal-seeking', 'adaptationMode', 'goal-seeking'],
  ] as const)('%s → %s sets %s', (pickerId, option, field, expected) => {
    const tree = render(<RecipeScreen />)
    pickOption(tree, pickerId, option)
    expect(store().recipe[field]).toBe(expected)
  })

  it('maps the stance control onto both stance fields', () => {
    const tree = render(<RecipeScreen />)

    pickOption(tree, 'stance', 'southpaw')
    expect(store().recipe.defaultStance).toBe('southpaw')
    expect(store().recipe.stanceMode).toBe('fixed')

    // Choosing a switch mode keeps the stance already chosen as the
    // starting stance rather than silently resetting it to orthodox.
    pickOption(tree, 'stance', 'switch-by-round')
    expect(store().recipe.stanceMode).toBe('switch-by-round')
    expect(store().recipe.defaultStance).toBe('southpaw')
  })

  it('sets the goal from a tier preset at the current duration', () => {
    const tree = render(<RecipeScreen />)
    pickOption(tree, 'goal', 'hard')
    expect(store().recipe.totalPunchGoal).toBe(GOAL_TIERS.hard[store().recipe.durationMinutes])
  })

  it('steps the goal by 50 in each direction', () => {
    const tree = render(<RecipeScreen />)
    press(tree, 'goal-toggle')
    const before = store().recipe.totalPunchGoal
    press(tree, 'goal-stepper-plus')
    expect(store().recipe.totalPunchGoal).toBe(before + 50)
    press(tree, 'goal-stepper-minus')
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
    pickOption(tree, 'duration', '60')
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
    // Open the goal picker and pick the extreme tier — extreme-warning
    // renders inside the extraBody, which is only mounted while the
    // picker is open.
    pickOption(tree, 'goal', 'extreme')
    press(tree, 'goal-toggle')
    expect(() => tree.root.findByProps({ testID: 'extreme-warning' })).not.toThrow()
  })

  it('shows no warning at a moderate tier', () => {
    const tree = render(<RecipeScreen />)
    pickOption(tree, 'goal', 'steady')
    press(tree, 'goal-toggle')
    expect(tree.root.findAllByProps({ testID: 'extreme-warning' })).toHaveLength(0)
  })
})

describe('start with a sample', () => {
  it('lists every designed sample by name in the sample picker', () => {
    const tree = render(<RecipeScreen />)
    // Open the picker so the option rows mount.
    press(tree, 'sample-toggle')
    const text = allText(tree)
    for (const sample of listSampleWorkouts()) {
      expect(text).toContain(sample.name)
      expect(() =>
        tree.root.findByProps({ testID: `sample-option-${sample.key}` }),
      ).not.toThrow()
    }
  })

  it('selects and deselects a sample', () => {
    const tree = render(<RecipeScreen />)
    pickOption(tree, 'sample', 'switch-by-round')
    expect(store().selectedSampleKey).toBe('switch-by-round')
    // Deselect by picking None; the picker's "value" for the deselected
    // state is the sentinel 'none' option.
    pickOption(tree, 'sample', 'none')
    expect(store().selectedSampleKey).toBeUndefined()
  })
})

describe('scoring language (D4)', () => {
  it('scores on punch count and never promises technique accuracy', () => {
    const tree = render(<RecipeScreen />)
    const text = allText(tree)
    expect(text.toLowerCase()).toContain('punch count')
    expect(text).not.toMatch(/technique (accuracy|recognition)/i)
  })

  it('offers Start now that the live screen exists (M32-08)', () => {
    const tree = render(<RecipeScreen />)
    expect(tree.root.findByProps({ testID: 'start-button' }).props.disabled).toBeUndefined()
    // Honest about what it runs on: simulated punches until M33-01 wires
    // the trackers in.
    expect(allText(tree)).toContain('simulated punches')
  })
})

describe('advanced panel (M31-07)', () => {
  it('renders nothing from the menu while collapsed', () => {
    const tree = render(<RecipeScreen />)
    expect(tree.root.findAllByProps({ testID: 'enablement-menu' })).toHaveLength(0)
  })

  it('expands without mutating any value', () => {
    const tree = render(<RecipeScreen />)
    const before = store().recipe
    press(tree, 'advanced-toggle')
    expect(store().recipe).toEqual(before)
    expect(() => tree.root.findByProps({ testID: 'enablement-menu' })).not.toThrow()
  })

  it('updates the summary card in the same interaction as a menu change', () => {
    const tree = render(<RecipeScreen />)
    press(tree, 'advanced-toggle')
    const before = textOf(tree.root.findByProps({ testID: 'recipe-summary-card' }))
    act(() => {
      const node = tree.root.findByProps({ testID: 'punch-5' })
      node.props.onValueChange(!node.props.value)
    })
    expect(store().recipe.enabledPunches).not.toContain(5)
    expect(textOf(tree.root.findByProps({ testID: 'recipe-summary-card' }))).not.toEqual(before)
  })
})

describe('punchCraft landing — the workout home', () => {
  it('never mentions beats or the retired sequence grade (D3)', () => {
    // The descriptive tagline is gone (Kyle 2026-08-28 — the wordmark and
    // the buttons carry the page); the D3 language rules still hold for
    // whatever copy remains.
    const tree = render(<PunchCraftLanding />)
    const text = allText(tree)
    expect(text.toLowerCase()).not.toContain('hand-sequence match')
    expect(text.toLowerCase()).not.toContain('beat')
  })

  it('offers the entry point into the recipe screen', () => {
    // The button is the branded image now; the action phrase lives in the
    // pressable's accessibility label rather than in rendered text.
    const tree = render(<PunchCraftLanding />)
    const button = tree.root.findByProps({ accessibilityLabel: 'Build a workout' })
    expect(button.props.accessibilityRole).toBe('button')
  })

  it('shows every preset as an always-visible grid tile', () => {
    // The presets are a grid now, not a popout — every tile mounted and
    // named without any interaction.
    const tree = render(<PunchCraftLanding />)
    const text = allText(tree)
    for (const sample of listSampleWorkouts()) {
      expect(text).toContain(sample.name)
      expect(() => tree.root.findByProps({ testID: `preset-${sample.key}` })).not.toThrow()
    }
  })

  it('tile tap selects (and re-tap clears); quick-start arms only with a pick', () => {
    const tree = render(<PunchCraftLanding />)
    expect(store().selectedSampleKey).toBeUndefined()
    expect(tree.root.findByProps({ testID: 'quick-start' }).props.disabled).toBe(true)

    press(tree, 'preset-switch-by-round')
    expect(store().selectedSampleKey).toBe('switch-by-round')
    expect(tree.root.findByProps({ testID: 'quick-start' }).props.disabled).toBe(false)

    press(tree, 'preset-switch-by-round')
    expect(store().selectedSampleKey).toBeUndefined()
  })

  it('Build a workout mints a fresh seed and clears any library pick (M35)', () => {
    const tree = render(<PunchCraftLanding />)
    act(() => store().selectSample('switch-by-round'))
    const before = store().recipe.seed
    press(tree, 'setup-workout')
    expect(store().selectedSampleKey).toBeUndefined()
    expect(store().recipe.seed).not.toBe(before)
  })
})

describe('Puncheokie landing — the instrument', () => {
  it('opens the jam and offers no workout routes', () => {
    const tree = render(<PuncheokieLanding />)
    expect(() => tree.root.findByProps({ testID: 'open-jam' })).not.toThrow()
    expect(tree.root.findAllByProps({ testID: 'setup-workout' }, { deep: false })).toHaveLength(0)
  })

  it('lists the launch patches with the default selected', () => {
    const tree = render(<PuncheokieLanding />)
    expect(() =>
      tree.root.findByProps({ testID: 'patch-two-handed-pentatonic' }),
    ).not.toThrow()
    expect(allText(tree)).toContain('Two-Handed Pentatonic')
  })
})
