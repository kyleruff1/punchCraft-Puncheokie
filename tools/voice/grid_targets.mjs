/**
 * Grid-fit targets for the phrase render pipeline (M39-V1c).
 *
 * A JS mirror of `src/domain/timing/TimingEngine.ts` — same formula,
 * same numbers — kept in .mjs so the render/validation toolchain
 * (Node, not TypeScript) can compute the target duration a rendered
 * phrase clip must fit within.
 *
 * ## Why a mirror instead of a bridge
 *
 * The renderer runs in Node — no ts-node in this workspace, no build
 * step for tools/*. Importing `../src/domain/timing/TimingEngine.ts`
 * would require compiling on every render invocation and pull in every
 * transitive TS dep. The engine formula is 4 lines. Duplicating them
 * with a test that pins both copies to the same numbers is cheaper and
 * safer than a build step.
 *
 * ## The contract Kyle named
 *
 * Every rendered phrase clip must fit its allocated grid duration:
 *   preferred: |actualMs - gridDurationMs| / gridDurationMs ≤ 5%
 *   hard cap:  |actualMs - gridDurationMs| / gridDurationMs ≤ 10%
 *   beyond hard cap → re-render.
 *
 * The stretch-correction (ffmpeg rubberband in make-phrase-clips.mjs)
 * is a MITIGATION applied inside the tolerance band, not a substitute
 * for it. Clips that need more than ±10% stretch to fit have taken a
 * take Chatterbox spoke at the wrong pace; the fix is to re-render,
 * not to warp harder.
 *
 * ## Legacy corpus caveat — totalSteps assumption
 *
 * The existing phrase corpus is authored as combination NOTATIONS
 * ('1-2b-3'), not `RhythmicCombination` records with explicit
 * `totalSteps`. The engine spec (Kyle 2026-08-30) lets a combination
 * skip grid steps for syncopation. Until each combination is
 * re-authored with explicit `rhythm.totalSteps`, the fit-check
 * assumes density = 1.0 (one slot per token). This is the same
 * assumption `combinationsFromCorpus()` in corpus.mjs implicitly makes
 * today. When the block-authoring migration lands, pass explicit
 * `totalSteps` through and this module honors it.
 */

/**
 * Legacy `cadenceProfile` → `BeatDivision` mapping (Kyle's spec).
 * Mirror of `divisionForCadenceProfile` in
 * src/domain/workout/WorkoutRecipe.ts:232.
 */
export const CADENCE_DIVISION = Object.freeze({
  technical: 1,
  steady: 2,
  pressure: 3,
  sprint: 4,
})

/** Master pulse — Kyle's target. Every cadence is a subdivision. */
export const DEFAULT_BASE_BPM = 60

/**
 * Cornerman default swing (Kyle's 0.54–0.57 character band).
 * The fit target is duration-only — swing shifts internal step
 * offsets but does NOT change `combinationDurationMs` (a full pass
 * of the grid is always `totalSteps × callSlotDurationMs`). Included
 * here as the value we would apply if swing ever entered the target
 * formula.
 */
export const DEFAULT_SWING = 0.54

/**
 * Fit tolerances — matches the engine header rule at
 * TimingEngine.ts:30-37 verbatim.
 */
export const PREFERRED_TOLERANCE = 0.05
export const MAX_TOLERANCE = 0.10

/** Duration of one master beat in milliseconds. */
export function beatDurationMs(baseBpm = DEFAULT_BASE_BPM) {
  if (!Number.isFinite(baseBpm) || baseBpm <= 0) {
    throw new Error('baseBpm must be a positive number')
  }
  return 60_000 / baseBpm
}

/** Duration of one call slot at the given cadence (division). */
export function callSlotDurationMs({ baseBpm = DEFAULT_BASE_BPM, division }) {
  if (!Number.isInteger(division) || division < 1 || division > 4) {
    throw new Error(`division must be an integer in [1,4], got ${division}`)
  }
  return beatDurationMs(baseBpm) / division
}

/**
 * Grid duration for a rendered phrase clip.
 *
 * @param opts.tokens      combination notation split — e.g. ['1','2b','3']
 * @param opts.cadence     legacy cadenceProfile name (mapped to division)
 * @param opts.division    optional direct division override (wins over cadence)
 * @param opts.baseBpm     defaults to 60 (Kyle's master pulse)
 * @param opts.totalSteps  optional explicit grid allocation (density < 1.0)
 * @returns milliseconds — the target the rendered wav must fit within ±5% / ±10%.
 */
export function gridDurationMs({
  tokens,
  cadence,
  division,
  baseBpm = DEFAULT_BASE_BPM,
  totalSteps,
}) {
  const resolvedDivision = division ?? (cadence ? CADENCE_DIVISION[cadence] : undefined)
  if (!resolvedDivision) {
    throw new Error(`gridDurationMs: unknown cadence "${cadence}" (and no division override)`)
  }
  const steps = totalSteps ?? (Array.isArray(tokens) ? tokens.length : 0)
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error(`gridDurationMs: totalSteps must be >= 1, got ${steps}`)
  }
  return steps * callSlotDurationMs({ baseBpm, division: resolvedDivision })
}

/**
 * `actualMs / targetMs` — 1.0 = perfect fit; > 1.0 = clip too long; < 1.0 = too short.
 *
 * Kept as a ratio (not a percentage of drift) because it composes with
 * the stretch multiplier the ffmpeg pass would apply to correct it.
 */
export function fitPct(actualMs, targetMs) {
  if (!Number.isFinite(actualMs) || actualMs <= 0) {
    throw new Error(`fitPct: actualMs must be positive, got ${actualMs}`)
  }
  if (!Number.isFinite(targetMs) || targetMs <= 0) {
    throw new Error(`fitPct: targetMs must be positive, got ${targetMs}`)
  }
  return actualMs / targetMs
}

/**
 * Classify a fit ratio against the ±5% / ±10% bands.
 * Returns one of: 'preferred' | 'acceptable' | 'reject'.
 *
 * Guarded against floating-point boundary jitter — a ratio of exactly
 * 1.10 (which comes back as 1.10000000000000009 from `actual/target`)
 * lands in 'acceptable', not 'reject'.
 */
const FIT_EPSILON = 1e-9
export function fitVerdict(ratio) {
  const drift = Math.abs(ratio - 1)
  if (drift <= PREFERRED_TOLERANCE + FIT_EPSILON) return 'preferred'
  if (drift <= MAX_TOLERANCE + FIT_EPSILON) return 'acceptable'
  return 'reject'
}

/**
 * Convenience — the per-clip band expressed as absolute ms bounds so
 * validation UIs can render a "should land between X and Y" number.
 */
export function fitBoundsMs(targetMs) {
  return {
    preferredMinMs: Math.round(targetMs * (1 - PREFERRED_TOLERANCE)),
    preferredMaxMs: Math.round(targetMs * (1 + PREFERRED_TOLERANCE)),
    maxMinMs: Math.round(targetMs * (1 - MAX_TOLERANCE)),
    maxMaxMs: Math.round(targetMs * (1 + MAX_TOLERANCE)),
  }
}

/**
 * Per-interval fit tolerance (M39-V2 Phase 4b, Kyle amended blueprint
 * 2026-08-30 §Fit-check: two-tier tolerance).
 *
 * Distinct from the whole-clip band above: this checks whether an
 * INTERNAL taught strike position (from `CoachPhraseAsset.taughtStrikeOffsetsTicks`,
 * populated in Phase 4) is close enough to its authored target for the
 * runtime to trust it as a strike map. `speechMarksMs` — the ASR word
 * onsets — are diagnostics only; the two-tier check runs against the
 * SEMANTIC strike positions the phrase teaches.
 *
 *   warn:      |actual − target| > INTERVAL_WARN_MS
 *   hard fail: |actual − target| > max(INTERVAL_HARD_MS_FLOOR,
 *                                       INTERVAL_HARD_PCT × target)
 *
 * Rationale: the ±10 ms fit-check tolerance the compiled timeline
 * uses (`compileCue.ts` DEFAULT_RESPONSE_GAP_TICKS = 60 ticks ≈
 * 62.5 ms at 60 BPM) plus the ~50 ms cleanup grace the coach lane
 * needs leaves ~10-15 ms of slop per interval before the athlete
 * hears drift. Beyond that, the hard cap keeps proportional error
 * from letting a very short interval slip large in absolute terms
 * (a 200 ms interval at 5% is 10 ms; the 25 ms floor keeps that
 * from being tighter than the warn tier).
 */
export const INTERVAL_WARN_MS = 12
export const INTERVAL_HARD_MS_FLOOR = 25
export const INTERVAL_HARD_PCT = 0.05

/** The hard-fail threshold in milliseconds for a target of `targetMs`. */
export function intervalHardMs(targetMs) {
  if (!Number.isFinite(targetMs) || targetMs <= 0) {
    throw new Error(`intervalHardMs: targetMs must be positive, got ${targetMs}`)
  }
  return Math.max(INTERVAL_HARD_MS_FLOOR, targetMs * INTERVAL_HARD_PCT)
}

/**
 * Classify one interval's drift.
 * Returns `'ok' | 'warn' | 'hard'`. `hard` implies re-render (the
 * clip does not honor its taught strike positions well enough for
 * the runtime to dispatch strikes from it).
 */
export function intervalFitVerdict(actualMs, targetMs) {
  if (!Number.isFinite(actualMs)) {
    throw new Error(`intervalFitVerdict: actualMs must be finite, got ${actualMs}`)
  }
  if (!Number.isFinite(targetMs) || targetMs <= 0) {
    throw new Error(`intervalFitVerdict: targetMs must be positive, got ${targetMs}`)
  }
  const drift = Math.abs(actualMs - targetMs)
  if (drift <= INTERVAL_WARN_MS) return 'ok'
  if (drift <= intervalHardMs(targetMs)) return 'warn'
  return 'hard'
}

/**
 * Audit a full sequence of intervals: pass the arrays and get back a
 * per-interval verdict list plus a summary that names the worst
 * offender. Used by --fit-check when a clip carries taught strike
 * positions (Phase 4 pipeline emits them).
 *
 * Both arrays must be the same length; each `actualMs[i]` maps to
 * `targetMs[i]`.
 */
export function intervalFitAudit(actualMs, targetMs) {
  if (!Array.isArray(actualMs) || !Array.isArray(targetMs)) {
    throw new Error('intervalFitAudit: expects two numeric arrays')
  }
  if (actualMs.length !== targetMs.length) {
    throw new Error(
      `intervalFitAudit: length mismatch actual=${actualMs.length} target=${targetMs.length}`,
    )
  }
  const per = actualMs.map((a, i) => {
    const t = targetMs[i]
    const verdict = intervalFitVerdict(a, t)
    return { index: i, actualMs: a, targetMs: t, driftMs: a - t, verdict }
  })
  const worst = per.reduce(
    (acc, row) => (Math.abs(row.driftMs) > Math.abs(acc.driftMs) ? row : acc),
    per[0] ?? { index: -1, actualMs: 0, targetMs: 0, driftMs: 0, verdict: 'ok' },
  )
  const counts = per.reduce(
    (acc, row) => {
      acc[row.verdict] += 1
      return acc
    },
    { ok: 0, warn: 0, hard: 0 },
  )
  return { per, worst, counts, verdict: counts.hard > 0 ? 'hard' : counts.warn > 0 ? 'warn' : 'ok' }
}
