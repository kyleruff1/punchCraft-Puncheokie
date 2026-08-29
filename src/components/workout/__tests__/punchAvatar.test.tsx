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
import { punchAvatarKey } from '@domain/workout/punchAvatar'
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

  it('renders nothing before any punch is lit', () => {
    const tree = render(<PunchAvatarCard cue={cue([punch(1)])} activeTokenIndex={-1} />)
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
