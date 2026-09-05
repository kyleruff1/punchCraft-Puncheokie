/**
 * Per-bar loop calls fit their strides (Script Bible v2, Kyle 2026-09-01).
 *
 * A call that outlasts the stride of a bar it names WILL pile onto the
 * next bar's call — the overlap Pillar 2 forbids — so the fit is proven
 * here, against measured clip durations, not hoped for at runtime. Every
 * unique motif in the maps must have a rendered call clip, and that clip
 * must fit the TIGHTEST stride any occurrence of the motif runs at.
 */
import { CLICK_MAPS, measuresPerRep, type ClickRate } from '../clickMaps'
import { findClickScript } from '../../../../audio/voiceAssets/clickScriptManifest'

/** Tightest stride (ms) per motif across every map occurrence. */
function minStrides(): Map<string, number> {
  const strides = new Map<string, number>()
  for (const map of Object.values(CLICK_MAPS)) {
    for (const round of map.rounds) {
      for (const row of round.rows) {
        const slots = row.motif.split('-').length
        const strideMs =
          measuresPerRep(slots, row.rate as ClickRate) * 4 * (60_000 / map.bpm)
        const existing = strides.get(row.motif)
        if (existing === undefined || strideMs < existing) {
          strides.set(row.motif, strideMs)
        }
      }
    }
  }
  return strides
}

/**
 * Both vocabularies carry the same guarantee. Techniques run under the
 * numbers fallback until its bank renders, so the presence pin for that
 * vocabulary activates only once at least one technique call is on disk —
 * a partial techniques render is then a failure, never a silent fallback.
 */
/**
 * Resolved 2026-09-03: all six formerly-over-stride technique calls now
 * fit and are enforced. Five were fixed by a coach-shorthand rewrite
 * (pump→plural "Body jabs!", all-body factored to one "Body:" prefix,
 * adjacent same-level runs hyphenated to one breath, "lead uppercut"→
 * "lead upper" keeping the hand — CALL_TECHNIQUE_OVERRIDES in
 * gen-workout-scripts.ts). The sixth, `1b-2-1-2` (lone body jab among
 * head shots — no legal factoring), got a Kyle-approved harder per-clip
 * stretch (CALL_MAX_STRETCH 1.6× in make-click-script-clips.mjs). Nothing
 * is exempt now; the empty set is the assertion.
 */
const PENDING_OVER_STRIDE_TECHNIQUES = new Set<string>([])

describe.each(['numbers', 'techniques'] as const)('loop-call fit (%s)', (vocabulary) => {
  const strides = minStrides()
  const bankRendered = [...strides.keys()].some(
    (motif) => findClickScript(`call/${motif}`, vocabulary)?.vocabulary === vocabulary,
  )

  it('every map motif has a rendered call clip', () => {
    if (vocabulary === 'techniques' && !bankRendered) return // bank not rendered yet
    const missing = [...strides.keys()].filter(
      (motif) => findClickScript(`call/${motif}`, vocabulary)?.vocabulary !== vocabulary,
    )
    expect(missing).toEqual([])
  })

  it('every call clip fits the tightest stride its motif runs at', () => {
    const overruns: string[] = []
    for (const [motif, strideMs] of strides) {
      if (vocabulary === 'techniques' && PENDING_OVER_STRIDE_TECHNIQUES.has(motif)) continue
      const clip = findClickScript(`call/${motif}`, vocabulary)
      if (clip?.vocabulary !== vocabulary) continue // reported by the presence test above
      if (clip.durationMs > strideMs - 100) {
        overruns.push(`${motif}: ${clip.durationMs}ms > stride ${strideMs}ms − 100`)
      }
    }
    expect(overruns).toEqual([])
  })

  it('every round opener pad fits its rep-0 call (Variant B, Kyle 2026-09-04)', () => {
    // The bell releases into an authored setupMeasures pad on each round's
    // first row (fit-round-openers.mjs); the rep-0 call plays inside it and
    // must END at least a minimum breath before the first node — never
    // late. This trips at render time if a future clip re-render outgrows
    // its round's pad, instead of on Kyle's ear.
    const MIN_BREATH_MS = 150 // mirrors _useWorkoutRunner.MIN_BREATH_MS (RN module — not importable here)
    const overruns: string[] = []
    for (const [id, map] of Object.entries(CLICK_MAPS)) {
      const measureMs = 4 * (60_000 / map.bpm)
      map.rounds.forEach((round, r) => {
        const opener = round.rows[0]!
        const padMs = (opener.setupMeasures ?? 0) * measureMs
        const clip = findClickScript(`call/${opener.motif}`, vocabulary)
        if (clip?.vocabulary !== vocabulary) return // presence pinned above
        if (padMs < clip.durationMs + MIN_BREATH_MS) {
          overruns.push(
            `${id} r${r + 1} ${opener.motif}: pad ${padMs}ms < call ${clip.durationMs}ms + ${MIN_BREATH_MS}`,
          )
        }
      })
    }
    expect(overruns).toEqual([])
  })

  it('the pending over-stride list only shrinks — a ruled motif comes OFF it', () => {
    if (vocabulary !== 'techniques' || !bankRendered) return
    // Every listed motif must still actually bust — an entry that now fits
    // is stale and must be removed so the exception cannot hide regressions.
    const stale = [...PENDING_OVER_STRIDE_TECHNIQUES].filter((motif) => {
      const strideMs = strides.get(motif)
      const clip = findClickScript(`call/${motif}`, vocabulary)
      if (strideMs === undefined || clip?.vocabulary !== vocabulary) return false
      return clip.durationMs <= strideMs - 100
    })
    expect(stale).toEqual([])
  })
})
