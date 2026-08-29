/**
 * The punch avatar on screen.
 *
 * Two things must never regress: every punch the timeline can prescribe has
 * art (a missing render is a Jest failure here, not a blank card mid-round),
 * and the card is a HUD layer the reactive backdrop cannot reach.
 */
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

import { PunchAvatarCard } from '../PunchAvatarCard'
import { findPunchAvatar, punchAvatarFrames } from '../punchAvatarManifest'
import { minHoldMs, punchAvatarKey } from '@domain/workout/punchAvatar'
import type { CueInstance } from '@domain/programs/CueTimeline'
import type { PunchNumber, WorkoutToken } from '@domain/workout/WorkoutTokens'

const NUMBERS: PunchNumber[] = [1, 2, 3, 4, 5, 6]

const punch = (number: PunchNumber, body = false): WorkoutToken => ({
  kind: 'punch',
  number,
  body,
  beatOffset: 0,
})

function cue(tokens: WorkoutToken[], over: Partial<CueInstance> = {}): CueInstance {
  return {
    id: 'cue-1',
    blockId: 'block-1',
    repeatIndex: 0,
    scoring: 'sequence',
    tokens,
    tokenOffsetsMs: tokens.map((_, i) => i * 400),
    expectedPunches: tokens.map((_, tokenIndex) => ({ tokenIndex, hand: 'left' as const })),
    displayOnlyTokenIndexes: [],
    previewAt: 8_500,
    announceAt: 9_250,
    scheduledStartMs: 10_000,
    scheduledEndMs: 10_800,
    windowStartMs: 9_800,
    windowEndMs: 11_200,
    ...over,
  }
}

const mounted: ReactTestRenderer[] = []
function render(element: React.ReactElement): ReactTestRenderer {
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

describe('punchAvatarManifest', () => {
  it('covers every punch the timeline can prescribe — head and body', () => {
    for (const number of NUMBERS) {
      for (const body of [false, true]) {
        const frames = findPunchAvatar(number, body)
        expect(frames).toBeDefined()
        expect(frames?.key).toBe(punchAvatarKey(number, body))
        // Both stop-motion frames, or the flip has nothing to play.
        expect(frames?.step1).toBeDefined()
        expect(frames?.step2).toBeDefined()
        expect(frames?.step1).not.toBe(frames?.step2)
      }
    }
  })

  it('holds exactly the 12 punches, with no duplicate keys', () => {
    expect(punchAvatarFrames).toHaveLength(12)
    expect(new Set(punchAvatarFrames.map((f) => f.key)).size).toBe(12)
  })
})

describe('PunchAvatarCard', () => {
  it('shows both frames mounted, opening on the wind-up', () => {
    const tree = render(<PunchAvatarCard cue={cue([punch(1), punch(2)])} activeTokenIndex={0} />)
    const step1 = tree.root.findAllByProps({ testID: 'punch-avatar-step1' }, { deep: false })[0]!
    const step2 = tree.root.findAllByProps({ testID: 'punch-avatar-step2' }, { deep: false })[0]!
    // Both stay mounted so neither can hitch on first decode mid-combination.
    expect(step1).toBeDefined()
    expect(step2).toBeDefined()
    expect(step1.props.source).toBe(findPunchAvatar(1, false)?.step1)
    expect(step2.props.source).toBe(findPunchAvatar(1, false)?.step2)
  })

  it('renders the punch that is lit, not the first of the combo', () => {
    const tree = render(
      <PunchAvatarCard cue={cue([punch(1), punch(6, true)])} activeTokenIndex={1} />,
    )
    const step2 = tree.root.findAllByProps({ testID: 'punch-avatar-step2' }, { deep: false })[0]!
    expect(step2.props.source).toBe(findPunchAvatar(6, true)?.step2)
  })

  it('demonstrates the opening punch before the engine lights anything', () => {
    // A cue previewing, or a gap between reps, still shows the combination.
    const tree = render(<PunchAvatarCard cue={cue([punch(1)])} activeTokenIndex={-1} />)
    const step2 = tree.root.findAllByProps({ testID: 'punch-avatar-step2' }, { deep: false })[0]!
    expect(step2.props.source).toBe(findPunchAvatar(1, false)?.step2)
  })

  it('renders nothing with no cue at all', () => {
    const tree = render(<PunchAvatarCard activeTokenIndex={-1} />)
    expect(tree.root.findAllByProps({ testID: 'punch-avatar-card' }, { deep: false })).toHaveLength(
      0,
    )
  })

  it('renders nothing for a token with no art (defense, footwork, coach)', () => {
    const tokens: WorkoutToken[] = [{ kind: 'defense', command: 'slip', beatOffset: 0 }]
    const tree = render(<PunchAvatarCard cue={cue(tokens)} activeTokenIndex={0} />)
    expect(tree.root.findAllByProps({ testID: 'punch-avatar-card' }, { deep: false })).toHaveLength(
      0,
    )
  })

  it('holds the strike statically under reduced motion', () => {
    const tree = render(
      <PunchAvatarCard cue={cue([punch(3)])} activeTokenIndex={0} reducedMotion />,
    )
    const step2 = tree.root.findAllByProps({ testID: 'punch-avatar-step2' }, { deep: false })[0]!
    expect(step2.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ opacity: 1 })]),
    )
  })

  it('is a decorative layer — never intercepts a touch', () => {
    const tree = render(<PunchAvatarCard cue={cue([punch(1)])} activeTokenIndex={0} />)
    const layer = tree.root.findAllByProps({ testID: 'punch-avatar-card' }, { deep: false })[0]!
    expect(layer.props.pointerEvents).toBe('none')
  })

  it('keeps a fixed opacity — a blackout round must not dim it', () => {
    // The card takes no backdrop state at all: there is no prop through which
    // calm, churn or a veil charge could reach it.
    const tree = render(<PunchAvatarCard cue={cue([punch(1)])} activeTokenIndex={0} />)
    const layer = tree.root.findAllByProps({ testID: 'punch-avatar-card' }, { deep: false })[0]!
    const flat = [layer.props.style].flat()
    expect(flat.some((s) => s && typeof s.opacity === 'number')).toBe(true)
  })
})

describe('PunchAvatarCard — demonstrating the combination', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('walks the combination when the engine lights nothing', () => {
    // A cue can sit previewing, or between reps, with no token 'active'.
    // The card keeps demonstrating rather than freezing on a guard pose.
    const tree = render(
      <PunchAvatarCard cue={cue([punch(1), punch(2), punch(3)])} activeTokenIndex={-1} />,
    )
    const shownKey = (): unknown =>
      tree.root.findAllByProps({ testID: 'punch-avatar-step2' }, { deep: false })[0]!.props.source
    expect(shownKey()).toBe(findPunchAvatar(1, false)?.step2)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(shownKey()).toBe(findPunchAvatar(2, false)?.step2)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(shownKey()).toBe(findPunchAvatar(3, false)?.step2)
  })

  it('snaps to the engine the moment it lights a token', () => {
    const combo = cue([punch(1), punch(2), punch(5)])
    const tree = render(<PunchAvatarCard cue={combo} activeTokenIndex={-1} />)
    act(() => {
      tree.update(<PunchAvatarCard cue={combo} activeTokenIndex={2} />)
    })
    // The opening punch keeps the card for its full flip first — the hold is
    // the guarantee that both frames play — then the engine's token lands.
    act(() => {
      jest.advanceTimersByTime(minHoldMs(400) + 20)
    })
    const step2 = tree.root.findAllByProps({ testID: 'punch-avatar-step2' }, { deep: false })[0]!
    expect(step2.props.source).toBe(findPunchAvatar(5, false)?.step2)
  })

  it('flips to the strike after the wind-up, then back to guard', () => {
    const tree = render(<PunchAvatarCard cue={cue([punch(1), punch(2)])} activeTokenIndex={0} />)
    const opacityOf = (id: string): number => {
      const node = tree.root.findAllByProps({ testID: id }, { deep: false })[0]!
      const flat = [node.props.style].flat()
      return flat.reduce((acc, s) => (s && typeof s.opacity === 'number' ? s.opacity : acc), 0)
    }
    expect(opacityOf('punch-avatar-step1')).toBe(1)
    act(() => {
      jest.advanceTimersByTime(120)
    })
    expect(opacityOf('punch-avatar-step2')).toBe(1)
    expect(opacityOf('punch-avatar-step1')).toBe(0)
  })
})

describe('PunchAvatarCard — the flip repeats', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('keeps flipping while one punch holds the card, beat after beat', () => {
    // A repeated combo lights the same token every rep; the figure must
    // keep working rather than freezing after one cycle.
    const tree = render(<PunchAvatarCard cue={cue([punch(1), punch(2)])} activeTokenIndex={0} />)
    const stepOpacity = (id: string): number => {
      const node = tree.root.findAllByProps({ testID: id }, { deep: false })[0]!
      return [node.props.style]
        .flat()
        .reduce((acc, s) => (s && typeof s.opacity === 'number' ? s.opacity : acc), 0)
    }
    const seen: string[] = []
    for (let beat = 0; beat < 4; beat += 1) {
      act(() => {
        jest.advanceTimersByTime(120)
      })
      seen.push(stepOpacity('punch-avatar-step2') === 1 ? 'step2' : 'step1')
      act(() => {
        jest.advanceTimersByTime(400)
      })
      seen.push(stepOpacity('punch-avatar-step1') === 1 ? 'step1' : 'step2')
    }
    // The strike shows on every beat, not just the first.
    expect(seen.filter((s) => s === 'step2').length).toBeGreaterThanOrEqual(4)
    expect(seen.filter((s) => s === 'step1').length).toBeGreaterThanOrEqual(4)
  })

  it('sizes the card in fixed points, so a layout change cannot resize the figure', () => {
    const tree = render(<PunchAvatarCard cue={cue([punch(1)])} activeTokenIndex={0} />)
    const card = tree.root
      .findAllByProps({ testID: 'punch-avatar-card' }, { deep: false })[0]!
      .props.children
    // The inner card carries a numeric height — never a percentage, which
    // tracked the cue zone and made the avatar jump between two sizes.
    const style = [card.props.style].flat()[0]
    expect(typeof style.height).toBe('number')
  })
})

describe('PunchAvatarCard — only punches steer it', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('keeps demonstrating when the lit token is a coach or defense command', () => {
    // The runner marks EVERY non-punch token 'active' for the whole cue, so
    // an index pointing at one must not park the figure in guard.
    const tokens: WorkoutToken[] = [
      { kind: 'coach', command: 'hands-up', beatOffset: 0 },
      punch(1),
      punch(4),
    ]
    const tree = render(<PunchAvatarCard cue={cue(tokens)} activeTokenIndex={0} />)
    const source = (): unknown =>
      tree.root.findAllByProps({ testID: 'punch-avatar-step2' }, { deep: false })[0]!.props.source
    expect(source()).toBe(findPunchAvatar(1, false)?.step2)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(source()).toBe(findPunchAvatar(4, false)?.step2)
  })
})

describe('PunchAvatarCard — under the live re-render cadence', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('still reaches the strike while the screen re-renders around it', () => {
    // The live screen pushes the store ~4Hz and immediately on every
    // token-due, handing CueStage a NEW cue view object each time. The flip
    // must survive that churn.
    const combo = cue([punch(1), punch(2)])
    const tree = render(<PunchAvatarCard cue={combo} activeTokenIndex={0} />)
    const isStrike = (): boolean => {
      const node = tree.root.findAllByProps({ testID: 'punch-avatar-step2' }, { deep: false })[0]!
      return [node.props.style]
        .flat()
        .some((s) => s && s.opacity === 1)
    }
    let sawStrike = false
    for (let tick = 0; tick < 40; tick += 1) {
      act(() => {
        jest.advanceTimersByTime(25)
      })
      if (isStrike()) sawStrike = true
      // A fresh cue object every tick, exactly like renderStateFor produces.
      act(() => {
        tree.update(<PunchAvatarCard cue={{ ...combo }} activeTokenIndex={0} />)
      })
    }
    expect(sawStrike).toBe(true)
  })
})
