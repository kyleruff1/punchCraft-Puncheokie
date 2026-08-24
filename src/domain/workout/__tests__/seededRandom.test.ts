import { makeRng } from '../seededRandom'

describe('makeRng', () => {
  it('is deterministic for a given seed', () => {
    const a = makeRng('seed-a')
    const b = makeRng('seed-a')
    const seqA = Array.from({ length: 20 }, () => a.next())
    const seqB = Array.from({ length: 20 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('diverges for different seeds', () => {
    const a = Array.from({ length: 20 }, makeRng('seed-a').next)
    const b = Array.from({ length: 20 }, makeRng('seed-b').next)
    expect(a).not.toEqual(b)
  })

  it('returns floats in [0, 1)', () => {
    const rng = makeRng('range')
    for (let i = 0; i < 1000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  describe('int', () => {
    it('stays within [0, maxExclusive)', () => {
      const rng = makeRng('int')
      for (let i = 0; i < 1000; i++) {
        const v = rng.int(6)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(6)
        expect(Number.isInteger(v)).toBe(true)
      }
    })

    it('returns 0 for an empty range', () => {
      expect(makeRng('x').int(0)).toBe(0)
      expect(makeRng('x').int(-3)).toBe(0)
    })
  })

  describe('pick', () => {
    it('returns a member of the array', () => {
      const rng = makeRng('pick')
      const items = ['a', 'b', 'c']
      for (let i = 0; i < 50; i++) expect(items).toContain(rng.pick(items))
    })

    it('throws on an empty array', () => {
      expect(() => makeRng('x').pick([])).toThrow()
    })
  })

  describe('weightedPick', () => {
    it('never returns a zero-weight item when a positive one exists', () => {
      const rng = makeRng('weighted')
      const items = ['never', 'always']
      for (let i = 0; i < 200; i++) {
        expect(rng.weightedPick(items, (x) => (x === 'always' ? 1 : 0))).toBe('always')
      }
    })

    it('falls back to uniform when all weights are zero', () => {
      const rng = makeRng('weighted-zero')
      const items = ['a', 'b']
      for (let i = 0; i < 50; i++) expect(items).toContain(rng.weightedPick(items, () => 0))
    })

    it('roughly honours the weights over many draws', () => {
      const rng = makeRng('weighted-dist')
      const counts = { heavy: 0, light: 0 }
      for (let i = 0; i < 4000; i++) {
        counts[rng.weightedPick(['heavy', 'light'] as const, (x) => (x === 'heavy' ? 3 : 1))] += 1
      }
      // 3:1 weighting — heavy should land well above half.
      expect(counts.heavy).toBeGreaterThan(counts.light * 2)
    })
  })

  describe('shuffle', () => {
    it('is a permutation and does not mutate the input', () => {
      const rng = makeRng('shuffle')
      const input = [1, 2, 3, 4, 5]
      const out = rng.shuffle(input)
      expect(input).toEqual([1, 2, 3, 4, 5])
      expect(out.slice().sort()).toEqual([1, 2, 3, 4, 5])
    })
  })

  describe('chance', () => {
    it('is never true at 0 and always true at 1', () => {
      const rng = makeRng('chance')
      for (let i = 0; i < 50; i++) {
        expect(rng.chance(0)).toBe(false)
        expect(rng.chance(1)).toBe(true)
      }
    })
  })
})
