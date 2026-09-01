/**
 * Bar paging — the fixed 4-slot row (GH #305).
 *
 * A block of four slots or fewer shows whole. A longer block (alternating
 * bars composing an 8-punch combination) pages to the bar in progress, so
 * the four node positions stay put on screen instead of the row growing.
 *
 * The property that matters most here is index preservation. `tokenStates`,
 * `affirmedTokenIndexes`, `handHintFor` and `PunchAvatarCard`'s
 * `activeTokenIndex` are ALL keyed on the index within `cue.tokens`. A paged
 * view that renumbered from zero would compile, render, and silently
 * mis-address every one of them — the hand hint would point the wrong way
 * and the avatar would track the wrong punch. Nothing would throw.
 */

import { visibleBar } from '../tokenVisuals'
import type { TokenVisualState } from '../tokenVisuals'
import type { WorkoutToken } from '@domain/workout/WorkoutTokens'

const punch = (number: 1 | 2 | 3 | 4 | 5 | 6, beatOffset: number): WorkoutToken => ({
  kind: 'punch',
  number,
  body: false,
  beatOffset,
})

/** An 8-punch combination: two alternating bars. */
const TWO_BARS: WorkoutToken[] = [
  punch(1, 0),
  punch(2, 1),
  punch(1, 2),
  punch(2, 3),
  punch(3, 4),
  punch(2, 5),
  punch(3, 6),
  punch(2, 7),
]

const states = (...s: TokenVisualState[]): TokenVisualState[] => s

describe('visibleBar', () => {
  it('shows a single-bar block whole', () => {
    const oneBar = TWO_BARS.slice(0, 4)
    const shown = visibleBar(oneBar, states('active', 'upcoming', 'upcoming', 'upcoming'))
    expect(shown.map((s) => s.index)).toEqual([0, 1, 2, 3])
  })

  it('shows a SHORT block whole rather than padding it to four here', () => {
    // Padding is the authoring layer's job (rest tokens), not the renderer's.
    const short = TWO_BARS.slice(0, 2)
    const shown = visibleBar(short, states('active', 'upcoming'))
    expect(shown.map((s) => s.index)).toEqual([0, 1])
  })

  it('pages to the first bar while the active slot is in it', () => {
    const shown = visibleBar(
      TWO_BARS,
      states('completed', 'active', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming'),
    )
    expect(shown.map((s) => s.index)).toEqual([0, 1, 2, 3])
  })

  it('pages to the SECOND bar once the active slot crosses the boundary', () => {
    const shown = visibleBar(
      TWO_BARS,
      states('completed', 'completed', 'completed', 'completed', 'active', 'upcoming', 'upcoming', 'upcoming'),
    )
    expect(shown.map((s) => s.index)).toEqual([4, 5, 6, 7])
    // And it carries the REAL punch identities, not renumbered ones.
    expect(shown.map((s) => (s.token.kind === 'punch' ? s.token.number : 0))).toEqual([3, 2, 3, 2])
  })

  it('preserves real indices so hand hints and the avatar stay addressed', () => {
    const shown = visibleBar(
      TWO_BARS,
      states('completed', 'completed', 'completed', 'completed', 'completed', 'active', 'upcoming', 'upcoming'),
    )
    // Index 5 is the active one; a renumbered view would report 1 here and
    // every index-keyed consumer would quietly read the wrong token.
    const active = shown.find((s) => s.index === 5)
    expect(active).toBeDefined()
    expect(shown[0]!.index).toBe(4)
  })

  it('shows the first bar before anything has started', () => {
    const shown = visibleBar(TWO_BARS, states(...(Array(8).fill('upcoming') as TokenVisualState[])))
    expect(shown.map((s) => s.index)).toEqual([0, 1, 2, 3])
  })

  it('HOLDS the last bar after the final punch rather than snapping back', () => {
    // Snapping to bar 0 at cue end would read as a backwards jump — the
    // exact artifact this design exists to remove.
    const shown = visibleBar(
      TWO_BARS,
      states(...(Array(8).fill('completed') as TokenVisualState[])),
    )
    expect(shown.map((s) => s.index)).toEqual([4, 5, 6, 7])
  })

  it('never returns more than one bar', () => {
    const long = [...TWO_BARS, punch(1, 8), punch(2, 9), punch(1, 10), punch(2, 11)]
    for (let activeIndex = 0; activeIndex < long.length; activeIndex += 1) {
      const s = long.map((_, i): TokenVisualState =>
        i < activeIndex ? 'completed' : i === activeIndex ? 'active' : 'upcoming',
      )
      expect(visibleBar(long, s).length).toBeLessThanOrEqual(4)
    }
  })

  it('keeps rest slots in the bar so the width never collapses', () => {
    const padded: WorkoutToken[] = [
      punch(1, 0),
      punch(1, 1),
      punch(2, 2),
      { kind: 'rest', beatOffset: 3 },
    ]
    const shown = visibleBar(padded, states('active', 'upcoming', 'upcoming', 'empty'))
    expect(shown).toHaveLength(4)
    expect(shown[3]!.token.kind).toBe('rest')
  })
})
