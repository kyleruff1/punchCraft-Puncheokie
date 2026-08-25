/**
 * The phrase-clip corpus — what the library must cover, and the duration
 * window each shipped clip promises.
 *
 * Extracted from `make-phrase-clips.mjs` so validation tooling (the Tier-0
 * clip validator, `export-expectations.mjs`) can import the same facts the
 * generator renders from without triggering a render — the generator scripts
 * execute at import. One source of truth: if the corpus scan or the bounds
 * formula changes here, the generator and the validator move together.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Every cadence a combination may be called at. */
export const CADENCES = ['technical', 'steady', 'pressure', 'sprint']

/** Both callout vocabularies the athlete can choose between (Coach Callouts). */
export const VOCABULARIES = ['numbers', 'techniques']

/**
 * Every combination the workout corpus can call.
 *
 * Scanned from the sources rather than kept as a second list here — a
 * hand-maintained list drifts silently: the workout calls a combination, no
 * phrase exists, and the coach falls back to the per-word path the phrase
 * library exists to replace. Two sources feed it:
 *
 *   - the hand-authored samples (`samples/*.ts`), and
 *   - the generator's motif library (`comboLibrary.ts`, M35) — the generator
 *     emits those notations verbatim, so rendering them here is what gives a
 *     generated workout the single-take persona voice instead of per-word.
 *
 * Single-token entries are skipped — one punch is a standalone clip, and
 * rendering it as a "phrase" would just be the same word again.
 */
export function combinationsFromCorpus() {
  const dir = join('src', 'domain', 'workout', 'samples')
  const sources = readdirSync(dir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(dir, file))
  sources.push(join('src', 'domain', 'workout', 'comboLibrary.ts'))

  const found = new Set()
  for (const path of sources) {
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(/notation:\s*'([^']+)'/g)) {
      const notation = match[1]
      if (notation.split('-').length > 1) found.add(notation)
    }
  }
  return [...found].sort()
}

/**
 * Plausible duration window for a spoken phrase of `words` words.
 *
 * A window rather than a ceiling because Chatterbox drops syllables just as
 * often as it runs long — a "one, two" that comes back at 370ms has lost the
 * "two", and shipped this way it read as unintelligible barking after tempo
 * fit. Bounding both ends lets the best-of-N retry keep rolling until the
 * take has the right number of syllables. 250-800ms per word covers a rushed
 * call and a leisurely one; anything outside is either dropped or padded.
 *
 * This window describes the FINAL file the athlete hears — the generator
 * scales it up by the tempo-fit rate before handing it to Chatterbox.
 */
export function finalBoundsMs(words) {
  const n = Math.max(1, words)
  return { minMs: 250 * n, maxMs: 800 * n + 200 }
}
