/**
 * Would a mic session of this probe be resolvable? Asked BEFORE setting one up.
 *
 * A `playhead-to-speaker` session costs a Focusrite, a quiet room, a mic placed
 * against the tablet speaker, and two and a half minutes that cannot be
 * repeated later from the same clock. The dry run spent all of that on a
 * capture that turned out to contain no answer at all — its plays were evenly
 * spaced, so "the latency" and "the latency plus one gap" were attested by 78
 * and 75 plays respectively, and no amount of anchor correction could separate
 * them. That was only discovered afterwards.
 *
 * It did not have to be. Resolvability is a property of the PLAY TIMES alone,
 * and the tablet logs those. So this runs the probe, reads the log, and answers
 * the question with no recording in the loop:
 *
 *   - How much do the inter-play gaps actually vary? That spread is what gives
 *     the vote its margin, and it is the thing a code change can silently
 *     revert. `Math.random` does not survive minification, so the shipped
 *     bundle cannot be grepped to check — but the gaps it produces can be
 *     measured.
 *   - Given those gaps, would a recording resolve? Simulate onsets at a fixed
 *     delay and run the real `chooseLatency` over them.
 *
 * The simulation is run WITH jitter as well as without. A perfectly rigid
 * latency makes the winning cluster artificially tight, which flatters the
 * margin; real variation spreads the winner's votes while leaving its rivals
 * where they are, so the jittered figure is the one that decides whether the
 * session is worth setting up.
 *
 * Wireless adb is fine here. Every number is a DIFFERENCE between two stamps
 * from the same clock, so the host↔device offset cancels and its uncertainty
 * never enters. The mic session itself still wants USB.
 *
 *   node tools/audition/probe-preflight.mjs            # run the probe, then judge
 *   node tools/audition/probe-preflight.mjs --log=<f>  # judge a log already captured
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

import { chooseLatency, parseRepLines } from './playhead-to-speaker.mjs'

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)

/**
 * Below this the gaps are too alike for any recording of them to be aligned.
 * Set against what the vote needs, not against a nominal range: the analyser
 * clusters within ±40 ms, so the spread has to be many times that before a
 * wrong delay stops collecting nearly as many votes as the right one.
 */
const MIN_SPREAD_MS = 450

/** A plausible per-play variation in the audio path, for the honest simulation. */
const ASSUMED_JITTER_MS = 25

const median = (v) => {
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Find a control by its accessibility label in the current view hierarchy. */
function findButton(label) {
  execFileSync('adb', ['shell', 'uiautomator', 'dump', '/sdcard/ui.xml'], { encoding: 'utf8' })
  const xml = execFileSync('adb', ['shell', 'cat', '/sdcard/ui.xml'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  const idx = xml.indexOf(`content-desc="${label}"`)
  if (idx < 0) return null
  const bounds = xml.slice(idx).match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
  if (!bounds) return null
  const [, x1, y1, x2, y2] = bounds.map(Number)
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Drive the probe on-device and return its logcat output. */
async function captureProbeLog() {
  const sh = (cmd) => execFileSync('adb', ['shell', cmd], { encoding: 'utf8' })
  console.log('[preflight] waking device and opening the ruler probe…')
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

  execFileSync('adb', ['logcat', '-c'])
  const logcat = spawn('adb', ['logcat', '-v', 'epoch', 'ReactNativeJS:V', '*:S'])
  let out = ''
  logcat.stdout.on('data', (d) => {
    out += d
  })
  await sleep(1_000)
  console.log(`[preflight] tapping the probe at ${button.x},${button.y} — about 70 s of plays…`)
  sh(`input tap ${button.x} ${button.y}`)

  // Wait for the probe's own completion line rather than a fixed duration, so
  // a slower device is not cut off mid-run and reported as a thin sample.
  for (let i = 0; i < 240 && !out.includes('puncheokie.ruler.done'); i += 1) await sleep(1_000)
  logcat.kill()
  if (!out.includes('puncheokie.ruler.done')) console.log('[preflight] WARNING: probe never reported done')
  return out
}

export function judge(logText) {
  const reps = parseRepLines(logText)
  const problems = []
  if (reps.length < 12) problems.push(`only ${reps.length} rep records — did the probe actually run?`)

  const byAsset = new Map()
  for (const r of reps) {
    const k = r.asset ?? 'unknown'
    if (!byAsset.has(k)) byAsset.set(k, [])
    byAsset.get(k).push(r.playheadEpochMs)
  }

  // Gaps WITHIN one asset only. The pause between assets is not a play gap,
  // and letting it in would report a spread the probe does not actually have.
  const perAsset = []
  let all = []
  for (const [asset, times] of byAsset) {
    const gaps = times
      .slice(1)
      .map((t, i) => t - times[i])
      .filter((g) => g > 0 && g < 5_000)
    if (gaps.length === 0) continue
    all = all.concat(gaps)
    perAsset.push({
      asset,
      plays: times.length,
      minMs: Math.min(...gaps),
      medianMs: median(gaps),
      maxMs: Math.max(...gaps),
      spreadMs: Math.max(...gaps) - Math.min(...gaps),
    })
  }

  const spreadMs = all.length ? Math.max(...all) - Math.min(...all) : 0
  if (spreadMs < MIN_SPREAD_MS) {
    problems.push(
      `inter-play gaps vary by only ${spreadMs} ms (want ≥ ${MIN_SPREAD_MS}) — a recording of this` +
        ` probe could not be aligned, because "the latency" and "the latency plus one gap" would be` +
        ` attested by about the same number of plays. Check that the randomised gap in` +
        ` src/app/dev/voice-latency.tsx reached the installed build`,
    )
  }

  // The real question, run through the real selector.
  const times = reps.map((r) => r.playheadEpochMs)
  const simulations = [0, ASSUMED_JITTER_MS].map((jitterMs) => {
    const onsets = times.map((t, i) => t + 120 + (jitterMs === 0 ? 0 : i % 2 ? jitterMs : -jitterMs))
    const s = chooseLatency(onsets, times)
    return {
      jitterMs,
      votes: s.best?.votes ?? 0,
      rivalVotes: s.runnerUp?.votes ?? 0,
      marginX: s.runnerUp ? Math.round((s.best.votes / s.runnerUp.votes) * 10) / 10 : null,
      decisive: s.decisive,
    }
  })
  for (const s of simulations) {
    if (!s.decisive) {
      problems.push(
        `simulated at ±${s.jitterMs} ms of path jitter, the vote is ${s.votes} to ${s.rivalVotes} —` +
          ` not decisive, so a real recording would be refused. Do not spend a mic session on this`,
      )
    }
  }

  return { ok: problems.length === 0, problems, reps: reps.length, spreadMs, perAsset, simulations }
}

async function main() {
  const logPath = arg('log')
  if (logPath && !existsSync(logPath)) {
    console.error(`no such log: ${logPath}`)
    process.exit(3)
  }
  const logText = logPath ? readFileSync(logPath, 'utf8') : await captureProbeLog()
  const report = judge(logText)

  console.log('')
  for (const a of report.perAsset) {
    console.log(
      `${a.asset}: ${a.plays} plays, gap min ${a.minMs} med ${a.medianMs} max ${a.maxMs}` +
        ` (spread ${a.spreadMs} ms)`,
    )
  }
  console.log(`\nall plays: ${report.reps} records, gaps vary by ${report.spreadMs} ms`)
  for (const s of report.simulations) {
    console.log(
      `simulated at ±${s.jitterMs} ms jitter: ${s.votes} votes against ${s.rivalVotes}` +
        `${s.marginX === null ? '' : ` (${s.marginX}x)`} — decisive=${s.decisive}`,
    )
  }

  if (!report.ok) {
    console.error('\n' + report.problems.map((p) => 'PROBLEM: ' + p).join('\n'))
    process.exit(2)
  }
  console.log('\nPREFLIGHT PASS — a mic session of this probe would resolve. Set up the rig.')
}

if (process.argv[1]?.endsWith('probe-preflight.mjs')) {
  main().catch((e) => {
    console.error(`[preflight] FAILED: ${e.message}`)
    process.exit(1)
  })
}
