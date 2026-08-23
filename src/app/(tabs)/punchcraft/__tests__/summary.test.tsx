/**
 * Summary screen (M33-08).
 *
 * The presentation rules under test are the ones that would quietly turn a
 * measurement into an accusation: nothing scolds a short count, an
 * unmeasured figure is absent rather than zero, and velocity says what it
 * is instead of implying a physical unit.
 */
import React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

jest.mock('expo-router', () => {
  function Stack() {
    return null
  }
  function Screen() {
    return null
  }
  Stack.Screen = Screen
  return { Stack, useRouter: () => ({ back: jest.fn() }) }
})

import SummaryScreen, { SHORT_COUNT_NOTE } from '../summary'
import { computeWorkoutSummary, type SummaryCueResult } from '@domain/programs/workoutSummary'
import { threeRoundFundamentals } from '@domain/workout/samples'

const WORKOUT = threeRoundFundamentals
const BLOCK = WORKOUT.schedule[0]!.blocks[0]!.id

function rows(count: number, over: Partial<SummaryCueResult> = {}): SummaryCueResult[] {
  return Array.from({ length: count }, (_, i) => ({
    blockId: BLOCK,
    tokenIndex: i,
    expectedHand: i % 2 === 0 ? ('left' as const) : ('right' as const),
    outcome: 'matched' as const,
    offsetMs: 0,
    velocityRaw: 10,
    velocityUnit: 'tracker-unit',
    capabilityTier: 'hand-timestamp',
    ...over,
  }))
}

const mounted: ReactTestRenderer[] = []

function render(cueResults: SummaryCueResult[], extras = 0): ReactTestRenderer {
  const summary = computeWorkoutSummary({
    workout: WORKOUT,
    cueResults,
    extraPunches: extras,
  })
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(<SummaryScreen summary={summary} />)
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

const allText = (tree: ReactTestRenderer): string => textOf(tree.root)

function nodes(tree: ReactTestRenderer, testID: string): ReactTestInstance[] {
  return tree.root.findAllByProps({ testID }, { deep: false })
}

// ---------------------------------------------------------------------------

describe('the screen renders doc §24', () => {
  it('shows the headline count badge and the per-round breakdown', () => {
    const tree = render(rows(30))
    expect(() => tree.root.findByProps({ testID: 'summary-screen' })).not.toThrow()
    expect(() => tree.root.findByProps({ testID: 'round-0' })).not.toThrow()
    expect(() => tree.root.findByProps({ testID: 'round-2' })).not.toThrow()
  })

  it('shows the lead metrics', () => {
    const tree = render(rows(30), 4)
    expect(textOf(tree.root.findByProps({ testID: 'summary-extras' }))).toContain('4')
    expect(() => tree.root.findByProps({ testID: 'summary-rate' })).not.toThrow()
    expect(() => tree.root.findByProps({ testID: 'summary-left-right' })).not.toThrow()
  })

  it('shows the seed and versions that make a replay possible', () => {
    const tree = render(rows(10))
    const provenance = textOf(tree.root.findByProps({ testID: 'summary-provenance' }))
    expect(provenance).toContain(WORKOUT.recipe.seed)
    expect(provenance).toContain('calculation')
  })

  it('handles having no summary at all', () => {
    let tree!: ReactTestRenderer
    act(() => {
      tree = create(<SummaryScreen />)
    })
    mounted.push(tree)
    expect(() => tree.root.findByProps({ testID: 'summary-empty' })).not.toThrow()
  })
})

describe('a short count is a measurement, not a verdict (doc §21, D13)', () => {
  it('shows the transmit-floor note when short', () => {
    const tree = render(rows(10))
    expect(textOf(tree.root.findByProps({ testID: 'short-count-note' }))).toBe(SHORT_COUNT_NOTE)
  })

  it('does not show it when the target was met', () => {
    // The note explains a low number; it would be noise on a met target.
    const tree = render(rows(WORKOUT.recipe.totalPunchGoal))
    expect(nodes(tree, 'short-count-note')).toHaveLength(0)
  })

  it('never scolds', () => {
    const text = allText(render(rows(3))).toLowerCase()
    for (const word of ['fail', 'failed', 'poor', 'bad', 'weak', 'only', 'try harder']) {
      expect(text).not.toContain(word)
    }
  })

  it('uses no letter grade', () => {
    const text = allText(render(rows(3)))
    expect(text).not.toMatch(/\bgrade\b/i)
    expect(text).not.toMatch(/\b[A-F][+-]?\b\s*(grade|rating)/)
  })
})

describe('absent, never zero (D11)', () => {
  it('omits velocity metrics when nothing measured them', () => {
    const tree = render(rows(20, { velocityRaw: null, velocityUnit: null }))
    expect(nodes(tree, 'summary-avg-velocity')).toHaveLength(0)
    expect(nodes(tree, 'summary-peak-velocity')).toHaveLength(0)
  })

  it('says plainly that no velocity was recorded', () => {
    const tree = render(rows(20, { velocityRaw: null, velocityUnit: null }))
    expect(textOf(tree.root.findByProps({ testID: 'velocity-representation' }))).toMatch(
      /no velocity/i,
    )
  })

  it('shows them when velocity was recorded', () => {
    const tree = render(rows(20))
    expect(() => tree.root.findByProps({ testID: 'summary-avg-velocity' })).not.toThrow()
  })
})

describe('velocity is disclosed, not implied (spec §8.5, §4.3)', () => {
  it('always renders the representation line', () => {
    const tree = render(rows(20))
    expect(() => tree.root.findByProps({ testID: 'velocity-representation' })).not.toThrow()
  })

  it('labels velocity figures as tracker-reported', () => {
    expect(allText(render(rows(20)))).toContain('tracker-reported velocity')
  })

  it('never states a physical unit', () => {
    expect(allText(render(rows(20)))).not.toMatch(/\bmph\b|\bm\/s\b|newton|joule/i)
  })
})

describe('the sequence label is resolved, never asserted (D4)', () => {
  it('says hand-sequence match at this tier', () => {
    expect(allText(render(rows(20)))).toContain('hand-sequence match')
  })

  it('never claims technique accuracy', () => {
    expect(allText(render(rows(20)))).not.toMatch(/technique accuracy/i)
  })

  it('would say technique match only if the tier allowed it', () => {
    // Proves the string is resolved rather than hardcoded.
    const tree = render(rows(20, { capabilityTier: 'hand-distinct-type' }))
    expect(allText(tree)).toContain('technique match')
  })
})

describe('adaptations are explained, not hidden', () => {
  it('says nothing when the plan never adapted', () => {
    const tree = render(rows(20))
    expect(nodes(tree, 'adaptation-note')).toHaveLength(0)
  })

  it('reports how many times the plan changed', () => {
    const summary = computeWorkoutSummary({
      workout: WORKOUT,
      cueResults: rows(20),
      adaptations: [
        { decidedAtMonotonicMs: 1, boundary: 'rest' },
        { decidedAtMonotonicMs: 2, boundary: 'rest' },
      ],
    })
    let tree!: ReactTestRenderer
    act(() => {
      tree = create(<SummaryScreen summary={summary} />)
    })
    mounted.push(tree)
    expect(textOf(tree.root.findByProps({ testID: 'adaptation-note' }))).toContain('2 times')
  })
})
