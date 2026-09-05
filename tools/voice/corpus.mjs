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
  // Kyle's corpus v1 is the second source: combos plus ladder stages, in
  // the same lowercase clip-key form the scan produces.
  for (const notation of corpusV1().notations) found.add(notation)
  // SINGLES (2026-09-05): the "one punch is a standalone clip" assumption
  // above was false at runtime — cue-previewing warms form 'combo' for
  // every token (CueAnnouncer preloadBothVocabsFor), and fused-body ids
  // ship only in numbers/standalone, so uppercut-clinic's 1-6b-3-2 logged
  // 'no manifest entry for numbers/combo/6b' per rep (harmless warm-up
  // noise, NOT the round-4 silence — that trail led elsewhere). Rendering
  // the single family closes the announce library over bare punches so a
  // lone-punch announce-then-work block can never fall to the per-word
  // path that has no fused-body combo form.
  for (const n of ['1', '2', '3', '4', '5', '6', '1b', '2b', '3b', '4b', '5b', '6b']) {
    found.add(n)
  }
  return [...found].sort()
}

/**
 * Kyle's combo corpus v1 (Rhythm Map M1) — the second source of phrase
 * notations, and the only source of spoken groupings.
 *
 * Read from the JSON twin of `src/domain/workout/corpus/comboCorpusV1.ts`
 * (this is an .mjs tool; the typed module is for the domain). Notations
 * normalize to the lowercase-b clip-key form. Ladder stages that are not
 * corpus rows render too; a >4-punch stage inherits its grouping from the
 * corpus combo it is a prefix of, cut at the stage boundary — the athlete
 * hears the same motif boundaries at every rung of the ladder.
 */
export function corpusV1() {
  const raw = JSON.parse(
    readFileSync(join('src', 'domain', 'workout', 'corpus', 'comboCorpusV1.json'), 'utf8'),
  )
  const lower = (tokens) => tokens.map((t) => t.toLowerCase())
  const keyOf = (tokens) => lower(tokens).join('-')

  /** notation -> grouping (lowercase token groups), explicit combos first. */
  const groupingFor = new Map()
  const notations = new Set()

  for (const combo of raw.combos) {
    const key = keyOf(combo.tokens)
    if (combo.tokens.length > 1) notations.add(key)
    if (combo.spokenGroups.length > 1) {
      groupingFor.set(key, combo.spokenGroups.map(lower))
    }
  }

  const combosByLength = [...raw.combos].sort((a, b) => b.tokens.length - a.tokens.length)
  const prefixGrouping = (tokens) => {
    const wanted = lower(tokens)
    for (const combo of combosByLength) {
      const host = lower(combo.tokens)
      if (host.length < wanted.length) break
      if (combo.spokenGroups.length <= 1) continue
      if (!wanted.every((t, i) => host[i] === t)) continue
      const cut = []
      let taken = 0
      for (const group of combo.spokenGroups.map(lower)) {
        if (taken >= wanted.length) break
        const slice = group.slice(0, wanted.length - taken)
        cut.push(slice)
        taken += slice.length
      }
      return cut.length > 1 ? cut : undefined
    }
    return undefined
  }

  for (const set of raw.buildUpSets) {
    for (const stage of set.stages) {
      if (stage.tokens.length <= 1) continue
      const key = keyOf(stage.tokens)
      notations.add(key)
      if (!groupingFor.has(key) && stage.tokens.length > 4) {
        const derived = prefixGrouping(stage.tokens)
        if (derived) groupingFor.set(key, derived)
      }
    }
  }

  return { notations: [...notations].sort(), groupingFor }
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
