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
import { join } from 'node:path'

import { compileAdlib } from './prosody.mjs'
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

/** kind: 'lead-in' | 'rest'. Dedupe by exact text; carry every slot. */
function assemble(kind, rows, prefix, plan) {
  const byText = new Map()
  for (const row of rows) {
    const existing = byText.get(row.text)
    if (existing) {
      existing.slots.push(row.slot)
      continue
    }
    byText.set(row.text, {
      id: `${prefix}-${hash8(row.text)}`,
      kind,
      text: row.text,
      slots: [row.slot],
      ...plan(row.text),
    })
  }
  return [...byText.values()]
}

const allJobs = [
  ...assemble('lead-in', corpus.leadIns, 'li', (text) => ({
    performance: 'work',
    plan: compileAdlib(text, {
      performance: 'work',
      expression: PRODUCTION_EXPRESSION,
      finish: 'land',
    }),
    minDurationMs: 800,
    maxDurationMs: 9_000,
  })),
  ...assemble('rest', corpus.rests, 'rr', (text) => ({
    performance: 'teach',
    plan: compileAdlib(text, {
      performance: 'teach',
      expression: PRODUCTION_EXPRESSION,
      finish: 'land',
    }),
    minDurationMs: 3_000,
    maxDurationMs: 16_000,
  })),
].map((job) => ({ ...job, wav: join(process.cwd(), OUT_ROOT, `${job.id}.wav`) }))

if (process.argv.includes('--list')) {
  for (const j of allJobs) console.log(`${j.id}\t${j.slots.length} slot(s)\t${JSON.stringify(j.text)}`)
  console.log(`\n${allJobs.length} unique clips covering ${allJobs.reduce((a, j) => a + j.slots.length, 0)} slots`)
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
      reference: REFERENCE_VOICE,
      attempts: 8,
      jobs: jobs.map((j) => ({
        path: j.wav,
        text: j.plan.renderedText,
        ...(EXAGGERATION[j.performance] ?? EXAGGERATION.work ?? {}),
        minDurationMs: j.minDurationMs,
        maxDurationMs: j.maxDurationMs,
        expectText: j.plan.renderedText,
        asrMinScore: 0.8,
      })),
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
        '-ar', '24000', '-ac', '1', temp],
      { stdio: 'ignore' },
    )
    if (existsSync(temp)) renameWithRetry(temp, job.wav)
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
    "  kind: 'lead-in' | 'rest'",
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
        `text: ${JSON.stringify(clip.text)}, ` +
        `slots: ${JSON.stringify(clip.slots)}, ` +
        `module: require('../../../assets/voice/click-scripts/${PERSONA.id}/${clip.id}.wav'), ` +
        `durationMs: ${durationMs} },`,
    )
  }
  lines.push(
    ']',
    '',
    '/** The clip covering a script-bible slot, or undefined when unrendered. */',
    'export function findClickScript(slot: string): ClickScriptClip | undefined {',
    '  return CLICK_SCRIPT_CLIPS.find((c) => c.slots.includes(slot))',
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
