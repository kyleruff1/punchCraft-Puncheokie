/**
 * Dump `src/domain/programs/phraseTimingManifest.ts` to JSON for the Python
 * tools (GH #292, plan C5 repair).
 *
 * Why this exists: those tools used to regex
 * `src/audio/voiceAssets/phraseManifest.ts` for per-token `wordMarks`. That
 * file was DELETED when V2 Phase 5-iv retired the per-punch phrase corpus
 * (commit 369a2c6), so every one of them has been reading a path that does
 * not exist — a traceback at best, silently zero rows at worst. The per-token
 * onsets and ends survived in the compiled `phraseTimingManifest.ts`, which
 * is TypeScript the Python side cannot import; this is the bridge.
 *
 *   node --import ./tools/analysis/wav-stub.mjs --import tsx \
 *     tools/analysis/phrase-timing-dump.mjs
 *   → tools/analysis/reports/phrase-timing.json
 *
 * Shape: `{ generatedAt, entries: [{ combination, cadence, tokens,
 * numbers|techniques: { cueId, durationMs, wordMarksSource, words } }],
 * byCueId: { <cueId>: { combination, cadence, vocabulary, durationMs,
 * wordMarksSource, words } } }` — `byCueId` is what a log-joining tool wants,
 * since the log names a cueId.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PHRASE_TIMING } from '../../src/domain/programs/phraseTimingManifest'

const REPO_ROOT = import.meta.url
  ? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  : process.cwd()

const OUT = join(REPO_ROOT, 'tools', 'analysis', 'reports', 'phrase-timing.json')

const byCueId = {}
for (const entry of PHRASE_TIMING) {
  for (const vocabulary of ['numbers', 'techniques']) {
    const vocab = entry[vocabulary]
    if (!vocab) continue
    byCueId[vocab.cueId] = {
      combination: entry.combination,
      cadence: entry.cadence,
      vocabulary,
      durationMs: vocab.durationMs,
      wordMarksSource: vocab.wordMarksSource,
      words: vocab.words,
    }
  }
}

const withMarks = Object.values(byCueId).filter((v) => v.words.length > 0).length
const payload = {
  generatedAt: new Date().toISOString(),
  source: 'src/domain/programs/phraseTimingManifest.ts',
  note: 'Regenerate after build_phrase_timing.py or any re-render. src/audio/voiceAssets/phraseManifest.ts was retired in V2 Phase 5-iv; this is the surviving per-token timing.',
  entries: PHRASE_TIMING,
  byCueId,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8')
console.log(`wrote ${OUT}`)
console.log(`  ${PHRASE_TIMING.length} entries · ${Object.keys(byCueId).length} clips · ${withMarks} with per-token marks`)
