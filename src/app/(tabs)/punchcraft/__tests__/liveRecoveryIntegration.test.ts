/**
 * Recovery + warning don't overlap — the property. Uses the real
 * corpus, the real intro/theme durations, and the real per-rest fit
 * budget the live wiring passes into `planRecoverySequence`. If either
 * the recovery selection or the warning worst-case ever creeps past
 * the 60 s rest, this test catches it before the boxer does.
 *
 * The live wiring budgets each rest against the ACTUAL upcoming
 * round's theme clip (not the corpus-wide worst case — budgeting the
 * 8.7 s outlier for every rest once starved the filter down to a
 * single admissible script). The property here mirrors that: for
 * EVERY theme in the manifest, whatever the plan places under that
 * theme's budget must fit alongside that theme's warning.
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
// Both quote styles: the generated manifest writes double-quoted theme
// strings, and a single-quote-only regex once matched NOTHING — leaving
// themeMax at 0 and this whole file asserting a budget ~8.7 s looser
// than the live wiring's, green while production degenerated.
const themeDurations: number[] = []
for (const m of themeSrc.matchAll(/theme:\s*["'][^"']+["'],[\s\S]*?durationMs:\s*(\d+)/g)) {
  themeDurations.push(Number(m[1]))
}

// Recovery meta from the corpus (estimated durations; the render's
// measured totals land near these, either side).
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

function warnWorstMs(nextRoundNumber: number, themeMs: number): number {
  const openerMax = openerDurations.length ? Math.max(...openerDurations) : 0
  const coreMs = warnRoundMs.get(nextRoundNumber) ?? 0
  return openerMax + BREATH_MS + themeMs + BREATH_MS + coreMs + WARN_SLACK_MS + SAFETY_MS
}

/** Live wiring's budget for rest slot i when the upcoming round carries
 * a theme clip of `themeMs`: rest window minus bell clearance minus the
 * warning's worst-case footprint for round i+2. */
const budgetFor = (restIndex: number, themeMs: number): number =>
  Math.max(0, REST_MS - BELL_CLEARANCE_MS - warnWorstMs(restIndex + 2, themeMs))

const median = (xs: number[]): number => {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

describe('recovery + warning fit inside the 60s rest', () => {
  it('the warning worst-case is real and non-trivial for every round', () => {
    expect(openerDurations.length).toBeGreaterThan(0)
    // The theme extraction must actually match the manifest — a silent
    // zero here once hid an 8.7 s budget error.
    expect(themeDurations.length).toBeGreaterThan(0)
    for (let round = 2; round <= 12; round += 1) {
      expect(warnRoundMs.get(round)).toBeGreaterThan(0)
    }
  })

  it('whatever the plan places fits alongside EVERY possible theme warning', () => {
    // The live budget subtracts the actual upcoming theme; the property
    // holds when, for each theme the schedule could carry, everything
    // planned under that theme's budget also plays out inside the rest.
    for (const themeMs of [...themeDurations, 0]) {
      const plan = planRecoverySequence(recoveryMeta, 7, `fit-${themeMs}`, {
        maxTotalMsFor: (i) => budgetFor(i, themeMs),
      })
      for (let i = 0; i < plan.length; i += 1) {
        const scriptId = plan[i]
        if (!scriptId) continue
        const script = recoveryMeta.find((s) => s.scriptId === scriptId)!
        expect(
          BELL_CLEARANCE_MS + script.measuredTotalMs + warnWorstMs(i + 2, themeMs),
        ).toBeLessThanOrEqual(REST_MS)
      }
    }
  })

  it('typical themes leave room for real variety across a 40m workout', () => {
    // If the budget is so tight that most slots skip — or every slot
    // funnels to one short script — the feature is inert; the corpus was
    // tuned against typical theme lengths, so test with the median.
    const themeMs = median(themeDurations)
    const plan = planRecoverySequence(recoveryMeta, 7, 'coverage-40m', {
      maxTotalMsFor: (i) => budgetFor(i, themeMs),
    })
    const placed = plan.filter((x): x is string => x !== undefined)
    expect(placed.length).toBeGreaterThanOrEqual(5)
    // Variety, not a single survivor: at least 3 distinct scripts across
    // the seven rests (the R13-collapse regression guard).
    expect(new Set(placed).size).toBeGreaterThanOrEqual(3)
  })
})
