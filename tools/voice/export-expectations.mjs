/**
 * Export the ground truth for every shipped voice clip — what each file
 * should say, how fast it was tempo-fitted, and what duration window it
 * promises — so the audio validators (Tier 0/1/2) can judge a WAV without
 * re-deriving any of it.
 *
 * The truth is computed, not copied: phrase text comes from the same
 * `compilePhrase` call the generator renders with, word text from the same
 * `compileAdlib`, the corpus from the same scan (`corpus.mjs`), the word
 * tables from `wordCorpus.mjs`. If a phrasing rule changes, re-running this
 * exporter is what keeps validation honest — there is no hand-maintained
 * copy to drift.
 *
 * Audition clips (assets/voice/audition) are deliberately not exported:
 * they are dev-only persona A/B material, not athlete-facing.
 *
 * Run: node tools/voice/export-expectations.mjs [--persona=<id>]
 * Writes: tools/analysis/expectations.json
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { CADENCES, VOCABULARIES, combinationsFromCorpus, corpusV1, finalBoundsMs } from './corpus.mjs'
import { compileAdlib, compilePhrase, spokenFor } from './prosody.mjs'
import { ACTIVE_PERSONA, getPersona } from './personas.mjs'
import { fitBoundsMs, gridDurationMs } from './grid_targets.mjs'
import { FORM_SPEED, SHARED_WORDS, TONES, VOCABULARY_WORDS, maxWordMs } from './wordCorpus.mjs'

const personaArg = process.argv.find((a) => a.startsWith('--persona='))?.slice('--persona='.length)
const PERSONA = getPersona(personaArg ?? ACTIVE_PERSONA)
const TEMPO_CALIBRATION = PERSONA.tempoCalibration ?? 1

// The same per-clip overrides the generators render with — a respelled
// clip must be validated against what it actually says, not the table text.
const OVERRIDES = existsSync(join('tools', 'voice', 'overrides.json'))
  ? JSON.parse(readFileSync(join('tools', 'voice', 'overrides.json'), 'utf8'))
  : {}

// Mirrors the generator's performance narrowing: the full teach/work/push set,
// filtered to what this persona actually renders (the shipped cornerman
// renders push alone).
const ALL_PERFORMANCES = [
  { name: 'teach', finish: 'land' },
  { name: 'work', finish: PERSONA.finish },
  { name: 'push', finish: PERSONA.finish },
]
const PERFORMANCES = PERSONA.performances
  ? ALL_PERFORMANCES.filter((p) => PERSONA.performances.includes(p.name))
  : ALL_PERFORMANCES

const entries = []
let missing = 0

function push(entry) {
  const exists = existsSync(entry.file)
  if (!exists) missing += 1
  entries.push({ ...entry, exists })
}

/* ------------------------------------------------------- phrase clips */

const phraseRoot = join('assets', 'voice', 'phrases', PERSONA.id)
// The same grouping source the generator renders with — text drift between
// render and validation is the exact failure this exporter exists to prevent.
const { groupingFor: GROUPING } = corpusV1()
for (const combination of combinationsFromCorpus()) {
  const tokens = combination.split('-').map((t) => t.trim())
  for (const cadence of CADENCES) {
    for (const vocabulary of VOCABULARIES) {
      for (const performance of PERFORMANCES) {
        const plan = compilePhrase({
          tokens,
          vocabulary,
          cadence,
          performance: performance.name,
          expression: PERSONA.expression,
          finish: performance.finish,
          ...(GROUPING.has(combination) ? { grouping: GROUPING.get(combination) } : {}),
        })
        const key = `${combination}.${cadence}.${vocabulary}.${performance.name}`
        if (OVERRIDES[key]?.text) plan.renderedText = OVERRIDES[key].text
        // Counted from the text actually rendered, not from `spokenFor` —
        // mid-phrase the compiler shortens some tokens ("lead hook" → "hook"),
        // and a duration window sized to the long form flags honest clips.
        const spokenWordCount = plan.renderedText
          .replace(/[^\w\s']/g, ' ')
          .trim()
          .split(/\s+/)
          .filter(Boolean).length
        // M39-V1c grid target — what the engine schedules this
        // combination to fill on the ±60 BPM master grid at the
        // cadence's division. The rendered wav must fit within ±5%
        // (preferred) / ±10% (hard cap). See tools/voice/grid_targets.mjs.
        const gridMs = gridDurationMs({ tokens, cadence })
        push({
          kind: 'phrase',
          key,
          file: join(phraseRoot, `${key}.wav`),
          text: plan.renderedText,
          tokens,
          wordCount: spokenWordCount,
          tempoRate: Number((plan.speed * TEMPO_CALIBRATION).toFixed(3)),
          // The window the shipped file promises (already post-tempo-fit).
          boundsMs: finalBoundsMs(spokenWordCount),
          // Engine grid target + tolerance bands (V1c).
          gridDurationMs: Math.round(gridMs),
          fitBoundsMs: fitBoundsMs(gridMs),
          vocabulary,
          cadence,
          performance: performance.name,
        })
      }
    }
  }
}

/* --------------------------------------------------------- word clips */

for (const vocabulary of ['numbers', 'names']) {
  for (const form of ['standalone', 'combo']) {
    const dir = join('assets', 'voice', vocabulary, form)
    const words = { ...VOCABULARY_WORDS[vocabulary], ...SHARED_WORDS }
    for (const [id, text] of Object.entries(words)) {
      const override = OVERRIDES[`${vocabulary}/${form}/${id}`] ?? OVERRIDES[`word:${id}`] ?? {}
      const spoken = override.text ?? text
      const plan = compileAdlib(`${spoken}!`, {
        performance: 'work',
        expression: PERSONA.expression,
        finish: 'land',
      })
      const wordCount = spoken.trim().split(/\s+/).length
      const tempoRate = Number((FORM_SPEED[form] * TEMPO_CALIBRATION).toFixed(3))
      push({
        kind: 'word',
        key: `${vocabulary}/${form}/${id}`,
        file: join(dir, `${id}.wav`),
        text: plan.renderedText,
        tokens: [id],
        wordCount,
        tempoRate,
        // Words have no enforced floor today, and the ceiling handed to the
        // renderer describes the pre-fit take — so this window is advisory:
        // the validator ranks by it, it does not fail on it.
        boundsMs: {
          minMs: Math.round(150 * wordCount),
          maxMs: Math.round((maxWordMs(wordCount, form) / tempoRate) * 1.4),
        },
        boundsAdvisory: true,
        vocabulary,
        form,
      })
    }

    for (const [id, spec] of Object.entries(TONES)) {
      push({
        kind: 'tone',
        key: `${vocabulary}/${form}/${id}`,
        file: join(dir, `${id}.wav`),
        freqHz: spec.freqHz,
        durationMs: spec.durationMs,
      })
    }
  }
}

/* -------------------------------------------------------------- write */

const outDir = join('tools', 'analysis')
mkdirSync(outDir, { recursive: true })
const outPath = join(outDir, 'expectations.json')
const byKind = entries.reduce((acc, e) => {
  acc[e.kind] = (acc[e.kind] ?? 0) + 1
  return acc
}, {})
writeFileSync(
  outPath,
  `${JSON.stringify({ persona: PERSONA.id, generatedAt: new Date().toISOString(), entries }, null, 2)}\n`,
)

console.log(
  `Wrote ${entries.length} expectations to ${outPath} ` +
    `(${Object.entries(byKind)
      .map(([k, n]) => `${n} ${k}`)
      .join(', ')})`,
)
if (missing > 0) {
  console.warn(`WARNING: ${missing} expected clip file(s) not found on disk — corpus/library drift.`)
  for (const e of entries.filter((x) => !x.exists)) console.warn(`  missing ${e.file}`)
}
