/**
 * Typography scale integrity.
 *
 * The load-bearing thing: `sizes` must stay ordered largest → smallest so
 * `sizes.hero > sizes.title > sizes.body > sizes.micro` is a meaningful
 * design guarantee, not a coincidence. If a future edit accidentally
 * makes `sizes.body` bigger than `sizes.hero`, the whole scale becomes
 * incoherent — this test flags that immediately.
 */
import { fonts, recipes, sizes, weights } from '../typography'

describe('typography sizes', () => {
  it('descends largest → smallest', () => {
    expect(sizes.display).toBeGreaterThan(sizes.hero)
    expect(sizes.hero).toBeGreaterThan(sizes.title)
    expect(sizes.title).toBeGreaterThan(sizes.subtitle)
    expect(sizes.subtitle).toBeGreaterThan(sizes.body)
    expect(sizes.body).toBeGreaterThan(sizes.label)
    expect(sizes.label).toBeGreaterThan(sizes.micro)
  })
})

describe('typography fonts', () => {
  it('every family is a non-empty string', () => {
    for (const value of Object.values(fonts)) {
      expect(typeof value).toBe('string')
      expect((value as string).length).toBeGreaterThan(0)
    }
    // Belt and braces: no undefined values slipped in as a paired-fallback
    // rewrite — the punchCraft app now uses Kanit everywhere,
    // including body.
    expect(fonts.body).toMatch(/^Kanit_/)
    expect(fonts.heading).toMatch(/^Kanit_/)
    expect(fonts.display).toMatch(/^Kanit_/)
    expect(fonts.label).toMatch(/^Kanit_/)
  })
})

describe('typography weights', () => {
  it('descends heaviest → lightest as a numeric compare', () => {
    const w = weights
    expect(Number(w.black)).toBeGreaterThan(Number(w.bold))
    expect(Number(w.bold)).toBeGreaterThan(Number(w.semibold))
    expect(Number(w.semibold)).toBeGreaterThan(Number(w.medium))
    expect(Number(w.medium)).toBeGreaterThan(Number(w.regular))
  })
})

describe('button recipes', () => {
  it('every recipe carries a font, size, and weight', () => {
    for (const key of ['buttonPrimary', 'buttonSecondary', 'buttonSubtle'] as const) {
      const r = recipes[key]
      expect(r.fontFamily).toMatch(/^Kanit_/)
      expect(typeof r.fontSize).toBe('number')
      expect(r.fontSize).toBeGreaterThan(0)
      expect(r.fontWeight).toMatch(/^\d{3}$/)
    }
  })

  it('buttonPrimary is more prominent than buttonSubtle', () => {
    expect(recipes.buttonPrimary.fontSize).toBeGreaterThan(recipes.buttonSubtle.fontSize)
    expect(Number(recipes.buttonPrimary.fontWeight)).toBeGreaterThanOrEqual(
      Number(recipes.buttonSubtle.fontWeight),
    )
  })
})
