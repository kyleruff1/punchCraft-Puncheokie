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
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
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
  }
  for (const a of argv) {
    if (a.startsWith('--workout=')) args.workout = a.slice('--workout='.length)
    else if (a.startsWith('--device=')) args.device = a.slice('--device='.length)
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length)
    else if (a === '--no-screen') args.screen = false
    else if (a.startsWith('--timeout=')) args.timeoutSec = Number(a.slice('--timeout='.length))
  }
  if (!args.workout) {
    throw new Error('Usage: drive-workout-first-round.mjs --workout=<key> [--device=...] [--out=...]')
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
 */
async function waitForLogLine(sessionDir, needleSubstring, timeoutMs, pollMs = 500) {
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
        if (line.includes(needleSubstring)) return { line, elapsed: Date.now() - start }
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
    screenrecordProc = spawn(
      'adb',
      ['-s', deviceId, 'shell', `screenrecord --time-limit ${recordDurationSec} /sdcard/session.mp4`],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
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

    // 6. Wait for first `rest-entered` after runner.start — that's the round-1
    //    bell of round 2 = round 1 complete
    log(`waiting for round-1 completion (rest-entered) — up to ${args.timeoutSec}s`)
    const roundEnded = await waitForLogLine(sessionDir, "'rest-entered'", args.timeoutSec * 1000)
    if (!roundEnded) {
      // Fallback: many logs won't stringify session phases; try 'phase' + 'rest'
      const alt = await waitForLogLine(sessionDir, 'rest', 5_000)
      if (!alt) log('WARN: rest-entered marker not seen — session may be short/incomplete')
    } else {
      log(`round 1 complete at ${roundEnded.line.split(' ').slice(0, 2).join(' ')}`)
    }

    // Grace period so trailing audio events land in logcat
    log('grace period 3s')
    await sleep(3000)

    // 7. Force-stop + pull screenrecord
    log('force-stopping app')
    adbShell(`am force-stop ${PACKAGE}`, deviceId)
    await sleep(1000)

    if (screenrecordProc) {
      log('stopping screenrecord')
      screenrecordProc.kill('SIGINT')
      await sleep(2000)
      try {
        adb(['pull', '/sdcard/session.mp4', join(sessionDir, 'screen.mp4')], deviceId)
        log('pulled screen.mp4')
      } catch (e) {
        log(`WARN: could not pull screen.mp4 (${e.message})`)
      }
    }

    cleanup()
    await sleep(1000)

    const stats = existsSync(logcatFile) ? statSync(logcatFile) : { size: 0 }
    log(`logcat size: ${stats.size} bytes → ${logcatFile}`)
    log('done')
    return { sessionDir, deviceId, workoutId: args.workout }
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
