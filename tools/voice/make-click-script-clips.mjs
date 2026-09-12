/**
 * Click-script clips — section lead-ins + between-round rest scripts for
 * the click-track workout library (Kyle, 2026-08-31).
 *
 * Source of truth is `tools/analysis/gen-workout-scripts.ts --corpus`,
 * executed live at render time — the same strings the script bible
 * (`docs/click-workout-scripts.md`) prints, so doc and clips can never
 * drift. Numeric verbiage only; technique verbiage implied.
 *
 * Many slots share a text (`One, two, one, two — straight time, fifteen
 * bars.` recurs across workouts), so clips are DEDUPED BY TEXT: one wav
 * per unique utterance, id `li-`/`rr-` + sha1(text) prefix, and the
 * manifest maps every slot (`lead-in/<key>/rNsM`, `rest/<key>/rN`) to
 * its clip.
 *
 * Delivery: lead-ins render at performance `work` (the coach setting up
 * the next set), rests at `teach` (the corner talking the athlete
 * through recovery). Same reference, texture and gates as every other
 * batch: best-of-N with the ASR gate, then trim + broadcast chain.
 *
 * Output: `assets/voice/click-scripts/<persona>/<id>.wav` and
 * `src/audio/voiceAssets/clickScriptManifest.ts`.
 *
 * Run:
 *   node tools/voice/make-click-script-clips.mjs
 *        [--list] [--only=<substr>] [--only-keys=<id,…>] [--manifest-only]
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { compileAdlib } from './prosody.mjs'
import { textureChain } from './texture.mjs'
import { CHATTERBOX_TEMPO_CALIBRATION, SHIPPED_SAMPLE_RATE } from './persona.mjs'
import { ACTIVE_PERSONA, getPersona, rendererId } from './personas.mjs'
import { measureDuration, renameWithRetry, trimEnds } from './wav.mjs'

// EVERY persona-derived value comes off PERSONA, never the flat persona.mjs
// constants — those follow ACTIVE_PERSONA and silently ignore `--persona=`
// (the 2026-09-01 reference bug; the same trap re-textured cornerman3 takes
// with cornerman's echoey chain until caught 2026-09-02).
const personaArg = process.argv.find((a) => a.startsWith('--persona='))?.slice('--persona='.length)
const PERSONA = getPersona(personaArg ?? ACTIVE_PERSONA)
const ENGINE = PERSONA.engine
const EXAGGERATION = PERSONA.intensity ?? {}
const PRODUCTION_EXPRESSION = PERSONA.expression
// Texture + output sample rate are overridable for the quality bake-off /
// full high-quality pass (Kyle, 2026-09-03: "make it sound nice and high
// bit rate"). Default to the persona's approved texture at 24kHz (the
// Chatterbox model's native rate).
const PRODUCTION_TEXTURE = process.argv.find((a) => a.startsWith('--texture='))?.slice('--texture='.length) ?? PERSONA.texture
const OUT_SAMPLE_RATE = process.argv.find((a) => a.startsWith('--sample-rate='))?.slice('--sample-rate='.length) ?? String(PERSONA.sampleRate ?? SHIPPED_SAMPLE_RATE)
const RENDERER = rendererId(PERSONA)
const OUT_ROOT = join('assets', 'voice', 'click-scripts', PERSONA.id)

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
  throw new Error('ffmpeg not found. winget install --id Gyan.FFmpeg')
}

const CHATTERBOX_PYTHON =
  process.env.CHATTERBOX_PYTHON ?? 'F:/voice-tools/venv/Scripts/python.exe'

if (ENGINE !== 'chatterbox') {
  console.error('Click-script rendering expects the chatterbox persona.')
  process.exit(1)
}

mkdirSync(OUT_ROOT, { recursive: true })

// -----------------------------------------------------------------------------
// Corpus — executed live from the script-bible generator. One source.
// -----------------------------------------------------------------------------

const corpusJson = execFileSync(
  process.execPath,
  ['--import', './tools/analysis/wav-stub.mjs', '--import', 'tsx',
    join('tools', 'analysis', 'gen-workout-scripts.ts'), '--corpus'],
  { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
)
const corpus = JSON.parse(corpusJson)

function hash8(text) {
  return createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 8)
}

/** kind: 'lead-in' | 'rest' | 'call'. Dedupe by exact text; carry every slot. */
function assemble(kind, rows, prefix, plan, vocabulary = 'numbers') {
  const byText = new Map()
  for (const row of rows) {
    const existing = byText.get(row.text)
    if (existing) {
      existing.slots.push(row.slot)
      // A shared text keeps the TIGHTEST window any of its slots demands.
      if (row.windowMs !== undefined) {
        existing.maxDurationMs = Math.min(existing.maxDurationMs, row.windowMs)
      }
      continue
    }
    byText.set(row.text, {
      id: `${prefix}-${hash8(row.text)}`,
      kind,
      vocabulary,
      text: row.text,
      slots: [row.slot],
      ...plan(row),
    })
  }
  return [...byText.values()]
}

// Chatterbox reads "lead" as /lɛd/ ("led hook") — respell it to "leed"
// for the TTS input ONLY (Kyle on-glass, 2026-09-03). The manifest text
// and the ASR expectText keep the real "lead" (Whisper transcribes the
// spoken /liːd/ back to "lead"), so nothing downstream sees "leed".
function speechText(text) {
  return text.replace(/\blead\b/gi, (m) => (m[0] === 'L' ? 'Leed' : 'leed'))
}

// Loop calls fit UNDER the tightest stride any occurrence runs at, so
// call N+1 can never pile on call N (Pillar 2 by construction).
const CALL_WINDOW_PAD_MS = 150

// Per-call rubberband cap overrides (default 1.3×). 1b-2-1-2 is a mixed
// bar — a lone body jab among head shots — that blocks all copy
// factoring, so it renders ~2.05s against a 2.0s stride; Kyle approved
// the extra compression for this one bar (2026-09-03) to bring it under.
/**
 * Per-slot syllable-budget overrides (Kyle 2026-09-04, third strike on the
 * four-count): every ASR-clean 1-1-1-1 take died in the rubberband — the
 * fourth "one" survives Whisper but not the ear at 1.2-1.3x. The stride
 * law allows ~2300ms for this motif (tightest occurrence 2400ms), so the
 * budget yields and the take ships (near-)unsqueezed. The syllable cap is
 * a punchiness PREFERENCE; clickCallFit's stride law stays the LAW.
 */
const CALL_WINDOW_OVERRIDES = {
  'call/1-1-1-1': 2200,
}

/**
 * Per-slot render overrides for the cornerman3 click-script slots that
 * shipped with dropped syllables under the default persona settings (Kyle
 * 2026-09-11, GH #386). Chatterbox elides one syllable from repeat-heavy
 * calls; Whisper hallucinates it back in the ASR transcription; the
 * `asrExact: true` gate passes on the false transcript. These overrides
 * fight the elision by:
 *
 *  - **Stronger stops between repeats** — `"One! One! One! One!"` instead
 *    of `"One, one, one, one!"` forces Chatterbox to reset prosody between
 *    words, which reduces token merging. `expectText` stays at the original
 *    corpus text; only the synthesis input changes, so the ASR gate still
 *    checks the intended token count.
 *  - **Higher `cfgWeight` (0.7)** trades theatrical looseness for text
 *    fidelity — Chatterbox stays closer to the literal script.
 *  - **Lower `exaggeration` (0.75)** reduces pitch variance, giving each
 *    repeated token a cleaner acoustic separation.
 *
 * Re-render with `--attempts=30` (up from the default 8) to deepen the
 * best-of-N budget on this batch. The `phrase_token_audit.py` sweep on
 * the shipped wavs is Layer 2 and lives outside this file — see #386.
 */
const CALL_CLIP_OVERRIDES = {
  // Pattern-naming workaround for the five 4-of-same slots Chatterbox
  // reliably elides on repeat text (Kyle 2026-09-11). The click grid
  // gives the athlete four beats; the coach names the pattern once
  // rather than counting to four. Precedent: techniques `1b-1b-1b-1b`
  // already ships as "Body jabs!" (plural noun, single word); this
  // extends the same pattern to the remaining broken slots. The
  // override text is the canonical text — synthesis, ASR gate, and
  // manifest all move to it (see the render-jobs map for the plumbing).
  'numbers|call/1-1-1-1': { text: 'Four ones!' },
  'numbers|call/2-2-2-2': { text: 'Four twos!' },
  'numbers|call/5-5-5-5': { text: 'Four fives!' },
  'numbers|call/1b-1b-1b-1b': { text: 'Four body ones!' },
  'techniques|call/1-1-1-1': { text: 'Four jabs!' },
}

const CALL_MAX_STRETCH = {
  'call/1b-2-1-2': 1.6,
  // (Kept for history; the window override above supersedes it for the
  // four-count. Note this table is Math.max'd against 1.3 — it can only
  // RAISE the cap, never lower it.)
  'call/1-1-1-1': 1.08,
  // Body/fused-bee calls that render marginally long; a slightly harder
  // stretch keeps them under their stride after the bright/48k re-render
  // (Kyle-approved per-clip compression, 2026-09-03).
  'call/1b-1b-1b-1b': 1.45,
  'call/1b-2b-3b-2b': 1.45,
  'call/1-2b-5b-2': 1.4,
}

// Syllable-unit budget per word: technique words run longer than digits
// ("uppercut" is three syllables to "five"'s one), and the call cap must
// know it or every uppercut motif renders against a numeric-sized window.
// Hyphens split like spaces (except the fused "-bee" body token): a
// hyphenated same-level run ("cross-jab-cross") is a pause-removed breath,
// NOT one short word — counting it as one unit would set a too-tight cap
// and the rubberband would crush the audio (Kyle's compressed calls,
// 2026-09-03). The hyphen buys removed pauses at render, not a smaller
// syllable budget.
const UNIT_WORDS = { uppercut: 3, upper: 2, body: 2 }
const syllableUnits = (text) =>
  text
    .replace(/-bee/g, 'bee') // shield the fused body token from the hyphen split
    .split(/[ ,!-]+/)
    .filter(Boolean)
    .reduce((a, w) => a + (w.includes('bee') ? 2 : (UNIT_WORDS[w.toLowerCase()] ?? 1)), 0)

const leadInPlan = (row) => ({
  performance: 'work',
  plan: compileAdlib(row.text, {
    performance: 'work',
    expression: PRODUCTION_EXPRESSION,
    finish: 'land',
  }),
  minDurationMs: 800,
  maxDurationMs: 9_000,
})

const restPlan = (row) => ({
  performance: 'teach',
  plan: compileAdlib(row.text, {
    performance: 'teach',
    expression: PRODUCTION_EXPRESSION,
    finish: 'land',
  }),
  minDurationMs: 3_000,
  maxDurationMs: 16_000,
})

const callPlan = (row) => ({
  performance: 'push',
  plan: compileAdlib(row.text, {
    performance: 'push',
    expression: PRODUCTION_EXPRESSION,
    finish: 'shout',
  }),
  minDurationMs: 250,
  // A call must live in the BREATH, not blanket the previous bar's
  // punches: at body-work's 4.8s stride a 3.1s call started 1.2s
  // AFTER the bar it named and read as "the coach is a second late"
  // (Kyle on-glass, 2026-09-02). Budget by syllable units — a fused
  // "-bee" token is two, technique words per UNIT_WORDS — clamped to
  // [800ms, the stride window]. ~250ms/unit + 300 is the clipped-urgent
  // corner call the original loop-call design specified.
  maxDurationMs: Math.min(
    row.windowMs,
    CALL_WINDOW_OVERRIDES[`call/${row.motif}`] ??
      Math.max(800, 300 + 250 * syllableUnits(row.text)),
  ),
  // Token-exact ASR: a call that loses a word ("Six, five, two" heard
  // as "the 652") is worse than a slower take — the athlete throws
  // what they hear (caught on-glass 2026-09-01).
  asrExact: true,
})

const callRows = (textOf) =>
  (corpus.calls ?? []).map((c) => ({
    slot: `call/${c.motif}`,
    text: textOf(c),
    windowMs: c.minStrideMs - CALL_WINDOW_PAD_MS,
  }))

const allJobs = [
  ...assemble('lead-in', corpus.leadIns, 'li', leadInPlan),
  ...assemble('rest', corpus.rests, 'rr', restPlan),
  ...assemble('call', callRows((c) => c.text), 'cc', callPlan),
  // The technique vocabulary (Kyle, 2026-09-02): same slots, same intensity
  // logic, translated copy — compact call forms, full names in prose.
  ...assemble('lead-in', corpus.techniques?.leadIns ?? [], 'lt', leadInPlan, 'techniques'),
  ...assemble('rest', corpus.techniques?.rests ?? [], 'rt', restPlan, 'techniques'),
  ...assemble('call', callRows((c) => c.techniqueText).filter((r) => r.text), 'ct', callPlan, 'techniques'),
].map((job) => ({ ...job, wav: join(process.cwd(), OUT_ROOT, `${job.id}.wav`) }))

// Apply CALL_CLIP_OVERRIDES.text to the canonical text fields BEFORE any
// downstream consumer (validator, manifest, render) reads them. Without
// this the manifest and phrase_token_audit.py score against the corpus
// text while the shipped wav says the override text — the mismatch that
// prompted the 2026-09-11 plumbing hardening.
for (const j of allJobs) {
  if (j.kind !== 'call') continue
  const raw = j.slots
    .map((s) => CALL_CLIP_OVERRIDES[`${j.vocabulary ?? 'numbers'}|${s}`])
    .find(Boolean)
  if (raw?.text !== undefined) {
    j.text = raw.text
    j.plan = { ...j.plan, renderedText: raw.text }
  }
}

if (process.argv.includes('--list')) {
  for (const j of allJobs) console.log(`${j.id}\t${j.slots.length} slot(s)\t${JSON.stringify(j.text)}`)
  console.log(`\n${allJobs.length} unique clips covering ${allJobs.reduce((a, j) => a + j.slots.length, 0)} slots`)
  process.exit(0)
}

// `--dump-expectations=<path>` writes the exact render-script text for every
// clip — the same `expectText` the ASR gate scored — and exits. The token
// audit (tools/voice/phrase_token_audit.py) then transcribes the SHIPPED wavs
// and holds them to these texts token-for-token, which is the exactness the
// fuzzy 0.8-similarity gate lacks: a dropped or doubled word inside a
// repeat-heavy call ("One, two-bee. One, two-bee!") clears the fuzzy score
// and is exactly what the athlete hears as a hole. The phrase bank has had
// this gate since #269; the click bank ships without one until now.
//
// Pair it with --persona=cornerman3, or the paths point at another bank.
const dumpArg = process.argv.find((a) => a.startsWith('--dump-expectations='))
if (dumpArg) {
  const out = dumpArg.slice('--dump-expectations='.length)
  const entries = {}
  for (const j of allJobs) {
    entries[j.id] = {
      wav: j.wav.replaceAll('\\', '/'),
      text: j.plan.renderedText,
      tokens: j.tokens ?? [],
      vocabulary: j.vocabulary ?? 'numbers',
      kind: j.kind,
      slots: j.slots,
    }
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(entries, null, 1))
  console.log(`Wrote ${Object.keys(entries).length} expectations to ${out}`)

  // The two Tier-0 gates want different shapes, so write both from the one
  // source: `phrase_token_audit.py` reads a map keyed by clip id (above),
  // `validate_clips.py` reads `{ entries: [...] }` with `key/kind/file/text`
  // (below, the export-expectations.mjs shape). One producer, so the exact
  // text both gates score can never drift apart.
  const validateOut = out.replace(/\.json$/, '') + '.validate.json'
  writeFileSync(
    validateOut,
    JSON.stringify(
      {
        persona: PERSONA.id,
        renderer: RENDERER,
        entries: allJobs.map((j) => ({
          key: j.id,
          // `kind: 'phrase'` is the VALIDATOR's taxonomy (speech vs tone),
          // not this bank's lead-in/rest/call — every click clip is speech.
          kind: 'phrase',
          file: j.wav.replaceAll('\\', '/'),
          text: j.plan.renderedText,
          clickKind: j.kind,
          vocabulary: j.vocabulary ?? 'numbers',
          ...(j.minDurationMs !== undefined ? { minDurationMs: j.minDurationMs } : {}),
          ...(j.maxDurationMs !== undefined ? { maxDurationMs: j.maxDurationMs } : {}),
          exists: existsSync(j.wav),
        })),
      },
      null,
      1,
    ),
  )
  console.log(`Wrote ${allJobs.length} validator entries to ${validateOut}`)
  console.log(`  persona ${PERSONA.id} — wavs under ${OUT_ROOT}`)
  process.exit(0)
}

const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
const onlyKeysArg = process.argv.find((a) => a.startsWith('--only-keys='))?.slice('--only-keys='.length)
const onlyKeys = onlyKeysArg
  ? new Set(onlyKeysArg.split(',').map((k) => k.trim()).filter(Boolean))
  : null

// `--missing-only`: render only texts with no wav yet — ids are text
// hashes, so an unchanged text keeps its clip and a map edit re-renders
// exactly the copy it touched.
const missingOnly = process.argv.includes('--missing-only')

const jobs = allJobs.filter((j) => {
  if (onlyKeys) return onlyKeys.has(j.id)
  if (onlyArg) return j.id.includes(onlyArg) || j.text.includes(onlyArg)
  if (missingOnly) return !existsSync(j.wav)
  return true
})

if (jobs.length === 0) {
  console.error(`No jobs selected. --list to see all ${allJobs.length} candidate ids.`)
  process.exit(1)
}

// -----------------------------------------------------------------------------
// Render.
// -----------------------------------------------------------------------------

const manifestOnly = process.argv.includes('--manifest-only')

if (!manifestOnly) {
  console.log(`Rendering ${jobs.length} click-script clips — ${RENDERER}…`)
  const renderOut = execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
    input: JSON.stringify({
      // PERSONA.reference, not the flat REFERENCE_VOICE export — the flat
      // constant is the ACTIVE persona's reference and silently ignored
      // `--persona=` (caught 2026-09-01: the first cornerman2 batch
      // actually cloned from the original cornerman reference).
      reference: PERSONA.reference,
      attempts: Number(
        process.argv.find((a) => a.startsWith('--attempts='))?.slice('--attempts='.length) ?? 8,
      ),
      jobs: jobs.map((j) => {
        // Per-slot overrides (see CALL_CLIP_OVERRIDES). Only calls carry
        // slot keys like `call/<motif>`; other clip kinds skip the lookup.
        const raw =
          j.kind === 'call'
            ? j.slots
                .map((s) => CALL_CLIP_OVERRIDES[`${j.vocabulary ?? 'numbers'}|${s}`])
                .find(Boolean) ?? {}
            : {}
        const { text: overrideText, ...paramOverrides } = raw
        // When the override provides a text, it becomes the canonical
        // text for that clip — synthesis, ASR gate, and manifest all
        // move to it. The workflow ships pattern-naming workarounds
        // (e.g. numbers `1-1-1-1` → "Four ones!") where Chatterbox
        // reliably elides a token on the 4-of-same repeat; the click
        // grid still gives the athlete 4 beats to throw against.
        // Manifest text is patched into `j.plan.renderedText` up here
        // so the report/manifest section picks it up too.
        if (overrideText !== undefined) {
          // Patch both the plan (used by the ASR gate and validator) and
          // the top-level text field (used by the shipped manifest and
          // downstream token audits). Without the top-level patch the
          // manifest keeps the corpus text and phrase_token_audit.py
          // scores the wav against tokens it never speaks.
          j.plan = { ...j.plan, renderedText: overrideText }
          j.text = overrideText
        }
        return {
          path: j.wav,
          text: speechText(overrideText ?? j.plan.renderedText),
          ...(EXAGGERATION[j.performance] ?? EXAGGERATION.work ?? {}),
          ...paramOverrides,
          minDurationMs: j.minDurationMs,
          maxDurationMs: j.maxDurationMs,
          expectText: j.plan.renderedText,
          asrMinScore: 0.8,
          ...(j.asrExact ? { asrExact: true } : {}),
        }
      }),
    }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  for (const line of renderOut.split(/\r?\n/)) {
    if (line.startsWith('FAIL ') || line.startsWith('OK ')) console.log(`  ${line}`)
  }

  console.log('Trimming and texturing…')
  const FFMPEG = findFfmpeg()
  for (const job of jobs) {
    if (!existsSync(job.wav)) continue
    trimEnds(job.wav, { tailMs: 120 })
    const filters = textureChain(PRODUCTION_TEXTURE, { profile: 'single', finalAccentDb: 0 })
    const temp = `${job.wav}.p.wav`
    execFileSync(
      FFMPEG,
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', job.wav, '-af', filters,
        '-ar', OUT_SAMPLE_RATE, '-ac', '1', temp],
      { stdio: 'ignore' },
    )
    if (existsSync(temp)) renameWithRetry(temp, job.wav)
    // Persona-level tempo bump (Kyle 2026-09-11, GH #386): apply the
    // persona's `tempoCalibration` UNCONDITIONALLY to every call clip
    // as a formant-preserved rubberband pass, matching how
    // make-phrase-clips.mjs and make-voice-clips.mjs already treat this
    // constant. Click-scripts were the outlier — they rendered at 1.0×
    // while every other clip family shipped at cornerman3's 1.35×. That
    // explains why the 3+-consecutive-repeat family blew stride windows:
    // the raw Chatterbox pace was 35% slower than the persona baseline
    // it was tuned against. This pass brings click-scripts onto the same
    // pace footing. Runs BEFORE the fit-safety compression (which stays
    // conditional on the post-tempo measurement).
    if (job.kind === 'call' && CHATTERBOX_TEMPO_CALIBRATION !== 1) {
      const rate = CHATTERBOX_TEMPO_CALIBRATION
      const tempoTemp = `${job.wav}.t.wav`
      execFileSync(
        FFMPEG,
        ['-hide_banner', '-loglevel', 'error', '-y', '-i', job.wav,
          '-af', `rubberband=tempo=${rate.toFixed(4)}:formant=preserved:pitchq=quality`,
          '-ar', OUT_SAMPLE_RATE, '-ac', '1', tempoTemp],
        { stdio: 'ignore' },
      )
      if (existsSync(tempoTemp)) renameWithRetry(tempoTemp, job.wav)
    }
    // Fit safety for calls: a take the renderer could not land inside the
    // stride window (post-tempo) gets the make-phrase-clips rubberband
    // pass (formant-preserved). Capped at 1.3× — beyond that the delivery
    // smears (the documented b-syllable crush), so we flag rather than
    // push harder. Per-slot exceptions raise the cap for a specific call
    // Kyle has ear-approved at a harder stretch: 1b-2-1-2 (lone body jab
    // among head shots — no legal copy factoring) needs ~1.5× to clear
    // its 2.0s stride, and Kyle signed off on the extra compression for
    // that one bar (2026-09-03).
    if (job.kind === 'call') {
      const stretchCap = Math.max(1.3, ...job.slots.map((s) => CALL_MAX_STRETCH[s] ?? 1.3))
      const measured = measureDuration(job.wav)
      if (measured > job.maxDurationMs) {
        const rate = Math.min(stretchCap, measured / job.maxDurationMs)
        const fitTemp = `${job.wav}.f.wav`
        execFileSync(
          FFMPEG,
          ['-hide_banner', '-loglevel', 'error', '-y', '-i', job.wav,
            '-af', `rubberband=tempo=${rate.toFixed(4)}:formant=preserved:pitchq=quality`,
            '-ar', OUT_SAMPLE_RATE, '-ac', '1', fitTemp],
          { stdio: 'ignore' },
        )
        if (existsSync(fitTemp)) renameWithRetry(fitTemp, job.wav)
        job.fitted = rate
        const after = measureDuration(job.wav)
        console.log(`  FIT ${job.id} ${measured}ms -> ${after}ms (x${rate.toFixed(2)}, window ${job.maxDurationMs}ms)${after > job.maxDurationMs ? ' STILL-OVER' : ''}`)
      }
    }
  }
}

// -----------------------------------------------------------------------------
// Report + manifest.
// -----------------------------------------------------------------------------

const shipped = jobs.filter((j) => existsSync(j.wav))
console.log(`\n${shipped.length}/${jobs.length} click-script wavs on disk at ${OUT_ROOT}`)
for (const job of shipped) {
  const kb = (statSync(job.wav).size / 1024).toFixed(0)
  const durationMs = measureDuration(job.wav)
  console.log(`${job.id.padEnd(14)} ${String(durationMs).padStart(6)} ms  ${kb.padStart(4)} KB  ${job.slots.length}x  ${JSON.stringify(job.text)}`)
}

if (!manifestOnly) {
  writeFileSync(
    join('tools', 'analysis', 'reports', 'click-script-render-report.json'),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      persona: PERSONA.id,
      requested: jobs.length,
      shipped: shipped.length,
      entries: shipped.map((j) => ({
        id: j.id,
        kind: j.kind,
        text: j.text,
        slots: j.slots,
        durationMs: measureDuration(j.wav),
        ...(j.kind === 'call' ? { windowMs: j.maxDurationMs } : {}),
        ...(j.fitted ? { fittedRate: j.fitted } : {}),
      })),
    }, null, 2)}\n`,
  )
  console.log('Report: tools/analysis/reports/click-script-render-report.json')
}

writeManifest()

function writeManifest() {
  const have = allJobs.filter((j) => existsSync(j.wav))
  const lines = [
    '/**',
    ' * Click-script clips (generated) — section lead-ins + rest scripts',
    ' * for the click-track workout library.',
    ' *',
    ' * DO NOT EDIT — produced by `node tools/voice/make-click-script-clips.mjs`.',
    ' *',
    ' * Clips are deduped by text; `slots` lists every script-bible slot',
    " * (`lead-in/<workout>/rNsM`, `rest/<workout>/rN`) the clip covers.",
    ' * Lookup: `findClickScript(slot)`.',
    ' *',
    ' * Not yet wired to the runtime — click sets run coach-minimal today.',
    ' */',
    '',
    '/* eslint-disable @typescript-eslint/no-require-imports */',
    '',
    'export interface ClickScriptClip {',
    '  id: string',
    "  kind: 'lead-in' | 'rest' | 'call'",
    '  /** Which calling vocabulary the copy speaks. */',
    "  vocabulary: 'numbers' | 'techniques'",
    '  /** The exact rendered text — what the ASR gate scored against. */',
    '  text: string',
    '  /** Every script-bible slot this clip covers. */',
    '  slots: readonly string[]',
    '  /** Metro module id for the wav. */',
    '  module: number',
    '  /** Measured duration of the rendered clip, in milliseconds. */',
    '  durationMs: number',
    '}',
    '',
    'export const CLICK_SCRIPT_CLIPS: readonly ClickScriptClip[] = [',
  ]
  for (const clip of have) {
    const durationMs = measureDuration(clip.wav)
    lines.push(
      `  { id: '${clip.id}', kind: '${clip.kind}', ` +
        `vocabulary: '${clip.vocabulary}', ` +
        `text: ${JSON.stringify(clip.text)}, ` +
        `slots: ${JSON.stringify(clip.slots)}, ` +
        `module: require('../../../assets/voice/click-scripts/${PERSONA.id}/${clip.id}.wav'), ` +
        `durationMs: ${durationMs} },`,
    )
  }
  lines.push(
    ']',
    '',
    '/**',
    ' * The clip covering a script-bible slot, or undefined when unrendered.',
    ' * Vocabulary is a second lookup dimension with a numbers fallback, so a',
    ' * partially rendered techniques bank degrades to the numeric copy',
    ' * rather than to silence.',
    ' */',
    'export function findClickScript(',
    '  slot: string,',
    "  vocabulary: 'numbers' | 'techniques' = 'numbers',",
    '): ClickScriptClip | undefined {',
    '  return (',
    '    CLICK_SCRIPT_CLIPS.find((c) => c.vocabulary === vocabulary && c.slots.includes(slot)) ??',
    "    (vocabulary === 'techniques'",
    "      ? CLICK_SCRIPT_CLIPS.find((c) => c.vocabulary === 'numbers' && c.slots.includes(slot))",
    '      : undefined)',
    '  )',
    '}',
    '',
    '/* eslint-enable @typescript-eslint/no-require-imports */',
    '',
  )
  writeFileSync(
    join('src', 'audio', 'voiceAssets', 'clickScriptManifest.ts'),
    lines.join('\n'),
  )
  console.log(`Wrote clickScriptManifest.ts (${have.length}/${allJobs.length} clips)`)
}
