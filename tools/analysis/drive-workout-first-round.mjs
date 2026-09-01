/**
 * Drive a first-round workout on the tablet and capture its logcat.
 *
 * Loop Stage 2 of the 10-Workout Audio Verification Loop
 * (see .claude/plans/it-s-time-to-build-linked-deer.md).
 *
 * Assumes:
 *   - Wireless ADB paired + `192.168.86.59:*` device visible.
 *   - Metro is running on http://192.168.86.35:8081.
 *   - Focusrite mic wired if you want an acoustic follow-up
 *     (Stage 3b) — this harness only captures logcat + optional
 *     screenrecord for now.
 *
 * Sequence:
 *   1. adb force-stop com.kyleruff.punchcraft
 *   2. Launch main activity
 *   3. Wait for the dev-launcher or picker (logcat + polling)
 *   4. Tap dev-launcher server row (if present) → wait for bundle
 *   5. Tap the workout tile → tap quickstart → tap Hit It!
 *   6. Start `adb logcat -v time` capture to <sessionDir>/logcat.txt
 *   7. Start `adb shell screenrecord` (bounded) → <sessionDir>/screen.mp4
 *   8. Wait for round-1 completion:
 *      first `phase: 'rest'` transition after `runner.start`
 *   9. Force-stop the app, close captures
 *
 * Usage:
 *   node tools/analysis/drive-workout-first-round.mjs \
 *     --workout=<sampleWorkoutKey> \
 *     --device=192.168.86.59:37979 \
 *     [--out=<sessionDir>]  # default: tools/analysis/sessions/<workoutId>-<epoch>
 *     [--no-screen]         # skip screenrecord
 *     [--timeout=<sec>]     # drive-boundary total budget; default 420
 */

import { spawn, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------------------------------------------------------------------------
// Setup + args
// ---------------------------------------------------------------------------

const THIS_FILE = fileURLToPath(import.meta.url)
const REPO_ROOT = resolve(dirname(THIS_FILE), '..', '..')

const PACKAGE = 'com.kyleruff.punchcraft'
const MAIN_ACTIVITY = `${PACKAGE}/.MainActivity`

function parseArgs(argv) {
  const args = {
    workout: undefined,
    device: undefined,
    out: undefined,
    screen: true,
    timeoutSec: 420,
    // Forensic mode (token-order investigation, 2026-08-31): 60 fps
    // screenrecord + mic capture alongside logcat, all stopped at
    // `rest-entered` so exactly one round is captured.
    forensic: false,
    mic: process.env.AUDITION_MIC ?? 'Analogue 1 + 2 (16- Focusrite USB Audio)',
  }
  for (const a of argv) {
    if (a.startsWith('--workout=')) args.workout = a.slice('--workout='.length)
    else if (a.startsWith('--device=')) args.device = a.slice('--device='.length)
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length)
    else if (a === '--no-screen') args.screen = false
    else if (a === '--forensic') args.forensic = true
    else if (a.startsWith('--mic=')) args.mic = a.slice('--mic='.length)
    else if (a.startsWith('--timeout=')) args.timeoutSec = Number(a.slice('--timeout='.length))
  }
  // Forensic mode implies video; `--no-screen` would defeat the purpose.
  if (args.forensic) args.screen = true
  if (!args.workout) {
    throw new Error(
      'Usage: drive-workout-first-round.mjs --workout=<key> [--device=<id>] [--out=<dir>]\n' +
        '                                    [--forensic] [--mic="<dshow name>"]\n' +
        '                                    [--no-screen] [--timeout=<sec>]\n\n' +
        '  --forensic  60 fps screenrecord + mic capture.wav alongside logcat,\n' +
        '              all stopped at rest-entered (one round). Needs a __DEV__\n' +
        '              bundle for the viz.batch transition records.',
    )
  }
  return args
}

function adb(args, deviceId) {
  const parts = deviceId ? ['-s', deviceId, ...args] : [...args]
  return execSync(`adb ${parts.join(' ')}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function adbShell(cmd, deviceId) {
  return adb(['shell', cmd], deviceId)
}

// Return the first device id from `adb devices`, honoring the arg override.
function pickDevice(preferred) {
  if (preferred) return preferred
  const out = execSync('adb devices', { encoding: 'utf8' })
  const rows = out.split('\n').slice(1)
  const first = rows.map((l) => l.trim().split(/\s+/)).find((row) => row[1] === 'device')
  if (!first) throw new Error('No adb devices connected')
  return first[0]
}

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

function log(msg) {
  const stamp = new Date().toISOString().slice(11, 19)
  console.log(`[${stamp}] ${msg}`)
}

// ---------------------------------------------------------------------------
// UI automation — dump + tap by resource-id or content-desc
// ---------------------------------------------------------------------------

/**
 * Dump the current UI and return the raw XML string. Uses tmp file on
 * device.
 */
function dumpUi(deviceId) {
  adbShell('uiautomator dump /sdcard/ui.xml', deviceId)
  return adbShell('cat /sdcard/ui.xml', deviceId)
}

/**
 * Find a node in the UI dump by resource-id (exact) OR content-desc
 * (substring). Returns center coordinates or null.
 */
function findTapTarget(xml, { resourceId, contentDescSubstring }) {
  const nodeRe = /<node[^>]*>/g
  let match
  while ((match = nodeRe.exec(xml)) !== null) {
    const node = match[0]
    if (resourceId && !node.includes(`resource-id="${resourceId}"`)) continue
    if (
      contentDescSubstring &&
      !node.match(new RegExp(`content-desc="[^"]*${contentDescSubstring}[^"]*"`))
    )
      continue
    const boundsMatch = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    if (!boundsMatch) continue
    const [, x1, y1, x2, y2] = boundsMatch.map(Number)
    if (!Number.isFinite(x1)) continue
    return {
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      bounds: [x1, y1, x2, y2],
    }
  }
  return null
}

function tap(deviceId, x, y) {
  adbShell(`input tap ${x} ${y}`, deviceId)
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

/**
 * Poll a logcat file (that's being written by a background tail) until
 * a matching line appears or the timeout elapses. Returns the timestamp
 * ms of the matching line (adb -v time format) or null if timeout.
 *
 * `alsoMatches` is an optional extra predicate on the SAME line, for
 * picking one variant of a repeated event out of the stream. It is
 * same-line by design: the app's structured records can wrap onto
 * continuation lines, but Node keeps the object's FIRST property on the
 * event-name line, so a discriminating field placed first is always
 * co-located with its event name.
 */
async function waitForLogLine(
  sessionDir,
  needleSubstring,
  timeoutMs,
  alsoMatches = null,
  pollMs = 500,
) {
  const start = Date.now()
  const logPath = join(sessionDir, 'logcat.txt')
  const seen = new Set()
  while (Date.now() - start < timeoutMs) {
    if (existsSync(logPath)) {
      const text = readFileSync(logPath, 'utf8')
      const lines = text.split(/\r?\n/)
      for (const line of lines) {
        if (seen.has(line)) continue
        seen.add(line)
        if (!line.includes(needleSubstring)) continue
        if (alsoMatches && !alsoMatches(line)) continue
        return { line, elapsed: Date.now() - start }
      }
    }
    await sleep(pollMs)
  }
  return null
}

/**
 * Poll UI dumps for a specific resource-id / content-desc target and
 * return once found (or null on timeout).
 */
async function waitForUiTarget(deviceId, findSpec, timeoutMs, pollMs = 1500) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const xml = dumpUi(deviceId)
      const target = findTapTarget(xml, findSpec)
      if (target) return target
    } catch (e) {
      // uiautomator sometimes fails on transition; keep polling
    }
    await sleep(pollMs)
  }
  return null
}

// ---------------------------------------------------------------------------
// The drive
// ---------------------------------------------------------------------------

async function drive(args) {
  const deviceId = pickDevice(args.device)
  const timestampMs = Date.now()
  const sessionDir =
    args.out ??
    join(
      REPO_ROOT,
      'tools',
      'analysis',
      'sessions',
      `${args.workout}-${timestampMs}`,
    )
  ensureDir(sessionDir)
  log(`session dir: ${sessionDir}`)
  log(`device: ${deviceId}`)

  // 1. Force-stop + clear logcat + start capture
  log('force-stopping app')
  adbShell(`am force-stop ${PACKAGE}`, deviceId)
  await sleep(1000)
  log('clearing device logcat buffer')
  adbShell('logcat -c', deviceId)

  log('starting logcat capture')
  const logcatFile = join(sessionDir, 'logcat.txt')
  const logcatFd = spawn('adb', ['-s', deviceId, 'logcat', '-v', 'time', 'ReactNativeJS:V', 'puncheokie:V', 'AndroidRuntime:E', 'System.err:W', '*:S'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const fs = await import('node:fs')
  const logcatOut = fs.createWriteStream(logcatFile)
  logcatFd.stdout.pipe(logcatOut)

  let screenrecordProc = null
  if (args.screen) {
    log('starting screenrecord (device-side)')
    // screenrecord max ~180s default; timeout matches drive timeout
    const recordDurationSec = Math.min(args.timeoutSec, 180)
    // Forensic mode raises the bit rate: token nodes are small, and
    // compression artifacts at the default rate blur exactly the ring
    // edges we need to read frame by frame.
    const bitRateArg = args.forensic ? '--bit-rate 8000000 ' : ''
    screenrecordProc = spawn(
      'adb',
      [
        '-s',
        deviceId,
        'shell',
        `screenrecord ${bitRateArg}--time-limit ${recordDurationSec} /sdcard/session.mp4`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
  }

  // Mic capture — the third timeline. Logs give sub-ms ordering truth,
  // video gives 16.7 ms pixel truth, audio gives sample-accurate truth
  // about what the athlete actually HEARD. Reuses the dshow invocation
  // from tools/audition/monitor-session.mjs.
  let ffmpegProc = null
  if (args.forensic) {
    log(`starting mic capture (${args.mic})`)
    ffmpegProc = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'dshow',
        '-rtbufsize',
        '256M',
        '-i',
        `audio=${args.mic}`,
        '-ac',
        '1',
        '-ar',
        '48000',
        '-y',
        join(sessionDir, 'capture.wav'),
      ],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    )
    ffmpegProc.on('error', (err) => {
      log(`WARN: mic capture failed to start (${err.message}) — continuing without audio`)
      ffmpegProc = null
    })
  }

  const cleanup = () => {
    try {
      logcatFd.kill('SIGTERM')
    } catch {}
    try {
      logcatOut.close()
    } catch {}
    if (screenrecordProc) {
      try {
        screenrecordProc.kill('SIGTERM')
      } catch {}
    }
    if (ffmpegProc) {
      try {
        // 'q' rather than a signal: ffmpeg finalizes the WAV header on a
        // graceful quit. A kill leaves an unreadable file.
        ffmpegProc.stdin.write('q')
      } catch {
        try {
          ffmpegProc.kill('SIGTERM')
        } catch {}
      }
    }
  }

  try {
    // 2. Launch main activity via LAUNCHER intent — force-brings the
    //    app to the foreground even if another activity is on top.
    //    `am start -n <activity>` alone doesn't foreground the app
    //    reliably when a different package is the current task.
    //
    //    Some foreground apps (notably Android Settings' sub-screens
    //    on the Lenovo tablet) ignore KEYCODE_HOME while a modal is
    //    open. Five BACK keyevents defensively unwind whatever's on
    //    screen, then HOME lands on the launcher, and finally the
    //    monkey intent brings up punchCraft.
    // WAKE FIRST (GH #305): an unattended tablet dozes, and a dozing
    // screen renders nothing — a whole sweep failed with "tile did not
    // appear within 120s" because `mWakefulness=Dozing` and the lockscreen
    // was up. Neither BACK nor HOME wakes a sleeping device; WAKEUP does,
    // and `wm dismiss-keyguard` clears the (insecure) lockscreen. Idempotent
    // when already awake.
    log('WAKEUP + dismiss-keyguard (tablet may be dozing)')
    adbShell('input keyevent KEYCODE_WAKEUP', deviceId)
    await sleep(1200)
    try {
      adbShell('wm dismiss-keyguard', deviceId)
    } catch {}
    await sleep(800)
    log('BACK x5 + HOME to unwind any foreground activity')
    for (let i = 0; i < 5; i += 1) {
      adbShell('input keyevent KEYCODE_BACK', deviceId)
      await sleep(400)
    }
    adbShell('input keyevent KEYCODE_HOME', deviceId)
    await sleep(2000)
    log(`launching ${PACKAGE} via LAUNCHER intent`)
    adbShell(
      `monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1`,
      deviceId,
    )

    // 3. Wait for dev launcher OR picker screen (whichever the app shows)
    log('waiting for app UI (picker OR dev launcher, up to 120s)')
    let workoutTile = null
    const uiDeadlineMs = Date.now() + 120_000
    while (Date.now() < uiDeadlineMs) {
      const xml = dumpUi(deviceId)
      workoutTile = findTapTarget(xml, { resourceId: `preset-${args.workout}` })
      if (workoutTile) {
        log(`preset-${args.workout} tile found (picker is up)`)
        break
      }
      // Dev launcher fallback — tap the server row if present.
      // Dev-launcher card is a ViewGroup with content-desc="punchCraft"
      // + subtitle text "http://…:8081". Try both.
      const serverRowByPort = findTapTarget(xml, { contentDescSubstring: '8081' })
      const serverRowByName = findTapTarget(xml, { contentDescSubstring: 'punchCraft' })
      const serverRow = serverRowByPort ?? serverRowByName
      if (serverRow) {
        log(`dev launcher detected — tapping server row at ${serverRow.x},${serverRow.y}`)
        tap(deviceId, serverRow.x, serverRow.y)
        await sleep(4000)
      } else {
        await sleep(2000)
      }
    }
    if (!workoutTile) {
      throw new Error(
        `preset-${args.workout} tile did not appear within 120s`,
      )
    }

    // 4. Tap workout tile → quickstart → Hit It
    log(`tapping preset-${args.workout} at ${workoutTile.x},${workoutTile.y}`)
    tap(deviceId, workoutTile.x, workoutTile.y)
    await sleep(1500)

    const quickstart = await waitForUiTarget(
      deviceId,
      { resourceId: 'quick-start' },
      10_000,
    )
    if (!quickstart) throw new Error('quick-start button not found')
    log(`tapping quick-start at ${quickstart.x},${quickstart.y}`)
    tap(deviceId, quickstart.x, quickstart.y)
    await sleep(3000)

    const hitIt = await waitForUiTarget(deviceId, { resourceId: 'start-workout' }, 10_000)
    if (!hitIt) throw new Error('start-workout (Hit It!) button not found')
    log(`tapping start-workout at ${hitIt.x},${hitIt.y}`)
    tap(deviceId, hitIt.x, hitIt.y)

    // 5. Wait for runner.start marker
    log('waiting for runner.start marker (up to 30s)')
    const runnerArmed = await waitForLogLine(sessionDir, 'puncheokie.runner.start', 30_000)
    if (!runnerArmed) throw new Error('runner.start log line never appeared')
    log(`runner armed at ${runnerArmed.line.split(' ').slice(0, 2).join(' ')}`)

    // 6. Wait for the round-1 bell — the first rest boundary after
    //    runner.start — which is what "one round deep" means.
    //
    //    This used to wait on the literal `'rest-entered'`. That string is a
    //    domain event TYPE and was never written to logcat by anything, so the
    //    wait could not succeed: every drive burned the full timeout, then fell
    //    through to a 5 s search for the substring 'rest' that matched nothing
    //    either. Captures therefore ran long and spanned more than the one
    //    round the protocol calls for, while screenrecord capped out at 180 s
    //    partway through. Verified against all archived sessions: zero contain
    //    `rest-entered` (GH #305).
    //
    //    `puncheokie.round.boundary` is emitted by the runner at every
    //    work/rest transition and carries `transition` + `roundIndex`.
    log(`waiting for round-1 completion (round.boundary rest) — up to ${args.timeoutSec}s`)
    const roundEnded = await waitForLogLine(
      sessionDir,
      'puncheokie.round.boundary',
      args.timeoutSec * 1000,
      (line) => line.includes('rest-entered'),
    )
    if (!roundEnded) {
      log('WARN: round boundary never seen — is the bundle older than the')
      log('      puncheokie.round.boundary instrumentation? Capture may span')
      log('      more than one round; treat its verdict as unscoped.')
    } else {
      log(`round 1 complete at ${roundEnded.line.split(' ').slice(0, 2).join(' ')}`)
    }

    // Grace period so trailing audio events land in logcat
    log('grace period 3s')
    await sleep(3000)

    // Stop the mic at the round boundary — Kyle's protocol is one round
    // per workout, capture off at rest. Video is stopped below, after the
    // app force-stop, so the final frames are included.
    if (ffmpegProc) {
      log('stopping mic capture')
      try {
        ffmpegProc.stdin.write('q')
      } catch {
        try {
          ffmpegProc.kill('SIGTERM')
        } catch {}
      }
      ffmpegProc = null
      await sleep(500)
    }

    // 7. Force-stop + pull screenrecord
    log('force-stopping app')
    adbShell(`am force-stop ${PACKAGE}`, deviceId)
    await sleep(1000)

    if (screenrecordProc) {
      // Stop it DEVICE-side. `screenrecordProc.kill('SIGINT')` signals the
      // local adb client, which on Windows does not reach the on-device
      // recorder at all — and by this point the recorder has usually
      // self-terminated anyway (see the 180s note below).
      log('stopping screenrecord (device-side)')
      try {
        adbShell('pkill -INT screenrecord', deviceId)
      } catch {}
      try {
        screenrecordProc.kill('SIGINT')
      } catch {}
      await sleep(2000)
      try {
        adb(['pull', '/sdcard/session.mp4', join(sessionDir, 'screen.mp4')], deviceId)
        log('pulled screen.mp4')
      } catch (e) {
        log(`WARN: could not pull screen.mp4 (${e.message})`)
      }
      // Be honest about what the video actually covers. `screenrecord` on
      // this device (v1.3, SDK 33) hard-caps at 180s — "Default / maximum
      // is 180" — and all seven forensic captures to date hit it
      // (179.7-180.0s) against 403-431s of audio. Since 180s is less than
      // the pre-roll (19-36s) plus a 240s round, NO start offset can make
      // one recording bracket the whole round. Fixing round detection does
      // not fix this; segmentation or a deliberately-delayed window is
      // follow-up work. Until then the file is a partial view and the
      // report must not imply otherwise.
      const roundEndedMs = roundEnded ? roundEnded.elapsed : null
      log('WARN: screenrecord caps at 180s — video covers only the START of')
      log('      the round. Do not read absence-of-evidence from screen.mp4.')
      writeFileSync(
        join(sessionDir, 'capture-window.json'),
        JSON.stringify(
          {
            screenrecordCapSec: 180,
            roundEndedAfterMs: roundEndedMs,
            videoCoversWholeRound: roundEndedMs !== null && roundEndedMs <= 180_000,
            note: 'screenrecord --time-limit maxes at 180s on this device; logcat and capture.wav span the full round, video does not.',
          },
          null,
          2,
        ),
        'utf8',
      )
    }

    cleanup()
    await sleep(1000)

    const stats = existsSync(logcatFile) ? statSync(logcatFile) : { size: 0 }
    log(`logcat size: ${stats.size} bytes → ${logcatFile}`)
    if (args.forensic) {
      const wav = join(sessionDir, 'capture.wav')
      const mp4 = join(sessionDir, 'screen.mp4')
      const wavSize = existsSync(wav) ? statSync(wav).size : 0
      const mp4Size = existsSync(mp4) ? statSync(mp4).size : 0
      log(`capture.wav: ${wavSize} bytes`)
      log(`screen.mp4:  ${mp4Size} bytes`)
      const vizBatches = existsSync(logcatFile)
        ? (readFileSync(logcatFile, 'utf8').match(/puncheokie\.viz\.batch/g) ?? []).length
        : 0
      log(`viz.batch lines: ${vizBatches}`)
      if (vizBatches === 0) {
        log('WARN: no viz.batch lines — is this a __DEV__ bundle with the forensics wire?')
      }
    }
    log('done')
    return {
      sessionDir,
      deviceId,
      workoutId: args.workout,
      forensic: args.forensic,
    }
  } catch (err) {
    log(`ERROR: ${err.message}`)
    cleanup()
    try {
      adbShell(`am force-stop ${PACKAGE}`, deviceId)
    } catch {}
    throw err
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const result = await drive(args)
  console.log(JSON.stringify(result, null, 2))
}

const invokedDirectly = process.argv[1]?.endsWith('drive-workout-first-round.mjs')
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
