/**
 * Sustained-strike coach lines (M39-V2 Phase 4b).
 *
 * A `sustained-instruction` covers a whole pumping / open-pressure /
 * volume-burst block with ONE utterance: "Pump the jab", "Pump the
 * body cross". The runtime picks the vocabulary-appropriate clip when
 * the compiled cue's `voicePolicy.contentKind === 'sustained-instruction'`
 * and its `repeatFrequency === 'once-per-cue'`.
 *
 * Rendered CALM+teach+land per the rhythmic-template scout
 * (Aug 30 2026) — the calmer intensity preset from
 * `make-recovery-clips.mjs`, `performance: 'teach'` for the longer
 * beat and slower speedScale, `finish: 'land'` so the phrase settles
 * into the next several seconds of the same movement rather than
 * bouncing up like a combo-announce call.
 *
 * Files land in the existing `assets/voice/numbers/standalone/`
 * directory — Metro's Windows file map cannot survive a new asset
 * subdirectory and does not recover; see the note in
 * `make-recovery-clips.mjs`.
 *
 * Run: node tools/voice/make-sustained-clips.mjs [--only-ids=su-pump-1-numbers,...]
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
  PRODUCTION_EXPRESSION,
  PRODUCTION_TEXTURE,
  REFERENCE_VOICE,
  RENDERER,
} from './persona.mjs'
import { measureDuration, trimEnds, renameWithRetry } from './wav.mjs'

const OUT_DIR = join('assets', 'voice', 'numbers', 'standalone')

/**
 * CALM cornerman preset (from make-recovery-clips.mjs; the ONLY
 * settled calm-cornerman intensity in the tree). A sustained
 * instruction wants the same tone: authoritative but not shouting,
 * so it doesn't jolt the athlete out of the rhythm they're about to
 * settle into.
 */
const CALM = { exaggeration: 0.75, cfgWeight: 0.5 }

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
  console.error('Sustained rendering expects the chatterbox persona.')
  process.exit(1)
}

const { sustained } = JSON.parse(
  readFileSync(join('tools', 'voice', 'sustained.json'), 'utf8'),
)

const onlyArg = process.argv.find((a) => a.startsWith('--only-ids='))?.slice('--only-ids='.length)
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null
const manifestOnly = process.argv.includes('--manifest-only')

// The manifest is always rebuilt from the FULL sustained list against
// what's on disk, so a partial render never truncates it. Missing
// clips just don't appear in the output; `sustainedClipFor()` returns
// undefined and the runtime falls back to silence-plus-visuals.
function writeManifest() {
  const have = sustained.filter((s) => existsSync(join(OUT_DIR, `${s.id}.wav`)))
  const lines = [
    '/**',
    ' * Sustained-strike coach lines (generated; M39-V2 Phase 4b).',
    ' *',
    ' * DO NOT EDIT — produced by `node tools/voice/make-sustained-clips.mjs`.',
    ' *',
    ' * Each entry pairs a rendered wav with a (token, vocabulary) key.',
    ' * Runtime lookup: `sustainedClipFor({ token, vocabulary })`.',
    ' * A block whose `voicePolicy.contentKind === "sustained-instruction"`',
    ' * and `repeatFrequency === "once-per-cue"` fires this clip ONCE at',
    ' * cue start and stays silent for the block interior.',
    ' */',
    '',
    '/* eslint-disable @typescript-eslint/no-require-imports */',
    '',
    "import type { StrikeToken } from '@domain/strikes/strikeCatalog'",
    '',
    'export type SustainedVocabulary = \'numbers\' | \'techniques\'',
    '',
    'export interface SustainedClip {',
    '  id: string',
    '  token: StrikeToken',
    '  vocabulary: SustainedVocabulary',
    '  /** The exact rendered text (for diagnostics + fit-check). */',
    '  text: string',
    '  /** Metro module id for the wav. */',
    '  module: number',
    '  /** Measured duration of the rendered clip, in milliseconds. */',
    '  durationMs: number',
    '}',
    '',
    'export const SUSTAINED_CLIPS: readonly SustainedClip[] = [',
  ]
  for (const clip of have) {
    const durationMs = measureDuration(join(OUT_DIR, `${clip.id}.wav`))
    lines.push(
      `  { id: '${clip.id}', token: '${clip.token}', vocabulary: '${clip.vocabulary}', text: ${JSON.stringify(clip.text)}, module: require('../../../assets/voice/numbers/standalone/${clip.id}.wav'), durationMs: ${durationMs} },`,
    )
  }
  lines.push(
    ']',
    '',
    '/**',
    ' * The sustained-instruction clip for a (token, vocabulary) pair,',
    ' * or undefined when none was rendered. Matches exactly on both',
    ' * fields — no cross-vocab fallback: if a vocabulary is missing a',
    ' * clip, the runtime is expected to know and stay silent rather',
    ' * than say the wrong dialect.',
    ' */',
    'export function sustainedClipFor(',
    '  key: { token: StrikeToken; vocabulary: SustainedVocabulary },',
    '): SustainedClip | undefined {',
    '  return SUSTAINED_CLIPS.find(',
    '    (c) => c.token === key.token && c.vocabulary === key.vocabulary,',
    '  )',
    '}',
    '',
    '/* eslint-enable @typescript-eslint/no-require-imports */',
    '',
  )
  writeFileSync(join('src', 'audio', 'voiceAssets', 'sustainedManifest.ts'), lines.join('\n'))
  console.log(`Wrote sustainedManifest.ts (${have.length}/${sustained.length} clips)`)
}

if (manifestOnly) {
  writeManifest()
  process.exit(0)
}

const FFMPEG = findFfmpeg()

const jobs = sustained.filter((s) => !only || only.has(s.id)).map((clip) => {
  const plan = compileAdlib(clip.text, {
    performance: 'teach',
    expression: PRODUCTION_EXPRESSION,
    finish: 'land',
  })
  return { ...clip, plan, wav: join(process.cwd(), OUT_DIR, `${clip.id}.wav`) }
})

console.log(`Rendering ${jobs.length} sustained clips — ${RENDERER}…`)
const renderOut = execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
  input: JSON.stringify({
    reference: REFERENCE_VOICE,
    // GPU rig is not the bottleneck (Kyle 2026-08-30) — attempts
    // matters more than throughput. 16 gives the keep-better sampler
    // real room to reject flat/rushed takes on short imperatives.
    attempts: 16,
    jobs: jobs.map((j) => ({
      path: j.wav,
      text: j.plan.renderedText,
      ...CALM,
      // A sustained instruction is one short imperative sentence —
      // reject fragments and runaways. The 3200 ms ceiling is generous
      // enough for "Pump the rear body uppercut." at teach cadence.
      minDurationMs: 900,
      maxDurationMs: 3_200,
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
