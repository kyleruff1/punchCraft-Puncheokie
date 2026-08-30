/**
 * Technique standalone strike names (M39-V2 Phase 4b).
 *
 * One wav per canonical strike, spoken as its TECHNIQUE name — the
 * technique-vocabulary partner of the shipped `numbers/standalone/1.wav`
 * … `6b.wav`. Powers synchronized `strike-call` cues where the coach
 * says the strike name on the strike beat itself (Kyle amendment §
 * "Combo-announce is NOT the ONLY coach shape" — synchronized survives
 * alongside combo-announce).
 *
 * Rendered push+shout — a single strike anchor, not a settled
 * instruction. Matches how the numbers/standalone corpus renders
 * (`assets/voice/numbers/standalone/1.wav` etc.). Ships into the same
 * `assets/voice/numbers/standalone/` directory (single-directory rule
 * that Metro's Windows file map depends on — see the note in
 * `make-recovery-clips.mjs`).
 *
 * Run: node tools/voice/make-technique-standalone-clips.mjs [--only-ids=ts-1,...]
 *      [--manifest-only]   (re-measure what's on disk, skip rendering)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
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
  console.error('Technique-standalone rendering expects the chatterbox persona.')
  process.exit(1)
}

const { techniques } = JSON.parse(
  readFileSync(join('tools', 'voice', 'techniques-standalone.json'), 'utf8'),
)

const onlyArg = process.argv.find((a) => a.startsWith('--only-ids='))?.slice('--only-ids='.length)
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null
const manifestOnly = process.argv.includes('--manifest-only')

function writeManifest() {
  const have = techniques.filter((s) => existsSync(join(OUT_DIR, `${s.id}.wav`)))
  const lines = [
    '/**',
    ' * Technique standalone strike names (generated; M39-V2 Phase 4b).',
    ' *',
    ' * DO NOT EDIT — produced by',
    ' * `node tools/voice/make-technique-standalone-clips.mjs`.',
    ' *',
    ' * Each entry pairs a rendered wav with the canonical strike token',
    ' * (`1`, `1b`, … `6b`). Runtime lookup: `techniqueStandaloneClipFor(token)`.',
    ' * The technique-vocabulary partner of the shipped `numbers/standalone`',
    ' * corpus — used by synchronized `strike-call` cues.',
    ' */',
    '',
    '/* eslint-disable @typescript-eslint/no-require-imports */',
    '',
    "import type { StrikeToken } from '@domain/strikes/strikeCatalog'",
    '',
    'export interface TechniqueStandaloneClip {',
    '  id: string',
    '  token: StrikeToken',
    '  /** The exact rendered text (for diagnostics + fit-check). */',
    '  text: string',
    '  /** Metro module id for the wav. */',
    '  module: number',
    '  /** Measured duration of the rendered clip, in milliseconds. */',
    '  durationMs: number',
    '}',
    '',
    'export const TECHNIQUE_STANDALONE_CLIPS: readonly TechniqueStandaloneClip[] = [',
  ]
  for (const clip of have) {
    const durationMs = measureDuration(join(OUT_DIR, `${clip.id}.wav`))
    lines.push(
      `  { id: '${clip.id}', token: '${clip.token}', text: ${JSON.stringify(clip.text)}, module: require('../../../assets/voice/numbers/standalone/${clip.id}.wav'), durationMs: ${durationMs} },`,
    )
  }
  lines.push(
    ']',
    '',
    '/**',
    ' * The technique standalone clip for a strike token, or undefined',
    ' * when none was rendered. A missing token means synchronized',
    ' * technique-vocab reinforcement on THIS strike is skipped; the',
    ' * runtime does not synthesize a substitute.',
    ' */',
    'export function techniqueStandaloneClipFor(',
    '  token: StrikeToken,',
    '): TechniqueStandaloneClip | undefined {',
    '  return TECHNIQUE_STANDALONE_CLIPS.find((c) => c.token === token)',
    '}',
    '',
    '/* eslint-enable @typescript-eslint/no-require-imports */',
    '',
  )
  writeFileSync(
    join('src', 'audio', 'voiceAssets', 'techniquesStandaloneManifest.ts'),
    lines.join('\n'),
  )
  console.log(`Wrote techniquesStandaloneManifest.ts (${have.length}/${techniques.length} clips)`)
}

if (manifestOnly) {
  writeManifest()
  process.exit(0)
}

const FFMPEG = findFfmpeg()

const jobs = techniques.filter((s) => !only || only.has(s.id)).map((clip) => {
  const plan = compileAdlib(clip.text, {
    performance: 'push',
    expression: PRODUCTION_EXPRESSION,
    finish: PRODUCTION_FINISH,
  })
  return { ...clip, plan, wav: join(process.cwd(), OUT_DIR, `${clip.id}.wav`) }
})

console.log(`Rendering ${jobs.length} technique-standalone clips — ${RENDERER}…`)
const renderOut = execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
  input: JSON.stringify({
    reference: REFERENCE_VOICE,
    // GPU rig is not the bottleneck (Kyle 2026-08-30) — high attempts
    // matters more than throughput. A one-word/two-word shout gets
    // rejected as flat far more often than a sentence; 16 attempts
    // keeps the keep-better sampler honest.
    attempts: 16,
    jobs: jobs.map((j) => ({
      path: j.wav,
      text: j.plan.renderedText,
      ...(EXAGGERATION.push ?? {}),
      // A technique standalone is one-to-three words at push intensity;
      // reject the fragment-into-nothing and the long-runaway cases.
      minDurationMs: 400,
      maxDurationMs: 2_000,
      expectText: j.plan.renderedText,
      asrMinScore: 0.75, // shorter phrases score more variably
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

writeManifest()
