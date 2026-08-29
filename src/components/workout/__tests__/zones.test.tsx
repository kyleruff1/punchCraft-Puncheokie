/**
 * Live-layout zones (M32-07).
 *
 * The assertions that matter most here are the honesty ones: that a
 * velocity surface is *absent* rather than empty when the tracker cannot
 * measure velocity, and that a hand-pattern score is never called
 * technique accuracy.
 */
import React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'

import { CueStage, type CueView } from '../CueStage'
import { MetricsRail, MAX_OPTIONAL_TILES, OPTIONAL_TILES, type TileId, type VelocityView } from '../MetricsRail'
import { RoundTopBar, formatCountdown } from '../RoundTopBar'
import { expandTimeline } from '@domain/programs/CueTimeline'
import { CADENCE_PROFILES } from '@domain/workout/cadence'
import { threeRoundFundamentals } from '@domain/workout/samples'
import type { CapabilityTier } from '@domain/workout/capabilityTier'

const STEADY_BPM = CADENCE_PROFILES.steady.nominalBpm
const TIMELINE = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)

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

const allText = (tree: ReactTestRenderer): string => textOf(tree.root)

/**
 * All nodes carrying a testID, counted once each.
 *
 * `findAllByProps` defaults to `deep: true`, which returns both the
 * composite and the host node for every match and silently doubles any
 * count taken from it.
 */
function nodes(tree: ReactTestRenderer, testID: string): ReactTestInstance[] {
  return tree.root.findAllByProps({ testID }, { deep: false })
}

function cueView(cueIndex = 0, overrides: Partial<CueView> = {}): CueView {
  const cue = TIMELINE[0]!.cues[cueIndex]!
  return {
    cue,
    tokenStates: cue.tokens.map(() => 'upcoming' as const),
    ...overrides,
  }
}

const velocity = (value: number): VelocityView => ({
  value,
  unit: 'tracker-unit',
  label: 'tracker-reported velocity',
})

// ---------------------------------------------------------------------------

describe('CueStage', () => {
  it('renders the current combination', () => {
    const view = cueView()
    const tree = render(<CueStage current={view} />)
    expect(() => tree.root.findByProps({ testID: 'cue-stage-current' })).not.toThrow()
    // One token component per token in the cue.
    for (const token of view.cue.tokens) {
      if (token.kind !== 'punch') continue
      expect(
        tree.root.findAllByProps({
          testID: `punch-token-${token.number}${token.body ? 'b' : ''}`,
        }).length,
      ).toBeGreaterThan(0)
    }
  })

  it('renders the next combination above, dimmed and smaller', () => {
    const tree = render(<CueStage current={cueView(0)} next={cueView(1)} />)
    expect(() => tree.root.findByProps({ testID: 'cue-stage-next' })).not.toThrow()
    expect(allText(tree)).toContain('Next')
  })

  it('shows an idle state with no current cue', () => {
    const tree = render(<CueStage />)
    expect(() => tree.root.findByProps({ testID: 'cue-stage-idle' })).not.toThrow()
  })

  it('keeps the whole combination visible so it can be anticipated', () => {
    // The active token is highlighted, but the rest stay on screen rather
    // than being revealed one at a time.
    const view = cueView(0)
    const states = view.cue.tokens.map((_, i) => (i === 0 ? ('active' as const) : ('upcoming' as const)))
    const tree = render(<CueStage current={{ ...view, tokenStates: states }} />)
    const markers = nodes(tree, 'state-marker')
    // Exactly one active marker; the other tokens render without one.
    expect(markers.length).toBe(1)
  })

  it('renders a repeat indicator with a dot per repeat', () => {
    const view = cueView(0, { repeatTotal: 3 })
    const tree = render(<CueStage current={view} />)
    expect(textOf(tree.root.findByProps({ testID: 'repeat-indicator' }))).toContain('×3')
    const filled = nodes(tree, 'repeat-dot-filled').length
    const empty = nodes(tree, 'repeat-dot-empty').length
    expect(filled + empty).toBe(3)
  })

  it('fills one more dot on each successive repeat', () => {
    const base = TIMELINE[0]!.cues[0]!
    const second = render(
      <CueStage
        current={{
          cue: { ...base, repeatIndex: 1 },
          tokenStates: base.tokens.map(() => 'upcoming' as const),
          repeatTotal: 3,
        }}
      />,
    )
    expect(nodes(second, 'repeat-dot-filled')).toHaveLength(2)
  })

  it('omits the repeat indicator for a single-pass combination', () => {
    const tree = render(<CueStage current={cueView(0, { repeatTotal: 1 })} />)
    expect(nodes(tree, 'repeat-indicator')).toHaveLength(0)
  })

  it('gives punch tokens a hand hint drawn from the resolved expectations', () => {
    const view = cueView(0)
    const tree = render(<CueStage current={view} />)
    const hints = nodes(tree, 'hand-hint').map((n) => textOf(n))
    expect(hints).toEqual(
      view.cue.expectedPunches.map((p) => (p.hand === 'left' ? 'L' : 'R')),
    )
  })

  it('renders defense tokens with their own shape', () => {
    // Round 1 block 2 of the sample is a slip-led defense counter.
    const defenseCue = TIMELINE[0]!.cues.find((c) =>
      c.tokens.some((t) => t.kind === 'defense'),
    )!
    const tree = render(
      <CueStage
        current={{
          cue: defenseCue,
          tokenStates: defenseCue.tokens.map(() => 'upcoming' as const),
        }}
      />,
    )
    expect(nodes(tree, 'defense-token-slip').length).toBeGreaterThan(0)
  })

  it('renders in both motion modes', () => {
    for (const reducedMotion of [false, true]) {
      expect(() =>
        render(<CueStage current={cueView()} next={cueView(1)} reducedMotion={reducedMotion} />),
      ).not.toThrow()
    }
  })
})

describe('RoundTopBar', () => {
  const base = {
    roundIndex: 0,
    roundCount: 3,
    roundRemainingMs: 125_000,
    stance: 'orthodox' as const,
    connection: { left: 'streaming' as const, right: 'streaming' as const },
  }

  it('renders stance; round + countdown live in the tabs header now', () => {
    // Kyle 2026-08-28: round/clock moved to the header's 75% line
    // (HeaderRoundClock in (tabs)/_layout) — this bar keeps stance,
    // gloves and the degraded notice only.
    const tree = render(<RoundTopBar {...base} />)
    expect(textOf(tree.root.findByProps({ testID: 'stance-label' }))).toBe('Orthodox')
    expect(tree.root.findAllByProps({ testID: 'round-counter' })).toHaveLength(0)
    expect(tree.root.findAllByProps({ testID: 'round-countdown' })).toHaveLength(0)
  })

  it.each([
    [0, '0:00'],
    [999, '0:01'],
    [60_000, '1:00'],
    [180_000, '3:00'],
    [-5_000, '0:00'],
  ])('formats %sms as %s', (ms, expected) => {
    expect(formatCountdown(ms)).toBe(expected)
  })

  it('renders a lamp per glove — no L/R letters, no state words (Kyle 2026-08-29)', () => {
    const tree = render(<RoundTopBar {...base} />)
    expect(() => tree.root.findByProps({ testID: 'tracker-lamp-L' })).not.toThrow()
    expect(() => tree.root.findByProps({ testID: 'tracker-lamp-R' })).not.toThrow()
  })

  it('a simulated source shows unlit lamps and no SIM text — the header owns the tag', () => {
    const tree = render(
      <RoundTopBar {...base} connection={{ left: 'simulated', right: 'simulated' }} />,
    )
    expect(
      tree.root.findByProps({ testID: 'tracker-lamp-L' }).props.accessibilityLabel,
    ).toContain('not connected')
    expect(textOf(tree.root)).not.toContain('SIM')
  })

  it('renders no battery text even when supplied — the lamps-only bar', () => {
    const with60 = render(<RoundTopBar {...base} batteryPct={{ left: 60.4 }} />)
    expect(nodes(with60, 'glove-battery-L')).toHaveLength(0)
    expect(nodes(with60, 'glove-battery-R')).toHaveLength(0)
  })

  it('renders the degraded warning as text plus an icon, not a bare colour (spec §19.4)', () => {
    const tree = render(<RoundTopBar {...base} degraded="Right glove reconnecting" />)
    const warning = tree.root.findByProps({ testID: 'degraded-warning' })
    expect(textOf(warning)).toContain('Right glove reconnecting')
    // The '!' icon glyph carries the severity alongside the message.
    expect(textOf(warning)).toContain('!')
    expect(warning.props.accessibilityRole).toBe('alert')
  })

  it('omits the degraded row when not degraded', () => {
    const tree = render(<RoundTopBar {...base} />)
    expect(nodes(tree, 'degraded-warning')).toHaveLength(0)
  })

  it('names each glove state accessibly', () => {
    const tree = render(
      <RoundTopBar {...base} connection={{ left: 'streaming', right: 'error' }} />,
    )
    expect(
      tree.root.findByProps({ testID: 'tracker-lamp-L' }).props.accessibilityLabel,
    ).toContain('Left tracker connected')
    expect(
      tree.root.findByProps({ testID: 'tracker-lamp-R' }).props.accessibilityLabel,
    ).toContain('Right tracker not connected')
  })
})

describe('MetricsRail', () => {
  const base = {
    counts: { total: 42, left: 20, right: 22 },
    roundGoal: 120,
    requiredPace: 63.4,
    velocityAvailable: true,
    capabilityTier: 'hand-timestamp' as CapabilityTier,
    tiles: [] as TileId[],
  }

  it('renders the default metrics', () => {
    const tree = render(<MetricsRail {...base} />)
    expect(textOf(tree.root.findByProps({ testID: 'metric-punches' }))).toContain('42 / 120')
    expect(textOf(tree.root.findByProps({ testID: 'metric-required-pace' }))).toContain('63/min')
    expect(textOf(tree.root.findByProps({ testID: 'metric-left-right' }))).toContain('20 / 22')
  })

  it('shows an em dash rather than a zero for an unmeasured pace', () => {
    // "Not measured yet" and "zero" are different facts.
    const tree = render(<MetricsRail {...base} requiredPace={undefined} />)
    expect(textOf(tree.root.findByProps({ testID: 'metric-required-pace' }))).toContain('—')
  })

  it('renders velocity metrics with the approved label', () => {
    const tree = render(
      <MetricsRail {...base} avgVelocity={velocity(9.6)} lastVelocity={velocity(12.2)} />,
    )
    expect(textOf(tree.root.findByProps({ testID: 'metric-avg-velocity' }))).toContain('10')
    expect(allText(tree)).toContain('tracker-reported velocity')
  })

  it('supports exactly the eight documented tiles', () => {
    expect([...OPTIONAL_TILES].sort()).toEqual(
      [
        'combo-completion',
        'connection-completeness',
        'correct-hand-percent',
        'left-right-balance',
        'peak-velocity',
        'projected-final',
        'punches-last-15s',
        'velocity-zone',
      ].sort(),
    )
  })

  it.each(OPTIONAL_TILES)('renders tile %s', (id) => {
    const tree = render(<MetricsRail {...base} tiles={[id]} />)
    expect(() => tree.root.findByProps({ testID: `tile-${id}` })).not.toThrow()
  })

  it('renders no tile section when none are chosen', () => {
    const tree = render(<MetricsRail {...base} tiles={[]} />)
    expect(nodes(tree, 'optional-tiles')).toHaveLength(0)
  })

  it('renders the full optional set — a metric-heavy rail', () => {
    // The cap was raised from D9's four to the whole optional set for a
    // metric-heavy screen; with velocity available, every optional tile shows.
    const tree = render(<MetricsRail {...base} tiles={[...OPTIONAL_TILES]} />)
    const rendered = OPTIONAL_TILES.filter((id) => nodes(tree, `tile-${id}`).length > 0)
    expect(rendered).toHaveLength(OPTIONAL_TILES.length)
    expect(OPTIONAL_TILES.length).toBeLessThanOrEqual(MAX_OPTIONAL_TILES)
  })

  it('renders four when exactly four are chosen', () => {
    const four: TileId[] = [
      'left-right-balance',
      'correct-hand-percent',
      'combo-completion',
      'projected-final',
    ]
    const tree = render(<MetricsRail {...base} tiles={four} />)
    for (const id of four) {
      expect(() => tree.root.findByProps({ testID: `tile-${id}` })).not.toThrow()
    }
  })

  it('derives the left/right tile from counts when no value is supplied', () => {
    const tree = render(<MetricsRail {...base} tiles={['left-right-balance']} />)
    expect(textOf(tree.root.findByProps({ testID: 'tile-left-right-balance' }))).toContain('20 / 22')
  })

  it('shows an em dash for a tile with no data yet', () => {
    const tree = render(<MetricsRail {...base} tiles={['correct-hand-percent']} />)
    expect(textOf(tree.root.findByProps({ testID: 'tile-correct-hand-percent' }))).toContain('—')
  })

  it('uses a supplied tile value when given one', () => {
    const tree = render(
      <MetricsRail {...base} tiles={['projected-final']} tileValues={{ 'projected-final': 980 }} />,
    )
    expect(textOf(tree.root.findByProps({ testID: 'tile-projected-final' }))).toContain('980')
  })
})

describe('capability gating (doc §3, M32-02)', () => {
  const base = {
    counts: { total: 10, left: 5, right: 5 },
    velocityAvailable: false,
    capabilityTier: 'hand-only' as CapabilityTier,
    tiles: [] as TileId[],
  }

  it('omits velocity metrics entirely rather than rendering them empty', () => {
    // A greyed "Avg velocity —" reads as the athlete failing to produce a
    // number; the truth is the tracker cannot measure one.
    const tree = render(
      <MetricsRail {...base} avgVelocity={velocity(9)} lastVelocity={velocity(9)} />,
    )
    expect(nodes(tree, 'metric-avg-velocity')).toHaveLength(0)
    expect(nodes(tree, 'metric-last-velocity')).toHaveLength(0)
    expect(allText(tree)).not.toContain('velocity')
  })

  it('omits velocity tiles too', () => {
    const tree = render(<MetricsRail {...base} tiles={['peak-velocity', 'velocity-zone']} />)
    expect(nodes(tree, 'tile-peak-velocity')).toHaveLength(0)
    expect(nodes(tree, 'tile-velocity-zone')).toHaveLength(0)
  })

  it('drops the hidden velocity tiles rather than rendering them empty', () => {
    const tiles: TileId[] = [
      'peak-velocity',
      'velocity-zone',
      'left-right-balance',
      'correct-hand-percent',
      'combo-completion',
      'projected-final',
    ]
    const tree = render(<MetricsRail {...base} tiles={tiles} />)
    const rendered = OPTIONAL_TILES.filter((id) => nodes(tree, `tile-${id}`).length > 0)
    // Velocity unavailable: the two velocity tiles are gone, the four others stay.
    expect(rendered).toHaveLength(4)
    expect(rendered).not.toContain('peak-velocity')
    expect(rendered).not.toContain('velocity-zone')
  })

  it('restores velocity surfaces when the source can report it', () => {
    const tree = render(
      <MetricsRail
        {...base}
        velocityAvailable
        capabilityTier="hand-timestamp"
        avgVelocity={velocity(11)}
        tiles={['peak-velocity']}
      />,
    )
    expect(() => tree.root.findByProps({ testID: 'metric-avg-velocity' })).not.toThrow()
    expect(() => tree.root.findByProps({ testID: 'tile-peak-velocity' })).not.toThrow()
  })
})

describe('the hand-sequence match label (D4, spec §13.3)', () => {
  const base = {
    counts: { total: 10, left: 5, right: 5 },
    velocityAvailable: true,
    tiles: ['correct-hand-percent'] as TileId[],
  }

  it.each([
    ['hand-only', 'hand-sequence match'],
    ['hand-timestamp', 'hand-sequence match'],
    ['hand-broad-type', 'hand-sequence match'],
    ['hand-distinct-type', 'technique match'],
  ] as const)('captions the correct-hand tile with %s → %s', (tier, expected) => {
    const tree = render(<MetricsRail {...base} capabilityTier={tier} />)
    expect(textOf(tree.root.findByProps({ testID: 'tile-correct-hand-percent' }))).toContain(
      expected,
    )
  })

  it('never says technique accuracy at the tier this hardware reaches', () => {
    const tree = render(<MetricsRail {...base} capabilityTier="hand-timestamp" />)
    expect(allText(tree)).toContain('hand-sequence match')
    expect(allText(tree)).not.toMatch(/technique accuracy/i)
  })
})
