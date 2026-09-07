/**
 * Every spoken slot a click workout names has a rendered clip (2026-09-07).
 *
 * `clickCallFit` pins the per-bar `call/<motif>` clips. Nothing pinned the
 * lead-ins and rest scripts — and a forgotten slot degrades SILENTLY:
 * `introPlan.ts` simply omits the round-1 opener and the runner skips the
 * whisper. Twelve new workouts is exactly when that would happen.
 *
 * Gated per workout the way clickCallFit gates per vocabulary: a workout
 * with NO rendered slot in a vocabulary is treated as not rendered yet and
 * skipped, so this passes before a render lands and fails the moment a
 * render lands incomplete.
 */
import { allClickMaps } from '../allClickMaps'
import { findClickScript } from '../../../../audio/voiceAssets/clickScriptManifest'

describe.each(['numbers', 'techniques'] as const)('click-script slot coverage (%s)', (vocabulary) => {
  it('every lead-in and rest slot resolves once its workout is rendered', () => {
    const missing: string[] = []
    const notRendered: string[] = []
    for (const [id, map] of Object.entries(allClickMaps())) {
      const slots: string[] = []
      map.rounds.forEach((round, r) => {
        round.rows.forEach((_row, s) => slots.push(`lead-in/${id}/r${r + 1}s${s + 1}`))
        if (round.rest) slots.push(`rest/${id}/r${r + 1}`)
      })
      const rendered = new Set(
        slots.filter((slot) => findClickScript(slot, vocabulary)?.vocabulary === vocabulary),
      )
      if (rendered.size === 0) {
        notRendered.push(id)
        continue
      }
      for (const slot of slots) if (!rendered.has(slot)) missing.push(slot)
    }
    expect(missing).toEqual([])
    // Visible in the run, so an unrendered workout is a known gap, not a hidden one.
    if (notRendered.length > 0) {
      console.info(`[clickScriptCoverage] ${vocabulary}: not yet rendered — ${notRendered.join(', ')}`)
    }
  })
})
