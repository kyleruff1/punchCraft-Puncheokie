/**
 * Whole-phrase combination clips — the production library.
 *
 * ## What this renders
 *
 * Every combination the authored workouts call, at every cadence, spoken by
 * the settled **Old-School Cornerman** persona. This is the preferred path the
 * live coach uses: `VoiceOutputExpo.playCombination(combination, cadence)`
 * looks a clip up here and plays it as one utterance, which is the whole point
 * — separately synthesized words never sound like one coach delivering a
 * combination.
 *
 * ## The persona is shared, not re-derived
 *
 * The grouping, contour, beats and text all come from `prosody.mjs`; the voice
 * blend, expression, finish and texture come from `persona.mjs`; the WAV
 * editing comes from `wav.mjs`. This generator only chooses *what* to render
 * and threads the pieces together. A second copy of any of those rules would
 * be a source of truth able to disagree with the clip the athlete hears.
 *
 * ## The one thing baked in here
 *
 * The manifest key is `(combination, cadence)` — it carries no vocabulary or
 * performance axis yet, because the runtime does not select on them. So the
 * two are pinned: **punch-numbers** vocabulary (what the app calls today) and
 * the **work** performance state (the general in-round delivery). The shout
 * finish and the rest of the persona apply regardless. Widening the key to
 * choose technique names or a teach/push state at runtime is the next step;
 * this is the drop-in that makes the coach sound right first.
 *
 * ## Word marks
 *
 * Kokoro reports no per-word timing and a natural delivery runs words
 * together, so there are usually no envelope gaps to measure. `wordMarks` is
 * emitted for interface stability but is expected to be empty — circle
 * activation stays on the cue clock until a forced aligner is in play. It is
 * not read by the runtime today.
 *
 * Run: node tools/voice/make-phrase-clips.mjs
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { compilePhrase, spokenFor } from './prosody.mjs'
import { textureChain } from './texture.mjs'
import { ACTIVE_PERSONA, PERSONAS, getPersona, rendererId } from './personas.mjs'
import { insertBeats, measureDuration, readWav, renameWithRetry, trimEnds } from './wav.mjs'

/**
 * The persona to render, via `--persona=<id>`; the active one by default.
 *
 * Each persona renders into its own directory and is tagged in the manifest,
 * so several voices can exist side by side and the app can pick between them.
 * See tools/voice/personas.mjs.
 */
const personaArg = process.argv.find((a) => a.startsWith('--persona='))?.slice('--persona='.length)
const PERSONA = getPersona(personaArg ?? ACTIVE_PERSONA)
const OUT_ROOT = join('assets', 'voice', 'phrases', PERSONA.id)

// Everything the render is shaped by, read off the selected persona rather
// than off module constants — otherwise `--persona` would change where clips
// land without changing how they sound.
const RENDERER = rendererId(PERSONA)
const ENGINE = PERSONA.engine
const REFERENCE_VOICE = PERSONA.reference
const EXAGGERATION = PERSONA.intensity ?? {}
const CHATTERBOX_TEMPO_CALIBRATION = PERSONA.tempoCalibration ?? 1
const PRODUCTION_EXPRESSION = PERSONA.expression
const PRODUCTION_FINISH = PERSONA.finish
const PRODUCTION_TEXTURE = PERSONA.texture
const PRODUCTION_BLEND_NAME = PERSONA.blendName ?? PERSONAS.stone.blendName
const PRODUCTION_BLEND = PERSONA.blend ?? PERSONAS.stone.blend

/** Every cadence a combination may be called at. */
const CADENCES = ['technical', 'steady', 'pressure', 'sprint']

/** Both callout vocabularies the athlete can choose between (Coach Callouts). */
const VOCABULARIES = ['numbers', 'techniques']

/**
 * The performance states this persona renders, each with the finish that fits
 * it — narrowed by `persona.performances` when the persona does not
 * differentiate them.
 *
 * The full set is teach / work / push, where a shouted finish is wrong for a
 * *teaching* call so teach settles while work and push shout. The shipped
 * cornerman renders **push alone**: the calmer deliveries auditioned as tame,
 * and rendering three identical variants would triple the corpus for no audible
 * difference. `performanceFor` still selects a state at runtime, so restoring
 * the axis is a re-render rather than a rewrite.
 */
const ALL_PERFORMANCES = [
  { name: 'teach', finish: 'land' },
  { name: 'work', finish: PRODUCTION_FINISH },
  { name: 'push', finish: PRODUCTION_FINISH },
]
const PERFORMANCES = PERSONA.performances
  ? ALL_PERFORMANCES.filter((p) => PERSONA.performances.includes(p.name))
  : ALL_PERFORMANCES

/** Aged drift — small enough to read as weathered rather than unsteady. */
const DRIFT_SEMITONES = 0.14
const DRIFT_HZ = 4.2

function findFfmpeg() {
  const candidates = [
    'ffmpeg',
    join(
      homedir(),
      'AppData/Local/Microsoft/WinGet/Packages',
      'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
      'ffmpeg-9.0-full_build/bin/ffmpeg.exe',
    ),
  ]
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-hide_banner', '-version'], { stdio: 'ignore' })
      return candidate
    } catch {
      // Try the next one.
    }
  }
  throw new Error('ffmpeg not found. winget install --id Gyan.FFmpeg (see tools/voice/README.md)')
}

const FFMPEG = findFfmpeg()

/**
 * The interpreter that has Chatterbox and a CUDA build of PyTorch.
 *
 * Deliberately not the repo's default `python`: the toolchain needs Python
 * 3.12 (torch ships no 3.14 wheels) and several GB of CUDA libraries, so it
 * lives in its own venv off the repo. Override with `CHATTERBOX_PYTHON` when
 * it sits elsewhere. See tools/voice/README.md.
 */
const CHATTERBOX_PYTHON =
  process.env.CHATTERBOX_PYTHON ?? 'F:/voice-tools/venv/Scripts/python.exe'

/**
 * Every combination the workout corpus can call.
 *
 * Scanned from the sources rather than kept as a second list here — a
 * hand-maintained list drifts silently: the workout calls a combination, no
 * phrase exists, and the coach falls back to the per-word path this whole file
 * exists to replace. Two sources feed it:
 *
 *   - the hand-authored samples (`samples/*.ts`), and
 *   - the generator's motif library (`comboLibrary.ts`, M35) — the generator
 *     emits those notations verbatim, so rendering them here is what gives a
 *     generated workout the single-take persona voice instead of per-word.
 *
 * Single-token entries are skipped — one punch is a standalone clip, and
 * rendering it as a "phrase" would just be the same word again.
 */
function combinationsFromCorpus() {
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

/** Apply the production texture in place. See `texture.mjs`. */
function postProcess(path, { profile, finalAccentDb }) {
  const filters = textureChain(PRODUCTION_TEXTURE, { profile, finalAccentDb })
  const temp = `${path}.p.wav`
  execFileSync(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-af', filters,
      '-ar', '24000', '-ac', '1', temp],
    { stdio: 'ignore' },
  )
  if (!existsSync(temp)) throw new Error(`ffmpeg produced nothing for ${path}`)
  renameWithRetry(temp, path)
}

/**
 * Word onsets, measured from the rendered audio.
 *
 * Kept for interface stability and future use. Returns `[]` unless every
 * expected word is found as a distinct envelope onset — a natural delivery
 * runs them together, so that is the common case, and a wrong mark would light
 * the wrong circle. The runtime does not read this today.
 */
function measureWordOnsets(path, expectedWords) {
  const wav = readWav(path)
  if (!wav) return []
  const { buffer, fmt, data, bytesPerFrame, frames } = wav
  const peakAt = (frame) => {
    let peak = 0
    for (let c = 0; c < fmt.channels; c += 1) {
      peak = Math.max(peak, Math.abs(buffer.readInt16LE(data.start + frame * bytesPerFrame + c * 2)))
    }
    return peak
  }

  const window = Math.round(fmt.sampleRate * 0.01)
  const envelope = []
  for (let f = 0; f < frames; f += window) {
    let peak = 0
    for (let i = f; i < Math.min(f + window, frames); i += 1) peak = Math.max(peak, peakAt(i))
    envelope.push({ atMs: Math.round((f / fmt.sampleRate) * 1000), peak })
  }

  const loudest = envelope.reduce((m, e) => Math.max(m, e.peak), 0)
  const threshold = loudest * 0.12
  const minGapWindows = 5

  const onsets = []
  let inWord = false
  let belowFor = 0
  for (const point of envelope) {
    if (point.peak >= threshold) {
      if (!inWord) {
        onsets.push(point.atMs)
        inWord = true
      }
      belowFor = 0
    } else if (inWord) {
      belowFor += 1
      if (belowFor >= minGapWindows) inWord = false
    }
  }

  return onsets.length === expectedWords ? onsets : []
}

/* ------------------------------------------------------------------- build */

mkdirSync(OUT_ROOT, { recursive: true })
const cwd = process.cwd()

// `--only=<substr>` renders just the combinations containing the substring — a
// fast smoke test of the pipeline (e.g. `--only=1-2` or `--only=slip`) without
// waiting on the whole corpus.
const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
const combinations = combinationsFromCorpus().filter((c) => !onlyArg || c.includes(onlyArg))

// `--manifest-only` skips synthesis and rebuilds index.json + the app manifest
// from the clips already on disk. It exists to recover from a partial render
// (a Windows lock race that dropped a clip or two) without re-synthesizing the
// whole corpus — measure what is on disk, write the manifest, done.
const manifestOnly = process.argv.includes('--manifest-only')

// `--list` prints the corpus and the clip count without rendering — a fast way
// to see what a full render will cover after the motif library changes.
if (process.argv.includes('--list')) {
  const total = combinations.length * CADENCES.length * VOCABULARIES.length * PERFORMANCES.length
  console.log(combinations.join('\n'))
  console.log(
    `\n${combinations.length} combinations × ${CADENCES.length} cadences × ` +
      `${VOCABULARIES.length} vocab × ${PERFORMANCES.length} performances = ${total} clips`,
  )
  process.exit(0)
}

const jobs = []
for (const combination of combinations) {
  const tokens = combination.split('-').map((t) => t.trim())
  for (const cadence of CADENCES) {
    for (const vocabulary of VOCABULARIES) {
      for (const performance of PERFORMANCES) {
        const plan = compilePhrase({
          tokens,
          vocabulary,
          cadence,
          performance: performance.name,
          expression: PRODUCTION_EXPRESSION,
          finish: performance.finish,
        })
        const key = `${combination}.${cadence}.${vocabulary}.${performance.name}`
        // Words the coach will speak — used to size the duration bounds
        // passed to the renderer (see `phraseBoundsMs`). "1-2b-3" under
        // `numbers` is *four* words ("one two bee three"), so per-token
        // count is wrong; `spokenFor` gives the real spoken form.
        const spokenWordCount = tokens.reduce(
          (sum, t) => sum + spokenFor(t, { vocabulary }).split(' ').length,
          0,
        )
        jobs.push({
          key,
          combination,
          cadence,
          vocabulary,
          performance: performance.name,
          tokens,
          plan,
          spokenWordCount,
          wav: join(cwd, OUT_ROOT, `${key}.wav`),
        })
      }
    }
  }
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
 */
function phraseBoundsMs(words) {
  const n = Math.max(1, words)
  return { minDurationMs: 250 * n, maxDurationMs: 800 * n + 200 }
}

if (!manifestOnly) {
console.log(`Rendering ${jobs.length} phrases — ${RENDERER}…`)

const renderOut =
  ENGINE === 'chatterbox'
    ? execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
        input: JSON.stringify({
          reference: REFERENCE_VOICE,
          jobs: jobs.map((j) => ({
            path: j.wav,
            text: j.plan.renderedText,
            ...(EXAGGERATION[j.performance] ?? EXAGGERATION.work),
            ...phraseBoundsMs(j.spokenWordCount),
          })),
        }),
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      })
    : execFileSync('python', [join('tools', 'voice', 'kokoro_render.py')], {
        input: JSON.stringify({
          blends: { [PRODUCTION_BLEND_NAME]: PRODUCTION_BLEND },
          jobs: jobs.map((j) => ({
            path: j.wav,
            text: j.plan.renderedText,
            speed: j.plan.speed,
            blend: PRODUCTION_BLEND_NAME,
          })),
        }),
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      })
for (const failure of renderOut.split(/\r?\n/).filter((l) => l.startsWith('FAIL '))) {
  console.error(`  ${failure}`)
}

// Chatterbox has no speed control and renders roughly twice as long as Kokoro
// for the same call, which a cue window will not tolerate. Apply the plan's
// speed here instead, formant-preserving so compressing the call does not
// raise its pitch into a different voice.
if (ENGINE === 'chatterbox') {
  console.log('Fitting tempo to the cue windows…')
  for (const job of jobs) {
    if (!existsSync(job.wav)) continue
    const rate = job.plan.speed * CHATTERBOX_TEMPO_CALIBRATION
    if (!Number.isFinite(rate) || Math.abs(rate - 1) < 0.02) continue
    const temp = `${job.wav}.t.wav`
    try {
      execFileSync(
        FFMPEG,
        ['-hide_banner', '-loglevel', 'error', '-y', '-i', job.wav,
          '-af', `rubberband=tempo=${rate.toFixed(3)}:formant=preserved:pitchq=quality`,
          '-ar', '24000', '-ac', '1', temp],
        { stdio: 'ignore' },
      )
      if (existsSync(temp)) renameWithRetry(temp, job.wav)
    } catch (error) {
      console.error(`  FAIL tempo ${job.key}: ${error.message.split('\n')[0]}`)
    }
  }
}

// Beats and trim before the contour and texture. Trimming last was the bug
// that cost the audition two rounds: compression lifts the echo tail, so the
// trimmer then keeps it.
console.log('Setting movement beats and trimming…')
for (const job of jobs) {
  if (!existsSync(job.wav)) continue
  insertBeats(job.wav, job.plan.beats)
  trimEnds(job.wav, job.plan.profile === 'single' ? { tailMs: 70 } : {})
}

console.log('Applying pitch contour, finish and aged drift…')
const contourOut = execFileSync('python', [join('tools', 'voice', 'pitch_contour.py')], {
  input: JSON.stringify(
    jobs
      .filter((j) => existsSync(j.wav))
      .map((j) => ({
        path: j.wav,
        contour: j.plan.pitchContourSemitones,
        shiftSemitones: j.plan.pitchShiftSemitones,
        finish: j.plan.finishShape,
        driftSemitones: DRIFT_SEMITONES,
        driftHz: DRIFT_HZ,
      })),
  ),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
for (const failure of contourOut.split(/\r?\n/).filter((l) => l.startsWith('FAIL '))) {
  console.error(`  ${failure}`)
}
} // end if (!manifestOnly)

console.log(manifestOnly ? 'Rebuilding manifest from clips on disk…' : `Applying the ${PRODUCTION_TEXTURE} texture…`)
const index = []
for (const job of jobs) {
  if (!existsSync(job.wav)) continue
  if (!manifestOnly) {
    try {
      postProcess(job.wav, { profile: job.plan.profile, finalAccentDb: job.plan.finalAccentDb })
    } catch (error) {
      console.error(`  FAIL ${job.key}: ${error.message.split('\n')[0]}`)
      continue
    }
  }
  const durationMs = measureDuration(job.wav)

  // A token can be more than one word — "two bee" — so onsets are matched by
  // walking both lists rather than by index.
  const wordCounts = job.tokens.map(
    (t) => spokenFor(t, { vocabulary: job.vocabulary }).split(' ').length,
  )
  const expectedWords = wordCounts.reduce((a, b) => a + b, 0)
  const onsets = measureWordOnsets(job.wav, expectedWords)
  const wordMarks = []
  let wordIndex = 0
  for (let t = 0; t < job.tokens.length; t += 1) {
    const onset = onsets[wordIndex]
    if (onset !== undefined) wordMarks.push({ tokenIndex: t, token: job.tokens[t], offsetMs: onset })
    wordIndex += wordCounts[t]
  }

  index.push({
    cueId: job.key,
    persona: PERSONA.id,
    combination: job.combination,
    cadence: job.cadence,
    vocabulary: job.vocabulary,
    performance: job.performance,
    file: `${job.key}.wav`,
    tokens: job.tokens,
    durationMs,
    wordMarks,
    renderer: RENDERER,
  })

  const kb = (statSync(job.wav).size / 1024).toFixed(0)
  console.log(`${job.key.padEnd(40)} ${String(durationMs).padStart(5)} ms  ${kb.padStart(4)} KB`)
}

// A `--only` smoke render is a subset: writing the index or the app manifest
// would drop every combination it did not render, so those writes are skipped.
if (onlyArg) {
  console.log(`\nSmoke render of ${index.length} clip(s) for --only=${onlyArg}; index and manifest left untouched.`)
  process.exit(0)
}

writeFileSync(join(OUT_ROOT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)

/* ------------------------------------------------------------- app manifest */

const lines = [
  '/**',
  ' * Whole-phrase combination assets (generated).',
  ' *',
  ' * DO NOT EDIT — produced by `node tools/voice/make-phrase-clips.mjs`.',
  ' *',
  ' * One clip per (combination, cadence, vocabulary, performance) for each',
  ' * rendered persona. `wordMarks` is present for interface stability but is',
  ' * usually empty — circle activation stays on the cue clock.',
  ' */',
  '',
  '/* eslint-disable @typescript-eslint/no-require-imports */',
  '',
  "import type { CalloutVocabulary, PerformanceState } from '@domain/coach/VoiceOutputPort'",
  '',
  'export interface PhraseWordMark {',
  '  tokenIndex: number',
  '  token: string',
  '  /** Milliseconds from the start of the clip. */',
  '  offsetMs: number',
  '}',
  '',
  'export interface PhraseAsset {',
  '  cueId: string',
  '  /** Which voice this clip is spoken in. See tools/voice/personas.mjs. */',
  '  persona: string',
  '  combination: string',
  '  cadence: string',
  '  vocabulary: CalloutVocabulary',
  '  performance: PerformanceState',
  '  tokens: string[]',
  '  durationMs: number',
  '  wordMarks: PhraseWordMark[]',
  '  /** Metro module id for the clip. */',
  '  module: number',
  '  renderer: string',
  '}',
  '',
  `/** The voice used when a caller does not name one. */`,
  `export const DEFAULT_PERSONA = ${JSON.stringify(PERSONA.id)}`,
  '',
  'export const phraseAssets: readonly PhraseAsset[] = [',
]
for (const entry of index) {
  lines.push(
    '  {',
    `    cueId: ${JSON.stringify(entry.cueId)},`,
    `    persona: ${JSON.stringify(entry.persona)},`,
    `    combination: ${JSON.stringify(entry.combination)},`,
    `    cadence: ${JSON.stringify(entry.cadence)},`,
    `    vocabulary: ${JSON.stringify(entry.vocabulary)},`,
    `    performance: ${JSON.stringify(entry.performance)},`,
    `    tokens: ${JSON.stringify(entry.tokens)},`,
    `    durationMs: ${entry.durationMs},`,
    `    wordMarks: ${JSON.stringify(entry.wordMarks)},`,
    `    module: require('../../../assets/voice/phrases/${entry.persona}/${entry.file}'),`,
    `    renderer: ${JSON.stringify(entry.renderer)},`,
    '  },',
  )
}
lines.push(
  ']',
  '',
  '/* eslint-enable @typescript-eslint/no-require-imports */',
  '',
  '/**',
  ' * Lookup by combination and cadence, plus the callout vocabulary, the',
  ' * performance state and the voice. Vocabulary and performance default to the',
  ' * production baseline (numbers / work) and the persona to the shipped voice,',
  ' * so a caller that has not been widened still resolves the clip it always did.',
  ' *',
  ' * **The performance is a preference, not a requirement.** A persona may render',
  ' * one delivery for every state (the shipped cornerman renders push alone), so',
  ' * an exact miss falls back to whatever performance that combination does have',
  ' * rather than returning undefined — which would drop the caller to the',
  ' * per-word path and change the voice mid-workout.',
  ' */',
  'export function findPhraseAsset(',
  '  combination: string,',
  '  cadence: string,',
  "  vocabulary: CalloutVocabulary = 'numbers',",
  "  performance: PerformanceState = 'work',",
  '  persona: string = DEFAULT_PERSONA,',
  '): PhraseAsset | undefined {',
  '  const matches = phraseAssets.filter(',
  '    (a) =>',
  '      a.persona === persona &&',
  '      a.combination === combination &&',
  '      a.cadence === cadence &&',
  '      a.vocabulary === vocabulary,',
  '  )',
  '  return matches.find((a) => a.performance === performance) ?? matches[0]',
  '}',
  '',
  '/** Every persona present in the manifest, for a voice picker. */',
  'export function availablePersonas(): string[] {',
  '  return [...new Set(phraseAssets.map((a) => a.persona))]',
  '}',
  '',
)
writeFileSync(join('src', 'audio', 'voiceAssets', 'phraseManifest.ts'), lines.join('\n'))

console.log(`\nWrote ${index.length}/${jobs.length} phrases to ${OUT_ROOT}`)
console.log('Wrote src/audio/voiceAssets/phraseManifest.ts')
console.log(`Renderer: ${RENDERER}. Model files are gitignored — see tools/voice/README.md.`)
