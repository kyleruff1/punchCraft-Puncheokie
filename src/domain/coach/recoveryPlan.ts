/**
 * Inter-round recovery plan — seeded selection of which recovery script
 * the coach walks the boxer through in each rest.
 *
 * Domain-pure (no audio, no manifest imports): the caller passes in
 * `RecoveryScriptMeta[]`, the plan returns a `scriptId` per rest slot.
 * Every workout with the same seed picks the same sequence, so the
 * live wiring can compute it once and address it by rest index without
 * threading random state through the audio layer.
 *
 * Policy (verbatim from the corpus's `selectionPolicy`):
 * - No script repeats within a workout until every eligible script has
 *   been used. On exhaustion the pool refills — the sequence remains
 *   deterministic.
 * - Avoid selecting the same body-region `category` in consecutive
 *   rests.
 * - Leave at least 2 intervening rests between hydration prompts.
 * - Leave at least 2 intervening rests between bag-assisted scripts
 *   (`requiresStableBag`).
 * - Leave at least 2 intervening rests between forward-fold or
 *   toe-reach scripts (`avoidIfDizzy`).
 * - Respect a fit filter: never place a script whose `measuredTotalMs`
 *   would blow past the rest window's usable slice.
 *
 * Graceful degradation (all-blocked case): the category rule relaxes
 * first, then the three spacing rules, then the used-set is refilled;
 * the fit rule is NEVER relaxed. When nothing fits at all, the slot
 * returns `undefined` and the caller skips the walkthrough for that
 * rest.
 */

import { makeRng } from '../workout/seededRandom'

export interface RecoveryScriptMeta {
  scriptId: string
  /** Body-region grouping used by the non-adjacency rule. */
  category: string
  hydrationPrompt: boolean
  /** True if the script sends the athlete's glove onto the bag. */
  requiresStableBag: boolean
  /** True for forward folds / toe reaches the corpus dizzy-gates. */
  avoidIfDizzy: boolean
  /** Sum of measured segment durations plus scheduled pauses. */
  measuredTotalMs: number
}

export interface PlanRecoveryOptions {
  /** Default true. Set false to exclude scripts that need a stable bag. */
  allowBagAssisted?: boolean
  /** Default true. Set false to exclude forward-fold / toe-reach scripts. */
  allowForwardFold?: boolean
  /**
   * Per-rest fit budget. A script whose `measuredTotalMs` exceeds the
   * returned budget is not placed in that slot. Default: no cap.
   */
  maxTotalMsFor?: (restIndex: number) => number
}

/** How many rests must sit between two placements of the same class. */
const SPACING_HYDRATION = 2
const SPACING_BAG = 2
const SPACING_FOLD = 2

/**
 * Plan the recovery walkthroughs for one workout. Returns `restCount`
 * entries; each is a `scriptId` or `undefined` (skip this rest).
 */
export function planRecoverySequence(
  scripts: readonly RecoveryScriptMeta[],
  restCount: number,
  seedKey: string,
  opts: PlanRecoveryOptions = {},
): (string | undefined)[] {
  const allowBag = opts.allowBagAssisted ?? true
  const allowFold = opts.allowForwardFold ?? true
  const budget = opts.maxTotalMsFor ?? (() => Number.POSITIVE_INFINITY)

  const eligible = scripts.filter((s) => {
    if (!allowBag && s.requiresStableBag) return false
    if (!allowFold && s.avoidIfDizzy) return false
    return true
  })

  const rng = makeRng(`${seedKey}|recovery|v1`)
  const plan: (string | undefined)[] = []
  const used = new Set<string>()
  const history: RecoveryScriptMeta[] = []

  for (let rest = 0; rest < restCount; rest += 1) {
    const cap = budget(rest)
    const fits = (s: RecoveryScriptMeta): boolean => s.measuredTotalMs <= cap

    // No-repeat pool: unused first; when everything eligible has been
    // used, refill deterministically.
    let pool = eligible.filter((s) => !used.has(s.scriptId) && fits(s))
    if (pool.length === 0) {
      used.clear()
      pool = eligible.filter(fits)
    }
    if (pool.length === 0) {
      plan.push(undefined)
      history.push(null as unknown as RecoveryScriptMeta)
      continue
    }

    // Spacing filters — hardest first. `since` returns Infinity when
    // that class has never been placed (so the rule is trivially met).
    const since = (predicate: (s: RecoveryScriptMeta) => boolean): number => {
      for (let i = history.length - 1; i >= 0; i -= 1) {
        const h = history[i]
        if (h && predicate(h)) return history.length - 1 - i
      }
      return Number.POSITIVE_INFINITY
    }
    const hydrationGap = since((s) => s.hydrationPrompt)
    const bagGap = since((s) => s.requiresStableBag)
    const foldGap = since((s) => s.avoidIfDizzy)

    // Try successively looser filters. The fit rule holds throughout.
    const prevCategory = history[history.length - 1]?.category
    const filters: Array<(s: RecoveryScriptMeta) => boolean> = [
      // Tightest: every rule holds.
      (s) =>
        s.category !== prevCategory &&
        (!s.hydrationPrompt || hydrationGap >= SPACING_HYDRATION) &&
        (!s.requiresStableBag || bagGap >= SPACING_BAG) &&
        (!s.avoidIfDizzy || foldGap >= SPACING_FOLD),
      // Relax category first — the corpus's weakest rule.
      (s) =>
        (!s.hydrationPrompt || hydrationGap >= SPACING_HYDRATION) &&
        (!s.requiresStableBag || bagGap >= SPACING_BAG) &&
        (!s.avoidIfDizzy || foldGap >= SPACING_FOLD),
      // Then relax the spacing rules — anything that fits will do.
      () => true,
    ]

    let chosen: RecoveryScriptMeta | null = null
    for (const filter of filters) {
      const candidates = pool.filter(filter)
      if (candidates.length > 0) {
        // Sort for stable ordering across engine changes; RNG picks
        // one — same seed → same script.
        const sorted = candidates.slice().sort((a, b) => a.scriptId.localeCompare(b.scriptId))
        chosen = rng.pick(sorted)
        break
      }
    }
    if (!chosen) {
      plan.push(undefined)
      history.push(null as unknown as RecoveryScriptMeta)
      continue
    }
    plan.push(chosen.scriptId)
    used.add(chosen.scriptId)
    history.push(chosen)
  }
  return plan
}
