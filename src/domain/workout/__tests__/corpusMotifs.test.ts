/**
 * Corpus v1 integrity (Rhythm Map M1).
 *
 * Kyle's authored tables, held as executable constraints: every corpus row
 * must parse through the real grammar, its stats must match its tokens,
 * tier bands must hold, ladders must actually build, and every reference
 * must resolve. A corpus typo fails here, never on the bag.
 */
import {
  BUILD_UP_SETS,
  COMBO_CORPUS,
  CORPUS_MOTIFS,
  CORPUS_MOTIFS_BY_ID,
  OPTIONAL_FOOTWORK_WRAPPERS,
  canonicalNotation,
  corpusPhraseNotations,
} from '../corpusMotifs'
import { formatCombo, parseCombo } from '../WorkoutTokens'
import { defaultRecipe, tierFor } from '../WorkoutRecipe'

const TIER_BANDS = {
  beginner: { punches: [2, 4], maxBody: 1 },
  intermediate: { punches: [3, 6], maxBody: 2 },
  advanced: { punches: [5, 9], maxBody: 99 },
} as const

describe('combo corpus v1', () => {
  it('has the full 60-combo, 18-ladder, 6-wrapper shape', () => {
    expect(COMBO_CORPUS).toHaveLength(60)
    expect(BUILD_UP_SETS).toHaveLength(18)
    expect(OPTIONAL_FOOTWORK_WRAPPERS).toHaveLength(6)
    expect(CORPUS_MOTIFS).toHaveLength(60)
    expect(new Set(CORPUS_MOTIFS.map((m) => m.id)).size).toBe(60)
  })

  it.each(COMBO_CORPUS.map((c) => [c.id, c] as const))(
    '%s parses, round-trips, and matches its own stats',
    (_id, combo) => {
      const notation = canonicalNotation(combo.tokens)
      const tokens = parseCombo(notation)
      // Canonical form is stable under a second round trip.
      expect(formatCombo(tokens)).toBe(notation)

      const punchTokens = tokens.filter((t) => t.kind === 'punch')
      expect(punchTokens).toHaveLength(combo.punchCount)

      const bodyCount = punchTokens.filter((t) => 'body' in t && t.body === true).length
      expect(bodyCount).toBe(combo.bodyShotCount)

      // Spoken groups are a partition of the token list, in order.
      expect(combo.spokenGroups.flat()).toEqual([...combo.tokens])
    },
  )

  it.each(COMBO_CORPUS.map((c) => [c.id, c] as const))(
    '%s stays inside its tier band',
    (_id, combo) => {
      const band = TIER_BANDS[combo.tier]
      expect(combo.punchCount).toBeGreaterThanOrEqual(band.punches[0])
      expect(combo.punchCount).toBeLessThanOrEqual(band.punches[1])
      expect(combo.bodyShotCount).toBeLessThanOrEqual(band.maxBody)
    },
  )

  it('is jab-led at the corpus level (GR01: >= 75%)', () => {
    const jabLed = COMBO_CORPUS.filter((c) => c.jabLed).length
    expect(jabLed / COMBO_CORPUS.length).toBeGreaterThanOrEqual(0.75)
    // The jabLed flag is honest: first punch is a 1 or 1B.
    for (const combo of COMBO_CORPUS) {
      const leadsWithJab = combo.tokens[0] === '1' || combo.tokens[0] === '1B'
      expect(combo.jabLed).toBe(leadsWithJab)
    }
  })

  it('groups every long combo for the voice (GR07: > 4 punches)', () => {
    for (const combo of COMBO_CORPUS) {
      if (combo.punchCount > 4) {
        expect(combo.spokenGroups.length).toBeGreaterThan(1)
      }
    }
  })
})

describe('build-up ladders', () => {
  it.each(BUILD_UP_SETS.map((s) => [s.id, s] as const))(
    '%s builds stage over stage and resolves its combo references',
    (_id, set) => {
      expect(set.stages.length).toBeGreaterThanOrEqual(3)
      let prevCount = 0
      for (const stage of set.stages) {
        // Every stage parses in the real grammar.
        expect(() => parseCombo(canonicalNotation(stage.tokens))).not.toThrow()
        // A ladder always adds work — punch count strictly increases.
        expect(stage.punchCount).toBeGreaterThan(prevCount)
        prevCount = stage.punchCount
        if (stage.coreComboId !== null) {
          expect(CORPUS_MOTIFS_BY_ID.has(stage.coreComboId)).toBe(true)
        }
      }
    },
  )
})

describe('footwork wrappers', () => {
  it('declares placement and tier for every wrapper', () => {
    const placements = new Set([
      'before',
      'after',
      'between-spoken-groups',
      'between-repetitions',
    ])
    const tiers = new Set(['beginner', 'intermediate', 'advanced'])
    for (const wrapper of OPTIONAL_FOOTWORK_WRAPPERS) {
      expect(placements.has(wrapper.placement)).toBe(true)
      expect(tiers.has(wrapper.minimumTier)).toBe(true)
    }
  })
})

describe('phrase render surface', () => {
  it('lists every multi-token notation the voice needs, parseable and unique', () => {
    const notations = corpusPhraseNotations()
    expect(new Set(notations).size).toBe(notations.length)
    // All 60 combos are multi-punch, plus ladder-only stages.
    expect(notations.length).toBeGreaterThanOrEqual(60)
    for (const notation of notations) {
      expect(parseCombo(notation).length).toBeGreaterThan(1)
      // Clip-key compatibility: the canonical form is lowercase-b.
      expect(notation).toBe(notation.replace(/B/g, 'b'))
    }
  })
})

describe('recipe tier shim', () => {
  it('prefers the explicit field and derives from complexity otherwise', () => {
    const base = defaultRecipe()
    expect(tierFor({ ...base, tier: 'advanced' })).toBe('advanced')
    expect(tierFor({ ...base, comboComplexity: 1 })).toBe('beginner')
    expect(tierFor({ ...base, comboComplexity: 3 })).toBe('intermediate')
    expect(tierFor({ ...base, comboComplexity: 5 })).toBe('advanced')
  })
})
