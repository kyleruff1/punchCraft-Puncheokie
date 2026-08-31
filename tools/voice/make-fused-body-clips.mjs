/**
 * Numeric-vocab fused-body standalone strikes (task #46 / plan §W8).
 *
 * Six wavs — one per numeric body-shot token — spoken as one fused
 * utterance ("One-bee", "Two-bee", … "Six-bee"). Hyphenation is not
 * cosmetic: it is the input format Chatterbox needs to fuse
 * letter+number into a fast single utterance
 * ([[feedback-fused-bee-pronunciation]]). Space, concat, comma,
 * ellipsis all fail — hard-won from many render batches. The shipped
 * historical corpus at `assets/voice/phrases-legacy/cornerman/` used
 * fused-body pronunciation at the phrase level; this batch is the
 * standalone equivalent so the runtime never has to compose
 * `['digit','body']` on the fly (that compose violates Kyle's A/B/C
 * rule — the split gives the boxer time to commit head shot before
 * "body" arrives to redirect).
 *
 * Runs into `assets/voice/numbers/standalone/` alongside `1..6.wav`
 * (single-directory rule that Metro's Windows file map depends on).
 * Same performance shape as the technique-standalone corpus:
 * push+shout, single strike anchor.
 *
 * The main manifest (`src/audio/voiceAssets/manifest.ts`) is
 * hand-maintained (Metro static-require constraint) — this tool
 * only writes the wavs and reports duration measurements so the
 * hand-edit is one copy-paste per clip.
 *
 * Run:
 *   node tools/voice/make-fused-body-clips.mjs [--only-ids=1b,2b,...]
 *   node tools/voice/make-fused-body-clips.mjs --measure-only
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { compileAdlib } from './prosody.mjs'
import { textureChain } from './texture.mjs'
import {
  ENGINE,
  EXAGGERATION,
  PRODUCTION_EXPRESSION,
  PRODUCTION_FINISH,
  PRODUCTION_TEXTURE,
  REFERENCE_VOICE,
  RENDERER,
} from './persona.mjs'
import { measureDuration, trimEnds, renameWithRetry } from './wav.mjs'

const OUT_DIR = join('assets', 'voice', 'numbers', 'standalone')
const CONFIG_PATH = join('tools', 'voice', 'numbers-body-standalone.json')

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
  console.error('Fused-body rendering expects the chatterbox persona.')
  process.exit(1)
}

const { clips } = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))

const onlyArg = process.argv.find((a) => a.startsWith('--only-ids='))?.slice('--only-ids='.length)
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null
const measureOnly = process.argv.includes('--measure-only')

function reportMeasurements() {
  console.log('')
  console.log('== manifest.ts entries (copy-paste into numbers/standalone block) ==')
  for (const clip of clips) {
    const wav = join(OUT_DIR, `${clip.id}.wav`)
    if (!existsSync(wav)) {
      console.log(`  // ${clip.id}: MISSING (${wav})`)
      continue
    }
    const durationMs = measureDuration(wav)
    console.log(
      `  '${clip.id}': require('../../../${wav.replace(/\\/g, '/')}'),  // ${durationMs}ms — "${clip.text}"`,
    )
  }
  console.log('')
}

if (measureOnly) {
  reportMeasurements()
  process.exit(0)
}

const FFMPEG = findFfmpeg()

const jobs = clips.filter((c) => !only || only.has(c.id)).map((clip) => {
  const plan = compileAdlib(clip.text, {
    performance: 'push',
    expression: PRODUCTION_EXPRESSION,
    finish: PRODUCTION_FINISH,
  })
  return { ...clip, plan, wav: join(process.cwd(), OUT_DIR, `${clip.id}.wav`) }
})

console.log(`Rendering ${jobs.length} fused-body standalone clips — ${RENDERER}…`)
const renderOut = execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
  input: JSON.stringify({
    reference: REFERENCE_VOICE,
    // GPU rig is not the bottleneck (Kyle 2026-08-30) — high attempts
    // matters more than throughput. A two-syllable fused shout gets
    // rejected as flat or unfused more often than a sentence; 16
    // attempts keeps the keep-better sampler honest.
    attempts: 16,
    jobs: jobs.map((j) => ({
      path: j.wav,
      text: j.plan.renderedText,
      ...(EXAGGERATION.push ?? {}),
      // A fused-body shout is one fused word at push intensity;
      // reject the fragment-into-nothing and the long-runaway cases.
      minDurationMs: 400,
      maxDurationMs: 2_000,
      expectText: j.plan.renderedText,
      asrMinScore: 0.75,
    })),
  }),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
for (const line of renderOut.split(/\r?\n/)) {
  if (line.startsWith('FAIL ') || line.startsWith('OK ')) console.log(`  ${line}`)
}

console.log('Trimming and texturing…')
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

reportMeasurements()
