/**
 * Generate the Voice Coach clip set (M34-04, D16) — per-word, in the persona.
 *
 * D16's rule is that **time-critical speech is never synthesized at runtime** —
 * the clips are rendered ahead of time and the app plays local files. This
 * script is the ahead-of-time step for the *single-word* clips: the per-token
 * calls used by in-time delivery (a slow technical cadence) and the per-word
 * fallback when a combination has no whole-phrase rendering.
 *
 * ## In the persona now, not SAPI
 *
 * These were Windows SAPI placeholders. They now come from the same active
 * persona as the combinations — whichever engine and voice `persona.mjs`
 * selects — so a technical round and the fallback path sound like the same
 * coach, not a different one. That consistency is the whole reason this script
 * follows the phrase generator's engine: a fallback that speaks in a different
 * voice is worse than no fallback, because it reads as a bug rather than a
 * limitation. Each word is a single-strike delivery: a clear, firm command that
 * lands, rather than the shouted finish a combination ends on.
 *
 * ## Two vocabularies and two forms, one set of ids (D15)
 *
 * `numbers` says "one"; `names` says "jab". Same `VoiceAssetId`, different clip
 * — which is why the vocabulary belongs to the manifest and not to the id. Each
 * vocabulary is rendered twice more, as a **form**: `standalone` is a single
 * command at a clear pace; `combo` is the same word inside a run, quicker. This
 * is a different rendering, not the standalone clip played faster — speeding a
 * clip up at runtime smears the consonants.
 *
 * `3` is **"lead hook"**, not "left hook": a hook thrown with the lead hand is
 * a left hook in orthodox and a right hook in southpaw, so "left" would be
 * wrong every time a southpaw threw it.
 *
 * Output paths and ids are unchanged, so `src/audio/voiceAssets/manifest.ts`
 * needs no edit — only the audio behind each file changes.
 *
 * Run: node tools/voice/make-voice-clips.mjs
 * Requires: ffmpeg, plus whatever the active persona's engine needs — the
 * Chatterbox venv and a CUDA GPU, or the Kokoro model files. See
 * tools/voice/README.md.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { compileAdlib } from './prosody.mjs'
import { textureChain } from './texture.mjs'
import { FORM_SPEED, SHARED_WORDS, TONES, VOCABULARY_WORDS, maxWordMs } from './wordCorpus.mjs'
import {
  CHATTERBOX_TEMPO_CALIBRATION,
  ENGINE,
  EXAGGERATION,
  PRODUCTION_BLEND,
  PRODUCTION_BLEND_NAME,
  PRODUCTION_EXPRESSION,
  PRODUCTION_TEXTURE,
  REFERENCE_VOICE,
  RENDERER,
} from './persona.mjs'
import { measureDuration, trimEnds, renameWithRetry } from './wav.mjs'

const OUT_ROOT = join('assets', 'voice')
const SAMPLE_RATE = 44_100

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
 * The interpreter that has Chatterbox and a CUDA build of PyTorch. Not the
 * repo's default `python` — see tools/voice/README.md.
 */
const CHATTERBOX_PYTHON =
  process.env.CHATTERBOX_PYTHON ?? 'F:/voice-tools/venv/Scripts/python.exe'

/** Apply the production texture in place (single-strike profile). */
function postProcess(path, finalAccentDb) {
  const filters = textureChain(PRODUCTION_TEXTURE, { profile: 'single', finalAccentDb })
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

/** A short synthesised tone. Unchanged — a bell is a bell in any voice. */
function wavTone({ freqHz, durationMs, fadeOutMs }) {
  const samples = Math.round((durationMs / 1000) * SAMPLE_RATE)
  const fade = Math.round((fadeOutMs / 1000) * SAMPLE_RATE)
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1) {
    const t = i / SAMPLE_RATE
    let amp = 0.7
    const fromEnd = samples - i
    if (fromEnd < fade) amp *= fromEnd / fade
    // A short attack ramp avoids the click an instant onset would give a tone
    // the athlete hears hundreds of times a session.
    if (i < 64) amp *= i / 64
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freqHz * t) * amp * 32_767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/* ------------------------------------------------------------------- build */

const cwd = process.cwd()

// `--only-ids=<id1,id2,…>` renders just the named word ids (e.g. `2,go`) in
// every vocabulary × form — the hotfix path for a flagged word clip.
const onlyIdsArg = process.argv
  .find((a) => a.startsWith('--only-ids='))
  ?.slice('--only-ids='.length)
const onlyIds = onlyIdsArg
  ? new Set(
      onlyIdsArg
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null

/**
 * The shortest a spoken command may plausibly run, after the tempo fit —
 * scaled back up to the pre-fit take the renderer judges. Words had no floor
 * at all until the QA loop landed, which is why a dropped syllable in "Lead
 * uppercut" was invisible: the take was short, quiet and *plausible*. The
 * floor is loose (180ms a word on the final file) because the ASR gate is
 * the real syllable check; this just spares the gate obvious junk.
 */
function minWordMs(words, form) {
  const rate = FORM_SPEED[form] * CHATTERBOX_TEMPO_CALIBRATION
  return Math.round(180 * words * rate)
}

// One plan per (word, form): a single-strike command that lands. `land` rather
// than the persona's `shout` finish — a lone call is firm and clear, not a
// shouted combination ending.
const jobs = []
for (const vocabulary of ['numbers', 'names']) {
  for (const form of ['standalone', 'combo']) {
    const dir = join(OUT_ROOT, vocabulary, form)
    mkdirSync(dir, { recursive: true })
    const words = { ...VOCABULARY_WORDS[vocabulary], ...SHARED_WORDS }
    for (const [id, text] of Object.entries(words)) {
      if (onlyIds && !onlyIds.has(id)) continue
      const plan = compileAdlib(`${text}!`, {
        performance: 'work',
        expression: PRODUCTION_EXPRESSION,
        finish: 'land',
      })
      plan.speed = FORM_SPEED[form]
      jobs.push({
        id,
        vocabulary,
        form,
        plan,
        // "Cut off the ring" needs a longer budget than "Five" — see maxWordMs.
        words: text.trim().split(/\s+/).length,
        wav: join(cwd, dir, `${id}.wav`),
      })
    }
  }
}

console.log(`Rendering ${jobs.length} word clips — ${RENDERER}…`)

const renderOut =
  ENGINE === 'chatterbox'
    ? execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
        input: JSON.stringify({
          reference: REFERENCE_VOICE,
          // A lone word is the working call, not a teaching one and not the
          // shouted end of a combination — the same `work` state the plans are
          // compiled at above.
          jobs: jobs.map((j) => ({
            path: j.wav,
            text: j.plan.renderedText,
            ...(EXAGGERATION.work ?? {}),
            minDurationMs: minWordMs(j.words, j.form),
            maxDurationMs: maxWordMs(j.words, j.form),
            // The ASR gate: a take must transcribe as the scripted word.
            expectText: j.plan.renderedText,
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

// Keep the renderer's per-candidate story (see make-phrase-clips.mjs) — the
// silent SHORT/OVER discard is how garbled clips shipped unnoticed.
const verdicts = renderOut
  .split(/\r?\n/)
  .filter((l) => l.startsWith('VERDICT '))
  .map((l) => JSON.parse(l.slice('VERDICT '.length)))
if (verdicts.length > 0) {
  mkdirSync(join('tools', 'analysis'), { recursive: true })
  writeFileSync(
    join('tools', 'analysis', 'render-report-words.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), verdicts }, null, 1)}\n`,
  )
  const rejected = verdicts.filter((v) => !v.accepted)
  console.log(`ASR gate: ${verdicts.length - rejected.length}/${verdicts.length} takes accepted.`)
  for (const v of rejected) {
    console.warn(`  gate fallback ${v.path} (score ${v.score ?? 'n/a'}, ${v.attempts} attempts)`)
  }
}

// Chatterbox has no speed control, so the form's tempo is applied afterwards —
// formant-preserving, so clipping a word for the `combo` form does not raise
// its pitch into a different voice. Without this a word inside a run would run
// as long as an announcement.
if (ENGINE === 'chatterbox') {
  console.log('Fitting tempo per form…')
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
      console.error(`  FAIL tempo ${job.vocabulary}/${job.form}/${job.id}: ${error.message.split('\n')[0]}`)
    }
  }
}

// Trim, then the contour + aged drift, then the texture — the same order the
// combinations use, so a single word and a combination age identically.
console.log('Trimming…')
for (const job of jobs) {
  if (existsSync(job.wav)) trimEnds(job.wav, { tailMs: 70 })
}

console.log('Applying the contour and aged drift…')
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

console.log(`Applying the ${PRODUCTION_TEXTURE} texture and writing tones…`)
let count = 0
for (const vocabulary of ['numbers', 'names']) {
  for (const form of ['standalone', 'combo']) {
    const dir = join(cwd, OUT_ROOT, vocabulary, form)
    const forHere = jobs.filter((j) => j.vocabulary === vocabulary && j.form === form)

    let durTotal = 0
    for (const job of forHere) {
      if (!existsSync(job.wav)) continue
      postProcess(job.wav, job.plan.finalAccentDb)
      durTotal += measureDuration(job.wav)
    }

    // Tones are generated at exactly the length they should be, spoken words
    // are not — but they carry no id-specific voice, so they are written after.
    for (const [id, spec] of Object.entries(TONES)) {
      writeFileSync(join(dir, `${id}.wav`), wavTone(spec))
    }

    const clipCount = forHere.length + Object.keys(TONES).length
    let bytes = 0
    for (const job of forHere) if (existsSync(job.wav)) bytes += statSync(job.wav).size
    for (const id of Object.keys(TONES)) bytes += statSync(join(dir, `${id}.wav`)).size
    count += clipCount
    console.log(
      `${vocabulary.padEnd(8)} ${form.padEnd(10)} ${clipCount} clips  ${(bytes / 1024).toFixed(0)} KB  ` +
        `(mean word ${Math.round(durTotal / Math.max(1, forHere.length))} ms)`,
    )
  }
}

console.log(`\nWrote ${count} clips to ${OUT_ROOT}`)
console.log(`Renderer: ${RENDERER}. Model files are gitignored — see tools/voice/README.md.`)
