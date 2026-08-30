/**
 * Block-level cornerman instructions — the coach's line at a block
 * boundary ("Breathe. More coming.", "Final thirty. Empty the tank.").
 *
 * A11 (#265) wired `block.instruction` to `CueInstance.instruction`;
 * WS4 is the render batch that pairs each of those authored strings
 * with a rendered clip so the runtime can actually speak them at
 * block boundaries.
 *
 * Renders every entry in `tools/voice/instructions.json` to one wav in
 * `assets/voice/numbers/standalone/in-*.wav`. Unlike callouts, these are
 * NOT vocabulary-scoped (an instruction is a coach's aside, not a
 * technique announcement), so they live in one directory and the
 * manifest is one flat table indexed by clip id AND by exact-text match.
 *
 * Delivery direction (mirrors the recovery/callout persona): old-school
 * cornerman, calm during the recovery lines ("Breathe.", "Reset.") and
 * firmer for the exhortations ("Final thirty. Empty the tank."). The
 * texture chain matches callouts so instructions read as coming from
 * the same voice.
 *
 * Adding a new instruction:
 *   1. Add the line inline on a WorkoutBlock in samples/*.ts.
 *   2. Add a matching row to `instructions.json` (frozen id).
 *   3. Re-run this script (or --only-ids=new-id to just render the new one).
 *   4. The manifest lookup is by exact text — no code change needed.
 *
 * Run: node tools/voice/make-instruction-clips.mjs [--only-ids=in-breathe-01,...]
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
  console.error('Instruction rendering expects the chatterbox persona.')
  process.exit(1)
}

const { instructions } = JSON.parse(
  readFileSync(join('tools', 'voice', 'instructions.json'), 'utf8'),
)

const onlyArg = process.argv.find((a) => a.startsWith('--only-ids='))?.slice('--only-ids='.length)
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null
const manifestOnly = process.argv.includes('--manifest-only')

// The manifest is always rebuilt from the full instructions list against
// what's on disk, so a partial render never truncates it.
function writeManifest() {
  const have = instructions.filter((s) => existsSync(join(OUT_DIR, `${s.id}.wav`)))
  const lines = [
    '/**',
    ' * Block-level cornerman instruction clips (generated).',
    ' *',
    ' * DO NOT EDIT — produced by `node tools/voice/make-instruction-clips.mjs`.',
    ' *',
    ' * Each entry pairs a rendered wav with the exact text a workout',
    ' * block authored on `WorkoutBlock.instruction`. Runtime lookup is by',
    ' * exact text match — if a block\'s instruction has no entry here, it',
    ' * simply stays silent (the block still runs; nothing crashes).',
    ' */',
    '',
    '/* eslint-disable @typescript-eslint/no-require-imports */',
    '',
    'export interface InstructionClip {',
    '  id: string',
    '  /** The exact `WorkoutBlock.instruction` text this clip renders. */',
    '  text: string',
    '  /** Metro module id for the wav. */',
    '  module: number',
    '  /** Measured duration of the rendered clip, in milliseconds. */',
    '  durationMs: number',
    '}',
    '',
    'export const INSTRUCTION_CLIPS: readonly InstructionClip[] = [',
  ]
  for (const clip of have) {
    const durationMs = measureDuration(join(OUT_DIR, `${clip.id}.wav`))
    lines.push(
      `  { id: '${clip.id}', text: ${JSON.stringify(clip.text)}, module: require('../../../assets/voice/numbers/standalone/${clip.id}.wav'), durationMs: ${durationMs} },`,
    )
  }
  lines.push(
    ']',
    '',
    '/**',
    ' * The clip for a block instruction, or undefined when none was rendered.',
    ' * Matches on the exact authored text — no fuzzy normalization, so the',
    ' * block author and the render script cannot silently disagree.',
    ' */',
    'export function instructionClipFor(text: string): InstructionClip | undefined {',
    '  return INSTRUCTION_CLIPS.find((c) => c.text === text)',
    '}',
    '',
    '/* eslint-enable @typescript-eslint/no-require-imports */',
    '',
  )
  writeFileSync(join('src', 'audio', 'voiceAssets', 'instructionManifest.ts'), lines.join('\n'))
  console.log(`Wrote instructionManifest.ts (${have.length}/${instructions.length} clips)`)
}

if (manifestOnly) {
  writeManifest()
  process.exit(0)
}

const FFMPEG = findFfmpeg()
const jobs = instructions.filter((s) => !only || only.has(s.id)).map((clip) => {
  const plan = compileAdlib(clip.text, {
    performance: 'work',
    expression: PRODUCTION_EXPRESSION,
    finish: 'land',
  })
  return { ...clip, plan, wav: join(process.cwd(), OUT_DIR, `${clip.id}.wav`) }
})

console.log(`Rendering ${jobs.length} instruction clips — ${RENDERER}…`)
const renderOut = execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
  input: JSON.stringify({
    reference: REFERENCE_VOICE,
    attempts: 8,
    jobs: jobs.map((j) => ({
      path: j.wav,
      text: j.plan.renderedText,
      ...(EXAGGERATION.work ?? {}),
      minDurationMs: 500,
      maxDurationMs: 6_000,
      expectText: j.plan.renderedText,
      asrMinScore: 0.8,
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
