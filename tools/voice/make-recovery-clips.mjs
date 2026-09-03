/**
 * Inter-round recovery walkthroughs — the cornerman working the corner
 * during the 1-minute rest.
 *
 * Renders every segment of every script in `tools/voice/recovery.json`
 * as ONE wav per segment (paused holds are shipped as real silence
 * tracks — see `silenceManifest.ts` — never faked by synthesizing
 * dead air into the WAV, per the corpus's timing rule). Each script
 * plays back through `RecoveryPlayer` on a single native playlist
 * (segment / silence / segment / silence / …) using the doctrine
 * `IntroPlayer` locked in: no JS in the sequencing loop.
 *
 * Files land in the existing `assets/voice/numbers/standalone/`
 * directory. **Adding a new directory under `assets/` breaks Metro's
 * Windows file map** and it does not recover — a recovery segment is
 * not a call, but it lives beside the openers for that reason. (The
 * jokes that used to live here were retired 2026-08-30, but the
 * "one-directory" rule survives them.)
 *
 * Delivery direction (corpus, verbatim): "old-school cornerman;
 * dramatically aged, caring, calm, and authoritative. Use less
 * sing-song movement than active punch combinations. During holds,
 * lower the vocal energy and allow silence. Finish with a slightly
 * firmer readiness cue, without shouting." So this batch renders at
 * calm settings — quieter than the work shout — and the LAST segment
 * of every script gets a nudge of extra intensity for that final
 * readiness cue, still short of a shout.
 *
 * Run: node tools/voice/make-recovery-clips.mjs [--only-ids=rec-r01,...]
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
 * Calm cornerman settings for the corner: lower exaggeration than the
 * production work shout, cfg tightened up for text fidelity (a hold
 * instruction that mishears sends the athlete's body the wrong way).
 * `quiet_cornerman` scripts (breath resets) go one notch calmer;
 * every script's LAST segment carries the corpus's "firmer readiness
 * cue, without shouting."
 */
const CALM = { exaggeration: 0.7, cfgWeight: 0.5 }
const QUIET = { exaggeration: 0.6, cfgWeight: 0.55 }
const READY = { exaggeration: 0.85, cfgWeight: 0.45 }

function intensityFor(script, segmentIndex, segmentCount) {
  if (segmentIndex === segmentCount - 1) return READY
  if (script.deliveryMode === 'quiet_cornerman') return QUIET
  return CALM
}

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
  console.error('Recovery rendering expects the chatterbox persona.')
  process.exit(1)
}

const onlyArg = process.argv.find((a) => a.startsWith('--only-ids='))?.slice('--only-ids='.length)
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null

const manifestOnly = process.argv.includes('--manifest-only')

const corpus = JSON.parse(readFileSync(join('tools', 'voice', 'recovery.json'), 'utf8'))
const MAX_TOTAL_MS = Math.round((corpus.restWindow?.maximumScriptDurationSec ?? 45) * 1000)

/**
 * Build every job. Each segment gets its own wav; the manifest carries
 * the `pauseAfterMs` from the corpus and the RecoveryPlayer ships each
 * pause as a real silence track between segments.
 */
const allJobs = []
for (const script of corpus.scripts) {
  if (only && !only.has(script.id.toLowerCase())) continue
  for (let s = 0; s < script.segments.length; s += 1) {
    const segment = script.segments[s]
    const plan = compileAdlib(segment.text, {
      performance: 'work',
      expression: PRODUCTION_EXPRESSION,
      finish: 'land',
    })
    const id = `rec-${script.id.toLowerCase()}-s${s + 1}`
    allJobs.push({
      id,
      scriptId: script.id,
      segmentIndex: s,
      segmentCount: script.segments.length,
      pauseAfterMs: segment.pauseAfterMs,
      script,
      plan,
      wav: join(process.cwd(), OUT_DIR, `${id}.wav`),
    })
  }
}

function writeManifest() {
  const lines = [
    '/**',
    " * Inter-round recovery walkthroughs (generated from tools/voice/recovery.json).",
    ' *',
    ' * One entry per script; each script is a sequence of pre-rendered',
    ' * segments and scheduled pauses between them. `RecoveryPlayer` builds',
    ' * a single native audio playlist per rest: segment, silence, segment,',
    ' * silence, ... — the pauses are shipped as real silence assets so no',
    ' * JavaScript sequences the audio at run time.',
    ' *',
    ' * Scripts whose measured total exceeds the corpus cap',
    ` * (${MAX_TOTAL_MS} ms) are EXCLUDED from the manifest; a build-time`,
    ' * console error names them.',
    ' *',
    ' * DO NOT EDIT — regenerate with `node tools/voice/make-recovery-clips.mjs`.',
    ' */',
    '',
    '/* eslint-disable @typescript-eslint/no-require-imports */',
    '',
    'export interface RecoverySegmentClip {',
    '  /** Metro module id for the segment wav. */',
    '  module: number',
    '  /** Measured duration of the rendered segment, in milliseconds. */',
    '  durationMs: number',
    "  /** Held silence to schedule AFTER this segment (from the corpus). */",
    '  pauseAfterMs: number',
    '}',
    '',
    'export interface RecoveryScript {',
    '  scriptId: string',
    '  title: string',
    '  category: string',
    '  tags: readonly string[]',
    '  hydrationPrompt: boolean',
    '  requiresStableBag: boolean',
    '  avoidIfDizzy: boolean',
    '  segments: readonly RecoverySegmentClip[]',
    "  /** Sum of measured segment durations plus scheduled pauses. */",
    '  measuredTotalMs: number',
    '  corpusVersion: string',
    '}',
    '',
    'export const RECOVERY_SCRIPTS: readonly RecoveryScript[] = [',
  ]

  const excluded = []
  for (const script of corpus.scripts) {
    const segments = script.segments.map((segment, s) => {
      const id = `rec-${script.id.toLowerCase()}-s${s + 1}`
      const path = join(process.cwd(), OUT_DIR, `${id}.wav`)
      return { id, path, pauseAfterMs: segment.pauseAfterMs }
    })
    if (!segments.every((seg) => existsSync(seg.path))) {
      excluded.push([script.id, 'segments missing on disk'])
      continue
    }
    const durations = segments.map((seg) => measureDuration(seg.path))
    const measuredTotalMs =
      durations.reduce((sum, d) => sum + d, 0) +
      segments.reduce((sum, seg) => sum + seg.pauseAfterMs, 0)
    if (measuredTotalMs > MAX_TOTAL_MS) {
      excluded.push([script.id, `${measuredTotalMs} ms > ${MAX_TOTAL_MS} ms cap`])
      continue
    }
    lines.push(
      '  {',
      `    scriptId: ${JSON.stringify(script.id)},`,
      `    title: ${JSON.stringify(script.title)},`,
      `    category: ${JSON.stringify(script.category)},`,
      `    tags: ${JSON.stringify(script.tags)},`,
      `    hydrationPrompt: ${script.hydrationPrompt},`,
      `    requiresStableBag: ${script.requiresStableBag},`,
      `    avoidIfDizzy: ${script.avoidIfDizzy},`,
      '    segments: [',
    )
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i]
      lines.push(
        `      { module: require('../../../${OUT_DIR.replaceAll('\\', '/')}/${seg.id}.wav'), durationMs: ${durations[i]}, pauseAfterMs: ${seg.pauseAfterMs} },`,
      )
    }
    lines.push(
      '    ],',
      `    measuredTotalMs: ${measuredTotalMs},`,
      `    corpusVersion: ${JSON.stringify(corpus.corpusId)},`,
      '  },',
    )
  }
  lines.push(
    ']',
    '',
    '/* eslint-enable @typescript-eslint/no-require-imports */',
    '',
  )
  writeFileSync(
    join('src', 'audio', 'voiceAssets', 'recoveryManifest.ts'),
    lines.join('\n'),
  )
  const kept = corpus.scripts.length - excluded.length
  console.log(
    `Wrote recoveryManifest.ts (${kept}/${corpus.scripts.length} scripts within ${MAX_TOTAL_MS} ms cap)`,
  )
  for (const [id, reason] of excluded) {
    console.error(`  EXCLUDED ${id}: ${reason}`)
  }
}

if (manifestOnly) {
  writeManifest()
  process.exit(0)
}

const FFMPEG = findFfmpeg()

console.log(`Rendering ${allJobs.length} recovery segments — ${RENDERER}…`)
const renderOut = execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
  input: JSON.stringify({
    reference: REFERENCE_VOICE,
    attempts: 8,
    jobs: allJobs.map((j) => ({
      path: j.wav,
      text: j.plan.renderedText,
      ...intensityFor(j.script, j.segmentIndex, j.segmentCount),
      // A recovery segment is one calm sentence; the window rejects
      // fragments and runaways without policing pace.
      minDurationMs: 1_500,
      maxDurationMs: 12_000,
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
for (const job of allJobs) {
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
console.log(
  `Wrote ${allJobs.filter((j) => existsSync(j.wav)).length}/${allJobs.length} segments to ${OUT_DIR}`,
)
writeManifest()
