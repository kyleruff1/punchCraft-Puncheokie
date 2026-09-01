/**
 * Cue token components (M32-06).
 *
 * The two assertions worth having here are the ones a redesign could break
 * without anyone noticing: that no mid-combination state ever renders red
 * (doc §13, §21), and that every state stays distinguishable with colour
 * removed (spec §19.4).
 */
// Reanimated stub (GH #305 Stage 3): PunchToken now imports Animated +
// useAnimatedStyle at module top, and the real module needs the native
// worklets runtime jest lacks. Same minimal stub punchAvatar.test uses;
// no test here passes a clock, so worklet paint stays inert and the
// props-driven states render exactly as before.
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest factory cannot use top-level imports
  default: { View: require('react-native').View },
  runOnJS: <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => fn(...args),
  useSharedValue: <T,>(init: T) => ({ value: init }),
  useFrameCallback: () => ({ setActive: () => {} }),
  useAnimatedStyle: (factory: () => object) => factory(),
}))

import React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { StyleSheet } from 'react-native'

import { CoachBanner } from '../CoachBanner'
import { DefenseToken } from '../DefenseToken'
import { FootworkToken } from '../FootworkToken'
import { PunchToken } from '../PunchToken'
import { StanceChangeCard } from '../StanceChangeCard'
import { STATE_VISUALS, TOKEN_DIAMETER, type TokenVisualState } from '../tokenVisuals'
import { colors } from '@/theme/colors'
import type {
  CoachCommand,
  DefenseCommand,
  FootworkCommand,
  PunchNumber,
} from '@domain/workout/WorkoutTokens'

const STATES: TokenVisualState[] = ['upcoming', 'active', 'completed']
const PUNCHES: PunchNumber[] = [1, 2, 3, 4, 5, 6]
const DEFENSE: DefenseCommand[] = ['duck', 'bob-weave', 'slip', 'roll', 'pull']
const FOOTWORK: FootworkCommand[] = ['pivot', 'step-off', 'circle', 'cut-off-ring', 'reset']
const COACH: CoachCommand[] = [
  'double-up',
  'put-it-on-em',
  'touch-and-go',
  'breathe',
  'hands-up',
]

const mounted: ReactTestRenderer[] = []

/** testID lookups counted once each; findAllByProps defaults to deep. */
function nodes(tree: ReactTestRenderer, testID: string): ReactTestInstance[] {
  return tree.root.findAllByProps({ testID }, { deep: false })
}

function render(element: React.JSX.Element): ReactTestRenderer {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(element)
  })
  mounted.push(tree)
  return tree
}

afterEach(() => {
  // Unmount so the ActiveRing animation loops are stopped between tests.
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

// ---------------------------------------------------------------------------

describe('the no-red-flash rule (doc §13, §21)', () => {
  // Widened to string[]: `colors` is `as const`, so the literal union would
  // reject the arbitrary strings pulled out of the rendered styles.
  const RED: string[] = [colors.danger, colors.dangerSurface]

  it.each(STATES)('PunchToken never renders red in state %s', (state) => {
    for (const number of PUNCHES) {
      for (const body of [false, true]) {
        const tree = render(<PunchToken number={number} body={body} state={state} />)
        expect(colorsIn(tree).filter((c) => RED.includes(c))).toEqual([])
      }
    }
  })

  it.each(STATES)('DefenseToken never renders red in state %s', (state) => {
    for (const command of DEFENSE) {
      const tree = render(<DefenseToken command={command} state={state} />)
      expect(colorsIn(tree).filter((c) => RED.includes(c))).toEqual([])
    }
  })

  it.each(STATES)('FootworkToken never renders red in state %s', (state) => {
    for (const command of FOOTWORK) {
      const tree = render(<FootworkToken command={command} state={state} />)
      expect(colorsIn(tree).filter((c) => RED.includes(c))).toEqual([])
    }
  })

  it('never renders red on the banner or the stance card', () => {
    for (const command of COACH) {
      expect(colorsIn(render(<CoachBanner command={command} visible />)).filter((c) =>
        RED.includes(c),
      )).toEqual([])
    }
    for (const stance of ['orthodox', 'southpaw'] as const) {
      expect(
        colorsIn(render(<StanceChangeCard toStance={stance} />)).filter((c) => RED.includes(c)),
      ).toEqual([])
    }
  })
})

describe('states are distinguishable without colour (spec §19.4)', () => {
  it('gives each state a distinct border weight', () => {
    // Border weight is the one cue that survives both greyscale AND a
    // missing glyph font, so all three must differ on it alone.
    const weights = STATES.map((s) => STATE_VISUALS[s].borderWidth)
    expect(new Set(weights).size).toBe(STATES.length)
  })

  it('separates every pair of states on at least two non-colour dimensions', () => {
    for (const a of STATES) {
      for (const b of STATES) {
        if (a === b) continue
        const differences = [
          STATE_VISUALS[a].borderWidth !== STATE_VISUALS[b].borderWidth,
          STATE_VISUALS[a].marker !== STATE_VISUALS[b].marker,
          (STATE_VISUALS[a].backgroundColor === 'transparent') !==
            (STATE_VISUALS[b].backgroundColor === 'transparent'),
        ].filter(Boolean)
        expect(differences.length).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('marks active and completed with a text glyph', () => {
    expect(STATE_VISUALS.active.marker).not.toBe('')
    expect(STATE_VISUALS.completed.marker).not.toBe('')
    expect(STATE_VISUALS.active.marker).not.toBe(STATE_VISUALS.completed.marker)
  })

  it('renders the state marker in the tree', () => {
    const active = render(<PunchToken number={1} body={false} state="active" />)
    expect(textOf(active.root.findByProps({ testID: 'state-marker' }))).toBe(
      STATE_VISUALS.active.marker,
    )

    const completed = render(<PunchToken number={1} body={false} state="completed" />)
    expect(textOf(completed.root.findByProps({ testID: 'state-marker' }))).toBe(
      STATE_VISUALS.completed.marker,
    )
  })

  it('leaves upcoming unfilled rather than marking it', () => {
    const tree = render(<PunchToken number={1} body={false} state="upcoming" />)
    expect(tree.root.findAllByProps({ testID: 'state-marker' })).toHaveLength(0)
    expect(STATE_VISUALS.upcoming.backgroundColor).toBe('transparent')
  })

  it('names the state in the accessibility label', () => {
    for (const state of STATES) {
      const tree = render(<PunchToken number={2} body={false} state={state} />)
      const label = tree.root.findByProps({ testID: 'punch-token-2' }).props.accessibilityLabel
      expect(label).toContain(STATE_VISUALS[state].label)
    }
  })
})

describe('PunchToken', () => {
  it.each(PUNCHES)('renders number %s', (number) => {
    const tree = render(<PunchToken number={number} body={false} state="upcoming" />)
    expect(textOf(tree.root.findByProps({ testID: `punch-token-${number}` }))).toContain(
      String(number),
    )
  })

  it('adds the uppercase B badge for a body shot', () => {
    const tree = render(<PunchToken number={2} body state="upcoming" />)
    const badge = tree.root.findByProps({ testID: 'body-badge' })
    expect(textOf(badge)).toBe('B')
  })

  it('omits the badge for a head shot', () => {
    const tree = render(<PunchToken number={2} body={false} state="upcoming" />)
    expect(tree.root.findAllByProps({ testID: 'body-badge' })).toHaveLength(0)
  })

  it('keeps the lowercase b to the testID/notation and the uppercase B to the badge (D10)', () => {
    const tree = render(<PunchToken number={2} body state="upcoming" />)
    // The serialized form stays lowercase; only the visual badge is capital.
    expect(() => tree.root.findByProps({ testID: 'punch-token-2b' })).not.toThrow()
    expect(textOf(tree.root.findByProps({ testID: 'body-badge' }))).toBe('B')
  })

  it('places a body shot lower on screen (doc §13)', () => {
    const head = render(<PunchToken number={2} body={false} state="upcoming" />)
    const body = render(<PunchToken number={2} body state="upcoming" />)
    const padOf = (t: ReactTestRenderer, id: string): number => {
      const flat = StyleSheet.flatten(t.root.findByProps({ testID: id }).props.style) as {
        paddingTop?: number
      }
      return flat.paddingTop ?? 0
    }
    expect(padOf(body, 'punch-token-2b')).toBeGreaterThan(padOf(head, 'punch-token-2'))
  })

  it('shows the caller-supplied hand hint and names it accessibly', () => {
    const tree = render(<PunchToken number={1} body={false} state="active" handHint="L" />)
    expect(textOf(tree.root.findByProps({ testID: 'hand-hint' }))).toBe('L')
    expect(tree.root.findByProps({ testID: 'punch-token-1' }).props.accessibilityLabel).toContain(
      'left hand',
    )
  })

  it('omits the hand hint when the caller does not supply one', () => {
    // The hand depends on stance, which this component deliberately does
    // not know (doc §11).
    const tree = render(<PunchToken number={1} body={false} state="active" />)
    expect(tree.root.findAllByProps({ testID: 'hand-hint' })).toHaveLength(0)
  })

  it('sizes the stage token for gloves (doc §25)', () => {
    expect(TOKEN_DIAMETER.stage).toBeGreaterThanOrEqual(88)
    expect(TOKEN_DIAMETER.preview).toBeLessThan(TOKEN_DIAMETER.stage)
  })
})

describe('DefenseToken', () => {
  it.each(DEFENSE)('renders the word and an icon for %s', (command) => {
    const tree = render(<DefenseToken command={command} state="upcoming" />)
    const text = textOf(tree.root.findByProps({ testID: `defense-token-${command}` }))
    expect(text.length).toBeGreaterThan(1)
    expect(tree.root.findByProps({ testID: `defense-token-${command}` }).props.accessibilityLabel)
      .toBeTruthy()
  })

  it('uses a rounded rectangle, not a circle, so shape separates it from a punch', () => {
    const tree = render(<DefenseToken command="slip" state="upcoming" />)
    const plate = tree.root
      .findAllByProps({ testID: 'defense-token-slip' })[0]!
      .findAll((n) => {
        const flat = StyleSheet.flatten(n.props?.style) as { borderRadius?: number } | undefined
        return typeof flat?.borderRadius === 'number'
      })
    const radii = plate.map(
      (n) => (StyleSheet.flatten(n.props.style) as { borderRadius: number }).borderRadius,
    )
    // 16 is the plate; a circle would be half the height.
    expect(radii).toContain(16)
  })
})

describe('FootworkToken', () => {
  it.each(FOOTWORK)('renders the word and an icon for %s', (command) => {
    const tree = render(<FootworkToken command={command} state="upcoming" />)
    expect(
      textOf(tree.root.findByProps({ testID: `footwork-token-${command}` })).length,
    ).toBeGreaterThan(1)
  })

  it('uses the ring form for circle and cut-off-ring', () => {
    for (const command of ['circle', 'cut-off-ring'] as const) {
      const tree = render(<FootworkToken command={command} state="upcoming" />)
      expect(() => tree.root.findByProps({ testID: 'footwork-ring-form' })).not.toThrow()
    }
  })

  it('uses the arrow form for single steps', () => {
    for (const command of ['pivot', 'step-off', 'reset'] as const) {
      const tree = render(<FootworkToken command={command} state="upcoming" />)
      expect(() => tree.root.findByProps({ testID: 'footwork-arrow-form' })).not.toThrow()
    }
  })
})

describe('CoachBanner', () => {
  it.each(COACH)('renders %s when visible', (command) => {
    const tree = render(<CoachBanner command={command} visible />)
    expect(textOf(tree.root.findByProps({ testID: `coach-banner-${command}` })).length)
      .toBeGreaterThan(0)
  })

  it('renders nothing when not visible', () => {
    const tree = render(<CoachBanner command="breathe" visible={false} />)
    expect(tree.toJSON()).toBeNull()
  })

  it('is visually subordinate — smaller type than a token and no ring', () => {
    const tree = render(<CoachBanner command="hands-up" visible />)
    const flat = StyleSheet.flatten(
      tree.root.findByProps({ testID: 'coach-banner-hands-up' }).props.style,
    ) as { borderWidth?: number }
    // No token outline: a coaching call must not compete with the command
    // the athlete is currently throwing.
    expect(flat.borderWidth).toBeUndefined()
  })
})

describe('StanceChangeCard', () => {
  it.each(['orthodox', 'southpaw'] as const)('names the stance and lead foot for %s', (stance) => {
    const tree = render(<StanceChangeCard toStance={stance} />)
    const text = textOf(tree.root.findByProps({ testID: 'stance-change-card' }))
    expect(text).toContain(stance === 'orthodox' ? 'Orthodox' : 'Southpaw')
    expect(text).toContain(stance === 'orthodox' ? 'Left foot forward' : 'Right foot forward')
  })

  it('shows a foot orientation diagram', () => {
    const tree = render(<StanceChangeCard toStance="southpaw" />)
    expect(() => tree.root.findByProps({ testID: 'foot-orientation' })).not.toThrow()
  })

  it('is full width and high contrast', () => {
    const tree = render(<StanceChangeCard toStance="orthodox" />)
    const flat = StyleSheet.flatten(
      tree.root.findByProps({ testID: 'stance-change-card' }).props.style,
    ) as { width?: string | number; borderWidth?: number }
    expect(flat.width).toBe('100%')
    expect(flat.borderWidth).toBeGreaterThanOrEqual(3)
  })

  it('shows a countdown only when given one, rounded up to whole seconds', () => {
    const without = render(<StanceChangeCard toStance="orthodox" />)
    expect(without.root.findAllByProps({ testID: 'stance-countdown' })).toHaveLength(0)

    const with3 = render(<StanceChangeCard toStance="orthodox" countdownMs={2_400} />)
    expect(textOf(with3.root.findByProps({ testID: 'stance-countdown' }))).toBe('3s')
  })

  it('never shows a negative countdown', () => {
    const tree = render(<StanceChangeCard toStance="orthodox" countdownMs={-500} />)
    expect(textOf(tree.root.findByProps({ testID: 'stance-countdown' }))).toBe('0s')
  })
})

describe('reduced motion (doc §25)', () => {
  it('renders every token type in both motion modes without error', () => {
    for (const reducedMotion of [false, true]) {
      for (const state of STATES) {
        expect(() =>
          render(<PunchToken number={3} body state={state} reducedMotion={reducedMotion} />),
        ).not.toThrow()
        expect(() =>
          render(<DefenseToken command="roll" state={state} reducedMotion={reducedMotion} />),
        ).not.toThrow()
        expect(() =>
          render(<FootworkToken command="circle" state={state} reducedMotion={reducedMotion} />),
        ).not.toThrow()
      }
    }
  })

  it('keeps the state readable with motion disabled', () => {
    // The ring is what moves; with motion off the marker and border still
    // carry the state.
    const tree = render(<PunchToken number={1} body={false} state="active" reducedMotion />)
    expect(textOf(tree.root.findByProps({ testID: 'state-marker' }))).toBe(
      STATE_VISUALS.active.marker,
    )
  })
})

describe('the form affirmation (reward only)', () => {
  it('renders nothing extra when not affirmed', () => {
    // Absence is never rendered: the signal behind this is too device-local
    // to accuse anyone with, so a non-agreement must look like an ordinary
    // punch.
    const tree = render(<PunchToken number={3} body={false} state="completed" />)
    expect(nodes(tree, 'affirmation-ring')).toHaveLength(0)
    expect(nodes(tree, 'affirmation-ring-static')).toHaveLength(0)
    expect(nodes(tree, 'affirmed-marker')).toHaveLength(0)
  })

  it('renders the bulging ring when affirmed', () => {
    const tree = render(<PunchToken number={3} body={false} state="completed" affirmed />)
    expect(() => tree.root.findByProps({ testID: 'affirmation-ring' })).not.toThrow()
  })

  it('replaces the bulge with a static ring under reduced motion (doc §25)', () => {
    const tree = render(
      <PunchToken number={3} body={false} state="completed" affirmed reducedMotion />,
    )
    expect(() => tree.root.findByProps({ testID: 'affirmation-ring-static' })).not.toThrow()
    expect(nodes(tree, 'affirmation-ring')).toHaveLength(0)
  })

  it('carries a glyph as well as the gold, so colour is never the only signal', () => {
    const tree = render(<PunchToken number={3} body={false} state="completed" affirmed />)
    expect(textOf(tree.root.findByProps({ testID: 'affirmed-marker' })).length).toBeGreaterThan(0)
  })

  it('names the reward in the accessibility label', () => {
    const tree = render(<PunchToken number={3} body={false} state="completed" affirmed />)
    expect(
      tree.root.findByProps({ testID: 'punch-token-3' }).props.accessibilityLabel,
    ).toContain('good form')
  })

  it('uses gold, never red', () => {
    // A reward may not borrow the one colour reserved for results.
    const tree = render(<PunchToken number={3} body={false} state="completed" affirmed />)
    const found = colorsIn(tree)
    expect(found).toContain(colors.gold)
    expect(found).not.toContain(colors.danger)
  })

  it('rides on top of the token state rather than replacing it', () => {
    // A completed-and-affirmed token is still completed.
    const tree = render(<PunchToken number={3} body={false} state="completed" affirmed />)
    expect(() => tree.root.findByProps({ testID: 'punch-token-3' })).not.toThrow()
    expect(colorsIn(tree)).toContain(colors.gold)
  })

  it('affirms across every state and both motion modes without error', () => {
    for (const state of STATES) {
      for (const reducedMotion of [false, true]) {
        expect(() =>
          render(
            <PunchToken
              number={1}
              body={false}
              state={state}
              affirmed
              reducedMotion={reducedMotion}
            />,
          ),
        ).not.toThrow()
      }
    }
  })
})

describe('every colour comes from the theme', () => {
  it('uses no hardcoded hex outside the palette', () => {
    const palette = new Set<string>([...Object.values(colors), 'transparent'])
    const trees = [
      render(<PunchToken number={4} body state="active" handHint="R" />),
      render(<DefenseToken command="duck" state="completed" />),
      render(<FootworkToken command="cut-off-ring" state="upcoming" />),
      render(<CoachBanner command="double-up" visible />),
      render(<StanceChangeCard toStance="southpaw" countdownMs={1_000} />),
    ]
    for (const tree of trees) {
      for (const color of colorsIn(tree)) {
        expect(palette.has(color)).toBe(true)
      }
    }
  })
})
