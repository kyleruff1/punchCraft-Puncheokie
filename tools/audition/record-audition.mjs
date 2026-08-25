/**
 * Record a full clip audition through the condenser mic, adb-driven.
 *
 * Orchestrates the Tier-1 pass end to end: clears logcat, starts an ffmpeg
 * dshow capture from the Focusrite, launches the dev clip-audition screen on
 * the tablet via deep link, tails logcat for the screen's AUDITION lines, and
 * on "done" stops the capture cleanly (a `q` on stdin — killing ffmpeg
 * corrupts the WAV header) and writes the playlog beside it.
 *
 * Output (default tools/analysis/captures/<ts>/):
 *   capture.wav   48 kHz mono room recording
 *   playlog.json  {startedEpochMs, events:[{event,key,index,atMs,epochMs}]}
 *
 * Then: F:/voice-tools/venv/Scripts/python.exe tools/audition/validate_capture.py
 *
 * Modes:
 *   node tools/audition/record-audition.mjs                 full library
 *   node tools/audition/record-audition.mjs --keys=a,b,c    subset re-audit
 *   node tools/audition/record-audition.mjs --level-check   5s mic level print
 */

import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DEVICE_NAME = process.env.AUDITION_MIC ?? 'Analogue 1 + 2 (16- Focusrite USB Audio)'
const MAX_RUN_MS = 25 * 60 * 1000

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)

function ffmpegArgs(outPath, extra = []) {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'dshow', '-rtbufsize', '256M',
    '-i', `audio=${DEVICE_NAME}`,
    ...extra,
    '-ac', '1', '-ar', '48000', '-y', outPath,
  ]
}

if (process.argv.includes('--level-check')) {
  const out = join(process.env.TEMP ?? '.', 'audition-level-check.wav')
  console.log('Recording 5s — make noise at workout level…')
  execFileSync('ffmpeg', ffmpegArgs(out, ['-t', '5']), { stdio: 'inherit' })
  // volumedetect reports on stderr.
  const probe = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-i', out, '-af', 'volumedetect', '-f', 'null', '-'],
    { encoding: 'utf8' },
  )
  const lines = `${probe.stderr}`.split('\n').filter((l) => /mean_volume|max_volume/.test(l))
  console.log(lines.join('\n') || probe.stderr)
  console.log('Aim for max_volume around -6 to -3 dB at the loudest; adjust the Focusrite gain.')
  process.exit(0)
}

const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
const outDir = arg('out') ?? join('tools', 'analysis', 'captures', ts)
mkdirSync(outDir, { recursive: true })
const capturePath = join(outDir, 'capture.wav')

console.log(`Capture -> ${capturePath}`)
execFileSync('adb', ['logcat', '-c'])

const startedEpochMs = Date.now()
const ffmpeg = spawn('ffmpeg', ffmpegArgs(capturePath), { stdio: ['pipe', 'inherit', 'inherit'] })
const logcat = spawn('adb', ['logcat', '-v', 'epoch', '-s', 'ReactNativeJS:I'])

const events = []
let done = false

function finish(reason) {
  if (done) return
  done = true
  console.log(`Stopping (${reason}) — ${events.length} events captured.`)
  try {
    logcat.kill()
  } catch {
    /* gone */
  }
  try {
    ffmpeg.stdin.write('q')
  } catch {
    /* gone */
  }
  setTimeout(() => {
    writeFileSync(
      join(outDir, 'playlog.json'),
      `${JSON.stringify({ startedEpochMs, deviceName: DEVICE_NAME, events }, null, 1)}\n`,
    )
    console.log(`Wrote ${join(outDir, 'playlog.json')}`)
    console.log('Next: F:/voice-tools/venv/Scripts/python.exe tools/audition/validate_capture.py ' +
      `--capture ${capturePath} --playlog ${join(outDir, 'playlog.json')}`)
    process.exit(0)
  }, 1500)
}

let buffer = ''
logcat.stdout.on('data', (chunk) => {
  buffer += chunk.toString()
  const lines = buffer.split('\n')
  buffer = lines.pop() ?? ''
  for (const line of lines) {
    const match = line.match(/AUDITION (\{.*\})/)
    if (!match) continue
    try {
      const payload = JSON.parse(match[1])
      const epoch = line.match(/^\s*(\d+\.\d+)/)
      events.push({ ...payload, epochMs: epoch ? Math.round(Number(epoch[1]) * 1000) : null })
      if (payload.event === 'play') {
        console.log(`  ${String(payload.index + 1).padStart(3)} ${payload.key}`)
      }
      if (payload.event === 'done') finish('audition done')
    } catch {
      // Not ours.
    }
  }
})

setTimeout(() => finish('timeout'), MAX_RUN_MS)
process.on('SIGINT', () => finish('interrupted'))

// Capture and log tail are live — now start the audition on the device.
const keys = arg('keys')
const url = `punchcraft://dev/clip-audition?auto=1${keys ? `&keys=${keys}` : ''}`
console.log(`Launching ${url}`)
execFileSync('adb', ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `"${url}"`])
console.log('Audition running — leave the room quiet.')
