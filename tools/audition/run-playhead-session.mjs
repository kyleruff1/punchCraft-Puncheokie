/**
 * One PLAYHEAD_TO_SPEAKER_MS session, start to finish (plan step 5c).
 *
 *   node tools/audition/run-playhead-session.mjs [--out=<dir>] [--mic="<dshow name>"]
 *
 * Order matters and is the point:
 *
 *   1. Measure the host↔device clock offset FIRST and again LAST. A consumer
 *      tablet's clock drifts, and the pair brackets the drift across the very
 *      window being measured instead of assuming a number taken minutes ago
 *      still holds. If the two disagree by more than the latency we are after,
 *      the session says so rather than quietly averaging them.
 *   2. Start ffmpeg, then WAIT before triggering. The wav's epoch is derived
 *      from `mtime − duration`, so anything recorded before ffmpeg has settled
 *      sits in the least trustworthy part of the file.
 *   3. Record the host epoch at the moment the probe is triggered. That is the
 *      causality anchor: a sound cannot be captured before the tap that caused
 *      it, and it is the only independent check on the wav's start epoch.
 *   4. Stop ffmpeg cleanly (q, not SIGKILL) so it finalises the header and the
 *      mtime means what the anchor formula assumes.
 *
 * Everything lands in <out>/ as capture.wav, log.txt, trigger.json — the shape
 * `playhead-to-speaker.mjs` reads.
 */
import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { measureClockOffset } from './clock-offset.mjs'

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const MIC = arg('mic') ?? process.env.AUDITION_MIC ?? 'Analogue 1 + 2 (16- Focusrite USB Audio)'
const OUT = arg('out') ?? join('tools', 'analysis', 'listen', `p2s-${Date.now()}`)
/**
 * 2 assets x 40 plays, each separated by a 150 ms tail plus a randomised
 * 200–800 ms gap plus the measurement itself: ~70 s of probe. 150 s leaves
 * room for a slow start and gives the analyser a long stretch of pure room
 * tone, which is what its noise floor is estimated from.
 */
const RECORD_S = Number(arg('seconds') ?? 150)
const SETTLE_MS = 3_000

const sh = (cmd) => execFileSync('adb', ['shell', cmd], { encoding: 'utf8' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (m) => console.log(`[p2s] ${m}`)

/** Find a control by its accessibility label in the current view hierarchy. */
function findButton(label) {
  execFileSync('adb', ['shell', 'uiautomator', 'dump', '/sdcard/ui.xml'], { encoding: 'utf8' })
  const xml = execFileSync('adb', ['shell', 'cat', '/sdcard/ui.xml'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const idx = xml.indexOf(`content-desc="${label}"`)
  if (idx < 0) return null
  const bounds = xml.slice(idx).match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
  if (!bounds) return null
  const [, x1, y1, x2, y2] = bounds.map(Number)
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) }
}

async function main() {
  mkdirSync(OUT, { recursive: true })

  log('measuring clock offset (before)…')
  const offsetBefore = measureClockOffset({ samples: 30 })
  log(`  device − host = ${offsetBefore.offsetMs} ms, bracket ${offsetBefore.boundWidthMs} ms wide`)
  if (offsetBefore.boundWidthMs !== null && offsetBefore.boundWidthMs > 20) {
    log(`  WARNING: a ${offsetBefore.boundWidthMs} ms bracket is comparable to the latency being`)
    log(`  measured. This is adb round-trip, not the clock. Use USB.`)
  }

  log('waking device and opening the ruler probe…')
  sh('input keyevent KEYCODE_WAKEUP')
  await sleep(800)
  sh('input swipe 600 900 600 300')
  await sleep(1500)
  sh('am force-stop com.kyleruff.punchcraft')
  await sleep(800)
  sh("am start -a android.intent.action.VIEW -d 'punchcraft:///dev/voice-latency'")
  await sleep(8_000)

  const button = findButton('Calibrate ruler')
  if (!button) throw new Error('could not find "Calibrate ruler" — is the dev screen open?')
  log(`  found probe button at ${button.x},${button.y}`)

  log('starting logcat…')
  execFileSync('adb', ['logcat', '-c'])
  const logStream = createWriteStream(join(OUT, 'log.txt'))
  const logcat = spawn('adb', ['logcat', '-v', 'epoch', 'ReactNativeJS:V', '*:S'])
  logcat.stdout.pipe(logStream)

  log(`starting ffmpeg on "${MIC}"…`)
  const wavPath = join(OUT, 'capture.wav')
  // BRACKET THE RECORDING. The wav's start epoch is derived from
  // `mtime − duration`, and ffmpeg's close/flush delay makes mtime LATE, which
  // inflates every latency. The causality check could only ever fire when the
  // anchor was EARLY — the one direction ffmpeg cannot produce — so it had a
  // 2.26 s dead band on the dry run and could not catch its own failure mode.
  //
  // These two stamps close it from both sides. Recording cannot begin before
  // ffmpeg was spawned, and the last sample cannot arrive after it exited, so
  //     spawn ≤ t0 ≤ exit − duration
  // is a hard bracket that the mtime estimate must fall inside. Its width is
  // ffmpeg's startup plus close delay — measured, not assumed.
  const ffmpegSpawnedAtHostEpochMs = Date.now()
  const ff = spawn(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'warning', '-f', 'dshow', '-rtbufsize', '256M',
     '-i', `audio=${MIC}`,
     '-ac', '1', '-ar', '48000', '-t', String(RECORD_S), '-y', wavPath],
    { stdio: ['pipe', 'inherit', 'pipe'] },
  )
  // dshow overrun warnings mean dropped samples, which shifts everything after
  // the drop. Keep them with the session rather than letting them scroll past.
  const ffErr = createWriteStream(join(OUT, 'ffmpeg.log'))
  ff.stderr.pipe(ffErr)

  // Settle before triggering: the head of the file is the part the anchor
  // formula understands least.
  await sleep(SETTLE_MS)

  const triggeredAtHostEpochMs = Date.now()
  log(`triggering probe at host epoch ${triggeredAtHostEpochMs}`)
  sh(`input tap ${button.x} ${button.y}`)

  // 80 plays at ~400 ms each, plus arming pauses.
  log(`recording for ${RECORD_S}s — keep the room quiet…`)
  await new Promise((resolve) => ff.on('exit', resolve))
  const ffmpegExitedAtHostEpochMs = Date.now()
  ffErr.end()

  log('measuring clock offset (after)…')
  const offsetAfter = measureClockOffset({ samples: 30 })
  const driftMs = offsetAfter.offsetMs - offsetBefore.offsetMs
  log(`  device − host = ${offsetAfter.offsetMs} ms  (drift over the session: ${driftMs} ms)`)

  await sleep(1_500)
  logcat.kill()
  logStream.end()
  await sleep(500)

  writeFileSync(
    join(OUT, 'trigger.json'),
    JSON.stringify(
      {
        triggeredAtHostEpochMs,
        ffmpegSpawnedAtHostEpochMs,
        ffmpegExitedAtHostEpochMs,
        // The midpoint is the best single estimate; the drift is reported so a
        // reader can see whether treating it as constant was defensible.
        clockOffsetMs: Math.round((offsetBefore.offsetMs + offsetAfter.offsetMs) / 2),
        clockOffsetBefore: offsetBefore,
        clockOffsetAfter: offsetAfter,
        clockDriftMs: driftMs,
        mic: MIC,
        recordSeconds: RECORD_S,
      },
      null,
      2,
    ) + '\n',
  )

  log(`done → ${OUT}`)
  log(`analyse: node tools/audition/playhead-to-speaker.mjs --session ${OUT}`)
  if (Math.abs(driftMs) > 20) {
    log(`WARNING: the clock drifted ${driftMs} ms during the session — larger than the`)
    log(`quantity being measured. Treat the result as an order of magnitude only.`)
  }
}

main().catch((e) => {
  console.error(`[p2s] FAILED: ${e.message}`)
  process.exit(1)
})
