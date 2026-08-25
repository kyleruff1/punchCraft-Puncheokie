/**
 * Rest screen and its three phases (M33-04, doc §23, D6).
 *
 * The load-bearing tests here are the two rules that are easy to regress
 * quietly:
 *
 * - **Colour is not doing any work.** Strip every colour out of the tree
 *   and the three phases must still be three distinguishable things
 *   (spec §19.4). Unlike `CountBadge`, this component tints nothing per
 *   phase at all, so the assertion is that the *headings, glyphs, step
 *   markers and content* separate them.
 * - **Nothing scolds.** A short round and a dropped glove are both
 *   measurement statements (doc §21, D13), and the copy for each is checked
 *   against the same verdict-word list the badge uses.
 */
import React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { StyleSheet } from 'react-native'

import {
  RestPhases,
  SHORT_ROUND_NOTE,
  TRACKER_DROPPED_NOTE,
  restAnnouncementText,
  type RestNextRound,
} from '../RestPhases'
import { colors } from '@/theme/colors'
import { restPhaseAt, type FrozenRoundResult, type RestPhase } from '@domain/session/restPhases'

const MINUTE = 60_000

/** Elapsed time that sits squarely inside each phase of a 60 s rest. */
const AT: Record<RestPhase, number> = { result: 2_000, recovery: 25_000, preview: 50_000 }

const FROZEN: FrozenRoundResult = {
  roundIndex: 1,
  actual: 246,
  target: 240,
  left: 124,
  right: 122,
  avgVelocity: { value: 68.4, unit: 'tracker-unit', label: 'tracker-reported velocity' },
  bestVelocity: { value: 92.1, unit: 'tracker-unit', label: 'tracker-reported velocity' },
  precision: 34,
  trackerDropped: false,
}

const NEXT: RestNextRound = {
  theme: 'Hooks after the jab',
  stance: 'orthodox',
  sampleCombos: ['1-2-3', '1-2b-3'],
}

const mounted: ReactTestRenderer[] = []

function render(
  overrides: Partial<React.ComponentProps<typeof RestPhases>> = {},
): ReactTestRenderer {
  let tree!: ReactTestRenderer
  act(() => {
    tree = create(
      <RestPhases
        frozen={FROZEN}
        nextRound={NEXT}
        restElapsedMs={AT.result}
        restDurationMs={MINUTE}
        onSkipRest={() => undefined}
        {...overrides}
      />,
    )
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
  return textOf(tree.root).replace(/\s+/g, ' ').trim()
}

function has(tree: ReactTestRenderer, testID: string): boolean {
  return tree.root.findAllByProps({ testID }).length > 0
}

/** Every colour appearing anywhere in the rendered tree's styles. */
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

describe('the phase on screen follows the clock, not a timer of its own', () => {
  it.each(['result', 'recovery', 'preview'] as const)('shows the %s view', (phase) => {
    const tree = render({ restElapsedMs: AT[phase] })
    expect(has(tree, `rest-phase-${phase}`)).toBe(true)
    for (const other of ['result', 'recovery', 'preview'] as const) {
      if (other !== phase) expect(has(tree, `rest-phase-${other}`)).toBe(false)
    }
  })

  it('agrees with restPhaseAt at every boundary', () => {
    for (const elapsed of [0, 11_999, 12_000, 44_999, 45_000, 59_999]) {
      const tree = render({ restElapsedMs: elapsed })
      expect(has(tree, `rest-phase-${restPhaseAt(elapsed, MINUTE)}`)).toBe(true)
    }
  })

  it('counts the rest down rather than up', () => {
    expect(textOf(render({ restElapsedMs: 0 }).root.findByProps({ testID: 'rest-countdown' })))
      .toBe('1:00')
    expect(
      textOf(render({ restElapsedMs: 45_000 }).root.findByProps({ testID: 'rest-countdown' })),
    ).toBe('0:15')
  })
})

describe('the three phases survive colour removal (spec §19.4)', () => {
  const phases = ['result', 'recovery', 'preview'] as const

  it('gives each phase a different heading, glyph and step marker', () => {
    const read = (phase: RestPhase, id: string): string =>
      textOf(render({ restElapsedMs: AT[phase] }).root.findByProps({ testID: id }))

    for (const id of ['rest-phase-heading', 'rest-phase-glyph', 'rest-step-marker']) {
      expect(new Set(phases.map((p) => read(p, id))).size).toBe(3)
    }
  })

  it('separates every pair of phases on at least three non-colour signals', () => {
    const signals = (phase: RestPhase): string[] => {
      const tree = render({ restElapsedMs: AT[phase] })
      return ['rest-phase-heading', 'rest-phase-glyph', 'rest-step-marker'].map((id) =>
        textOf(tree.root.findByProps({ testID: id })),
      )
    }
    for (const a of phases) {
      for (const b of phases) {
        if (a === b) continue
        const [sa, sb] = [signals(a), signals(b)]
        expect(sa.filter((value, index) => value !== sb[index])).toHaveLength(3)
      }
    }
  })

  it('leaves three different bodies of text once colour is gone', () => {
    expect(new Set(phases.map((p) => allText(render({ restElapsedMs: AT[p] })))).size).toBe(3)
  })

  it('tints no chrome per phase — the header colours are identical throughout', () => {
    // The badge's outcome tint is the only colour that varies, and it lives
    // inside the result view, not in the phase chrome.
    const headerColours = (phase: RestPhase): string[] => {
      const tree = render({ restElapsedMs: AT[phase] })
      const header = tree.root.findByProps({ testID: 'rest-header' })
      const found: string[] = []
      const visit = (node: ReactTestInstance): void => {
        const flat = StyleSheet.flatten(node.props?.style) as Record<string, unknown> | undefined
        if (flat) {
          for (const [key, value] of Object.entries(flat)) {
            if (typeof value === 'string' && /color/i.test(key)) found.push(value)
          }
        }
        for (const child of node.children) if (typeof child !== 'string') visit(child)
      }
      visit(header)
      return found.sort()
    }
    expect(headerColours('recovery')).toEqual(headerColours('result'))
    expect(headerColours('preview')).toEqual(headerColours('result'))
  })

  it('draws every colour from the theme', () => {
    const palette = new Set<string>([...Object.values(colors), 'transparent'])
    for (const phase of phases) {
      for (const colour of colorsIn(render({ restElapsedMs: AT[phase] }))) {
        expect(palette.has(colour)).toBe(true)
      }
    }
  })
})

describe('result phase — the round grade card (D25)', () => {
  it('shows the four numbers the athlete came for', () => {
    // Punches thrown / max velocity / avg velocity / precision. Four tiles,
    // one row, no verdict.
    const tree = render({ restElapsedMs: AT.result })
    expect(textOf(tree.root.findByProps({ testID: 'grade-punches' }))).toContain('246')
    expect(textOf(tree.root.findByProps({ testID: 'grade-max-velocity' }))).toContain('92')
    expect(textOf(tree.root.findByProps({ testID: 'grade-avg-velocity' }))).toContain('68')
    expect(textOf(tree.root.findByProps({ testID: 'grade-precision' }))).toContain('34')
  })

  it('carries the target under the punches tile', () => {
    const tree = render({ restElapsedMs: AT.result })
    expect(textOf(tree.root.findByProps({ testID: 'grade-punches' }))).toContain('240')
  })

  it('renders an em-dash rather than zero when the tracker sent no velocity', () => {
    // D11: an absent capability is absent, not a false zero. `246 punches at
    // an average velocity of zero` would read as the athlete's failing.
    const { avgVelocity: _avg, bestVelocity: _best, ...noVelocity } = FROZEN
    const tree = render({ frozen: noVelocity, restElapsedMs: AT.result })
    expect(textOf(tree.root.findByProps({ testID: 'grade-max-velocity' }))).toContain('—')
    expect(textOf(tree.root.findByProps({ testID: 'grade-avg-velocity' }))).toContain('—')
  })

  it('explains why precision reads zero on hardware that rarely confirms type', () => {
    // Zero precision is honest here: the FightCamp v1 byte only reliably
    // discriminates some techniques per device (H12). The tile carries a
    // small line the athlete can read so a zero is not misread as failure.
    const tree = render({ frozen: { ...FROZEN, precision: 0 }, restElapsedMs: AT.result })
    const tile = textOf(tree.root.findByProps({ testID: 'grade-precision' }))
    expect(tile).toContain('0')
    expect(tile.toLowerCase()).toContain('hardware')
  })

  it('names the tile "correct hand and type" when precision is non-zero', () => {
    const tree = render({ restElapsedMs: AT.result })
    const tile = textOf(tree.root.findByProps({ testID: 'grade-precision' })).toLowerCase()
    expect(tile).toContain('correct hand and type')
  })

  it('renders no letter grade', () => {
    const text = allText(render({ restElapsedMs: AT.result }))
    expect(text).not.toMatch(/\bgrade\b/i)
  })
})

describe('a short round is a result, not a failure (doc §21, D13)', () => {
  const SHORT: FrozenRoundResult = { ...FROZEN, actual: 19, target: 240 }
  const SCOLDING = [/\bfail(ed|ure)?\b/i, /\bmissed?\b/i, /\bpoor\b/i, /\bonly\b/i, /\bbad\b/i]

  it('says what the count is a measurement of, and nothing about the athlete', () => {
    const tree = render({ frozen: SHORT, restElapsedMs: AT.result })
    expect(textOf(tree.root.findByProps({ testID: 'rest-short-note' }))).toBe(SHORT_ROUND_NOTE)
    for (const pattern of SCOLDING) expect(allText(tree)).not.toMatch(pattern)
  })

  it('shows the note for a short round only', () => {
    expect(has(render({ restElapsedMs: AT.result }), 'rest-short-note')).toBe(false)
    expect(
      has(render({ frozen: { ...FROZEN, actual: 240 }, restElapsedMs: AT.result }), 'rest-short-note'),
    ).toBe(false)
    expect(has(render({ frozen: SHORT, restElapsedMs: AT.result }), 'rest-short-note')).toBe(true)
  })

  it('uses no verdict word in any phase, for a short round or a dropped glove', () => {
    for (const phase of ['result', 'recovery', 'preview'] as const) {
      const tree = render({
        frozen: { ...SHORT, trackerDropped: true },
        restElapsedMs: AT[phase],
      })
      for (const pattern of SCOLDING) expect(allText(tree)).not.toMatch(pattern)
    }
  })
})

describe('recovery phase — doc §23 contents', () => {
  it('shows the left / right balance', () => {
    const tree = render({ restElapsedMs: AT.recovery })
    expect(textOf(tree.root.findByProps({ testID: 'rest-balance' }))).toContain('124 / 122')
  })

  it('falls back to best tracker-reported velocity when there is no best combo', () => {
    const tree = render({ restElapsedMs: AT.recovery })
    const best = textOf(tree.root.findByProps({ testID: 'rest-best' }))
    expect(best).toContain('tracker-reported velocity')
    expect(best).toContain('92')
  })

  it('prefers the best combination when one is supplied', () => {
    const tree = render({
      frozen: { ...FROZEN, bestCombo: '1-2-3-2' },
      restElapsedMs: AT.recovery,
    })
    const best = textOf(tree.root.findByProps({ testID: 'rest-best' }))
    expect(best).toContain('1-2-3-2')
    expect(best).not.toMatch(/velocity/i)
  })

  it('warns about a dropped tracker with text, not a colour', () => {
    const plain = render({ restElapsedMs: AT.recovery })
    expect(has(plain, 'rest-tracker-dropped')).toBe(false)

    const dropped = render({
      frozen: { ...FROZEN, trackerDropped: true },
      restElapsedMs: AT.recovery,
    })
    const note = textOf(dropped.root.findByProps({ testID: 'rest-tracker-dropped' }))
    expect(note).toContain(TRACKER_DROPPED_NOTE)
    // Text plus glyph, and no danger tint anywhere (spec §19.4, doc §21).
    expect(note).toContain('⚠')
    expect(colorsIn(dropped)).not.toContain(colors.danger)
  })
})

describe('reduced motion disables the breathing animation (doc §25)', () => {
  it('breathes by default', () => {
    expect(has(render({ restElapsedMs: AT.recovery }), 'rest-breath-animated')).toBe(true)
  })

  it('goes still when reduced motion is on, keeping the word', () => {
    const tree = render({ restElapsedMs: AT.recovery, reducedMotion: true })
    expect(has(tree, 'rest-breath-animated')).toBe(false)
    expect(has(tree, 'rest-breath-static')).toBe(true)
    expect(allText(tree)).toContain('Breathe')
  })
})

describe('preview phase — doc §23 contents', () => {
  it('names the next theme, the stance and two sample combinations', () => {
    const tree = render({ restElapsedMs: AT.preview })
    expect(textOf(tree.root.findByProps({ testID: 'rest-next-theme' }))).toBe('Hooks after the jab')
    expect(textOf(tree.root.findByProps({ testID: 'rest-next-stance' }))).toContain('Orthodox')
    expect(textOf(tree.root.findByProps({ testID: 'rest-sample-combo-0' }))).toBe('1-2-3')
    expect(textOf(tree.root.findByProps({ testID: 'rest-sample-combo-1' }))).toBe('1-2b-3')
  })

  it('shows two at most, however many are supplied', () => {
    const tree = render({
      restElapsedMs: AT.preview,
      nextRound: { ...NEXT, sampleCombos: ['1', '1-2', '1-2-3', '1-2-3-2'] },
    })
    expect(has(tree, 'rest-sample-combo-1')).toBe(true)
    expect(has(tree, 'rest-sample-combo-2')).toBe(false)
  })

  it('says the workout is done rather than previewing nothing after the last round', () => {
    const tree = render({ restElapsedMs: AT.preview, nextRound: undefined })
    expect(textOf(tree.root.findByProps({ testID: 'rest-next-theme' }))).toBe('Last round complete')
    expect(has(tree, 'rest-sample-combos')).toBe(false)
  })
})

describe('skip rest is one control for one state (D6)', () => {
  it.each(['result', 'recovery', 'preview'] as const)(
    'offers exactly one skip control during the %s phase',
    (phase) => {
      const tree = render({ restElapsedMs: AT[phase] })
      expect(tree.root.findAllByProps({ testID: 'rest-skip' }).length).toBeGreaterThan(0)
      // No per-phase skip anywhere in the tree.
      expect(allText(tree)).not.toMatch(/skip (result|recovery|preview|phase)/i)
    },
  )

  it('calls back once per press', () => {
    const onSkipRest = jest.fn()
    const tree = render({ restElapsedMs: AT.recovery, onSkipRest })
    act(() => {
      tree.root.findByProps({ testID: 'rest-skip' }).props.onPress()
    })
    expect(onSkipRest).toHaveBeenCalledTimes(1)
  })
})

describe('voice stays behind the port (D1, M34)', () => {
  it('announces once per phase, not once per render', () => {
    const onAnnounce = jest.fn()
    let tree!: ReactTestRenderer
    act(() => {
      tree = create(
        <RestPhases
          frozen={FROZEN}
          nextRound={NEXT}
          restElapsedMs={0}
          restDurationMs={MINUTE}
          onSkipRest={() => undefined}
          onAnnounce={onAnnounce}
        />,
      )
    })
    mounted.push(tree)

    const update = (elapsed: number): void => {
      act(() => {
        tree.update(
          <RestPhases
            frozen={FROZEN}
            nextRound={NEXT}
            restElapsedMs={elapsed}
            restDurationMs={MINUTE}
            onSkipRest={() => undefined}
            onAnnounce={onAnnounce}
          />,
        )
      })
    }

    // Ten ticks inside the result phase, then one into each later phase.
    for (let ms = 100; ms <= 1_000; ms += 100) update(ms)
    expect(onAnnounce).toHaveBeenCalledTimes(1)

    update(AT.recovery)
    update(AT.preview)
    expect(onAnnounce).toHaveBeenCalledTimes(3)
    expect(onAnnounce.mock.calls.map((c) => c[0].phase)).toEqual([
      'result',
      'recovery',
      'preview',
    ])
  })

  it('is silent when no port is wired', () => {
    expect(() => render({ restElapsedMs: AT.result })).not.toThrow()
  })
})

describe('restAnnouncementText', () => {
  it('reports the round and the two counts without a verdict (doc §23)', () => {
    expect(restAnnouncementText('result', FROZEN, NEXT)).toBe(
      'Round 2 complete. 246 of 240 punches. 6 over target. Average 68 tracker-reported velocity.',
    )
  })

  it('omits velocity when there is none to report', () => {
    const { avgVelocity: _avg, ...noVelocity } = FROZEN
    expect(restAnnouncementText('result', noVelocity, NEXT)).not.toMatch(/velocity/i)
  })

  it('names the next theme and stance in the preview', () => {
    expect(restAnnouncementText('preview', FROZEN, NEXT)).toBe(
      'Next round: Hooks after the jab. Orthodox stance.',
    )
  })

  it('says the workout is over rather than previewing a round that does not exist', () => {
    expect(restAnnouncementText('preview', FROZEN)).toBe('Last round complete.')
  })

  it('mentions a dropped tracker during recovery', () => {
    expect(restAnnouncementText('recovery', { ...FROZEN, trackerDropped: true })).toContain(
      TRACKER_DROPPED_NOTE,
    )
  })
})
