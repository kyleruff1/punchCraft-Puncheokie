/**
 * The punch avatar on screen.
 *
 * Two things must never regress: every punch the timeline can prescribe has
 * art (a missing render is a Jest failure here, not a blank card mid-round),
 * and the card is a HUD layer the reactive backdrop cannot reach.
 */
// PunchAvatarCard's frame-clock hook imports Reanimated (M39-V2
// Phase W0-b-iii). Reanimated's native runtime crashes in node; a
// minimal stub of the hooks the module names is enough — the
// tests below never pass an `anchor`, so the setInterval
// fallback path is what actually runs.
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
import { act, create, type ReactTestRenderer } from 'react-test-renderer'

import { PunchAvatarCard, requestedFor } from '../PunchAvatarCard'
import { findPunchAvatar, punchAvatarFrames } from '../punchAvatarManifest'
import { avatarFrameAt, minHoldMs, punchAvatarKey } from '@domain/workout/punchAvatar'
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

  it('parks on guard before the engine lights anything', () => {
    // A cue previewing, or a gap between reps, is a quiet span: the
    // universal GUARD stance, motionless ("guard is designed to be
    // parked on" — Kyle, 2026-09-02).
    const tree = render(<PunchAvatarCard cue={cue([punch(1)])} activeTokenIndex={-1} />)
    const guard = tree.root.findAllByProps({ testID: 'punch-avatar-guard' }, { deep: false })[0]!
    expect([guard.props.style].flat().at(-1).opacity).toBe(1)
  })

  it('shows guard with no cue at all — every round STARTS in guard', () => {
    const tree = render(<PunchAvatarCard activeTokenIndex={-1} />)
    const guard = tree.root.findAllByProps({ testID: 'punch-avatar-guard' }, { deep: false })[0]!
    expect([guard.props.style].flat().at(-1).opacity).toBe(1)
  })

  it('parks on guard for a token with no art (defense, footwork, coach)', () => {
    const tokens: WorkoutToken[] = [{ kind: 'defense', command: 'slip', beatOffset: 0 }]
    const tree = render(<PunchAvatarCard cue={cue(tokens)} activeTokenIndex={0} />)
    const guard = tree.root.findAllByProps({ testID: 'punch-avatar-guard' }, { deep: false })[0]!
    expect([guard.props.style].flat().at(-1).opacity).toBe(1)
  })

  it('holds guard statically under reduced motion', () => {
    const tree = render(
      <PunchAvatarCard cue={cue([punch(3)])} activeTokenIndex={0} reducedMotion />,
    )
    const guard = tree.root.findAllByProps({ testID: 'punch-avatar-guard' }, { deep: false })[0]!
    expect([guard.props.style].flat().at(-1).opacity).toBe(1)
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

  it('parks on the GUARD stance, motionless, when the engine lights nothing', () => {
    // "Guard is designed to be parked on" (Kyle, 2026-09-02): quiet
    // spans — round start, previews, rests, bar boundaries, setup gaps —
    // show the universal GUARD art. The old demo walker cycled the
    // combination here ("empty slots make the avatar jitter out").
    const tree = render(
      <PunchAvatarCard cue={cue([punch(1), punch(2), punch(3)])} activeTokenIndex={-1} />,
    )
    const guardOpacity = (): unknown =>
      tree.root
        .findAllByProps({ testID: 'punch-avatar-guard' }, { deep: false })[0]!
        .props.style.at(-1).opacity
    expect(guardOpacity()).toBe(1)
    act(() => {
      jest.advanceTimersByTime(5_000)
    })
    expect(guardOpacity()).toBe(1)
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

  it('strikes ON adoption, retracts, then parks on guard (strike-first, 2026-09-02)', () => {
    // Reversed cycle with guard on all sides (Kyle): the identity frame
    // paints the moment the engine lights the node — reactive, so the
    // strike can never be AHEAD of the call, only on it or behind —
    // then a flip-frame of retract, then the universal guard.
    const tree = render(<PunchAvatarCard cue={cue([punch(1), punch(2)])} activeTokenIndex={0} />)
    const opacityOf = (id: string): number => {
      const node = tree.root.findAllByProps({ testID: id }, { deep: false })[0]!
      const flat = [node.props.style].flat()
      return flat.reduce((acc, s) => (s && typeof s.opacity === 'number' ? s.opacity : acc), 0)
    }
    expect(opacityOf('punch-avatar-step1')).toBe(1) // strike lands with the beat
    act(() => {
      jest.advanceTimersByTime(340) // past strikeEnd (window 400 − flip 100 = 300)
    })
    expect(opacityOf('punch-avatar-step2')).toBe(1) // retract flip
    act(() => {
      jest.advanceTimersByTime(120) // past retract (flip 100)
    })
    expect(opacityOf('punch-avatar-guard')).toBe(1) // parked
  })
})

describe('PunchAvatarCard — the flip repeats', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('repetition comes from re-adoption — the pure cycle runs once and parks (no wrap to lap)', () => {
    // Anti-lap contract (Kyle, 2026-09-02): with no modulo wrap the
    // cycle cannot re-throw on its own, so misaligned timing can never
    // lap the reps — every new throw requires the engine to light a new
    // node. The single cycle: strike, retract, guard forever.
    const w = 400
    const flip = 100
    expect(avatarFrameAt(0, w, false)).toBe('step1')
    expect(avatarFrameAt(w - flip, w, false)).toBe('step2')
    for (const t of [w, w * 2, w * 10]) {
      expect(avatarFrameAt(t, w, false)).toBe('guard')
    }
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

describe('requestedFor — count-scored pump window (GH #305)', () => {
  it('caps a single-token pump at the PULSE stride, not the whole cue window', () => {
    // A jab pump ('1', count-scored, targetPunches 8) has no next due
    // time, so the window fell back to the entire cue span — tens of
    // seconds — and isLast's strict thirds held one frame for a third of
    // the block. Kyle: "avatar is stationary during the extended jab
    // segment." The rings pump on pulsesFor's stride (window / cycles);
    // the avatar must throw with that same pulse.
    const tokens: WorkoutToken[] = [{ kind: 'punch', number: 1, body: false, beatOffset: 0 }]
    const pump = cue(tokens, {
      scoring: 'count',
      countScored: { targetPunches: 8 },
      scheduledStartMs: 10_000,
      scheduledEndMs: 26_000, // 16s block
      windowEndMs: 26_400,
      tokenOffsetsMs: [0],
    } as Partial<CueInstance>)
    const req = requestedFor(pump, 0, 0)
    expect(req).not.toBeNull()
    // 16_000 / 8 cycles = 2_000ms stride — a pump, not a 16s statue.
    expect(req!.windowMs).toBe(2_000)
  })

  it('leaves multi-token count cues alone when their per-token gap is tighter', () => {
    const tokens: WorkoutToken[] = [
      { kind: 'punch', number: 1, body: false, beatOffset: 0 },
      { kind: 'punch', number: 2, body: false, beatOffset: 1 },
    ]
    const c = cue(tokens, {
      scoring: 'count',
      countScored: { targetPunches: 8 },
      scheduledStartMs: 10_000,
      scheduledEndMs: 26_000,
      windowEndMs: 26_400,
      tokenOffsetsMs: [0, 500],
    } as Partial<CueInstance>)
    // Per-token gap (500ms) is tighter than the 4_000ms cycle stride —
    // the cap must not WIDEN a window.
    expect(requestedFor(c, 0, 1)!.windowMs).toBe(500)
  })

  it('sequence-scored cues are untouched by the cap', () => {
    const tokens: WorkoutToken[] = [{ kind: 'punch', number: 1, body: false, beatOffset: 0 }]
    const c = cue(tokens, {
      scheduledStartMs: 10_000,
      scheduledEndMs: 11_000,
      windowEndMs: 12_000,
      tokenOffsetsMs: [0],
    })
    expect(requestedFor(c, 0, 0)!.windowMs).toBe(2_000) // windowEnd - start
  })
})

describe('requestedFor — per-occurrence key (M39-V2 Phase 3c anti-collapse)', () => {
  // The bug the plan calls out: `1-1-2` uses `punchAvatarKey('1', false)`
  // for BOTH `1`s, which collapses to `'1'`. The adoption guard at
  // `current.key === req.key` then short-circuits the second `1`, and the
  // ring lights against a stale card.
  //
  // The fix keys the request on the strike occurrence — cueId + tokenIndex
  // — which matches the Phase 2' `strikeIdFor(cueId, DEFAULT_REP_ID,
  // strikeIndex)` shape. This test pins the contract at the requestedFor
  // level so it survives future refactors of the effect timing.
  it('produces DIFFERENT keys for the two `1`s in `1-1-2`', () => {
    const combo = cue([punch(1), punch(1), punch(2)])
    const first = requestedFor(combo, 0, 2)
    const second = requestedFor(combo, 1, 2)
    expect(first?.key).toBeDefined()
    expect(second?.key).toBeDefined()
    expect(first!.key).not.toBe(second!.key)
  })

  it('produces DIFFERENT keys across cues even when the punch identity matches', () => {
    // Two `1`s in different cues (say, rep 0 and rep 1 of the same combo
    // after `expandBlock` mints per-repeat cue ids). Under the bug, both
    // hash to `'1'` and the adoption guard short-circuits the second rep.
    const a = cue([punch(1)], { id: 'cue-A' })
    const b = cue([punch(1)], { id: 'cue-B' })
    expect(requestedFor(a, 0, 0)?.key).not.toBe(requestedFor(b, 0, 0)?.key)
  })

  it('keeps the same key across renders for the SAME occurrence (stable identity)', () => {
    // The key is per-occurrence, not per-render — no accidental identity
    // churn on `useEffect`'s dep list.
    const combo = cue([punch(1), punch(2)])
    expect(requestedFor(combo, 0, 1)?.key).toBe(requestedFor(combo, 0, 1)?.key)
  })

  it('returns null for a non-punch token', () => {
    const tokens: WorkoutToken[] = [{ kind: 'coach', command: 'hands-up', beatOffset: 0 }]
    expect(requestedFor(cue(tokens), 0, -1)).toBeNull()
  })

  it('returns null for an undefined cue or out-of-range index', () => {
    expect(requestedFor(undefined, 0, -1)).toBeNull()
    expect(requestedFor(cue([punch(1)]), -1, 0)).toBeNull()
    expect(requestedFor(cue([punch(1)]), 99, 0)).toBeNull()
  })
})

describe('PunchAvatarCard — only punches steer it', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('parks on guard when the lit token is a coach command', () => {
    // A non-punch active index is a quiet span like any other: the
    // figure parks on the universal GUARD stance, motionless.
    const tokens: WorkoutToken[] = [
      { kind: 'coach', command: 'hands-up', beatOffset: 0 },
      punch(1),
      punch(4),
    ]
    const tree = render(<PunchAvatarCard cue={cue(tokens)} activeTokenIndex={0} />)
    const guardOpacity = (): unknown =>
      tree.root
        .findAllByProps({ testID: 'punch-avatar-guard' }, { deep: false })[0]!
        .props.style.at(-1).opacity
    expect(guardOpacity()).toBe(1)
    act(() => {
      jest.advanceTimersByTime(1200)
    })
    expect(guardOpacity()).toBe(1)
  })
})

describe('PunchAvatarCard — guard bookends the chain (2026-09-02)', () => {
  // Strike-first with guard on all sides: every punch strikes on its
  // node, retracts, and the chain's tail PARKS ON GUARD — no sandwich,
  // no last-punch special case anywhere.
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  const opacityOf = (tree: ReactTestRenderer, id: string): number => {
    const node = tree.root.findAllByProps({ testID: id }, { deep: false })[0]!
    return [node.props.style]
      .flat()
      .reduce((acc, s) => (s && typeof s.opacity === 'number' ? s.opacity : acc), 0)
  }

  it('ends the chain parked on guard, via the retract flip', () => {
    // A three-punch chain, engine lit on the last (window 400ms, flip
    // 100): strike [0,300), retract [300,400), guard after.
    const combo = cue([punch(1), punch(2), punch(3)])
    const tree = render(<PunchAvatarCard cue={combo} activeTokenIndex={2} />)
    expect(opacityOf(tree, 'punch-avatar-step1')).toBe(1) // strike on the node
    act(() => {
      jest.advanceTimersByTime(340)
    })
    expect(opacityOf(tree, 'punch-avatar-step2')).toBe(1) // retract
    act(() => {
      jest.advanceTimersByTime(200)
    })
    expect(opacityOf(tree, 'punch-avatar-guard')).toBe(1) // parked for the breath
  })

  it('a middle punch is identical — strike on its node, no special cases', () => {
    const combo = cue([punch(1), punch(2), punch(3)])
    const tree = render(<PunchAvatarCard cue={combo} activeTokenIndex={1} />)
    act(() => {
      jest.advanceTimersByTime(120)
    })
    expect(opacityOf(tree, 'punch-avatar-step1')).toBe(1) // struck
    expect(opacityOf(tree, 'punch-avatar-step2')).toBe(0)
  })

  it('a solo punch strikes, retracts, and parks like any other', () => {
    const tree = render(<PunchAvatarCard cue={cue([punch(4)])} activeTokenIndex={0} />)
    expect(opacityOf(tree, 'punch-avatar-step1')).toBe(1)
    act(() => {
      // Solo window runs to the cue end (1200ms) + retract flip (220).
      jest.advanceTimersByTime(1500)
    })
    expect(opacityOf(tree, 'punch-avatar-guard')).toBe(1)
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
      const node = tree.root.findAllByProps({ testID: 'punch-avatar-step1' }, { deep: false })[0]!
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
