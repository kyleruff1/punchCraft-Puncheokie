/**
 * Combo-announce clips — the M39-V1c fix for sprint + pressure cadences
 * (Kyle 2026-08-30).
 *
 * ## Why a new clip category
 *
 * Fit-check (commit b290ab0) proved 84% of the current per-punch phrase
 * corpus rejects the M39 grid, worst in sprint techniques (median +63%
 * drift, up to +359%): a 4-punch sprint combo needs ~4500 ms of raw
 * Chatterbox synth in a 1000 ms grid slot — physically unfittable at
 * intelligible ffmpeg rates. The engine's density-decoupled path (Kyle
 * 2026-08-30) speaks the WHOLE combo ONCE at block start and lets the
 * athlete work to the rings.
 *
 * Runtime consumer: `WorkoutBlock.voicePolicy = 'announce-then-work'`
 * plus `CueAnnouncer` (commit 79f3411, Phase A). Phase C swaps the
 * interim per-punch phrase call at rep 0 for the announce clip this
 * script produces.
 *
 * ## Shape
 *
 * Mirrors `make-instruction-clips.mjs`: one line per (combination,
 * vocabulary), rendered as a single Chatterbox take, textured with the
 * same broadcast chain as callouts. The template is Kyle's chosen
 * "punchy old-corner call": `<spoken tokens>, go!` — e.g. "One-two-three,
 * go!" for numbers vocabulary, "Jab, cross, hook, go!" for techniques.
 *
 * Same source-of-truth as phrases: combinations come from
 * `combinationsFromCorpus()`, spoken form from `spokenFor()`.
 *
 * Output: `assets/voice/combo-announces/<persona>/ca-<notation>-<vocab>.wav`
 * — sibling of `assets/voice/phrases/<persona>/` so per-category rollback
 * is a directory move.
 *
 * Run:
 *   node tools/voice/make-combo-announce-clips.mjs [--only=<substr>]
 *        [--only-keys=<k1,k2,…>] [--list] [--manifest-only]
 *
 * The manifest emit is DEFERRED to a follow-up (Phase B2 wires
 * `comboAnnounceManifest.ts` + `VoiceOutputPort.playComboAnnounce()`).
 * The pilot run just needs the wav on disk.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { combinationsFromCorpus, VOCABULARIES } from './corpus.mjs'
import { compileAdlib, spokenFor } from './prosody.mjs'
import { textureChain } from './texture.mjs'
import {
  ENGINE,
  EXAGGERATION,
  PRODUCTION_EXPRESSION,
  PRODUCTION_TEXTURE,
  REFERENCE_VOICE,
  RENDERER,
} from './persona.mjs'
import { ACTIVE_PERSONA, getPersona } from './personas.mjs'
import { measureDuration, renameWithRetry, trimEnds } from './wav.mjs'

const personaArg = process.argv.find((a) => a.startsWith('--persona='))?.slice('--persona='.length)
const PERSONA = getPersona(personaArg ?? ACTIVE_PERSONA)
const OUT_ROOT = join('assets', 'voice', 'combo-announces', PERSONA.id)

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
  console.error('Combo-announce rendering expects the chatterbox persona.')
  process.exit(1)
}

mkdirSync(OUT_ROOT, { recursive: true })

/**
 * Build the announcement text for one (combination, vocabulary).
 *
 * Kyle 2026-08-30: the punchy old-corner call is the settled template.
 * A trailing "go!" is the imperative that turns the announcement into a
 * command — "One-two-three, go!" reads as a corner shouting the combo
 * up, not naming it.
 */
function announceText(tokens, vocabulary) {
  // Commas separate the tokens — a corner shouting a combo says
  // "one, two, three, go!" not "onetwothreego". Without punctuation
  // Chatterbox runs the tokens together and the ASR gate rejects the
  // take. The " go!" tail turns the recitation into a command.
  const spoken = tokens.map((t) => spokenFor(t, { vocabulary })).join(', ')
  return `${spoken}, go!`
}

/** Frozen clip id per (notation, vocabulary). */
function announceId(notation, vocabulary) {
  return `ca-${notation}-${vocabulary}`
}

// -----------------------------------------------------------------------------
// Job assembly.
// -----------------------------------------------------------------------------

const combinations = combinationsFromCorpus()
const allJobs = []
for (const notation of combinations) {
  const tokens = notation.split('-').map((t) => t.trim())
  for (const vocabulary of VOCABULARIES) {
    const id = announceId(notation, vocabulary)
    const text = announceText(tokens, vocabulary)
    const plan = compileAdlib(text, {
      performance: 'push',
      expression: PRODUCTION_EXPRESSION,
      finish: 'shout',
    })
    allJobs.push({
      id,
      notation,
      vocabulary,
      tokens,
      text,
      plan,
      wav: join(process.cwd(), OUT_ROOT, `${id}.wav`),
    })
  }
}

// `--list` prints the roster and exits.
if (process.argv.includes('--list')) {
  for (const j of allJobs) console.log(`${j.id}\t${JSON.stringify(j.text)}`)
  console.log(`\n${allJobs.length} combo-announce clips (${combinations.length} combinations × ${VOCABULARIES.length} vocabularies)`)
  process.exit(0)
}

const onlyArg = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length)
const onlyKeysArg = process.argv.find((a) => a.startsWith('--only-keys='))?.slice('--only-keys='.length)
const onlyKeys = onlyKeysArg
  ? new Set(onlyKeysArg.split(',').map((k) => k.trim()).filter(Boolean))
  : null

const jobs = allJobs.filter((j) => {
  if (onlyKeys) return onlyKeys.has(j.id)
  if (onlyArg) return j.id.includes(onlyArg)
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
  console.log(`Rendering ${jobs.length} combo-announce clips — ${RENDERER}…`)
  const renderOut = execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
    input: JSON.stringify({
      reference: REFERENCE_VOICE,
      // Same as instructions: aggressive best-of-N because the shout
      // finish is unforgiving of a mumbled take.
      attempts: 10,
      jobs: jobs.map((j) => ({
        path: j.wav,
        text: j.plan.renderedText,
        ...(EXAGGERATION.push ?? EXAGGERATION.work ?? {}),
        // Natural announce window — a 4-punch combo says ~5 words in ~2 s,
        // so 500..3500 covers the whole corpus with margin.
        minDurationMs: 500,
        maxDurationMs: 3_500,
        expectText: j.plan.renderedText,
        asrMinScore: 0.8,
      })),
    }),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  for (const line of renderOut.split(/\r?\n/)) {
    if (line.startsWith('FAIL ') || line.startsWith('OK ') || line.startsWith('VERDICT ')) {
      // VERDICTs are noisy; only surface OK / FAIL.
      if (!line.startsWith('VERDICT ')) console.log(`  ${line}`)
    }
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
        '-ar', '24000', '-ac', '1', temp],
      { stdio: 'ignore' },
    )
    if (existsSync(temp)) renameWithRetry(temp, job.wav)
  }
}

// -----------------------------------------------------------------------------
// Summary — the wavs sit ready for Phase B2 (manifest + port wiring).
// -----------------------------------------------------------------------------

const shipped = jobs.filter((j) => existsSync(j.wav))
console.log(`\n${shipped.length}/${jobs.length} combo-announce wavs on disk at ${OUT_ROOT}`)
for (const job of shipped) {
  const kb = (statSync(job.wav).size / 1024).toFixed(0)
  const durationMs = measureDuration(job.wav)
  console.log(`${job.id.padEnd(48)} ${String(durationMs).padStart(5)} ms  ${kb.padStart(4)} KB  ${JSON.stringify(job.text)}`)
}

if (!manifestOnly) {
  writeFileSync(
    join('tools', 'analysis', 'combo-announce-report.json'),
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      persona: PERSONA.id,
      requested: jobs.length,
      shipped: shipped.length,
      entries: shipped.map((j) => ({
        id: j.id,
        notation: j.notation,
        vocabulary: j.vocabulary,
        text: j.text,
        durationMs: measureDuration(j.wav),
      })),
    }, null, 2)}\n`,
  )
  console.log('Report: tools/analysis/combo-announce-report.json')
}
