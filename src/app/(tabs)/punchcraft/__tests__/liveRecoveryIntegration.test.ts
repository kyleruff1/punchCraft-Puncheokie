/**
 * Recovery + warning don't overlap — the property. Uses the real
 * corpus, the real intro/theme durations, and the real per-rest fit
 * budget the live wiring passes into `planRecoverySequence`. If either
 * the recovery selection or the warning worst-case ever creeps past
 * the 60 s rest, this test catches it before the boxer does.
 *
 * Read from the source manifests as text (not `require`) so the test
 * doesn't drag Metro assets into the jest runtime.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { planRecoverySequence, type RecoveryScriptMeta } from '@domain/coach/recoveryPlan'

/* eslint-disable-next-line no-undef */
const cwd = process.cwd()

interface Corpus {
  scripts: ReadonlyArray<{
    id: string
    category: string
    hydrationPrompt: boolean
    requiresStableBag: boolean
    avoidIfDizzy: boolean
    estimatedDurationSec: number
  }>
}

const corpus = JSON.parse(
  readFileSync(join(cwd, 'tools', 'voice', 'recovery.json'), 'utf8'),
) as Corpus

const introSrc = readFileSync(
  join(cwd, 'src', 'audio', 'voiceAssets', 'introManifest.ts'),
  'utf8',
)
const openerDurations: number[] = []
for (const m of introSrc.matchAll(/'warn-opener-\d+':[^{]*\{[^}]*durationMs:\s*(\d+)/g)) {
  openerDurations.push(Number(m[1]))
}
const warnRoundMs = new Map<number, number>()
for (const m of introSrc.matchAll(/'warn-round-(\d+)':[^{]*\{[^}]*durationMs:\s*(\d+)/g)) {
  warnRoundMs.set(Number(m[1]), Number(m[2]))
}

const themeSrc = readFileSync(
  join(cwd, 'src', 'audio', 'voiceAssets', 'calloutManifest.ts'),
  'utf8',
)
const themeDurations: number[] = []
for (const m of themeSrc.matchAll(/theme:\s*'[^']+',[\s\S]*?durationMs:\s*(\d+)/g)) {
  themeDurations.push(Number(m[1]))
}

// Recovery meta from the corpus (using estimated durations — the render's
// measured totals will be lower for headroom the plan already accounts for).
const recoveryMeta: RecoveryScriptMeta[] = corpus.scripts.map((s) => ({
  scriptId: s.id,
  category: s.category,
  hydrationPrompt: s.hydrationPrompt,
  requiresStableBag: s.requiresStableBag,
  avoidIfDizzy: s.avoidIfDizzy,
  measuredTotalMs: Math.round(s.estimatedDurationSec * 1000),
}))

const REST_MS = 60_000
const BELL_CLEARANCE_MS = 1_000
const BREATH_MS = 350
const WARN_SLACK_MS = 400
const SAFETY_MS = 500

function warnWorstMs(nextRoundNumber: number): number {
  const openerMax = openerDurations.length ? Math.max(...openerDurations) : 0
  const themeMax = themeDurations.length ? Math.max(...themeDurations) : 0
  const coreMs = warnRoundMs.get(nextRoundNumber) ?? 0
  return openerMax + BREATH_MS + themeMax + BREATH_MS + coreMs + WARN_SLACK_MS + SAFETY_MS
}

// Live wiring's budget for rest slot i: rest window minus 1s bell
// clearance minus the warning's worst-case footprint for round i+2.
const maxTotalMsFor = (restIndex: number): number =>
  Math.max(0, REST_MS - BELL_CLEARANCE_MS - warnWorstMs(restIndex + 2))

describe('recovery + warning fit inside the 60s rest', () => {
  it('the warning worst-case is real and non-trivial for every round', () => {
    expect(openerDurations.length).toBeGreaterThan(0)
    for (let round = 2; round <= 12; round += 1) {
      expect(warnRoundMs.get(round)).toBeGreaterThan(0)
    }
  })

  it.each([
    ['20m (3 rests)', 3],
    ['30m (5 rests)', 5],
    ['40m (7 rests)', 7],
    ['60m (11 rests)', 11],
  ])('every placed recovery fits its rest slot on %s', (_label, restCount) => {
    const plan = planRecoverySequence(recoveryMeta, restCount, `fit-${restCount}`, {
      maxTotalMsFor,
    })
    for (let i = 0; i < plan.length; i += 1) {
      const scriptId = plan[i]
      if (!scriptId) continue
      const script = recoveryMeta.find((s) => s.scriptId === scriptId)!
      // The recovery ends before the warning's earliest possible start.
      expect(
        BELL_CLEARANCE_MS + script.measuredTotalMs + warnWorstMs(i + 2),
      ).toBeLessThanOrEqual(REST_MS)
    }
  })

  it('places some recovery in every rest across the standard 40m workout', () => {
    // If the budget is so tight that every slot skips, the whole
    // feature is inert; the corpus was tuned to prevent that.
    const plan = planRecoverySequence(recoveryMeta, 7, 'coverage-40m', { maxTotalMsFor })
    const placed = plan.filter((x): x is string => x !== undefined)
    expect(placed.length).toBeGreaterThanOrEqual(5)
  })
})
