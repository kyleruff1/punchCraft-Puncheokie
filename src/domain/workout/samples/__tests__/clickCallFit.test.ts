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
      const clip = findClickScript(`call/${motif}`, vocabulary)
      if (clip?.vocabulary !== vocabulary) continue // reported by the presence test above
      if (clip.durationMs > strideMs - 100) {
        overruns.push(`${motif}: ${clip.durationMs}ms > stride ${strideMs}ms − 100`)
      }
    }
    expect(overruns).toEqual([])
  })
})
