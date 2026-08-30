/**
 * Coasting coach lines — intros + check-ins (M39-V2 Phase 4b).
 *
 * A count-scored block (active-recovery / volume-burst / open-pressure)
 * gets ONE `coast-intro` at cue start and N `coast-checkin`s at
 * authored fractions of the block's duration. Timing is a per-event
 * choice: rhythm reinforcements sync to the next pulse tick;
 * time-remaining warnings float independent so "ten seconds" doesn't
 * become "twelve seconds" waiting for a beat.
 *
 * Rendered per the coasting-design scout (Aug 30 2026):
 *   - `intensity: 'calm'` → CALM+teach+land (AR intros + AR check-ins)
 *   - `intensity: 'push'` → PUSH+shout (VB starts / rhythm pushes / OP)
 *
 * Files land in the existing `assets/voice/numbers/standalone/`
 * directory (single-directory rule — see `make-recovery-clips.mjs`).
 *
 * Run: node tools/voice/make-coast-clips.mjs [--only-ids=co-ar-intro-01,...]
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

/**
 * CALM cornerman preset (from make-recovery-clips.mjs / matches the
 * sustained-instruction batch). Same tone for AR intros + AR
 * check-ins where the point is to breathe rather than to bark.
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
  console.error('Coast rendering expects the chatterbox persona.')
  process.exit(1)
}

const { coast } = JSON.parse(
  readFileSync(join('tools', 'voice', 'coast.json'), 'utf8'),
)

const onlyArg = process.argv.find((a) => a.startsWith('--only-ids='))?.slice('--only-ids='.length)
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null
const manifestOnly = process.argv.includes('--manifest-only')

function writeManifest() {
  const have = coast.filter((s) => existsSync(join(OUT_DIR, `${s.id}.wav`)))
  const lines = [
    '/**',
    ' * Coasting coach lines (generated; M39-V2 Phase 4b).',
    ' *',
    ' * DO NOT EDIT — produced by `node tools/voice/make-coast-clips.mjs`.',
    ' *',
    ' * Each entry pairs a rendered wav with a scoped slot. `blockKind`',
    ' * scopes the intro/check-in to a count-scored block type;',
    ' * `role` is intro (one at cue start) vs checkin (authored fraction',
    ' * of block duration); `timing` is synchronized (align to next',
    ' * pulse) or independent (fire when its tick arrives, unaligned).',
    ' *',
    ' * The compiler resolves check-in placements at compileCue time:',
    ' *   `atTick = blockStartTick + Math.round(blockDurationTicks × atFraction)`',
    ' */',
    '',
    '/* eslint-disable @typescript-eslint/no-require-imports */',
    '',
    "export type CoastBlockKind = 'active-recovery' | 'volume-burst' | 'open-pressure'",
    "export type CoastRole = 'intro' | 'checkin'",
    "export type CoastTiming = 'synchronized' | 'independent'",
    '',
    'export interface CoastClip {',
    '  id: string',
    '  blockKind: CoastBlockKind',
    '  role: CoastRole',
    '  /** A named slot inside the block (opener / early / mid / late / ...). */',
    '  slot: string',
    '  /** Design position 0..1 as a fraction of block duration. Intros are 0.0. */',
    '  atFraction: number',
    '  /** Whether the compiler should pulse-align this event. Null for intros. */',
    '  timing: CoastTiming | null',
    '  /** The exact rendered text (for diagnostics + fit-check). */',
    '  text: string',
    '  /** Metro module id for the wav. */',
    '  module: number',
    '  /** Measured duration of the rendered clip, in milliseconds. */',
    '  durationMs: number',
    '}',
    '',
    'export const COAST_CLIPS: readonly CoastClip[] = [',
  ]
  for (const clip of have) {
    const durationMs = measureDuration(join(OUT_DIR, `${clip.id}.wav`))
    const timingLit = clip.timing === null ? 'null' : `'${clip.timing}'`
    lines.push(
      `  { id: '${clip.id}', blockKind: '${clip.blockKind}', role: '${clip.role}', slot: '${clip.slot}', atFraction: ${clip.atFraction}, timing: ${timingLit}, text: ${JSON.stringify(clip.text)}, module: require('../../../assets/voice/numbers/standalone/${clip.id}.wav'), durationMs: ${durationMs} },`,
    )
  }
  lines.push(
    ']',
    '',
    '/**',
    ' * Every rendered clip that could open a given block kind (role = intro).',
    ' * The runtime picks one — random rotation, or authored per-cue.',
    ' */',
    'export function coastIntrosFor(blockKind: CoastBlockKind): readonly CoastClip[] {',
    '  return COAST_CLIPS.filter((c) => c.blockKind === blockKind && c.role === \'intro\')',
    '}',
    '',
    '/**',
    ' * Every rendered check-in for a block kind, in ascending atFraction',
    ' * order. The compiler groups by slot and picks one per slot per rep.',
    ' */',
    'export function coastCheckinsFor(blockKind: CoastBlockKind): readonly CoastClip[] {',
    '  return COAST_CLIPS.filter((c) => c.blockKind === blockKind && c.role === \'checkin\').slice().sort(',
    '    (a, b) => a.atFraction - b.atFraction,',
    '  )',
    '}',
    '',
    '/* eslint-enable @typescript-eslint/no-require-imports */',
    '',
  )
  writeFileSync(join('src', 'audio', 'voiceAssets', 'coastManifest.ts'), lines.join('\n'))
  console.log(`Wrote coastManifest.ts (${have.length}/${coast.length} clips)`)
}

if (manifestOnly) {
  writeManifest()
  process.exit(0)
}

const FFMPEG = findFfmpeg()

const jobs = coast.filter((s) => !only || only.has(s.id)).map((clip) => {
  // CALM lines use `teach` + `land` so the phrase settles into the
  // several-second breathing window the athlete is entering. PUSH
  // lines use production `push` + `shout` — same shape as combo-announce.
  const plan =
    clip.intensity === 'calm'
      ? compileAdlib(clip.text, {
          performance: 'teach',
          expression: PRODUCTION_EXPRESSION,
          finish: 'land',
        })
      : compileAdlib(clip.text, {
          performance: 'push',
          expression: PRODUCTION_EXPRESSION,
          finish: PRODUCTION_FINISH,
        })
  return { ...clip, plan, wav: join(process.cwd(), OUT_DIR, `${clip.id}.wav`) }
})

console.log(`Rendering ${jobs.length} coast clips — ${RENDERER}…`)
const renderOut = execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
  input: JSON.stringify({
    reference: REFERENCE_VOICE,
    attempts: 16,
    jobs: jobs.map((j) => ({
      path: j.wav,
      text: j.plan.renderedText,
      ...(j.intensity === 'calm' ? CALM : (EXAGGERATION.push ?? {})),
      minDurationMs: j.intensity === 'calm' ? 700 : 400,
      maxDurationMs: 3_600,
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

writeManifest()
