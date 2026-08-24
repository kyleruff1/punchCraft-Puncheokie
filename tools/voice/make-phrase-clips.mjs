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
import {
  PRODUCTION_BLEND,
  PRODUCTION_BLEND_NAME,
  PRODUCTION_EXPRESSION,
  PRODUCTION_FINISH,
  PRODUCTION_TEXTURE,
  RENDERER,
} from './persona.mjs'
import { insertBeats, measureDuration, readWav, trimEnds } from './wav.mjs'

const OUT_ROOT = join('assets', 'voice', 'phrases')

/** Every cadence a combination may be called at. */
const CADENCES = ['technical', 'steady', 'pressure', 'sprint']

/** Pinned until the manifest key widens (see the header). */
const VOCABULARY = 'numbers'
const PERFORMANCE = 'work'

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
 * Every combination the authored workouts actually call.
 *
 * Read from the sample sources rather than kept as a second list here. A
 * hand-maintained list drifts silently: the workout calls a combination, no
 * phrase exists, and the coach falls back to the per-word path this whole file
 * exists to replace.
 *
 * Single-token entries are skipped — one punch is a standalone clip, and
 * rendering it as a "phrase" would just be the same word again.
 */
function combinationsFromSamples() {
  const dir = join('src', 'domain', 'workout', 'samples')
  const found = new Set()
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue
    const source = readFileSync(join(dir, file), 'utf8')
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
  renameSync(temp, path)
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

const jobs = []
for (const combination of combinationsFromSamples()) {
  const tokens = combination.split('-').map((t) => t.trim())
  for (const cadence of CADENCES) {
    const plan = compilePhrase({
      tokens,
      vocabulary: VOCABULARY,
      cadence,
      performance: PERFORMANCE,
      expression: PRODUCTION_EXPRESSION,
      finish: PRODUCTION_FINISH,
    })
    jobs.push({
      key: `${combination}.${cadence}`,
      combination,
      cadence,
      tokens,
      plan,
      wav: join(cwd, OUT_ROOT, `${combination}.${cadence}.wav`),
    })
  }
}

console.log(
  `Rendering ${jobs.length} phrases — ${RENDERER}, ${VOCABULARY}/${PERFORMANCE}…`,
)

const renderOut = execFileSync('python', [join('tools', 'voice', 'kokoro_render.py')], {
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

console.log(`Applying the ${PRODUCTION_TEXTURE} texture…`)
const index = []
for (const job of jobs) {
  if (!existsSync(job.wav)) continue
  try {
    postProcess(job.wav, { profile: job.plan.profile, finalAccentDb: job.plan.finalAccentDb })
  } catch (error) {
    console.error(`  FAIL ${job.key}: ${error.message.split('\n')[0]}`)
    continue
  }
  const durationMs = measureDuration(job.wav)

  // A token can be more than one word — "two bee" — so onsets are matched by
  // walking both lists rather than by index.
  const wordCounts = job.tokens.map((t) => spokenFor(t, { vocabulary: VOCABULARY }).split(' ').length)
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
    combination: job.combination,
    cadence: job.cadence,
    file: `${job.key}.wav`,
    tokens: job.tokens,
    durationMs,
    wordMarks,
    renderer: RENDERER,
  })

  const kb = (statSync(job.wav).size / 1024).toFixed(0)
  console.log(
    `${job.key.padEnd(24)} ${String(durationMs).padStart(5)} ms  ${kb.padStart(4)} KB  ` +
      `"${job.plan.renderedText}"`,
  )
}

writeFileSync(join(OUT_ROOT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)

/* ------------------------------------------------------------- app manifest */

const lines = [
  '/**',
  ' * Whole-phrase combination assets (generated).',
  ' *',
  ' * DO NOT EDIT — produced by `node tools/voice/make-phrase-clips.mjs`.',
  ' *',
  ' * One clip per (combination, cadence), spoken by the settled Old-School',
  ' * Cornerman persona. `wordMarks` is present for interface stability but is',
  ' * usually empty — circle activation stays on the cue clock.',
  ' */',
  '',
  '/* eslint-disable @typescript-eslint/no-require-imports */',
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
  '  combination: string',
  '  cadence: string',
  '  tokens: string[]',
  '  durationMs: number',
  '  wordMarks: PhraseWordMark[]',
  '  /** Metro module id for the clip. */',
  '  module: number',
  '  renderer: string',
  '}',
  '',
  'export const phraseAssets: readonly PhraseAsset[] = [',
]
for (const entry of index) {
  lines.push(
    '  {',
    `    cueId: ${JSON.stringify(entry.cueId)},`,
    `    combination: ${JSON.stringify(entry.combination)},`,
    `    cadence: ${JSON.stringify(entry.cadence)},`,
    `    tokens: ${JSON.stringify(entry.tokens)},`,
    `    durationMs: ${entry.durationMs},`,
    `    wordMarks: ${JSON.stringify(entry.wordMarks)},`,
    `    module: require('../../../assets/voice/phrases/${entry.file}'),`,
    `    renderer: ${JSON.stringify(entry.renderer)},`,
    '  },',
  )
}
lines.push(
  ']',
  '',
  '/* eslint-enable @typescript-eslint/no-require-imports */',
  '',
  '/** Lookup by combination and cadence. */',
  'export function findPhraseAsset(',
  '  combination: string,',
  '  cadence: string,',
  '): PhraseAsset | undefined {',
  '  return phraseAssets.find((a) => a.combination === combination && a.cadence === cadence)',
  '}',
  '',
)
writeFileSync(join('src', 'audio', 'voiceAssets', 'phraseManifest.ts'), lines.join('\n'))

console.log(`\nWrote ${index.length}/${jobs.length} phrases to ${OUT_ROOT}`)
console.log('Wrote src/audio/voiceAssets/phraseManifest.ts')
console.log(`Renderer: ${RENDERER}. Model files are gitignored — see tools/voice/README.md.`)
