/**
 * Seeded pseudo-random generator for the workout generator (M35).
 *
 * The generator must be a pure function of its recipe: the same recipe,
 * generator version and seed must reproduce an identical plan (D8,
 * `WorkoutRecipe.ts` determinism note). A seeded stream is what makes that
 * possible without reaching for `Math.random` — which the domain-purity test
 * forbids here anyway (`src/domain/__tests__/domainPurity.test.ts`).
 *
 * The algorithm is **mulberry32 over an FNV-1a string hash**, the same pair
 * `SimulatedPunchSource` uses for its jitter stream — copied rather than
 * shared because that one is scoped to the simulator and this one belongs to
 * the domain. Randomness *quality* is not the point: reproducibility is.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

/** FNV-1a: fold a seed string into a 32-bit integer. */
function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** mulberry32: a 32-bit state PRNG returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Rng {
  /** A float in [0, 1). */
  next(): number
  /** An integer in [0, maxExclusive). Returns 0 when the range is empty. */
  int(maxExclusive: number): number
  /** A uniform pick. Throws on an empty array — an empty pool is a bug upstream. */
  pick<T>(items: readonly T[]): T
  /**
   * A weighted pick: probability proportional to `weight(item)`. Non-positive
   * weights are treated as zero; if every weight is zero it falls back to a
   * uniform pick so it never returns undefined for a non-empty pool.
   */
  weightedPick<T>(items: readonly T[], weight: (item: T) => number): T
  /** A Fisher–Yates shuffle into a new array; the input is not mutated. */
  shuffle<T>(items: readonly T[]): T[]
  /** True with probability `probability` (clamped to [0, 1]). */
  chance(probability: number): boolean
}

/**
 * Build a deterministic RNG from a seed string.
 *
 * Two RNGs from the same seed emit identical sequences; different seeds
 * diverge immediately. All the helpers draw from the one underlying stream,
 * so the order of calls is part of the determinism contract — reordering
 * draws changes the plan, which is exactly why the generator's call order is
 * fixed.
 */
export function makeRng(seed: string): Rng {
  const next = mulberry32(hashSeed(seed))

  const int = (maxExclusive: number): number => {
    if (maxExclusive <= 0) return 0
    return Math.floor(next() * maxExclusive)
  }

  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('makeRng: cannot pick from an empty array')
    return items[int(items.length)] as T
  }

  const weightedPick = <T>(items: readonly T[], weight: (item: T) => number): T => {
    if (items.length === 0) throw new Error('makeRng: cannot weightedPick from an empty array')
    const weights = items.map((item) => Math.max(0, weight(item)))
    const total = weights.reduce((sum, w) => sum + w, 0)
    if (total <= 0) return pick(items)
    let threshold = next() * total
    for (let i = 0; i < items.length; i++) {
      threshold -= weights[i] as number
      if (threshold < 0) return items[i] as T
    }
    // Floating-point slack can leave threshold ≥ 0 after the loop; the last
    // positive-weight item is the correct fallback.
    return items[items.length - 1] as T
  }

  const shuffle = <T>(items: readonly T[]): T[] => {
    const out = items.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = int(i + 1)
      ;[out[i], out[j]] = [out[j] as T, out[i] as T]
    }
    return out
  }

  const chance = (probability: number): boolean => {
    if (probability <= 0) return false
    if (probability >= 1) return true
    return next() < probability
  }

  return { next, int, pick, weightedPick, shuffle, chance }
}
