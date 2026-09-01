/**
 * Synchronized live-session monitor — logs + mic + screenshots on one clock.
 *
 * The logcat main buffer on the tablet rotates in minutes, so dumping after
 * the fact loses the evidence; this streams it. Three captures run together,
 * each stamped with PC epoch milliseconds so they align exactly:
 *
 *   log.txt          streamed `adb logcat -v epoch -s ReactNativeJS:I`
 *   capture.wav      the room, via the Focusrite (48 kHz mono)
 *   shots/<epoch>.png a screenshot every SHOT_INTERVAL_MS
 *   manifest.json    start epochs + shot list
 *
 * Correlating a complaint then works backwards: find the moment in the
 * audio, read the log lines at that epoch, open the screenshot nearest it —
 * what was said, what was scheduled, and what was on screen, one timestamp.
 *
 * Run: node tools/audition/monitor-session.mjs [--out <dir>] [--duration <min>]
 * Stop: Ctrl+C (or the duration cap). Screenshots pause automatically if the
 * device disconnects and resume when it returns.
 */

import { spawn, execFile } from 'node:child_process'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { computeAnchors, writeAnchors } from './anchor.mjs'

const DEVICE_NAME = process.env.AUDITION_MIC ?? 'Analogue 1 + 2 (16- Focusrite USB Audio)'
const SHOT_INTERVAL_MS = 2_500

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const durationMin = Number(arg('duration') ?? 30)

const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)
const outDir = arg('out') ?? join('tools', 'analysis', 'monitor', ts)
const shotsDir = join(outDir, 'shots')
mkdirSync(shotsDir, { recursive: true })

const startedEpochMs = Date.now()
console.log(`Monitoring -> ${outDir}  (Ctrl+C to stop, cap ${durationMin} min)`)

// --- audio ---------------------------------------------------------------
const ffmpeg = spawn(
  'ffmpeg',
  ['-hide_banner', '-loglevel', 'error', '-f', 'dshow', '-rtbufsize', '256M',
    '-i', `audio=${DEVICE_NAME}`, '-ac', '1', '-ar', '48000', '-y',
    join(outDir, 'capture.wav')],
  { stdio: ['pipe', 'inherit', 'inherit'] },
)

// --- logs ----------------------------------------------------------------
const DEVICE = arg('device') ?? process.env.ANDROID_SERIAL
const adbArgs = (rest) => (DEVICE ? ['-s', DEVICE, ...rest] : rest)
execFile('adb', adbArgs(['logcat', '-c']), () => {
  const logcat = spawn('adb', adbArgs(['logcat', '-v', 'epoch', '-s', 'ReactNativeJS:I']))
  logcat.stdout.pipe(createWriteStream(join(outDir, 'log.txt')))
  cleanupFns.push(() => logcat.kill())
})

// --- screenshots ---------------------------------------------------------
const shots = []
let shotBusy = false
const shotTimer = setInterval(() => {
  if (shotBusy) return
  shotBusy = true
  const epoch = Date.now()
  const file = join(shotsDir, `${epoch}.png`)
  const proc = spawn('adb', adbArgs(['exec-out', 'screencap', '-p']))
  const chunks = []
  proc.stdout.on('data', (c) => chunks.push(c))
  proc.on('close', (code) => {
    shotBusy = false
    if (code === 0 && chunks.length > 0) {
      writeFileSync(file, Buffer.concat(chunks))
      shots.push(epoch)
      if (shots.length % 24 === 0) console.log(`  ${shots.length} shots, ${((Date.now() - startedEpochMs) / 60000).toFixed(1)} min`)
    }
  })
}, SHOT_INTERVAL_MS)

// --- shutdown ------------------------------------------------------------
const cleanupFns = []
let done = false
function finish(reason) {
  if (done) return
  done = true
  console.log(`Stopping (${reason}) — ${shots.length} screenshots.`)
  clearInterval(shotTimer)
  for (const fn of cleanupFns) {
    try {
      fn()
    } catch {
      /* gone */
    }
  }
  try {
    ffmpeg.stdin.write('q')
  } catch {
    /* gone */
  }
  setTimeout(() => {
    writeFileSync(
      join(outDir, 'manifest.json'),
      `${JSON.stringify({ startedEpochMs, endedEpochMs: Date.now(), shotIntervalMs: SHOT_INTERVAL_MS, shots }, null, 1)}\n`,
    )
    // Merge computed anchors (audio-t0 from wav mtime−duration, logcat
    // first epoch) into the manifest so cadence_analyzer.py can align the
    // three streams without re-deriving the math.
    try {
      const anchors = computeAnchors(outDir)
      writeAnchors(outDir, anchors)
      console.log(`Wrote ${join(outDir, 'manifest.json')}   anchors: ${JSON.stringify(anchors)}`)
    } catch (err) {
      console.warn(`Wrote ${join(outDir, 'manifest.json')} — anchor compute failed: ${err.message}`)
    }
    process.exit(0)
  }, 1500)
}

process.on('SIGINT', () => finish('interrupted'))
setTimeout(() => finish('duration cap'), durationMin * 60 * 1000)
