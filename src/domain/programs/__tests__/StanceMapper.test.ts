/**
 * StanceMapper — the exhaustive orthodox/southpaw × switch matrix
 * (#126 M25-01 smoke tests + #127 M25-02 full matrix).
 *
 * Both issues are covered here rather than split, because the "smoke" cases
 * are strict subsets of the matrix and duplicating them would let the two
 * files disagree.
 *
 * Why this is pinned hard: H12 established the tracker cannot identify
 * technique, so the hand sequence this module produces is the *entire*
 * verifiable surface. An error here would score combinations against the
 * wrong glove and would look like athlete failure rather than a bug.
 */

import {
  handSequence,
  isLeadNumber,
  oppositeStance,
  resolveEffectiveStance,
  resolveHand,
  resolveSequence,
} from '../StanceMapper'
import { parseCombo, type PunchNumber, type Stance } from '../../workout/WorkoutTokens'

const ALL_NUMBERS: PunchNumber[] = [1, 2, 3, 4, 5, 6]

describe('isLeadNumber', () => {
  it('treats 1/3/5 as lead and 2/4/6 as rear (doc §2)', () => {
    expect(ALL_NUMBERS.filter(isLeadNumber)).toEqual([1, 3, 5])
    expect(ALL_NUMBERS.filter((n) => !isLeadNumber(n))).toEqual([2, 4, 6])
  })
})

describe('resolveHand — the full spec §13.2 matrix', () => {
  it.each([
    [1, 'orthodox', 'left'],
    [2, 'orthodox', 'right'],
    [3, 'orthodox', 'left'],
    [4, 'orthodox', 'right'],
    [5, 'orthodox', 'left'],
    [6, 'orthodox', 'right'],
    [1, 'southpaw', 'right'],
    [2, 'southpaw', 'left'],
    [3, 'southpaw', 'right'],
    [4, 'southpaw', 'left'],
    [5, 'southpaw', 'right'],
    [6, 'southpaw', 'left'],
  ] as Array<[PunchNumber, Stance, 'left' | 'right']>)(
    'punch %i in %s is thrown with the %s hand',
    (number, stance, hand) => {
      expect(resolveHand(number, stance)).toBe(hand)
    },
  )

  it('makes southpaw the exact inverse of orthodox for every number', () => {
    for (const n of ALL_NUMBERS) {
      expect(resolveHand(n, 'southpaw')).not.toBe(resolveHand(n, 'orthodox'))
    }
  })

  it('gives each stance three left and three right punches', () => {
    for (const stance of ['orthodox', 'southpaw'] as Stance[]) {
      const hands = ALL_NUMBERS.map((n) => resolveHand(n, stance))
      expect(hands.filter((h) => h === 'left')).toHaveLength(3)
      expect(hands.filter((h) => h === 'right')).toHaveLength(3)
    }
  })
})

describe('resolveEffectiveStance — the full BlockStance × Stance matrix (D2)', () => {
  it.each([
    ['inherit', 'orthodox', 'orthodox'],
    ['inherit', 'southpaw', 'southpaw'],
    ['orthodox', 'orthodox', 'orthodox'],
    ['orthodox', 'southpaw', 'orthodox'],
    ['southpaw', 'orthodox', 'southpaw'],
    ['southpaw', 'southpaw', 'southpaw'],
    ['switch', 'orthodox', 'southpaw'],
    ['switch', 'southpaw', 'orthodox'],
  ] as Array<['inherit' | 'orthodox' | 'southpaw' | 'switch', Stance, Stance]>)(
    'block stance %p with default %s resolves to %s',
    (blockStance, defaultStance, expected) => {
      expect(resolveEffectiveStance(blockStance, defaultStance)).toBe(expected)
    },
  )

  it("switch of southpaw is orthodox, not 'the other one from orthodox'", () => {
    // The failure mode this guards: treating switch as a constant rather
    // than as relative to the athlete's default.
    expect(resolveEffectiveStance('switch', 'southpaw')).toBe('orthodox')
    expect(resolveEffectiveStance('switch', 'orthodox')).toBe('southpaw')
  })

  it('is idempotent for absolute values regardless of default', () => {
    for (const def of ['orthodox', 'southpaw'] as Stance[]) {
      expect(resolveEffectiveStance('orthodox', def)).toBe('orthodox')
      expect(resolveEffectiveStance('southpaw', def)).toBe('southpaw')
    }
  })

  it('switching twice returns to the default', () => {
    for (const def of ['orthodox', 'southpaw'] as Stance[]) {
      const once = resolveEffectiveStance('switch', def)
      expect(oppositeStance(once)).toBe(def)
    }
  })
})

describe('resolveSequence', () => {
  it('maps 1-2b-3 in orthodox to left-right-left with body only on the second', () => {
    const expected = resolveSequence(parseCombo('1-2b-3'), 'orthodox')
    expect(expected.map((p) => p.hand)).toEqual(['left', 'right', 'left'])
    expect(expected.map((p) => p.body)).toEqual([false, true, false])
  })

  it('never lets the body modifier change the hand (D10)', () => {
    for (const stance of ['orthodox', 'southpaw'] as Stance[]) {
      for (const n of ALL_NUMBERS) {
        const head = resolveSequence(parseCombo(`${n}`), stance)[0]
        const body = resolveSequence(parseCombo(`${n}b`), stance)[0]
        expect(body?.hand).toBe(head?.hand)
        expect(body?.body).toBe(true)
        expect(head?.body).toBe(false)
      }
    }
  })

  it('yields no ExpectedPunch for display-only tokens (D4)', () => {
    const expected = resolveSequence(parseCombo('1-slip-2-breathe-pivot-3'), 'orthodox')
    expect(expected.map((p) => p.number)).toEqual([1, 2, 3])
  })

  it('reports tokenIndex against the ORIGINAL token array, not the punch index', () => {
    // A result must be traceable back to the cue that produced it, which
    // fails if the index is relative to the filtered punch list.
    const expected = resolveSequence(parseCombo('1-slip-2-pivot-3'), 'orthodox')
    expect(expected.map((p) => p.tokenIndex)).toEqual([0, 2, 4])
  })

  it('returns an empty list for a block with no punches', () => {
    expect(resolveSequence(parseCombo('slip-pivot-breathe'), 'orthodox')).toEqual([])
  })
})

describe('handSequence — the verifiable surface (D4, D12)', () => {
  it.each([
    ['1-2', 'orthodox', ['left', 'right']],
    ['1-1-2', 'orthodox', ['left', 'left', 'right']],
    ['1-2-3', 'orthodox', ['left', 'right', 'left']],
    ['2-3-6', 'orthodox', ['right', 'left', 'right']],
    ['1-2', 'southpaw', ['right', 'left']],
    ['1-2-3', 'southpaw', ['right', 'left', 'right']],
  ] as Array<[string, Stance, Array<'left' | 'right'>]>)(
    '%s in %s is %j',
    (notation, stance, expected) => {
      expect(handSequence(parseCombo(notation), stance)).toEqual(expected)
    },
  )

  it('cannot distinguish a body variant from its head equivalent', () => {
    // This is the concrete, executable statement of why scoring is labelled
    // a hand-sequence match. If it ever stops holding, the capability tier
    // changed and D12 must be revisited.
    for (const stance of ['orthodox', 'southpaw'] as Stance[]) {
      expect(handSequence(parseCombo('1-2-3'), stance)).toEqual(
        handSequence(parseCombo('1-2b-3'), stance),
      )
    }
  })

  it('cannot distinguish combos that differ only by technique within a role', () => {
    // 1 and 3 are both lead; 2 and 4 are both rear. A jab-cross and a
    // hook-hook are the same hand sequence.
    expect(handSequence(parseCombo('1-2'), 'orthodox')).toEqual(
      handSequence(parseCombo('3-4'), 'orthodox'),
    )
  })

  it('DOES distinguish sequences that differ by hand order', () => {
    // The complement of the above: what the tracker can actually see.
    expect(handSequence(parseCombo('1-2'), 'orthodox')).not.toEqual(
      handSequence(parseCombo('2-1'), 'orthodox'),
    )
  })

  it('inverts wholesale when the athlete switches stance', () => {
    const orthodox = handSequence(parseCombo('1-2-3-2'), 'orthodox')
    const southpaw = handSequence(parseCombo('1-2-3-2'), 'southpaw')
    expect(southpaw).toEqual(orthodox.map((h) => (h === 'left' ? 'right' : 'left')))
  })
})
