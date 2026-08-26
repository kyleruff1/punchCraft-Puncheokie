/**
 * Workout intro segments — the coach's walkout announcement.
 *
 * "Hello! Welcome to punch craft. I'm your coach, Jonathan punch craft.
 * Today, we're boxing six rounds of four minutes each… Let's get
 * started!" — played during an EXTENDED pre-round
 * countdown, so the first bell waits for the coach and the rhythm map is
 * never touched (the work clock starts at the bell, as always).
 *
 * The variation space stays finite by composition: the intro is a SEQUENCE
 * of whole-sentence clips (D16 — no runtime stitching inside a sentence),
 * one per setting axis, not one clip per combination of settings:
 *
 *   intro-hello                          1
 *   intro-rounds-{2..12}                11   (round count; length/rest fixed by D21)
 *   intro-program-{tier}-{cadence}      12   (3 tiers x 4 cadence bands)
 *   intro-letsgo                         1
 *
 * Renders into the existing numbers/standalone directory (a new directory
 * under assets/ breaks Metro's Windows file map) and WRITES
 * `src/audio/voiceAssets/introManifest.ts` with measured durations — the
 * countdown offset is computed from those numbers, so the manifest must
 * never guess.
 *
 * Run: node tools/voice/make-intro-clips.mjs [--only-ids=...]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
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

const NUMBER_WORDS = {
  2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven',
  8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve',
}

const TIER_LINES = {
  beginner: 'beginner fundamentals, building your foundation',
  intermediate: 'intermediate combinations, body work and counters',
  advanced: 'advanced chains, multi phase patterns and pressure',
}

const PACE_WORDS = {
  technical: 'technical',
  steady: 'steady',
  pressure: 'driving',
  sprint: 'sprint',
}

const SEGMENTS = []
// "Jonathan" over Kyle's "Johnathan": Whisper normalizes to the common
// spelling, and the ASR gate would flunk a take over a silent H.
SEGMENTS.push({
  id: 'intro-hello',
  text: "Hello! Welcome to punch craft. I'm your coach, Jonathan punch craft.",
})
for (const [n, word] of Object.entries(NUMBER_WORDS)) {
  SEGMENTS.push({
    id: `intro-rounds-${n}`,
    text: `Today, we're boxing ${word} rounds of four minutes each, with one minute of rest between rounds.`,
  })
}
for (const [tier, line] of Object.entries(TIER_LINES)) {
  for (const [cadence, pace] of Object.entries(PACE_WORDS)) {
    SEGMENTS.push({
      id: `intro-program-${tier}-${cadence}`,
      text: `Today's program: ${line}, at a ${pace} pace.`,
    })
  }
}
SEGMENTS.push({ id: 'intro-letsgo', text: "Let's get started!" })

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

const FFMPEG = findFfmpeg()
const CHATTERBOX_PYTHON =
  process.env.CHATTERBOX_PYTHON ?? 'F:/voice-tools/venv/Scripts/python.exe'

if (ENGINE !== 'chatterbox') {
  console.error('Intro rendering expects the chatterbox persona.')
  process.exit(1)
}

const onlyArg = process.argv.find((a) => a.startsWith('--only-ids='))?.slice('--only-ids='.length)
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null

const jobs = SEGMENTS.filter((s) => !only || only.has(s.id)).map((segment) => {
  const plan = compileAdlib(segment.text, {
    performance: 'work',
    expression: PRODUCTION_EXPRESSION,
    finish: 'land',
  })
  return { ...segment, plan, wav: join(process.cwd(), OUT_DIR, `${segment.id}.wav`) }
})

console.log(`Rendering ${jobs.length} intro segments — ${RENDERER}…`)
const renderOut = execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
  input: JSON.stringify({
    reference: REFERENCE_VOICE,
    attempts: 8,
    jobs: jobs.map((j) => ({
      path: j.wav,
      text: j.plan.renderedText,
      ...(EXAGGERATION.work ?? {}),
      minDurationMs: 900,
      maxDurationMs: 14_000,
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

// The manifest carries MEASURED durations — the countdown offset is
// arithmetic on these, so a guessed number would misplace the first bell.
// Always rebuilt over the full segment list from what exists on disk.
const entries = SEGMENTS.filter((s) => existsSync(join(process.cwd(), OUT_DIR, `${s.id}.wav`)))
const lines = [
  '/**',
  ' * Workout intro segments (generated).',
  ' *',
  " * DO NOT EDIT — produced by `node tools/voice/make-intro-clips.mjs`.",
  ' * Durations are measured from the rendered files; the pre-round',
  ' * countdown offset is computed from them.',
  ' */',
  '',
  '/* eslint-disable @typescript-eslint/no-require-imports */',
  '',
  'export interface IntroSegment {',
  '  id: string',
  '  /** Metro module id for the clip. */',
  '  module: number',
  '  durationMs: number',
  '}',
  '',
  'export const INTRO_SEGMENTS: Readonly<Record<string, IntroSegment>> = {',
]
for (const segment of entries) {
  const durationMs = measureDuration(join(process.cwd(), OUT_DIR, `${segment.id}.wav`))
  lines.push(
    `  '${segment.id}': { id: '${segment.id}', module: require('../../../assets/voice/numbers/standalone/${segment.id}.wav'), durationMs: ${durationMs} },`,
  )
}
lines.push('}', '', '/* eslint-enable @typescript-eslint/no-require-imports */', '')
writeFileSync(join('src', 'audio', 'voiceAssets', 'introManifest.ts'), lines.join('\n'))
console.log(`Wrote ${entries.length}/${SEGMENTS.length} segments + introManifest.ts`)
