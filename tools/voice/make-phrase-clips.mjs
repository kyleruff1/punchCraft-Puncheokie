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
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { CADENCES, VOCABULARIES, combinationsFromCorpus, corpusV1, finalBoundsMs } from './corpus.mjs'
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

// `--only-keys=<k1,k2,…>` renders exactly the named clips (full keys like
// `1-2b.steady.numbers.push`) — the hotfix path: re-render what the validator
// flagged, nothing else. Like `--only`, a subset render skips the index and
// manifest writes; follow with `--manifest-only` to refresh them from disk.
const onlyKeysArg = process.argv
  .find((a) => a.startsWith('--only-keys='))
  ?.slice('--only-keys='.length)
const onlyKeys = onlyKeysArg
  ? new Set(
      onlyKeysArg
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    )
  : null

/**
 * Per-clip render overrides — the "generated differently" lever for phrases
 * Chatterbox keeps garbling. Keyed by full clip key; fields: `text` (respelled
 * spoken text — becomes both what is rendered and what the ASR gate expects),
 * `cfgWeight`, `exaggeration`, `attempts`, `minMs`/`maxMs` (final-file bounds,
 * pre tempo-fit scaling). Absent file = no overrides.
 */
function loadOverrides() {
  const path = join('tools', 'voice', 'overrides.json')
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8'))
}
const OVERRIDES = loadOverrides()

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

// Spoken groupings from corpus v1 — "1-4-2-3-6-5" is three motifs, not six
// digits, and the grouping shapes the phrase's pauses and accents.
const { groupingFor: GROUPING } = corpusV1()

const allJobs = []
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
          ...(GROUPING.has(combination) ? { grouping: GROUPING.get(combination) } : {}),
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
        const override = OVERRIDES[key] ?? {}
        if (override.text) plan.renderedText = override.text
        allJobs.push({
          key,
          combination,
          cadence,
          vocabulary,
          performance: performance.name,
          tokens,
          plan,
          override,
          spokenWordCount,
          wav: join(cwd, OUT_ROOT, `${key}.wav`),
        })
      }
    }
  }
}

// `--dump-expectations=<path>` writes the exact render-script text for EVERY
// clip (the same expectText the ASR gate scored) and exits. The token audit
// (tools/voice/phrase_token_audit.py) transcribes the shipped wavs and holds
// them to these texts token-for-token — the exactness the fuzzy gate lacks.
const dumpArg = process.argv.find((a) => a.startsWith('--dump-expectations='))
if (dumpArg) {
  const out = dumpArg.slice('--dump-expectations='.length)
  const entries = {}
  for (const j of allJobs) {
    entries[j.key] = {
      wav: join(OUT_ROOT, `${j.key}.wav`).replaceAll('\\', '/'),
      text: j.plan.renderedText,
      tokens: j.tokens,
      vocabulary: j.vocabulary,
      cadence: j.cadence,
    }
  }
  writeFileSync(out, JSON.stringify(entries, null, 1))
  console.log(`Wrote ${Object.keys(entries).length} expectations to ${out}`)
  process.exit(0)
}

// `--missing-only` renders just the clips with no file on disk — the
// corpus-expansion batch: new notations render, the shipped 248 stay
// untouched. Like other subset renders it skips the index/manifest writes;
// follow with `--manifest-only`.
const missingOnly = process.argv.includes('--missing-only')

// The hotfix subset: exactly the flagged keys, nothing else.
const jobs = (onlyKeys ? allJobs.filter((j) => onlyKeys.has(j.key)) : allJobs).filter(
  (j) => !missingOnly || !existsSync(j.wav),
)
if (onlyKeys) {
  const known = new Set(allJobs.map((j) => j.key))
  for (const key of onlyKeys) {
    if (!known.has(key)) console.warn(`WARNING: --only-keys names unknown clip ${key}`)
  }
}

/**
 * Bounds passed to Chatterbox, scaled up by the tempo-fit rate that will
 * shrink the clip afterwards.
 *
 * Rubberband tempo>1 shortens playback, so the FINAL wav is roughly
 * Chatterbox output ÷ rate. If we want the final "one, two" to land in
 * [500, 1800] ms and the rate is 1.55 (sprint cadence), Chatterbox has to
 * produce [775, 2790] ms — otherwise the first render's bounds hold before
 * tempo fit but the final wav ends up at 450ms and reads as compressed.
 * Same words, same fit; the scaling is what makes the window a promise
 * about the file the athlete hears rather than one about the intermediate.
 */
/**
 * The tempo-fit rate for a job, including the per-key override multiplier.
 *
 * `override.tempo` < 1 compresses LESS: the token audit proved the 1.35×
 * fit crushes the "bee" syllable out of the b-family clips — the raw
 * takes passed the exact ASR gate, the fitted files transcribe without
 * it, and Kyle heard exactly that hole live. A relaxed clip runs longer
 * in final terms (the announce placement simply starts it earlier), and
 * the final-bounds window still holds as the promise.
 */
/**
 * NO vocabulary-wide tempo multipliers. Tried (Kyle's 28% "techniques
 * snap" A/B pick, 2026-08-27) and REVERTED the same night: the phrase
 * tempo is grid-locked — `plan.speed` fits each spoken word to its
 * strike on the beat grid, so a blanket tighten makes the words finish
 * ahead of the punches ("timing is wildly off" — Kyle, live) and the
 * post-limiter stretch also sheds level. Snap must come from render
 * ENERGY (text/emphasis/exaggeration), never post-fit tempo.
 */
function fitRateForJob(job) {
  const rate = job.plan.speed * CHATTERBOX_TEMPO_CALIBRATION * (job.override?.tempo ?? 1)
  return Number.isFinite(rate) && rate > 0 ? rate : 1
}

function chatterboxBoundsForJob(job) {
  const base = finalBoundsMs(job.spokenWordCount)
  // Overrides speak in final-file terms, same as the base window.
  const minMs = job.override?.minMs ?? base.minMs
  const maxMs = job.override?.maxMs ?? base.maxMs
  const scale = fitRateForJob(job)
  return {
    minDurationMs: Math.round(minMs * scale),
    maxDurationMs: Math.round(maxMs * scale),
  }
}

if (!manifestOnly) {
console.log(`Rendering ${jobs.length} phrases — ${RENDERER}…`)

const renderOut =
  ENGINE === 'chatterbox'
    ? execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
        input: JSON.stringify({
          reference: REFERENCE_VOICE,
          // `--attempts=<n>` raises the best-of-N budget for every job in
          // this run — the hotfix default is 12, a full render keeps 5.
          ...(process.argv.find((a) => a.startsWith('--attempts='))
            ? { attempts: Number(process.argv.find((a) => a.startsWith('--attempts=')).slice('--attempts='.length)) }
            : {}),
          jobs: jobs.map((j) => ({
            path: j.wav,
            text: j.plan.renderedText,
            ...(EXAGGERATION[j.performance] ?? EXAGGERATION.work),
            ...chatterboxBoundsForJob(j),
            // The ASR gate: a take must transcribe as the scripted words.
            expectText: j.plan.renderedText,
            // `--asr-exact` upgrades the gate to token-exact acceptance —
            // the fuzzy score alone let repeat-heavy combos ship with a
            // dropped token (1-1-2 saying "one, two").
            ...(process.argv.includes('--asr-exact') ? { asrExact: true } : {}),
            ...(j.override.cfgWeight !== undefined ? { cfgWeight: j.override.cfgWeight } : {}),
            ...(j.override.exaggeration !== undefined
              ? { exaggeration: j.override.exaggeration }
              : {}),
            ...(j.override.attempts !== undefined ? { attempts: j.override.attempts } : {}),
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

// The renderer tells the story of every job — every candidate's duration,
// transcript and score — in VERDICT lines. Keep it: the silent SHORT/OVER
// discard is how garbled clips shipped unnoticed the first time.
const verdicts = renderOut
  .split(/\r?\n/)
  .filter((l) => l.startsWith('VERDICT '))
  .map((l) => JSON.parse(l.slice('VERDICT '.length)))
if (verdicts.length > 0) {
  mkdirSync(join('tools', 'analysis'), { recursive: true })
  writeFileSync(
    join('tools', 'analysis', 'render-report.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), verdicts }, null, 1)}\n`,
  )
  const rejected = verdicts.filter((v) => !v.accepted)
  console.log(
    `ASR gate: ${verdicts.length - rejected.length}/${verdicts.length} takes accepted; ` +
      `report at tools/analysis/render-report.json`,
  )
  for (const v of rejected) {
    console.warn(`  gate fallback ${v.path} (score ${v.score ?? 'n/a'}, ${v.attempts} attempts)`)
  }
}

// Chatterbox has no speed control and renders roughly twice as long as Kokoro
// for the same call, which a cue window will not tolerate. Apply the plan's
// speed here instead, formant-preserving so compressing the call does not
// raise its pitch into a different voice.
if (ENGINE === 'chatterbox') {
  console.log('Fitting tempo to the cue windows…')
  for (const job of jobs) {
    if (!existsSync(job.wav)) continue
    const rate = fitRateForJob(job)
    if (Math.abs(rate - 1) < 0.02) continue
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
  // `--soft-head` protects low-energy consonant onsets (the /dʒ/ in
  // "jab" was being eaten by the default head trim — heard as "chap"
  // through the tablet speaker). More retained lead, gentler threshold.
  trimEnds(job.wav, {
    ...(job.plan.profile === 'single' ? { tailMs: 70 } : {}),
    ...(process.argv.includes('--soft-head')
      ? { headMs: 140, thresholdRatio: 0.0015 }
      : {}),
  })
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

// A `--only`/`--only-keys` render is a subset: writing the index or the app
// manifest would drop every combination it did not render, so those writes
// are skipped — follow a hotfix with `--manifest-only` to refresh both from
// the full set on disk.
if (onlyArg || onlyKeys || missingOnly) {
  console.log(
    `\nSubset render of ${index.length} clip(s); index and manifest left untouched — ` +
      `run with --manifest-only to refresh them.`,
  )
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
