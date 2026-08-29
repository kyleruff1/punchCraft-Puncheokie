/**
 * The punch-buzz tier map: the athlete literally feels the reading, so
 * the boundaries between tiers are contract, not implementation.
 */
import { punchBuzzOf } from '../HapticOutputPort'

describe('punchBuzzOf', () => {
  it('maps the normalized reading to ascending tiers', () => {
    expect(punchBuzzOf(0)).toBe('soft')
    expect(punchBuzzOf(0.29)).toBe('soft')
    expect(punchBuzzOf(0.3)).toBe('light')
    expect(punchBuzzOf(0.54)).toBe('light')
    expect(punchBuzzOf(0.55)).toBe('medium')
    expect(punchBuzzOf(0.79)).toBe('medium')
    expect(punchBuzzOf(0.8)).toBe('heavy')
    expect(punchBuzzOf(1)).toBe('heavy')
  })

  it('is monotone: a harder reading never buzzes softer', () => {
    const order = ['soft', 'light', 'medium', 'heavy']
    let prev = -1
    for (let v = 0; v <= 1.0001; v += 0.01) {
      const rank = order.indexOf(punchBuzzOf(v))
      expect(rank).toBeGreaterThanOrEqual(prev)
      prev = rank
    }
  })
})
