/**
 * Cornerman lobby jokes — rendered clips, told in the persona's own voice.
 *
 * Jokes play ONLY in the pre-fight lobby (one per workout, max), never
 * inside a round and never on the rhythm map — Kyle's constraint is that
 * personality must never offset the map, and the lobby is outside the work
 * window by construction. They are long conversational sentences, which is
 * Chatterbox's STABLE regime (the instability lives in short shouts), and
 * every take passes the same ASR gate as the calls: a joke the voice
 * garbles is worse than no joke.
 *
 * No tempo fit and no shout finish — a joke lands dry, at talking pace.
 * Files render into the existing numbers/standalone directory (adding a
 * new directory under assets/ breaks Metro's Windows file map) and are
 * addressed by `src/audio/voiceAssets/jokeManifest.ts`, outside the
 * VoiceAssetId vocabulary: a joke is not a call.
 *
 * Run: node tools/voice/make-joke-clips.mjs [--only-ids=joke-01,...]
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
  PRODUCTION_TEXTURE,
  REFERENCE_VOICE,
  RENDERER,
} from './persona.mjs'
import { trimEnds, renameWithRetry } from './wav.mjs'

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

const FFMPEG = findFfmpeg()
const CHATTERBOX_PYTHON =
  process.env.CHATTERBOX_PYTHON ?? 'F:/voice-tools/venv/Scripts/python.exe'

if (ENGINE !== 'chatterbox') {
  console.error('Joke rendering expects the chatterbox persona.')
  process.exit(1)
}

const onlyArg = process.argv.find((a) => a.startsWith('--only-ids='))?.slice('--only-ids='.length)
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim())) : null

const { jokes } = JSON.parse(readFileSync(join('tools', 'voice', 'jokes.json'), 'utf8'))
const jobs = jokes
  .filter((j) => !only || only.has(j.id))
  .map((joke) => {
    // Conversational: work-state delivery, landed (not shouted) finish.
    const plan = compileAdlib(joke.text, {
      performance: 'work',
      expression: PRODUCTION_EXPRESSION,
      finish: 'land',
    })
    return { ...joke, plan, wav: join(process.cwd(), OUT_DIR, `${joke.id}.wav`) }
  })

console.log(`Rendering ${jobs.length} lobby jokes — ${RENDERER}…`)
const renderOut = execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
  input: JSON.stringify({
    reference: REFERENCE_VOICE,
    attempts: 8,
    jobs: jobs.map((j) => ({
      path: j.wav,
      text: j.plan.renderedText,
      ...(EXAGGERATION.work ?? {}),
      // A joke runs 6-14 s; the window just rejects fragments and runaways.
      minDurationMs: 4_000,
      maxDurationMs: 18_000,
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

// No tempo fit — a joke is told at talking pace. Trim, then the broadcast
// texture so it sits in the same sonic space as the calls.
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
console.log(`Wrote ${jobs.filter((j) => existsSync(j.wav)).length}/${jobs.length} jokes to ${OUT_DIR}`)
