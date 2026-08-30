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
import { fitBoundsMs, fitPct, fitVerdict, gridDurationMs } from './grid_targets.mjs'

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
  const spans = measureWordSpans(path, expectedWords)
  return spans === null ? [] : spans.map((s) => s.startMs)
}

/**
 * Envelope-based word onset+offset detection.
 *
 * Returns `[{startMs, endMs}, ...]` when the detected count matches
 * `expectedWords`; `null` otherwise. Uses hysteresis so `endMs` tracks
 * the perceptual end of the syllable rather than the acoustic decay
 * tail — starts a word when energy crosses `startThresholdRatio` of
 * peak, ends it when energy drops below `endThresholdRatio` (higher).
 * A `minGapWindows` fallback still terminates a word when energy sits
 * between the two thresholds too long (rare in real speech).
 *
 * `opts`:
 *   startThresholdRatio (default 0.12): peak fraction that STARTS a word
 *   endThresholdRatio   (default 0.25): higher threshold that ENDS one
 *   minGapWindows       (default 5)   : safety-net silence gap in windows
 *
 * The tighter `endThresholdRatio` was Kyle's ask (2026-08-28) — the old
 * end-of-word ran into the syllable's decay, so the rail's "expected
 * ring N ms after word ends" fired later than the coach's perceived
 * word end, producing ~100 ms per-clip spread on envelope-sourced
 * clips.  Relaxed second-pass callers pass smaller ratios (0.08 / 0.15).
 */
function measureWordSpans(path, expectedWords, opts = {}) {
  const {
    startThresholdRatio = 0.12,
    endThresholdRatio = 0.25,
    minGapWindows = 5,
    // Back-compat: `thresholdRatio` sets BOTH start and end.
    thresholdRatio,
  } = opts
  const startThr = thresholdRatio ?? startThresholdRatio
  const endThr = thresholdRatio ?? endThresholdRatio
  const wav = readWav(path)
  if (!wav) return null
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
  const startLevel = loudest * startThr
  const endLevel = loudest * endThr

  const spans = []
  let inWord = false
  let belowFor = 0
  let currentStart = 0
  // The last frame ABOVE the end threshold — the perceptual end of the
  // syllable, before decay. `endMs` snaps here (no + window padding).
  let lastAboveEnd = 0
  for (const point of envelope) {
    if (!inWord) {
      if (point.peak >= startLevel) {
        currentStart = point.atMs
        lastAboveEnd = point.atMs
        inWord = true
        belowFor = 0
      }
    } else {
      if (point.peak >= endLevel) {
        lastAboveEnd = point.atMs
        belowFor = 0
      } else {
        belowFor += 1
        // End the word once we've had `minGapWindows` frames below the
        // END threshold. Snapping to lastAboveEnd trims the decay tail
        // that would otherwise inflate endMs by 50-150 ms.
        if (belowFor >= minGapWindows) {
          spans.push({ startMs: currentStart, endMs: lastAboveEnd })
          inWord = false
        }
      }
    }
  }
  if (inWord) spans.push({ startMs: currentStart, endMs: lastAboveEnd })

  return spans.length === expectedWords ? spans : null
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

// `--fit-check` — the V1c grid-fit inspector (M39-V1c / #281).
//
// Walks every job whose wav is present on disk, measures the actual
// duration, and compares to `gridDurationMs(job)` — the target the
// engine schedules the phrase to fill on the 60 BPM master grid at the
// cadence's division. Writes tools/analysis/fit-report.json with the
// full table plus a summary of preferred / acceptable / reject counts.
// Non-destructive — no Chatterbox call, no re-render — so it's safe to
// run on the shipped corpus before a batch to see what the current
// clips look like against the new contract.
//
// Exit code: 0 if every measured clip is in-band (preferred or
// acceptable); 1 if any clip lands beyond ±10%.
if (process.argv.includes('--fit-check')) {
  const rows = []
  const summary = { preferred: 0, acceptable: 0, reject: 0, missing: 0 }
  for (const j of allJobs) {
    const target = gridDurationMs({ tokens: j.tokens, cadence: j.cadence })
    if (!existsSync(j.wav)) {
      summary.missing += 1
      rows.push({ key: j.key, cadence: j.cadence, gridDurationMs: Math.round(target), missing: true })
      continue
    }
    const actual = measureDuration(j.wav)
    const ratio = fitPct(actual, target)
    const verdict = fitVerdict(ratio)
    summary[verdict] += 1
    rows.push({
      key: j.key,
      cadence: j.cadence,
      tokens: j.tokens,
      actualMs: actual,
      gridDurationMs: Math.round(target),
      fitPct: Number(ratio.toFixed(4)),
      driftPct: Number((ratio - 1).toFixed(4)),
      verdict,
      fitBoundsMs: fitBoundsMs(target),
    })
  }
  // Sort worst first so a reader sees rejects at the top of the file.
  rows.sort((a, b) => (Math.abs(b.driftPct ?? 0) - Math.abs(a.driftPct ?? 0)))
  const outPath = join('tools', 'analysis', 'fit-report.json')
  mkdirSync(join('tools', 'analysis'), { recursive: true })
  writeFileSync(
    outPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      persona: PERSONA.id,
      summary,
      rejectKeys: rows.filter((r) => r.verdict === 'reject').map((r) => r.key),
      rows,
    }, null, 2)}\n`,
  )
  const total = summary.preferred + summary.acceptable + summary.reject
  console.log(
    `Fit-check: ${summary.preferred} preferred / ${summary.acceptable} acceptable / ` +
      `${summary.reject} REJECT of ${total} measured (${summary.missing} missing).`,
  )
  console.log(`Full report: ${outPath}`)
  if (summary.reject > 0) {
    console.log('\nTop 10 rejects (by |drift|):')
    for (const r of rows.filter((x) => x.verdict === 'reject').slice(0, 10)) {
      const pct = ((r.driftPct ?? 0) * 100).toFixed(1)
      console.log(`  ${r.key.padEnd(48)} actual ${String(r.actualMs).padStart(5)} ms  target ${String(r.gridDurationMs).padStart(5)} ms  drift ${pct}%`)
    }
    process.exit(1)
  }
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
            // Techniques delivery (Kyle's energy A/D pick, 2026-08-28):
            // the technique names read flat next to the numeric twin, so
            // that side performs HOTTER — more exaggeration, looser hold
            // on the reference. Delivery, never tempo: the fit rate stays
            // grid-locked (see fitRateForJob).
            ...(j.vocabulary === 'techniques'
              ? { exaggeration: 1.35, cfgWeight: 0.25 }
              : {}),
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

  // A token can be more than one word — "two bee" — so spans are matched by
  // walking both lists rather than by index.
  const wordCounts = job.tokens.map(
    (t) => spokenFor(t, { vocabulary: job.vocabulary }).split(' ').length,
  )
  const expectedWords = wordCounts.reduce((a, b) => a + b, 0)

  // Two-pass envelope: strict first (Kyle's original detector), then
  // relaxed on miss. The relaxed pass rescues clips where the coach ran
  // words together — a longer minGap forgives the join.
  let spans = measureWordSpans(job.wav, expectedWords) ?? []
  let source = spans.length === expectedWords ? 'envelope' : 'none'
  if (source === 'none') {
    const relaxed = measureWordSpans(job.wav, expectedWords, {
      startThresholdRatio: 0.08,
      endThresholdRatio: 0.15,
      minGapWindows: 3,
    })
    if (relaxed) {
      spans = relaxed
      source = 'envelope-relaxed'
    }
  }
  const wordMarks = []
  let wordIndex = 0
  for (let t = 0; t < job.tokens.length; t += 1) {
    const startSpan = spans[wordIndex]
    // A multi-word token spans multiple envelope words — take the FIRST
    // word's start and the LAST word's end so the mark envelopes the whole
    // token ("two bee" starts on 'two' and ends on 'bee').
    const endSpan = spans[wordIndex + wordCounts[t] - 1]
    if (startSpan !== undefined && endSpan !== undefined) {
      wordMarks.push({
        tokenIndex: t,
        token: job.tokens[t],
        offsetMs: startSpan.startMs,
        endOffsetMs: endSpan.endMs,
      })
    }
    wordIndex += wordCounts[t]
  }
  // Rail sanity guard (2026-08-28): reject wordMarks that would make the
  // rings fire chaotically. The rail faithfully follows whatever cadence
  // the marks describe, so a clip with words that ran together (envelope
  // finding a 100 ms end-to-end gap) or with a spike between two
  // otherwise-uniform gaps (Whisper mis-timing a word) produces rings the
  // athlete can't throw on. Better: fall back to the beat grid for that
  // one clip — Kyle-consistent even if not Kyle-tight. Thresholds:
  //   MIN_INTER_TOKEN_GAP_MS: rings any closer look/feel overlapping.
  //   MIN_WORD_SPAN_MS: a token whose audible envelope is under this is
  //     probably a mis-detection (word ran into its neighbor).
  const MIN_INTER_TOKEN_GAP_MS = 150
  const MIN_WORD_SPAN_MS = 50
  let sane = wordMarks.length === job.tokens.length
  if (sane && wordMarks.length >= 2) {
    for (let i = 0; i < wordMarks.length; i += 1) {
      const span = (wordMarks[i].endOffsetMs ?? 0) - wordMarks[i].offsetMs
      if (span < MIN_WORD_SPAN_MS) { sane = false; break }
      if (i > 0) {
        const gap = wordMarks[i].endOffsetMs - wordMarks[i - 1].endOffsetMs
        if (gap < MIN_INTER_TOKEN_GAP_MS) { sane = false; break }
      }
    }
  }
  if (!sane) {
    // Drop the marks; runtime falls back to beat-grid rings for this clip.
    wordMarks.length = 0
    source = 'none'
  }

  // Grid fit (M39-V1c). The wav must fit the engine's allocated grid
  // within ±5% (preferred) / ±10% (hard cap). Stored on the per-persona
  // index.json for post-hoc analysis; the TS phraseManifest stays lean.
  const gridMs = gridDurationMs({ tokens: job.tokens, cadence: job.cadence })
  const ratio = fitPct(durationMs, gridMs)
  const verdict = fitVerdict(ratio)

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
    gridDurationMs: Math.round(gridMs),
    fitPct: Number(ratio.toFixed(4)),
    fitVerdict: verdict,
    wordMarks,
    wordMarksSource: wordMarks.length === job.tokens.length ? source : 'none',
    renderer: RENDERER,
  })

  const kb = (statSync(job.wav).size / 1024).toFixed(0)
  const fitTag =
    verdict === 'reject'
      ? ` FIT!${((ratio - 1) * 100).toFixed(1)}%`
      : verdict === 'acceptable'
        ? ` fit${((ratio - 1) * 100).toFixed(1)}%`
        : ''
  console.log(`${job.key.padEnd(40)} ${String(durationMs).padStart(5)} ms  ${kb.padStart(4)} KB${fitTag}`)
}

// Post-render fit summary (M39-V1c). Written alongside render-report.json
// so a batch operator can `--only-keys=$(jq -r '.rejectKeys[]' fit-report.json)`
// to re-render the failing clips at a fresh --attempts budget rather than
// letting them ship at the wrong duration.
if (!manifestOnly && index.length > 0) {
  const fitSummary = { preferred: 0, acceptable: 0, reject: 0 }
  const rejectKeys = []
  for (const entry of index) {
    if (entry.fitVerdict) {
      fitSummary[entry.fitVerdict] += 1
      if (entry.fitVerdict === 'reject') rejectKeys.push(entry.cueId)
    }
  }
  writeFileSync(
    join('tools', 'analysis', 'fit-report.json'),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      persona: PERSONA.id,
      summary: fitSummary,
      rejectKeys,
    }, null, 2)}\n`,
  )
  console.log(
    `Fit: ${fitSummary.preferred} preferred / ${fitSummary.acceptable} acceptable / ` +
      `${fitSummary.reject} REJECT (see tools/analysis/fit-report.json)`,
  )
  if (rejectKeys.length > 0) {
    console.log(
      `  Retry: node tools/voice/make-phrase-clips.mjs "--only-keys=$(jq -r '.rejectKeys | join(",")' tools/analysis/fit-report.json)" --attempts=12 --asr-exact --soft-head`,
    )
  }
}

// Whisper backfill (source: 'whisper') for entries the envelope couldn't
// resolve. Runs once per manifest emission, skipped for subset renders
// (which don't write the manifest anyway). The rail depends on populated
// wordMarks; a clip that fails all three sources is flagged and Kyle
// investigates. --skip-whisper-backfill bypasses the pass entirely for
// fast iteration.
const skipWhisperBackfill = process.argv.includes('--skip-whisper-backfill')
if (!skipWhisperBackfill && !onlyArg && !onlyKeys && !missingOnly) {
  const needsWhisper = index.filter((e) => e.wordMarksSource === 'none')
  if (needsWhisper.length > 0) {
    console.log(`\nWhisper word-onset backfill for ${needsWhisper.length} clips…`)
    try {
      const CHATTERBOX_PYTHON = process.env.CHATTERBOX_PYTHON ??
        'F:/voice-tools/venv/Scripts/python.exe'
      const jobs = needsWhisper.map((e) => ({
        cueId: e.cueId,
        wav: join(OUT_ROOT, e.file),
        tokens: e.tokens,
        // Per-token expected spoken form so the aligner works for BOTH
        // vocabularies. Numbers-side "1" -> "One" (heard as "one"),
        // techniques-side "1" -> "Jab" (heard as "jab"). Without this
        // the aligner assumed digit-only matching and every techniques
        // clip failed to bind, leaving them all on the beat grid.
        spokenTokens: e.tokens.map((t) => spokenFor(t, {
          vocabulary: e.vocabulary,
          cadence: e.cadence,
        })),
      }))
      const raw = execFileSync(
        CHATTERBOX_PYTHON,
        [join('tools', 'voice', 'whisper_word_spans.py')],
        { input: JSON.stringify(jobs), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
      )
      let filled = 0
      let stillMissing = 0
      const byId = new Map(index.map((e) => [e.cueId, e]))
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim()) continue
        let result
        try { result = JSON.parse(line) } catch { continue }
        const entry = byId.get(result.cueId)
        if (!entry) continue
        if (!result.ok || !Array.isArray(result.onsets)) {
          stillMissing += 1
          continue
        }
        const marks = result.onsets.map((onset, t) => ({
          tokenIndex: t,
          token: entry.tokens[t],
          offsetMs: Math.round(onset),
          endOffsetMs: Math.round(result.ends[t]),
        }))
        // Same rail sanity guard as the envelope path — Whisper's word
        // timings on repeat-heavy short combos frequently spike (1-2-1-2
        // with a 100 ms tail-off), and firing rings on those spikes reads
        // as chaos on the bag. Drop the marks and let the beat grid drive.
        let sane = marks.length >= 2
        if (sane) {
          for (let i = 0; i < marks.length; i += 1) {
            const span = marks[i].endOffsetMs - marks[i].offsetMs
            if (span < 50) { sane = false; break }
            if (i > 0 && marks[i].endOffsetMs - marks[i - 1].endOffsetMs < 150) {
              sane = false
              break
            }
          }
        }
        if (!sane) {
          stillMissing += 1
          continue
        }
        entry.wordMarks = marks
        entry.wordMarksSource = 'whisper'
        filled += 1
      }
      console.log(`  filled ${filled}/${needsWhisper.length} via Whisper; ${stillMissing} still 'none' (incl. rail-insane)`)
    } catch (err) {
      console.warn(`  Whisper backfill skipped: ${err.message.split('\n')[0]}`)
    }
  }
}

// Rail-coverage report — the "how mechanically scalable is the library"
// number Kyle asked for. A clip without wordMarks can't feed the ring
// cadence rail and falls back to the beat grid.
{
  const bySource = { envelope: 0, 'envelope-relaxed': 0, whisper: 0, none: 0 }
  for (const e of index) bySource[e.wordMarksSource ?? 'none'] = (bySource[e.wordMarksSource ?? 'none'] ?? 0) + 1
  const populated = index.length - bySource.none
  console.log(
    `\nwordMarks coverage: ${populated}/${index.length} clips ` +
      `(envelope ${bySource.envelope}, relaxed ${bySource['envelope-relaxed']}, ` +
      `whisper ${bySource.whisper}, none ${bySource.none})`,
  )
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

/* -------------------------------- per-clip placement shifts (cadence lab) */

// The sidecar maps cueId to milliseconds of extra head start for the phrase
// clip's placement (positive = earlier, negative = later). Absent keys keep
// the shipped placement rule; empty file = no shifts. Populated from
// cadence_audit.py / cadence_analyzer.py reports.
let clipShifts = {}
try {
  const raw = JSON.parse(readFileSync(join('tools', 'voice', 'clip-shifts.json'), 'utf8'))
  clipShifts = raw?.shifts ?? {}
} catch {
  // Absent file is fine — no shifts.
}
const shiftFor = (cueId) => {
  const v = clipShifts[cueId]
  return typeof v === 'number' && Number.isFinite(v) && v !== 0 ? Math.round(v) : undefined
}

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
  '  /** Onset in milliseconds from the start of the clip. */',
  '  offsetMs: number',
  '  /**',
  '   * End of the audible envelope for this token, in milliseconds from',
  '   * the start of the clip. Populated by the same envelope-detector pass',
  '   * as `offsetMs`. The cadence-lab measures ring fire − wordEnd, and the',
  '   * scalable ring-cadence rail (proposed) drives ring N off this field.',
  '   */',
  '  endOffsetMs?: number',
  '}',
  '',
  '/** Where the wordMarks came from. `envelope` is the strict envelope',
  " * detector's find; `envelope-relaxed` used softer thresholds; `whisper`",
  " * used ASR word_timestamps as the last resort. `none` means the clip",
  " * shipped without wordMarks — the rail falls back to the beat grid.*/",
  "export type WordMarksSource = 'envelope' | 'envelope-relaxed' | 'whisper' | 'none'",
  '',
  '/**',
  ' * The V2 shape of a phrase\'s teaching content (M39-V2 Phase 4). The',
  " * V1c `wordMarks[]` conflated two things: the ASR / envelope word",
  ' * onsets in the recording (used for subtitles + diagnostics) and the',
  ' * semantic strike positions the phrase teaches (used for the ring',
  ' * cadence rail and the fit-check). Phase 4 splits them:',
  ' *   - `speechMarksMs[]` — every word onset the recording carries.',
  ' *     Diagnostic use only. Same shape as `wordMarks[]` — same data',
  ' *     source, renamed to reflect what the field actually is.',
  ' *   - `taughtStrikeOffsetsTicks[]` — one per strike the phrase teaches,',
  ' *     in TRANSPORT ticks (960 PPQN). Populated when the render',
  ' *     pipeline can extract them (typically from the same envelope pass',
  ' *     that populates speechMarksMs, aligned to the strike grid).',
  ' *   - `mappedDurationTicks` — the clip\'s duration in transport ticks',
  ' *     (mirror of durationMs; ticks so it composes with the compiled',
  ' *     timeline without unit conversion).',
  ' * All three are OPTIONAL — a clip without them still plays through the',
  ' * V1c rail. The compiler prefers the V2 fields when present.',
  ' */',
  'export interface SpeechMark {',
  '  /** Onset in milliseconds from the start of the clip. */',
  '  offsetMs: number',
  '  /** End of the audible envelope for this mark, in ms. Optional. */',
  '  endOffsetMs?: number',
  '  /** Label — the word / syllable this mark corresponds to. Optional. */',
  '  label?: string',
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
  '  /** How the wordMarks were sourced — see WordMarksSource. */',
  '  wordMarksSource?: WordMarksSource',
  '  /**',
  '   * V2 semantic-rename of `wordMarks`: word onsets in the recording,',
  '   * diagnostic use only (subtitles / ASR / transcript). Present when',
  '   * the render pipeline emits it (M39-V2 Phase 4). Not a strike map.',
  '   */',
  '  speechMarksMs?: readonly SpeechMark[]',
  '  /**',
  '   * V2 strike map: semantic strike positions the phrase teaches, in',
  '   * transport ticks (960 PPQN). One entry per strike; length matches',
  '   * the combination\'s token count. Consumed by the compiled-timeline',
  '   * fit-check + the ring-cadence rail (M39-V2 Phase 4).',
  '   */',
  '  taughtStrikeOffsetsTicks?: readonly number[]',
  '  /**',
  '   * V2 mirror of `durationMs` in transport ticks (960 PPQN) — lets the',
  '   * compiled timeline compose without unit conversion (M39-V2 Phase 4).',
  '   */',
  '  mappedDurationTicks?: number',
  '  /**',
  '   * Cadence-lab per-clip placement shift (ms). Positive = start the clip',
  '   * EARLIER (fixes a clip whose spoken token landed after its ring);',
  '   * negative = later. Absent or 0 = shipped placement unchanged. Sourced',
  '   * from tools/voice/clip-shifts.json — never edit here; regenerate the',
  '   * manifest instead. Baked into the manifest so it travels with the app',
  '   * bundle, not resolved at runtime.',
  '   */',
  '  startPadMs?: number',
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
  const shift = shiftFor(entry.cueId)
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
    `    wordMarksSource: ${JSON.stringify(entry.wordMarksSource ?? 'none')},`,
    ...(shift !== undefined ? [`    startPadMs: ${shift},`] : []),
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
