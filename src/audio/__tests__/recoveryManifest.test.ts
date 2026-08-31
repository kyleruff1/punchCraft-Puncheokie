/**
 * Recovery corpus safety net — the manifest generator can only ship
 * what the silence-track library can play. If someone adds a new
 * `pauseAfterMs` to `tools/voice/recovery.json` and forgets to
 * generate the matching silence, RecoveryPlayer would drop the hold
 * silently. This test reads the corpus directly and holds every hold
 * to the same guarantee `introPlan.test.ts` gives the walkout.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const cwd = process.cwd()

import { silenceFor, SILENCE_TRACKS } from '../voiceAssets/silenceManifest'

interface RecoveryCorpus {
  restWindow: { maximumScriptDurationSec: number }
  scripts: ReadonlyArray<{
    id: string
    segments: ReadonlyArray<{ pauseAfterMs: number }>
  }>
}

const corpus = JSON.parse(
  readFileSync(join(cwd, 'tools', 'voice', 'recovery.json'), 'utf8'),
) as RecoveryCorpus

describe('recovery corpus / silence-track coverage', () => {
  it('has a silence track for every pauseAfterMs the corpus uses', () => {
    const pauses = new Set<number>()
    for (const script of corpus.scripts) {
      for (const segment of script.segments) {
        if (segment.pauseAfterMs > 0) pauses.add(segment.pauseAfterMs)
      }
    }
    for (const gap of pauses) {
      expect([gap, silenceFor(gap) !== undefined]).toEqual([gap, true])
    }
  })

  it("every silence track is a positive integer millisecond value", () => {
    for (const [ms, module] of Object.entries(SILENCE_TRACKS)) {
      const value = Number(ms)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThan(0)
      expect(typeof module).toBe('number')
    }
  })

  it("never accepts a script whose estimated duration already exceeds the cap", () => {
    // The build-time timing rule (measured > 45s → EXCLUDE) will do
    // the final enforcement, but the corpus's own estimates should
    // already be under it; a corpus that shipped an over-cap script
    // means the estimator is wrong or the cap changed.
    const cap = corpus.restWindow.maximumScriptDurationSec * 1000
    for (const script of corpus.scripts) {
      const estimate = script.segments.reduce(
        (sum, seg) => sum + seg.pauseAfterMs,
        0,
      )
      // Just the pauses; the speech adds ~2s per segment. If the pauses
      // alone breach the cap the corpus itself is malformed.
      expect(estimate).toBeLessThan(cap)
    }
  })
})
