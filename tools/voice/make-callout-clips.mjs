/**
 * Set-ceremony call-outs — the coach procuring every set.
 *
 * Renders the sentences in `tools/voice/callouts.json`:
 *
 * - `inRound` — pre-set call-outs ("Okay, get ready — ones and twos!")
 *   plus the two ceremony tails. These become VoiceAssetIds: rendered
 *   once into numbers/standalone, then COPIED to the other three
 *   manifest directories (numbers/combo, names/standalone, names/combo)
 *   — automating what gong and power-strikes did by hand — because the
 *   manifest's directory guard requires each vocabulary to own its file.
 * - `themes` — rest-side ladder-name clips ("Coming up — the Square
 *   Builder!") played by RoundWarningPlayer; NOT VoiceAssetIds.
 *
 * Writes `src/audio/voiceAssets/calloutManifest.ts` with MEASURED
 * durations (the fill's ceremony reservations and the map compiler's
 * placement are arithmetic on them) and the four per-directory require
 * maps that `manifest.ts` spreads into its sections.
 *
 * Run: node tools/voice/make-callout-clips.mjs [--only-ids=...] [--manifest-only]
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { compileAdlib } from './prosody.mjs'
import { textureChain } from './texture.mjs'
import {
  ENGINE,
  EXAGGERATION,
  OUT_SAMPLE_RATE,
  PRODUCTION_EXPRESSION,
  PRODUCTION_TEXTURE,
  REFERENCE_VOICE,
  RENDERER,
} from './persona.mjs'
import { measureDuration, trimEnds, renameWithRetry } from './wav.mjs'

const OUT_DIR = join('assets', 'voice', 'numbers', 'standalone')
const COPY_DIRS = [
  join('assets', 'voice', 'numbers', 'combo'),
  join('assets', 'voice', 'names', 'standalone'),
  join('assets', 'voice', 'names', 'combo'),
]

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
  console.error('Callout rendering expects the chatterbox persona.')
  process.exit(1)
}

const { inRound, themes } = JSON.parse(
  readFileSync(join('tools', 'voice', 'callouts.json'), 'utf8'),
)
const ALL = [...inRound, ...themes]

const onlyArg = process.argv.find((a) => a.startsWith('--only-ids='))?.slice('--only-ids='.length)
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null
const manifestOnly = process.argv.includes('--manifest-only')

// The manifest is always rebuilt over the FULL list from what exists on
// disk, so a partial render never truncates it.
function writeManifest() {
  const lines = [
    '/**',
    ' * Set-ceremony call-out clips (generated).',
    ' *',
    ' * DO NOT EDIT — produced by `node tools/voice/make-callout-clips.mjs`.',
    ' * Durations are measured from the rendered files; the fill reserves',
    " * ceremony time and the map compiler places events from these numbers.",
    ' */',
    '',
    '/* eslint-disable @typescript-eslint/no-require-imports */',
    '',
    '/** Every in-round call-out clip id — a subset of VoiceAssetId. */',
    'export type CalloutClipId =',
  ]
  const haveInRound = inRound.filter((s) => existsSync(join(OUT_DIR, `${s.id}.wav`)))
  for (const clip of haveInRound) lines.push(`  | '${clip.id}'`)
  lines.push(
    '',
    '/** In-round call-out sentence durations, keyed by VoiceAssetId. */',
    'export const CALLOUT_CLIPS: Readonly<Record<CalloutClipId, { durationMs: number }>> = {',
  )
  for (const clip of haveInRound) {
    const durationMs = measureDuration(join(OUT_DIR, `${clip.id}.wav`))
    lines.push(`  '${clip.id}': { durationMs: ${durationMs} },`)
  }
  lines.push('}', '')

  // Per-directory require maps, spread into manifest.ts's four sections —
  // each vocabulary points at its own copy (the directory guard's rule).
  const dirs = [
    ['CALLOUT_REQUIRES_NUMBERS_STANDALONE', 'numbers/standalone'],
    ['CALLOUT_REQUIRES_NUMBERS_COMBO', 'numbers/combo'],
    ['CALLOUT_REQUIRES_NAMES_STANDALONE', 'names/standalone'],
    ['CALLOUT_REQUIRES_NAMES_COMBO', 'names/combo'],
  ]
  for (const [name, dir] of dirs) {
    lines.push(`export const ${name}: Readonly<Record<CalloutClipId, number>> = {`)
    for (const clip of haveInRound) {
      lines.push(
        `  '${clip.id}': require('../../../assets/voice/${dir}/${clip.id}.wav'),`,
      )
    }
    lines.push('}', '')
  }

  lines.push(
    '/** Rest-side theme clips ("Coming up — the Square Builder!"). */',
    'export interface ThemeClip {',
    '  id: string',
    '  theme: string',
    '  module: number',
    '  durationMs: number',
    '}',
    '',
    'export const THEME_CLIPS: readonly ThemeClip[] = [',
  )
  for (const clip of themes.filter((s) => existsSync(join(OUT_DIR, `${s.id}.wav`)))) {
    const durationMs = measureDuration(join(OUT_DIR, `${clip.id}.wav`))
    lines.push(
      `  { id: '${clip.id}', theme: ${JSON.stringify(clip.theme)}, module: require('../../../assets/voice/numbers/standalone/${clip.id}.wav'), durationMs: ${durationMs} },`,
    )
  }
  lines.push(
    ']',
    '',
    '/** The clip for a round theme, or undefined when none was rendered. */',
    'export function themeClipFor(theme: string): ThemeClip | undefined {',
    '  return THEME_CLIPS.find((c) => c.theme === theme)',
    '}',
    '',
    '/* eslint-enable @typescript-eslint/no-require-imports */',
    '',
  )
  writeFileSync(join('src', 'audio', 'voiceAssets', 'calloutManifest.ts'), lines.join('\n'))
  console.log(
    `Wrote calloutManifest.ts (${haveInRound.length}/${inRound.length} in-round, ${themes.filter((s) => existsSync(join(OUT_DIR, `${s.id}.wav`))).length}/${themes.length} themes)`,
  )
}

if (manifestOnly) {
  writeManifest()
  process.exit(0)
}

const FFMPEG = findFfmpeg()
const jobs = ALL.filter((s) => !only || only.has(s.id)).map((clip) => {
  const plan = compileAdlib(clip.text, {
    performance: 'work',
    expression: PRODUCTION_EXPRESSION,
    finish: 'land',
  })
  return { ...clip, plan, wav: join(process.cwd(), OUT_DIR, `${clip.id}.wav`) }
})

console.log(`Rendering ${jobs.length} callout clips — ${RENDERER}…`)
const renderOut = execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
  input: JSON.stringify({
    reference: REFERENCE_VOICE,
    attempts: 8,
    jobs: jobs.map((j) => ({
      path: j.wav,
      text: j.plan.renderedText,
      ...(EXAGGERATION.work ?? {}),
      minDurationMs: 700,
      maxDurationMs: 9_000,
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
    // The persona's rate, not a literal. The theme clips this emits sit in
    // the round-warning playlist between 48 kHz openers and cores; at 24 kHz
    // every boundary around them was a format renegotiation (plan 5b).
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', job.wav, '-af', filters,
      '-ar', OUT_SAMPLE_RATE, '-ac', '1', temp],
    { stdio: 'ignore' },
  )
  if (existsSync(temp)) renameWithRetry(temp, job.wav)
}

// In-round clips exist in all four manifest directories.
let copied = 0
for (const clip of inRound) {
  const src = join(OUT_DIR, `${clip.id}.wav`)
  if (!existsSync(src)) continue
  for (const dir of COPY_DIRS) {
    copyFileSync(src, join(dir, `${clip.id}.wav`))
    copied += 1
  }
}
console.log(`Copied ${copied} files across manifest directories`)

writeManifest()
