/**
 * Inter-round recovery plan — every rule from the corpus's
 * `selectionPolicy`, plus the graceful degradation the header of
 * `recoveryPlan.ts` promises.
 */
import { planRecoverySequence, type RecoveryScriptMeta } from '../recoveryPlan'

/** The 20-script corpus, minimum viable shape for the plan. */
const CORPUS: RecoveryScriptMeta[] = [
  { scriptId: 'R01', category: 'mixed', hydrationPrompt: false, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 42600 },
  { scriptId: 'R02', category: 'upper_body', hydrationPrompt: true, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 39600 },
  { scriptId: 'R03', category: 'upper_body', hydrationPrompt: false, requiresStableBag: true, avoidIfDizzy: false, measuredTotalMs: 43700 },
  { scriptId: 'R04', category: 'upper_body', hydrationPrompt: false, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 43400 },
  { scriptId: 'R05', category: 'upper_body', hydrationPrompt: false, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 41100 },
  { scriptId: 'R06', category: 'upper_body', hydrationPrompt: true, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 43400 },
  { scriptId: 'R07', category: 'torso', hydrationPrompt: false, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 39200 },
  { scriptId: 'R08', category: 'torso', hydrationPrompt: false, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 42000 },
  { scriptId: 'R09', category: 'lower_body', hydrationPrompt: false, requiresStableBag: false, avoidIfDizzy: true, measuredTotalMs: 42900 },
  { scriptId: 'R10', category: 'lower_body', hydrationPrompt: true, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 40800 },
  { scriptId: 'R11', category: 'lower_body', hydrationPrompt: false, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 41600 },
  { scriptId: 'R12', category: 'lower_body', hydrationPrompt: false, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 40800 },
  { scriptId: 'R13', category: 'lower_body', hydrationPrompt: false, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 40200 },
  { scriptId: 'R14', category: 'mixed', hydrationPrompt: true, requiresStableBag: false, avoidIfDizzy: true, measuredTotalMs: 40700 },
  { scriptId: 'R15', category: 'breathing', hydrationPrompt: false, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 43900 },
  { scriptId: 'R16', category: 'upper_body', hydrationPrompt: false, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 42600 },
  { scriptId: 'R17', category: 'upper_body', hydrationPrompt: false, requiresStableBag: true, avoidIfDizzy: false, measuredTotalMs: 44800 },
  { scriptId: 'R18', category: 'upper_body', hydrationPrompt: false, requiresStableBag: true, avoidIfDizzy: false, measuredTotalMs: 41300 },
  { scriptId: 'R19', category: 'mixed', hydrationPrompt: false, requiresStableBag: false, avoidIfDizzy: true, measuredTotalMs: 42000 },
  { scriptId: 'R20', category: 'mixed', hydrationPrompt: true, requiresStableBag: false, avoidIfDizzy: false, measuredTotalMs: 43400 },
]

const findScript = (id: string) => CORPUS.find((s) => s.scriptId === id) as RecoveryScriptMeta

describe('planRecoverySequence', () => {
  it('is deterministic per seed', () => {
    const a = planRecoverySequence(CORPUS, 11, 'seed-alpha')
    const b = planRecoverySequence(CORPUS, 11, 'seed-alpha')
    expect(a).toEqual(b)
    const c = planRecoverySequence(CORPUS, 11, 'seed-beta')
    expect(c).not.toEqual(a)
  })

  it('does not repeat a script within the first pass through the pool', () => {
    // 20 eligible scripts, 11 rests — no refill should happen.
    const plan = planRecoverySequence(CORPUS, 11, 'seed-no-repeat')
    const placed = plan.filter((x): x is string => x !== undefined)
    expect(new Set(placed).size).toBe(placed.length)
  })

  it('refills the pool after everything has been used, still deterministically', () => {
    // 25 rests forces a refill after 20 placements.
    const plan = planRecoverySequence(CORPUS, 25, 'seed-refill')
    const placed = plan.filter((x): x is string => x !== undefined)
    expect(placed.length).toBe(25)
    // At least one repeat means the refill fired; determinism holds
    // because a second call with the same seed matches.
    const again = planRecoverySequence(CORPUS, 25, 'seed-refill')
    expect(again).toEqual(plan)
  })

  it('avoids the same category in consecutive rests when it can', () => {
    const plan = planRecoverySequence(CORPUS, 11, 'seed-category')
    for (let i = 1; i < plan.length; i += 1) {
      const prev = plan[i - 1]
      const cur = plan[i]
      if (!prev || !cur) continue
      expect(findScript(cur).category).not.toBe(findScript(prev).category)
    }
  })

  it('spaces hydration prompts by at least 2 intervening rests', () => {
    const plan = planRecoverySequence(CORPUS, 11, 'seed-hydration')
    let lastHydration = -Infinity
    for (let i = 0; i < plan.length; i += 1) {
      const id = plan[i]
      if (!id || !findScript(id).hydrationPrompt) continue
      expect(i - lastHydration).toBeGreaterThanOrEqual(3)
      lastHydration = i
    }
  })

  it('spaces bag-assisted scripts by at least 2 intervening rests', () => {
    const plan = planRecoverySequence(CORPUS, 11, 'seed-bag')
    let lastBag = -Infinity
    for (let i = 0; i < plan.length; i += 1) {
      const id = plan[i]
      if (!id || !findScript(id).requiresStableBag) continue
      expect(i - lastBag).toBeGreaterThanOrEqual(3)
      lastBag = i
    }
  })

  it('spaces forward-fold scripts by at least 2 intervening rests', () => {
    const plan = planRecoverySequence(CORPUS, 11, 'seed-fold')
    let lastFold = -Infinity
    for (let i = 0; i < plan.length; i += 1) {
      const id = plan[i]
      if (!id || !findScript(id).avoidIfDizzy) continue
      expect(i - lastFold).toBeGreaterThanOrEqual(3)
      lastFold = i
    }
  })

  it('never places a script whose measuredTotalMs exceeds the fit budget', () => {
    // Cap to 41 seconds — R03/R04/R06/R09/R15/R16/R17/R20 all disqualify.
    const cap = 41000
    const plan = planRecoverySequence(CORPUS, 11, 'seed-fit', {
      maxTotalMsFor: () => cap,
    })
    for (const id of plan) {
      if (!id) continue
      expect(findScript(id).measuredTotalMs).toBeLessThanOrEqual(cap)
    }
  })

  it('excludes bag-assisted scripts when the option is off', () => {
    const plan = planRecoverySequence(CORPUS, 11, 'seed-nobag', { allowBagAssisted: false })
    for (const id of plan) {
      if (!id) continue
      expect(findScript(id).requiresStableBag).toBe(false)
    }
  })

  it('excludes forward-fold scripts when the option is off', () => {
    const plan = planRecoverySequence(CORPUS, 11, 'seed-nofold', { allowForwardFold: false })
    for (const id of plan) {
      if (!id) continue
      expect(findScript(id).avoidIfDizzy).toBe(false)
    }
  })

  it('returns undefined for a rest slot when nothing fits at all', () => {
    // Cap below every script's total → every slot must be a skip.
    const plan = planRecoverySequence(CORPUS, 4, 'seed-tiny', {
      maxTotalMsFor: () => 10_000,
    })
    expect(plan).toEqual([undefined, undefined, undefined, undefined])
  })

  it('degradation never violates the fit rule', () => {
    // A tight budget that leaves only three eligible scripts across
    // eight rests forces the spacing rules to relax multiple times.
    // Fit must still hold in every slot that gets a script.
    const cap = 40800
    const plan = planRecoverySequence(CORPUS, 8, 'seed-degradation', {
      maxTotalMsFor: () => cap,
    })
    for (const id of plan) {
      if (!id) continue
      expect(findScript(id).measuredTotalMs).toBeLessThanOrEqual(cap)
    }
  })
})
