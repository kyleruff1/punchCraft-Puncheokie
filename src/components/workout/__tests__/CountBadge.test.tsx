/**
 * Round count badge (M33-03, doc §23).
 *
 * This is the one component allowed to render red, so the load-bearing test
 * here is the greyscale one: strip every colour out of the rendered tree and
 * the three outcomes must still be three distinguishable things (spec
 * §19.4). Everything else — byte-exact doc §23 strings, no letter grades,
 * tier-named sequence copy — follows from that.
 */
import React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { StyleSheet } from 'react-native'

import { CountBadge, OUTCOME_VISUALS, type CountBadgeSize } from '../CountBadge'
import { colors } from '@/theme/colors'
import { gradeRound, type RoundOutcome } from '@domain/programs/roundGrading'
import { sequenceScoreLabel, type CapabilityTier } from '@domain/workout/capabilityTier'

/** The three doc §23 examples, verbatim. */
const CASES: { outcome: RoundOutcome; actual: number; target: number }[] = [
  { outcome: 'over', actual: 246, target: 240 },
  { outcome: 'short', actual: 221, target: 240 },
  { outcome: 'exact', actual: 240, target: 240 },
]

const SIZES: CountBadgeSize[] = ['hero', 'compact']

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

/** Every colour value appearing anywhere in the rendered tree's styles. */
function colorsIn(tree: ReactTestRenderer): string[] {
  const found: string[] = []
  const visit = (node: ReactTestInstance): void => {
    const flat = StyleSheet.flatten(node.props?.style) as Record<string, unknown> | undefined
    if (flat) {
      for (const [key, value] of Object.entries(flat)) {
        if (typeof value === 'string' && /color/i.test(key)) found.push(value)
      }
    }
    for (const child of node.children) {
      if (typeof child !== 'string') visit(child)
    }
  }
  visit(tree.root)
  return found
}

/**
 * Walk the tree the way a greyscale display or a screen reader would: keep
 * every string and every testID, discard every colour. What survives is what
 * the result has to be readable from.
 */
function withoutColour(tree: ReactTestRenderer): { text: string; testIDs: string[] } {
  const strings: string[] = []
  const testIDs: string[] = []
  const visit = (node: ReactTestInstance): void => {
    const id = node.props?.testID
    // The circle's testID carries the outcome for querying; normalise it,
    // so the comparison below is about what a person can actually see.
    if (typeof id === 'string') testIDs.push(id.replace(/^count-badge-circle-.*$/, 'circle'))
    for (const child of node.children) {
      if (typeof child === 'string') strings.push(child)
      else visit(child)
    }
  }
  visit(tree.root)
  return { text: strings.join(' ').replace(/\s+/g, ' ').trim(), testIDs: testIDs.sort() }
}

// ---------------------------------------------------------------------------

describe('the doc §23 treatments, byte for byte', () => {
  it.each(SIZES)('renders 246 / 240 and +6 OVER at size %s', (size) => {
    const tree = render(<CountBadge actual={246} target={240} size={size} />)
    expect(textOf(tree.root.findByProps({ testID: 'count-badge-count' }))).toBe('246 / 240')
    expect(textOf(tree.root.findByProps({ testID: 'count-badge-status' }))).toBe('+6 OVER')
  })

  it.each(SIZES)('renders 221 / 240 and 19 SHORT at size %s', (size) => {
    const tree = render(<CountBadge actual={221} target={240} size={size} />)
    expect(textOf(tree.root.findByProps({ testID: 'count-badge-count' }))).toBe('221 / 240')
    expect(textOf(tree.root.findByProps({ testID: 'count-badge-status' }))).toBe('19 SHORT')
  })

  it.each(SIZES)('renders 240 / 240 and EXACT TARGET at size %s', (size) => {
    const tree = render(<CountBadge actual={240} target={240} size={size} />)
    expect(textOf(tree.root.findByProps({ testID: 'count-badge-count' }))).toBe('240 / 240')
    expect(textOf(tree.root.findByProps({ testID: 'count-badge-status' }))).toBe('EXACT TARGET')
  })

  it.each(CASES)('always renders an icon beside the text ($outcome)', ({ actual, target }) => {
    for (const size of SIZES) {
      const tree = render(<CountBadge actual={actual} target={target} size={size} />)
      const icon = textOf(tree.root.findByProps({ testID: 'count-badge-icon' }))
      expect(icon.length).toBeGreaterThan(0)
      // Siblings in one row: neither may render without the other.
      const row = textOf(tree.root.findByProps({ testID: 'count-badge-status-row' }))
      expect(row).toContain(icon)
      expect(row).toContain(textOf(tree.root.findByProps({ testID: 'count-badge-status' })))
    }
  })
})

describe('the three states survive colour removal (spec §19.4)', () => {
  it('gives each outcome a different glyph and a different word', () => {
    const icons = CASES.map((c) => OUTCOME_VISUALS[c.outcome].icon)
    expect(new Set(icons).size).toBe(CASES.length)

    const iconLabels = CASES.map((c) => OUTCOME_VISUALS[c.outcome].iconLabel)
    expect(new Set(iconLabels).size).toBe(CASES.length)
  })

  it('leaves three distinguishable trees once every colour is stripped', () => {
    const stripped = CASES.map(({ actual, target }) =>
      withoutColour(render(<CountBadge actual={actual} target={target} />)),
    )
    // Same structure — so structure is not doing the work either. What
    // separates them is purely the text content.
    for (const s of stripped) {
      expect(s.testIDs).toEqual(stripped[0]!.testIDs)
    }
    expect(new Set(stripped.map((s) => s.text)).size).toBe(CASES.length)
  })

  it('separates every pair of outcomes on at least two non-colour signals', () => {
    for (const a of CASES) {
      for (const b of CASES) {
        if (a.outcome === b.outcome) continue
        const treeA = render(<CountBadge actual={a.actual} target={a.target} />)
        const treeB = render(<CountBadge actual={b.actual} target={b.target} />)
        const pick = (t: ReactTestRenderer, id: string): string =>
          textOf(t.root.findByProps({ testID: id }))
        const differences = [
          pick(treeA, 'count-badge-icon') !== pick(treeB, 'count-badge-icon'),
          pick(treeA, 'count-badge-status') !== pick(treeB, 'count-badge-status'),
          pick(treeA, 'count-badge-count') !== pick(treeB, 'count-badge-count'),
        ].filter(Boolean)
        expect(differences.length).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('names the outcome in the accessibility label without naming a colour', () => {
    const labels = CASES.map(({ actual, target }) => {
      const tree = render(<CountBadge actual={actual} target={target} />)
      return tree.root.findByProps({ testID: 'count-badge' }).props.accessibilityLabel as string
    })
    expect(new Set(labels).size).toBe(CASES.length)
    for (const label of labels) {
      expect(label).not.toMatch(/\b(green|red|gold|colou?r)\b/i)
    }
  })
})

describe('red is allowed here — and only here, and only for short', () => {
  const RED: string[] = [colors.danger, colors.dangerSurface]

  it('uses danger for the short result', () => {
    expect(OUTCOME_VISUALS.short.tint).toBe(colors.danger)
    const tree = render(<CountBadge actual={221} target={240} />)
    expect(colorsIn(tree)).toContain(colors.danger)
  })

  it('never renders red for over or exact', () => {
    for (const { outcome, actual, target } of CASES) {
      if (outcome === 'short') continue
      for (const size of SIZES) {
        const tree = render(<CountBadge actual={actual} target={target} size={size} />)
        expect(colorsIn(tree).filter((c) => RED.includes(c))).toEqual([])
      }
    }
  })

  it('uses success for over and gold for exact (doc §23)', () => {
    expect(OUTCOME_VISUALS.over.tint).toBe(colors.success)
    expect(OUTCOME_VISUALS.exact.tint).toBe(colors.gold)
  })

  it('draws every colour from the theme', () => {
    const palette = new Set<string>([...Object.values(colors), 'transparent'])
    for (const { actual, target } of CASES) {
      const tree = render(
        <CountBadge
          actual={actual}
          target={target}
          sequenceScore={{ pct: 82, tier: 'hand-timestamp' }}
        />,
      )
      for (const color of colorsIn(tree)) expect(palette.has(color)).toBe(true)
    }
  })
})

describe('counts only — no letter grades, no technique claims', () => {
  it('renders no letter grade for any outcome', () => {
    for (const { actual, target } of CASES) {
      for (const size of SIZES) {
        const tree = render(<CountBadge actual={actual} target={target} size={size} />)
        const text = withoutColour(tree).text
        expect(text).not.toMatch(/\b[ABCDF][+-]?\b/)
        expect(text).not.toMatch(/\bgrade\b/i)
      }
    }
  })

  it.each(['hand-only', 'hand-timestamp', 'hand-broad-type', 'hand-distinct-type'] as const)(
    'labels the adjacent sequence score from the %s tier (D4)',
    (tier: CapabilityTier) => {
      const tree = render(
        <CountBadge actual={246} target={240} sequenceScore={{ pct: 82, tier }} />,
      )
      expect(textOf(tree.root.findByProps({ testID: 'count-badge-sequence-score' }))).toBe(
        `82% ${sequenceScoreLabel(tier)}`,
      )
    },
  )

  it('says hand-sequence match on the FightCamp v1 tier, never accuracy', () => {
    const tree = render(
      <CountBadge actual={246} target={240} sequenceScore={{ pct: 82, tier: 'hand-timestamp' }} />,
    )
    const text = textOf(tree.root.findByProps({ testID: 'count-badge-sequence-score' }))
    expect(text).toContain('hand-sequence match')
    expect(text).not.toMatch(/accuracy|technique/i)
  })

  it('omits the caption entirely when no sequence score is supplied', () => {
    const tree = render(<CountBadge actual={246} target={240} />)
    expect(tree.root.findAllByProps({ testID: 'count-badge-sequence-score' })).toHaveLength(0)
  })
})

describe('a short round is presented as a result, not a failure (doc §21)', () => {
  const SCOLDING = [/\bfail(ed|ure)?\b/i, /\bmissed?\b/i, /\bpoor\b/i, /\bonly\b/i, /\bbad\b/i]

  it('uses no verdict word in the visible text or the spoken label', () => {
    const tree = render(<CountBadge actual={221} target={240} />)
    const visible = withoutColour(tree).text
    const spoken = tree.root.findByProps({ testID: 'count-badge' }).props
      .accessibilityLabel as string
    for (const pattern of SCOLDING) {
      expect(visible).not.toMatch(pattern)
      expect(spoken).not.toMatch(pattern)
    }
    expect(spoken).toBe('221 of 240 punches. 19 short of target.')
  })

  it('shows the full count line for a very short round rather than hiding it', () => {
    const tree = render(<CountBadge actual={12} target={240} />)
    expect(textOf(tree.root.findByProps({ testID: 'count-badge-count' }))).toBe('12 / 240')
    expect(textOf(tree.root.findByProps({ testID: 'count-badge-status' }))).toBe('228 SHORT')
  })
})

describe('sizing and shape', () => {
  it.each(SIZES)('renders a circle at size %s', (size) => {
    const tree = render(<CountBadge actual={240} target={240} size={size} />)
    const flat = StyleSheet.flatten(
      tree.root.findByProps({ testID: 'count-badge-circle-exact' }).props.style,
    ) as { width: number; height: number; borderRadius: number }
    expect(flat.width).toBe(flat.height)
    expect(flat.borderRadius).toBe(flat.width / 2)
  })

  it('makes the hero form larger than the compact one', () => {
    const diameterOf = (size: CountBadgeSize): number => {
      const tree = render(<CountBadge actual={240} target={240} size={size} />)
      const flat = StyleSheet.flatten(
        tree.root.findByProps({ testID: 'count-badge-circle-exact' }).props.style,
      ) as { width: number }
      return flat.width
    }
    expect(diameterOf('hero')).toBeGreaterThan(diameterOf('compact'))
  })

  it('defaults to the hero form', () => {
    const explicit = render(<CountBadge actual={240} target={240} size="hero" />)
    const implied = render(<CountBadge actual={240} target={240} />)
    expect(implied.toJSON()).toEqual(explicit.toJSON())
  })

  it('tags the circle with the outcome so the state is queryable', () => {
    for (const { outcome, actual, target } of CASES) {
      const tree = render(<CountBadge actual={actual} target={target} />)
      expect(() =>
        tree.root.findByProps({ testID: `count-badge-circle-${outcome}` }),
      ).not.toThrow()
      expect(gradeRound(actual, target).outcome).toBe(outcome)
    }
  })
})
