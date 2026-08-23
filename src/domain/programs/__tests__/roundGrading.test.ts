/**
 * Round grading (M33-03, doc §23).
 *
 * The assertions worth having: the status strings are byte-exact against
 * the doc, the outcome can never disagree with the sign of `delta`, no
 * copy ever scolds, and nothing in this module reaches for a clock or a
 * platform import (spec §15.1).
 */
import { readFileSync } from 'node:fs'

import {
  gradeAccessibilityText,
  gradeCountText,
  gradeRound,
  gradeRoundScore,
  gradeStatusText,
  roundPunchCount,
  secondaryBadgeLabel,
  type RoundOutcome,
  type SecondaryBadgeId,
} from '../roundGrading'
import { sequenceScoreLabel, type CapabilityTier } from '@domain/workout/capabilityTier'
import type { RoundScore } from '../cueScoring'

const TIERS: CapabilityTier[] = [
  'hand-only',
  'hand-timestamp',
  'hand-broad-type',
  'hand-distinct-type',
]

describe('gradeRound', () => {
  it('grades the three doc §23 examples', () => {
    expect(gradeRound(246, 240)).toEqual({ outcome: 'over', delta: 6 })
    expect(gradeRound(221, 240)).toEqual({ outcome: 'short', delta: -19 })
    expect(gradeRound(240, 240)).toEqual({ outcome: 'exact', delta: 0 })
  })

  it('signs the delta as actual minus target', () => {
    expect(gradeRound(1, 0).delta).toBe(1)
    expect(gradeRound(0, 1).delta).toBe(-1)
  })

  it('treats a zero target with zero punches as exact, not short', () => {
    // A round with no punch target (a pure defense round) is met by
    // definition; grading it red would invent a failure.
    expect(gradeRound(0, 0)).toEqual({ outcome: 'exact', delta: 0 })
  })

  it('never applies a tolerance band around the target', () => {
    // Doc §23: gold is "exactly equals". One punch either side is not gold.
    expect(gradeRound(239, 240).outcome).toBe('short')
    expect(gradeRound(241, 240).outcome).toBe('over')
  })

  it('is a total function of its arguments — same inputs, same grade', () => {
    for (let i = 0; i < 5; i++) {
      expect(gradeRound(221, 240)).toEqual({ outcome: 'short', delta: -19 })
    }
  })

  it.each([
    [Number.NaN, 240],
    [240, Number.NaN],
    [Number.POSITIVE_INFINITY, 240],
    [-1, 240],
    [240, -1],
    [12.5, 240],
  ])('throws rather than guessing for (%s, %s)', (actual, target) => {
    expect(() => gradeRound(actual, target)).toThrow(RangeError)
  })

  it('agrees with the sign of the delta for every pair in a wide sweep', () => {
    for (let target = 0; target <= 40; target += 1) {
      for (let actual = 0; actual <= 40; actual += 1) {
        const grade = gradeRound(actual, target)
        const expected: RoundOutcome =
          grade.delta > 0 ? 'over' : grade.delta < 0 ? 'short' : 'exact'
        expect(grade.outcome).toBe(expected)
        expect(grade.delta).toBe(actual - target)
      }
    }
  })
})

describe('status text (doc §23, byte-exact)', () => {
  it('renders the three doc lines exactly', () => {
    expect(gradeCountText(246, 240)).toBe('246 / 240')
    expect(gradeStatusText(gradeRound(246, 240))).toBe('+6 OVER')

    expect(gradeCountText(221, 240)).toBe('221 / 240')
    expect(gradeStatusText(gradeRound(221, 240))).toBe('19 SHORT')

    expect(gradeCountText(240, 240)).toBe('240 / 240')
    expect(gradeStatusText(gradeRound(240, 240))).toBe('EXACT TARGET')
  })

  it('states the direction once — a short shows magnitude, not a minus sign', () => {
    expect(gradeStatusText(gradeRound(221, 240))).not.toContain('-')
  })

  it('gives the three outcomes three different strings', () => {
    const texts = [
      gradeStatusText(gradeRound(246, 240)),
      gradeStatusText(gradeRound(221, 240)),
      gradeStatusText(gradeRound(240, 240)),
    ]
    expect(new Set(texts).size).toBe(3)
  })
})

describe('a short round is a result, not a failure (doc §21)', () => {
  // The tracker transmits nothing below an acceleration floor, so a soft
  // strike and an unthrown one are the same absence of evidence (D13). No
  // copy here may read as a verdict on the athlete.
  const SCOLDING = [
    /\bfail(ed|ure)?\b/i,
    /\bmissed?\b/i,
    /\bpoor\b/i,
    /\bbad\b/i,
    /\bweak\b/i,
    /\bonly\b/i,
    /\btry harder\b/i,
    /\bshould have\b/i,
  ]

  const copy = [
    gradeStatusText(gradeRound(221, 240)),
    gradeAccessibilityText(221, 240),
    gradeAccessibilityText(0, 240),
  ]

  it.each(copy)('keeps %p free of any verdict word', (text) => {
    for (const pattern of SCOLDING) expect(text).not.toMatch(pattern)
  })

  it('describes the short round as a distance between two counts', () => {
    expect(gradeAccessibilityText(221, 240)).toBe('221 of 240 punches. 19 short of target.')
  })

  it('uses the same neutral shape for over and exact', () => {
    expect(gradeAccessibilityText(246, 240)).toBe('246 of 240 punches. 6 over target.')
    expect(gradeAccessibilityText(240, 240)).toBe('240 of 240 punches. Exact target.')
  })
})

describe('no letter grades anywhere (doc §23)', () => {
  it('never emits a standalone A–F grade token', () => {
    const strings = [
      gradeCountText(246, 240),
      gradeStatusText(gradeRound(246, 240)),
      gradeStatusText(gradeRound(221, 240)),
      gradeStatusText(gradeRound(240, 240)),
      gradeAccessibilityText(246, 240),
      gradeAccessibilityText(221, 240),
      gradeAccessibilityText(240, 240),
      ...TIERS.flatMap((tier) =>
        (
          [
            'pace-consistency',
            'velocity-consistency',
            'left-right-balance',
            'best-round',
            'exact-sequence-streak',
            'tracker-coverage',
          ] as SecondaryBadgeId[]
        ).map((id) => secondaryBadgeLabel(id, tier)),
      ),
    ]
    for (const text of strings) {
      expect(text).not.toMatch(/\b[ABCDF][+-]?\b/)
      expect(text).not.toMatch(/\bgrade\b/i)
    }
  })
})

describe('grading builds on the scored round', () => {
  const score = (landedCount: number, extraCount: number): RoundScore => ({
    label: 'hand-sequence match',
    completionPct: 0,
    correctHandPct: 0,
    timingWindowPct: 0,
    expectedCount: landedCount,
    landedCount,
    extraCount,
    capabilityTier: 'hand-timestamp',
    calculationVersion: 'test',
  })

  it('counts extras toward the round total (doc §21 keeps them counted)', () => {
    expect(roundPunchCount(score(230, 16))).toBe(246)
  })

  it('grades a scored round against its target', () => {
    expect(gradeRoundScore(score(230, 16), 240)).toEqual({ outcome: 'over', delta: 6 })
    expect(gradeRoundScore(score(221, 0), 240)).toEqual({ outcome: 'short', delta: -19 })
    expect(gradeRoundScore(score(240, 0), 240)).toEqual({ outcome: 'exact', delta: 0 })
  })
})

describe('secondary badges are recognitions, and the sequence one is tier-named (D4)', () => {
  it.each(TIERS)('names the streak with the %s tier label', (tier) => {
    const label = secondaryBadgeLabel('exact-sequence-streak', tier)
    expect(label).toBe(`Exact ${sequenceScoreLabel(tier)} streak`)
  })

  it('says hand-sequence match on every tier FightCamp v1 can reach (D12)', () => {
    for (const tier of ['hand-only', 'hand-timestamp', 'hand-broad-type'] as CapabilityTier[]) {
      expect(secondaryBadgeLabel('exact-sequence-streak', tier)).toBe(
        'Exact hand-sequence match streak',
      )
    }
  })

  it('never claims technique accuracy', () => {
    for (const tier of TIERS) {
      expect(secondaryBadgeLabel('exact-sequence-streak', tier)).not.toMatch(/accuracy/i)
    }
  })
})

describe('module purity (spec §15.1)', () => {
  // Read from the repo root rather than __dirname so this stays a plain
  // ESM import with no CommonJS globals.
  const source = readFileSync('src/domain/programs/roundGrading.ts', 'utf8')

  it.each([
    /from '(react|react-native)'/,
    /from 'expo/,
    /from '.*sqlite/i,
    /from '.*\/ble\//i,
  ])('has no import matching %p', (pattern) => {
    expect(source).not.toMatch(pattern)
  })

  it('reads no clock', () => {
    expect(source).not.toMatch(/Date\.now\(\)/)
    expect(source).not.toMatch(/new Date\(/)
    expect(source).not.toMatch(/performance\.now\(\)/)
    expect(source).not.toMatch(/Math\.random\(/)
  })
})
