/**
 * The unattended audio-verification suite (GH #292, plan B3).
 *
 * Drives every workout that has a manifest under tools/analysis/manifests
 * through the tablet with nobody in the room: the QA deep link stages the
 * workout, autostarts it, and plays a simulated punch script paced to the
 * workout (GH #291); the first-round correlator judges round 1; the
 * observers' records (voice playhead, instrument onset tap) are summarized
 * beside the verdict; AudioTrack counts bracket each drive.
 *
 * Launch recipe (learned on the device — binding). The intent is ALWAYS the
 * scheme-resolved form
 *   am start -a android.intent.action.VIEW -d '<url>' com.kyleruff.punchcraft
 * (`-n <component>` reaches the activity but never the router). On the dev
 * client (`--launch=warm`, the default): a LAUNCHER cold start, wait for
 * `puncheokie.app.ready` (the root layout logs it when the Stack mounts;
 * `Running "main"` comes ~20 s earlier and an intent inside that window is
 * dropped), then the intent. On a release build (`--expect-release` implies
 * `--launch=cold`): cold-launch WITH the intent — no expo-dev-launcher, and
 * `getInitialURL` has no listener race.
 *
 *   node tools/analysis/verify-suite.mjs --all [--vocab=numbers|techniques|both]
 *       [--only=a,b] [--device=<serial>] [--expect-release] [--first-round-only]
 *       [--sim=captured-jam|alternating-1-2|none] [--sim-force] [--sim-bpm=N]
 *       [--gh-ledger] [--dry-run] [--tap-fallback] [--keep-volume] [--out=<dir>]
 *       [--timing-gate=off|warn|fail]
 *
 * Each drive is judged twice: by `verify-first-round.mjs` (did the coach say
 * the right thing at the right mark) and by `observed-timing.mjs` (did the
 * audio actually get there in time). The second is what `--timing-gate`
 * controls, and it now defaults to `fail` — see `timingVerdictFromExit`. Its
 * hard finding is `barsAtOrPastPunch`: a call still sounding when the athlete
 * threw, which is the one guarantee the whole call-placement design exists to
 * provide.
 *
 * Outputs tools/analysis/suites/<epoch>/{summary.json,summary.md,suite.log}
 * plus one session dir per drive. Exit: 1 any FAIL/ERROR, 4 any STALE (after
 * one manifest regen + retry), 2 any WARN, else 0.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  LOGCAT_FILTER,
  PACKAGE,
  adbShell,
  dumpUi,
  ensureDir,
  findTapTarget,
  pickDevice,
  sleep,
  tap,
  waitForLogLine,
  waitForUiTarget,
} from './drive-workout-first-round.mjs'
import { boolField, extractField, recordsWithTag } from './logcat.mjs'
import { renderObservedTable, summarizeObserved } from './observed-summary.mjs'
import { parseLogcat } from './verify-first-round.mjs'

// `import.meta.url` is null under jest's CommonJS transform (cwd = repo root there).
const REPO_ROOT = import.meta.url
  ? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  : process.cwd()
const MANIFESTS_DIR = join(REPO_ROOT, 'tools', 'analysis', 'manifests')
const SUITES_DIR = join(REPO_ROOT, 'tools', 'analysis', 'suites')

/** Walkout + countdown allowance before round 1's bell. */
export const WALKOUT_ALLOWANCE_MS = 90_000
/** Slack past the last planned boundary before a drive is `timeout`. */
export const END_SLACK_MS = 60_000
const APP_READY_TIMEOUT_MS = 120_000
const QA_RUN_TIMEOUT_MS = 15_000
const RUNNER_START_TIMEOUT_MS = 60_000
const AUTOSTART_TIMEOUT_MS = 20_000
const COUNTDOWN_TIMEOUT_MS = 20_000
const GRACE_MS = 3_000

// ---------------------------------------------------------------------------
// Pure helpers (jest-guarded in __tests__/verify-suite.test.js)
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = {
    all: false,
    only: [],
    vocab: 'numbers',
    device: undefined,
    expectRelease: false,
    launch: undefined,
    firstRoundOnly: false,
    sim: 'captured-jam',
    simForce: false,
    simBpm: undefined,
    ghLedger: false,
    dryRun: false,
    tapFallback: false,
    keepVolume: false,
    out: undefined,
    timingGate: 'fail',
  }
  for (const a of argv) {
    if (a === '--all') args.all = true
    else if (a.startsWith('--only=')) args.only = a.slice('--only='.length).split(',').filter(Boolean)
    else if (a.startsWith('--vocab=')) args.vocab = a.slice('--vocab='.length)
    else if (a.startsWith('--device=')) args.device = a.slice('--device='.length)
    else if (a === '--expect-release') args.expectRelease = true
    else if (a.startsWith('--launch=')) args.launch = a.slice('--launch='.length)
    else if (a === '--first-round-only') args.firstRoundOnly = true
    else if (a.startsWith('--sim=')) args.sim = a.slice('--sim='.length)
    else if (a === '--sim-force') args.simForce = true
    else if (a.startsWith('--sim-bpm=')) args.simBpm = Number(a.slice('--sim-bpm='.length))
    else if (a === '--gh-ledger') args.ghLedger = true
    else if (a === '--dry-run') args.dryRun = true
    else if (a === '--tap-fallback') args.tapFallback = true
    else if (a === '--keep-volume') args.keepVolume = true
    else if (a.startsWith('--out=')) args.out = a.slice('--out='.length)
    else if (a.startsWith('--timing-gate=')) args.timingGate = a.slice('--timing-gate='.length)
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!['off', 'warn', 'fail'].includes(args.timingGate)) {
    throw new Error(`--timing-gate must be off, warn or fail, got '${args.timingGate}'`)
  }
  if (!['numbers', 'techniques', 'both'].includes(args.vocab)) {
    throw new Error(`--vocab must be numbers, techniques or both, got '${args.vocab}'`)
  }
  if (!args.all && args.only.length === 0) {
    throw new Error('Pass --all or --only=<id,...>')
  }
  args.launch ??= args.expectRelease ? 'cold' : 'warm'
  if (!['cold', 'warm'].includes(args.launch)) throw new Error(`--launch must be cold or warm`)
  if (args.simBpm !== undefined && !(args.simBpm >= 40 && args.simBpm <= 400)) {
    throw new Error('--sim-bpm must be 40..400')
  }
  return args
}

/** The `punchcraft://qa/run` URL for one drive. Always carries qa=1 so the flag persists. */
export function buildRunUrl({ workout, vocab, sim, simForce, simBpm, nonce }) {
  const params = [
    ['workout', workout],
    ['vocab', vocab],
    ['sim', sim ?? 'none'],
    ...(simForce ? [['simForce', '1']] : []),
    ...(simBpm !== undefined ? [['simBpm', String(simBpm)]] : []),
    ['autostart', '1'],
    ['qa', '1'],
    ['nonce', nonce],
  ]
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&')
  return `punchcraft://qa/run?${query}`
}

/**
 * Single-quote a URL for the DEVICE shell. adb joins its arguments with
 * spaces and hands them to `sh -c` on the device, where a bare `&` forks;
 * the quotes survive the host because execFile passes them verbatim.
 */
export function quoteForDeviceShell(url) {
  return `'${url.replace(/'/g, '%27')}'`
}

/** `adb [-s id] shell am start …` argv for the scheme-resolved intent. */
export function launchIntentArgs(url, deviceId) {
  return [
    ...(deviceId ? ['-s', deviceId] : []),
    'shell',
    'am',
    'start',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    quoteForDeviceShell(url),
    PACKAGE,
  ]
}

/** Wall-clock cap for one drive, from the manifest's whole-session shape. */
export function budgetMs(manifest, { firstRoundOnly = false } = {}) {
  const schedule = Array.isArray(manifest.scheduleMs) && manifest.scheduleMs.length > 0
    ? manifest.scheduleMs
    : [{ workMs: manifest.workDurationMs ?? 240_000, restMs: 0 }]
  const planned = firstRoundOnly
    ? schedule[0].workMs
    : schedule.reduce((sum, r) => sum + r.workMs + r.restMs, 0)
  return WALKOUT_ALLOWANCE_MS + planned + END_SLACK_MS
}

/** `cmd media_session volume --stream 3 --get` → { level, min, max } or null. */
export function parseVolumeGet(text) {
  const m = String(text).match(/volume is (\d+) in range \[(\d+)\.\.(\d+)\]/)
  return m ? { level: Number(m[1]), min: Number(m[2]), max: Number(m[3]) } : null
}

/** One line of audiotrack-count.sh → { ours, others, system, pid } or null. */
export function parseAudioTrackReading(text) {
  const m = String(text).match(/ours=(\d+)\s+others=(\d+)\s+system=(\d+)\s+pid=(\d+)/)
  return m ? { ours: Number(m[1]), others: Number(m[2]), system: Number(m[3]), pid: Number(m[4]) } : null
}

export function verdictFromVerifyExit(code) {
  switch (code) {
    case 0:
      return 'PASS'
    case 2:
      return 'WARN'
    case 1:
      return 'FAIL'
    case 4:
      return 'STALE'
    default:
      return 'ERROR'
  }
}

/**
 * The timing analyzer's exit code as a verdict, under the staged gate.
 *
 * Deliberately NOT folded into `verdictFromVerifyExit`. That function judges
 * the correlator, is pure, exported and unit-tested, and its four codes mean
 * what they have always meant; overloading it would make one call site's
 * behaviour depend on a flag the other call site does not have.
 *
 * The gate was staged, because one that fails on its first contact with the
 * fleet teaches everyone to pass `--timing-gate=off`:
 *   off  — measure and report, judge nothing.
 *   warn — a hard finding is a WARN. Used to establish the baseline.
 *   fail — a hard finding is a FAIL. **Now the default.**
 *
 * Staging is finished. The pre-floor baseline measured 41 calls landing at or
 * past the punch across 24 drives; the post-floor run measured 1. That is the
 * regression this gate now exists to prevent, and the number is small enough
 * that a new one is a signal rather than noise.
 *
 * It is flipped with that last violation still outstanding, deliberately:
 * `quick-coast-reset/numbers` has one bar at −3.9 ms, so a full suite FAILS
 * today. That is the gate telling the truth — never-late has no tolerance by
 * design — not a gate that needs loosening. Do not raise its threshold to get
 * green; either fix the bar or accept a red suite until the audio path is
 * steadier (the tail that causes it is `PLAYHEAD_TO_SPEAKER_MS`, still
 * unmeasured).
 */
export function timingVerdictFromExit(code, gate) {
  if (gate === 'off' || code === null || code === undefined) return 'PASS'
  switch (code) {
    case 0:
      return 'PASS'
    case 2:
      return 'WARN'
    case 1:
      return gate === 'fail' ? 'FAIL' : 'WARN'
    default:
      // The analyzer crashed or could not read the capture. That is a broken
      // instrument, not a broken coach: never upgrade it past WARN, or a bad
      // logcat fails a drive that may well have been perfect.
      return 'WARN'
  }
}

/** The more severe of two verdicts, by `aggregateVerdicts`' own ordering. */
export function worstVerdict(a, b) {
  const rank = (v) => (v === 'FAIL' || v === 'ERROR' ? 3 : v === 'STALE' ? 2 : v === 'WARN' ? 1 : 0)
  return rank(b) > rank(a) ? b : a
}

/** Suite exit code: 1 any FAIL/ERROR, 4 any STALE, 2 any WARN, else 0. */
export function aggregateVerdicts(verdicts) {
  if (verdicts.some((v) => v === 'FAIL' || v === 'ERROR')) return 1
  if (verdicts.some((v) => v === 'STALE')) return 4
  if (verdicts.some((v) => v === 'WARN')) return 2
  return 0
}

/**
 * Compact per-drive stats for the ledger's "Top mismatches" cell — counted
 * generically by the verdict's status key so a renamed category still lands.
 */
export function compactStats(report) {
  const counts = {}
  for (const v of report?.verdicts ?? []) {
    const status = v.status ?? v.verdict ?? v.category ?? 'unknown'
    counts[status] = (counts[status] ?? 0) + 1
  }
  const parts = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k}=${n}`)
  parts.push(`extras=${report?.extras?.length ?? 0}`)
  parts.push(`reanchor=${report?.reanchorCount ?? 0}`)
  return parts.join(' ')
}

export function parseCompactStats(cell) {
  const out = {}
  for (const m of String(cell ?? '').matchAll(/([a-zA-Z-]+)=(\d+)/g)) out[m[1]] = Number(m[2])
  return out
}

/** Everything that is not a clean match: the number the next row compares against. */
export function mismatchTotal(stats) {
  return Object.entries(stats)
    .filter(([k]) => !['matched', 'extras', 'reanchor'].includes(k))
    .reduce((sum, [, n]) => sum + n, 0)
}

export function closerThan(previousStats, currentStats) {
  if (!previousStats || Object.keys(previousStats).length === 0) return 'first'
  const prev = mismatchTotal(previousStats)
  const cur = mismatchTotal(currentStats)
  if (cur < prev) return 'closer'
  if (cur > prev) return 'farther'
  return 'same'
}

const LEDGER_HEADER = '| Drive | Timestamp | Commit | Verdict | Top mismatches | Closer? |'

/** Rows already in the issue's Test-drive results table, oldest first. */
export function ledgerRows(body) {
  const lines = body.split(/\r?\n/)
  const at = lines.findIndex((l) => l.trim() === LEDGER_HEADER)
  if (at === -1) return []
  const rows = []
  for (let i = at + 2; i < lines.length; i += 1) {
    if (!lines[i].trim().startsWith('|')) break
    rows.push(lines[i].trim())
  }
  return rows
}

export function ledgerRow({ drive, timestamp, sha, verdict, stats, closer }) {
  return `| ${drive} | ${timestamp} | ${sha} | ${verdict} | ${stats} | ${closer} |`
}

/**
 * Append one drive to the issue body's table. The drive number and the
 * Closer? column come from the rows already there.
 */
export function appendLedgerRow(body, { timestamp, sha, verdict, stats }) {
  const lines = body.split(/\r?\n/)
  const at = lines.findIndex((l) => l.trim() === LEDGER_HEADER)
  if (at === -1) throw new Error('issue body has no Test-drive results table')
  const rows = ledgerRows(body)
  const previous = rows.at(-1)
  const previousStats = previous ? parseCompactStats(previous.split('|')[5]) : null
  const row = ledgerRow({
    drive: rows.length + 1,
    timestamp,
    sha,
    verdict,
    stats,
    closer: closerThan(previousStats, parseCompactStats(stats)),
  })
  const insertAt = at + 2 + rows.length
  lines.splice(insertAt, 0, row)
  return lines.join('\n')
}

/** The [LOOP] issue whose body names `workoutId` on its `**Workout id**` line. */
export function findLoopIssue(issues, workoutId) {
  const needle = new RegExp(`\\*\\*Workout id\\*\\*:\\s*\`${workoutId}\``)
  return issues.find((issue) => needle.test(issue.body ?? '')) ?? null
}

/** Which drives to run, from the manifest files on disk and the args. */
export function planJobs(manifestFiles, { only = [], vocab = 'numbers' }) {
  const numeric = manifestFiles.filter((f) => f.endsWith('.json') && !f.endsWith('.techniques.json'))
  const ids = numeric.map((f) => f.replace(/\.json$/, '')).sort()
  const wanted = only.length > 0 ? ids.filter((id) => only.includes(id)) : ids
  const missing = only.filter((id) => !ids.includes(id))
  if (missing.length > 0) throw new Error(`no manifest for: ${missing.join(', ')}`)
  const vocabs = vocab === 'both' ? ['numbers', 'techniques'] : [vocab]
  const jobs = []
  for (const id of wanted) {
    for (const v of vocabs) {
      const file = v === 'techniques' ? `${id}.techniques.json` : `${id}.json`
      if (!manifestFiles.includes(file)) {
        throw new Error(`no ${v} manifest for ${id} — run first-round-manifest.ts --workout=${id} --vocab=${v}`)
      }
      jobs.push({ workoutId: id, vocab: v, manifestFile: file, dirName: v === 'techniques' ? `${id}.techniques` : id })
    }
  }
  return jobs
}

export function renderSummaryMd(rows, meta) {
  const lines = []
  lines.push(`# Suite ${meta.suiteId}`)
  lines.push('')
  lines.push(
    `device ${meta.deviceId} · ${meta.launch} launch · vocab ${meta.vocab} · sim ${meta.sim} · ${meta.firstRoundOnly ? 'first round only' : 'full sessions'} · timing gate ${meta.timingGate ?? 'warn'} · ${rows.length} drives · exit ${meta.exitCode}`,
  )
  lines.push('')
  // "voice onset (status event, ms)" — NOT the audible onset. This column is
  // the raw `playing: true` latency, which fires ~95 ms before sound leaves
  // the device (`OBSERVER_ONSET_SKEW_MS` in observed-timing.mjs). Naming it
  // plainly is the point: the raw and corrected views must never be read as
  // the same number.
  //
  // That ~95 now covers every kind in this column. It used to include
  // `intro`, `recovery`, `round-warning` and `metronome`, which are exactly
  // the kinds `observed-timing.mjs` refused to correct because 95 had never
  // been measured on `createAudioPlaylist` — so the sentence above was
  // asserting the constant across the boundary the analyzer was careful to
  // keep. Plan 5b measured the playlist path at 94.8 ms and the claim is now
  // true as written.
  lines.push('| workout | vocab | verdict | reason | verify | timing | breath min / p5 | at·past punch | under floor | stats | voice onset (status event, ms) | instrument onset (ms) | AudioTracks arm→end | elapsed |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const r of rows) {
    const voice = r.observed?.byKind
      ? Object.entries(r.observed.byKind)
          .map(([k, v]) => `${k} ${v.onset.medianMs ?? '—'}/${v.onset.p95Ms ?? '—'}`)
          .join(', ')
      : '—'
    const inst = r.observed?.instrument?.n > 0 ? `${r.observed.instrument.latency.medianMs}/${r.observed.instrument.latency.p95Ms}` : '—'
    const tracks = `${r.audioTracks?.arm?.ours ?? '—'}→${r.audioTracks?.end?.ours ?? '—'}`
    const f = r.breathFloor
    // The two floor cells are separate on purpose: `at·past punch` is the
    // correctness gate and any non-zero is a defect, `under floor` is the
    // comfort target and is expected to be non-zero until the clamp moves.
    // One combined cell would let a reader's eye slide over the first.
    const breath = f ? `${f.minBreathMs ?? '—'} / ${f.p5BreathMs ?? '—'}` : '—'
    const past = f ? String(f.barsAtOrPastPunch) : '—'
    const under = f ? `${f.barsUnderFloor}/${f.n}${f.barsUnderFloorRatio === null ? '' : ` (${Math.round(f.barsUnderFloorRatio * 1000) / 10}%)`}` : '—'
    const timing = r.timingVerdict ? `${r.timingExit ?? '—'} ${r.timingVerdict}` : '—'
    lines.push(
      `| ${r.workoutId} | ${r.vocab} | ${r.verdict} | ${r.reason ?? ''} | ${r.verifyExit ?? '—'} | ${timing} | ${breath} | ${past} | ${under} | ${r.stats ?? '—'} | ${voice || '—'} | ${inst} | ${tracks} | ${Math.round((r.elapsedMs ?? 0) / 1000)}s |`,
    )
  }
  const hardRows = rows.filter((r) => (r.timingHard?.length ?? 0) > 0)
  if (hardRows.length > 0) {
    lines.push('')
    lines.push('### Timing — hard findings')
    lines.push('')
    for (const r of hardRows) for (const h of r.timingHard) lines.push(`- **${r.workoutId} (${r.vocab})** — ${h}`)
  }
  return lines.join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// Device side
// ---------------------------------------------------------------------------

function adbFile(argv, { allowFail = false } = {}) {
  try {
    return execFileSync('adb', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    if (allowFail) return ''
    throw error
  }
}

function sendIntent(url, deviceId) {
  return adbFile(launchIntentArgs(url, deviceId))
}

function getVolume(deviceId) {
  return parseVolumeGet(adbShell('cmd media_session volume --stream 3 --get', deviceId))
}

function setVolume(deviceId, level) {
  adbShell(`cmd media_session volume --stream 3 --set ${level}`, deviceId)
}

/** Silence the media stream; returns the level to restore, or null. */
function muteForSuite(deviceId, slog) {
  const before = getVolume(deviceId)
  if (before === null) {
    slog('WARN: could not read media volume — leaving it alone')
    return null
  }
  if (before.level === 0) return before.level
  setVolume(deviceId, 0)
  const after = getVolume(deviceId)
  if (after === null || after.level !== 0) {
    slog('media_session --set 0 did not land — falling back to VOLUME_DOWN x15')
    for (let i = 0; i < 15; i += 1) adbShell('input keyevent KEYCODE_VOLUME_DOWN', deviceId)
  }
  slog(`media volume ${before.level} → 0 (restored on exit)`)
  return before.level
}

function audioTrackReading(deviceId, label) {
  const script = join(REPO_ROOT, 'tools', 'analysis', 'audiotrack-count.sh')
  const run = spawnSync('bash', [script, '--label', label], {
    encoding: 'utf8',
    env: { ...process.env, ANDROID_SERIAL: deviceId },
  })
  if (run.error) return { error: run.error.message }
  const parsed = parseAudioTrackReading(run.stdout)
  return parsed ?? { error: (run.stdout || run.stderr || '').trim().slice(0, 120) }
}

function gitShortSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

/** Whole-session health counters, the drive-full-workout.mjs set plus the observers. */
function sessionCounters(logcatText) {
  const events = parseLogcat(logcatText)
  const count = (type) => events.filter((e) => e.type === type).length
  const re = (pattern) => (logcatText.match(pattern) ?? []).length
  return {
    workEntered: re(/transition: 'work-entered'/g),
    restEntered: re(/transition: 'rest-entered'/g),
    completed: re(/transition: 'completed'/g),
    cancelled: re(/transition: 'cancelled'/g),
    leadInsDispatched: re(/kind: 'lead-in'/g),
    callsDispatched: re(/kind: 'call'/g),
    restScriptsLoaded: re(/recovery loaded/g),
    warnCeremonies: re(/round warning prepared/g),
    voiceClipMissing: count('voice.clipMissing'),
    instrumentClipMissing: re(/puncheokie\.instrument\.clipMissing/g),
    playFailed: re(/voice\.playFailed/g),
    redbox: re(/AndroidRuntime/g),
    qaBlocked: re(/puncheokie\.qa\.run\.blocked/g),
  }
}

// ---------------------------------------------------------------------------
// One drive
// ---------------------------------------------------------------------------

async function driveOne(ctx, job, attempt = 1) {
  const { deviceId, args, slog, suiteDir } = ctx
  const dir = join(suiteDir, attempt === 1 ? job.dirName : `${job.dirName}.retry`)
  ensureDir(dir)
  const manifestPath = join(MANIFESTS_DIR, job.manifestFile)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const budget = budgetMs(manifest, { firstRoundOnly: args.firstRoundOnly })
  const nonce = `suite-${ctx.suiteId}-${job.dirName}-${attempt}`
  const url = buildRunUrl({
    workout: job.workoutId,
    vocab: job.vocab,
    sim: args.sim,
    simForce: args.simForce,
    simBpm: args.simBpm,
    nonce,
  })
  const startedAt = Date.now()
  const row = {
    workoutId: job.workoutId,
    vocab: job.vocab,
    attempt,
    sessionDir: dir,
    manifest: job.manifestFile,
    timelineHash: manifest.identity?.timelineHash ?? null,
    url,
    budgetMs: budget,
    verdict: 'ERROR',
    reason: null,
    verifyExit: null,
    timingExit: null,
    timingVerdict: null,
    timingHard: null,
    timingSoft: null,
    breathFloor: null,
    stats: null,
    build: {},
    audioTracks: {},
    observed: null,
    counters: null,
    elapsedMs: 0,
  }
  slog(`── ${job.workoutId} (${job.vocab}) attempt ${attempt} · budget ${Math.round(budget / 1000)}s`)
  slog(`   ${url}`)

  adbShell(`am force-stop ${PACKAGE}`, deviceId)
  await sleep(1000)
  adbShell('logcat -c', deviceId)
  const logcatProc = spawn('adb', ['-s', deviceId, 'logcat', '-v', 'time', ...LOGCAT_FILTER], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const logcatOut = createWriteStream(join(dir, 'logcat.txt'))
  logcatProc.stdout.pipe(logcatOut)
  const stopLogcat = () => {
    try {
      logcatProc.kill('SIGTERM')
    } catch {}
    try {
      logcatOut.close()
    } catch {}
  }
  ctx.activeCleanup = () => {
    stopLogcat()
    try {
      adbShell(`am force-stop ${PACKAGE}`, deviceId)
    } catch {}
  }

  const fail = (reason, verdict = 'ERROR') => {
    row.verdict = verdict
    row.reason = reason
    slog(`   ${verdict}: ${reason}`)
  }

  try {
    adbShell('input keyevent KEYCODE_WAKEUP', deviceId)
    await sleep(800)
    try {
      adbShell('wm dismiss-keyguard', deviceId)
    } catch {}

    let tapped = false
    if (args.launch === 'warm') {
      slog('   LAUNCHER cold start → waiting for puncheokie.app.ready')
      adbShell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1`, deviceId)
      const ready = await waitForLogLine(dir, 'puncheokie.app.ready', APP_READY_TIMEOUT_MS)
      if (!ready) {
        fail('launch-failed: app.ready never logged (dev launcher picker up? Metro down?)')
        return finish()
      }
      slog(`   app.ready after ${Math.round(ready.elapsed / 1000)}s → sending intent`)
      sendIntent(url, deviceId)
    } else {
      slog('   cold launch with the intent')
      sendIntent(url, deviceId)
    }

    // The nonce is NOT on the tag line — it is one of the last fields, and
    // `waitForLogLine` matches a single line by design. So wait for the code,
    // then confirm the nonce against the STITCHED record.
    const stagedRun = () =>
      recordsWithTag(existsSync(join(dir, 'logcat.txt')) ? readFileSync(join(dir, 'logcat.txt'), 'utf8') : '', 'puncheokie.qa.run').find(
        (r) => r.body.includes(nonce),
      )
    let qaRun = await waitForLogLine(dir, 'puncheokie.qa.run', QA_RUN_TIMEOUT_MS)
    let record = qaRun ? stagedRun() : undefined
    if (!record) {
      slog('   qa.run for this nonce not seen — re-sending the intent once')
      sendIntent(url, deviceId)
      qaRun = await waitForLogLine(dir, 'puncheokie.qa.run.duplicate', QA_RUN_TIMEOUT_MS, (l) => l.includes(nonce)) ?? qaRun
      record = stagedRun()
    }
    if (!record) {
      if (args.tapFallback && args.launch === 'warm') {
        slog('   deep link never landed — tap fallback (dev builds only)')
        await tapFallback(deviceId, job, slog)
        tapped = true
      } else {
        fail('launch-failed: qa.run never logged (deep link not routed)')
        return finish()
      }
    } else {
      const body = record.body
      row.build = {
        dev: boolField(body, 'dev') ?? null,
        gitSha: extractField(body, 'gitSha') ?? null,
        hostSha: ctx.hostSha,
        autostart: boolField(body, 'autostart') ?? null,
        sim: extractField(body, 'sim') ?? null,
        qaEnabled: boolField(body, 'qaEnabled') ?? null,
      }
      slog(`   qa.run: dev=${row.build.dev} gitSha=${row.build.gitSha} autostart=${row.build.autostart} sim=${row.build.sim}`)
      if (args.expectRelease && row.build.dev !== false) {
        fail(`build-mismatch: expected a release build, qa.run reports dev=${row.build.dev}`, 'FAIL')
        return finish()
      }
      if (row.build.gitSha && ctx.hostSha !== 'unknown' && !row.build.gitSha.startsWith(ctx.hostSha) && !ctx.hostSha.startsWith(row.build.gitSha)) {
        slog(`   WARN: build gitSha ${row.build.gitSha} ≠ host ${ctx.hostSha} — the installed bundle is not this checkout`)
        row.build.shaMismatch = true
      }
      if (row.build.autostart === false) {
        fail('qa-flag-off: autostart was downgraded (persisted QA flag off on the device)')
        return finish()
      }
    }

    const armed = await waitForLogLine(dir, 'puncheokie.runner.start', RUNNER_START_TIMEOUT_MS)
    if (!armed) {
      fail('runner.start never logged')
      return finish()
    }
    row.build.source = extractField(armed.line, 'source') ?? null
    slog(`   runner armed · source=${row.build.source}`)
    if (args.sim !== 'none' && row.build.source !== null && !String(row.build.source).includes('sim')) {
      slog(`   WARN: tracker-when-sim-expected (source=${row.build.source}; pass --sim-force to override live gloves)`)
      row.sourceMismatch = true
    }
    row.audioTracks.arm = audioTrackReading(deviceId, `${job.workoutId}-arm`)

    if (!tapped) {
      const auto = await waitForLogLine(dir, 'puncheokie.qa.autostart', AUTOSTART_TIMEOUT_MS)
      if (!auto) {
        fail('no autostart: qa.autostart never logged')
        return finish()
      }
    }
    const countdown = await waitForLogLine(
      dir,
      'puncheokie.round.boundary',
      COUNTDOWN_TIMEOUT_MS,
      (l) => l.includes("transition: 'countdown-entered'"),
    )
    if (!countdown) {
      fail('countdown never entered')
      return finish()
    }
    slog(`   countdown entered — running to ${args.firstRoundOnly ? 'rest-entered' : 'completed'} (cap ${Math.round(budget / 1000)}s)`)

    const endNeedle = args.firstRoundOnly ? "transition: 'rest-entered'" : "transition: 'completed'"
    const ended = await waitForLogLine(
      dir,
      'puncheokie.round.boundary',
      budget,
      (l) => l.includes(endNeedle) || l.includes("transition: 'cancelled'"),
    )
    if (!ended) {
      fail(`timeout: no ${endNeedle} within ${Math.round(budget / 1000)}s`)
    } else if (ended.line.includes("transition: 'cancelled'")) {
      fail('workout cancelled on the device')
    } else {
      slog(`   ${args.firstRoundOnly ? 'round 1' : 'session'} ended after ${Math.round(ended.elapsed / 1000)}s`)
    }
    await sleep(GRACE_MS)
    row.audioTracks.end = audioTrackReading(deviceId, `${job.workoutId}-end`)
    return finish()
  } catch (error) {
    fail(`exception: ${error.message}`)
    return finish()
  }

  async function finish() {
    try {
      adbShell(`am force-stop ${PACKAGE}`, deviceId)
    } catch {}
    stopLogcat()
    ctx.activeCleanup = null
    await sleep(1000)
    const logPath = join(dir, 'logcat.txt')
    const logcatText = existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''
    row.counters = sessionCounters(logcatText)
    row.observed = summarizeObserved(logcatText)
    writeFileSync(join(dir, 'observed-summary.json'), JSON.stringify(row.observed, null, 2) + '\n', 'utf8')

    // The verifier judges round 1 whenever the capture got that far — a
    // launch failure has no round to judge and keeps its ERROR.
    const reachedRound = /transition: 'work-entered'/.test(logcatText)
    if (reachedRound) {
      const verify = spawnSync(
        'node',
        [join(REPO_ROOT, 'tools', 'analysis', 'verify-first-round.mjs'), '--manifest', manifestPath, '--session', dir],
        { encoding: 'utf8', cwd: REPO_ROOT },
      )
      row.verifyExit = verify.status
      writeFileSync(join(dir, 'verify-stdout.txt'), (verify.stdout ?? '') + (verify.stderr ?? ''), 'utf8')
      const reportPath = join(dir, 'verify-report.json')
      if (existsSync(reportPath)) {
        const report = JSON.parse(readFileSync(reportPath, 'utf8'))
        row.stats = compactStats(report)
        row.health = report.health ?? null
      }
      const verdict = verdictFromVerifyExit(verify.status)
      if (row.reason === null || verdict === 'FAIL') {
        // A timeout after a judged round 1 is still reported (the reason
        // stays), but the verifier's word outranks a clean run's default.
        if (row.reason === null) row.verdict = verdict
        else if (verdict === 'FAIL') row.verdict = 'FAIL'
      }
      slog(`   verify exit ${verify.status} → ${verdict}${row.stats ? ` · ${row.stats}` : ''}`)
      if (verdict === 'STALE' && attempt === 1) {
        slog('   STALE — regenerating the manifest and re-driving once')
        // The generator imports manifests that `require('…wav')`; the stub
        // loader makes those a placeholder under Node (see wav-stub.mjs).
        const regen = spawnSync(
          process.execPath,
          [
            '--import',
            './tools/analysis/wav-stub.mjs',
            '--import',
            'tsx',
            join('tools', 'analysis', 'first-round-manifest.ts'),
            `--workout=${job.workoutId}`,
            `--vocab=${job.vocab}`,
          ],
          { encoding: 'utf8', cwd: REPO_ROOT },
        )
        if (regen.status === 0) {
          row.elapsedMs = Date.now() - startedAt
          ctx.rows.push({ ...row, superseded: true })
          return driveOne(ctx, job, 2)
        }
        slog(`   manifest regen failed (${regen.status}); keeping STALE`)
      }

      // The timing analyzer, which this suite has never run. It writes its
      // own report into the drive directory, so a WARN here is always
      // traceable to named bars rather than to a number in this ledger.
      //
      // It runs AFTER the STALE retry path above returns, so a re-driven
      // workout is analyzed once, on the capture that was actually judged.
      if (args.timingGate !== 'off') {
        const timing = spawnSync(
          'node',
          [join(REPO_ROOT, 'tools', 'analysis', 'observed-timing.mjs'), '--session', dir],
          { encoding: 'utf8', cwd: REPO_ROOT },
        )
        row.timingExit = timing.status
        const timingReportPath = join(dir, 'observed-timing-report.json')
        if (existsSync(timingReportPath)) {
          const treport = JSON.parse(readFileSync(timingReportPath, 'utf8'))
          row.breathFloor = treport.breath?.floor ?? null
          row.timingHard = treport.verdict?.hard ?? []
          row.timingSoft = treport.verdict?.soft ?? []
        }
        const timingVerdict = timingVerdictFromExit(timing.status, args.timingGate)
        row.timingVerdict = timingVerdict
        // Only ever makes a drive worse. A clean timing report cannot rescue
        // a drive the correlator failed.
        row.verdict = worstVerdict(row.verdict, timingVerdict)
        const f = row.breathFloor
        slog(
          `   timing exit ${timing.status} → ${timingVerdict}` +
            (f ? ` · breath min ${f.minBreathMs ?? '—'} · at/past punch ${f.barsAtOrPastPunch} · under floor ${f.barsUnderFloor}/${f.n}` : ''),
        )
        for (const h of row.timingHard ?? []) slog(`   TIMING HARD: ${h}`)
      }
    }
    slog(`   ${renderObservedTable(row.observed).split('\n')[0]}`)
    if (row.counters.redbox > 0) slog(`   WARN: ${row.counters.redbox} AndroidRuntime lines in the capture`)
    if ((row.audioTracks.end?.ours ?? 0) >= 40) slog(`   WARN: AudioTracks at end ${row.audioTracks.end.ours} — within reach of the ceiling (GH #356)`)
    row.elapsedMs = Date.now() - startedAt
    writeFileSync(join(dir, 'drive.json'), JSON.stringify(row, null, 2) + '\n', 'utf8')
    return row
  }
}

/** Dev-build fallback: the tile → quick-start → radio → Hit It sequence. */
async function tapFallback(deviceId, job, slog) {
  const deadline = Date.now() + 60_000
  let tile = null
  while (Date.now() < deadline && !tile) {
    try {
      tile = findTapTarget(dumpUi(deviceId), { resourceId: `preset-${job.workoutId}` })
    } catch {}
    if (!tile) await sleep(2000)
  }
  if (!tile) throw new Error(`preset-${job.workoutId} tile never appeared`)
  tap(deviceId, tile.x, tile.y)
  await sleep(1500)
  const quick = await waitForUiTarget(deviceId, { resourceId: 'quick-start' }, 10_000)
  if (!quick) throw new Error('quick-start not found')
  tap(deviceId, quick.x, quick.y)
  await sleep(3000)
  if (job.vocab === 'techniques') {
    const radio = await waitForUiTarget(deviceId, { contentDescSubstring: 'Technique callouts' }, 10_000)
    if (!radio) throw new Error('Technique callouts radio not found')
    tap(deviceId, radio.x, radio.y)
    await sleep(800)
  }
  const hitIt = await waitForUiTarget(deviceId, { resourceId: 'start-workout' }, 10_000)
  if (!hitIt) throw new Error('start-workout not found')
  slog('   tapped Hit It')
  tap(deviceId, hitIt.x, hitIt.y)
}

// ---------------------------------------------------------------------------
// GitHub ledger
// ---------------------------------------------------------------------------

function ghLedger(rows, ctx) {
  const listed = execFileSync(
    'gh',
    ['issue', 'list', '--search', '[LOOP] in:title', '--state', 'open', '--json', 'number,title,body', '--limit', '60'],
    { encoding: 'utf8', cwd: REPO_ROOT },
  )
  const issues = JSON.parse(listed)
  const timestamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  for (const row of rows) {
    if (row.superseded) continue
    const issue = findLoopIssue(issues, row.workoutId)
    if (!issue) {
      ctx.slog(`ledger: no [LOOP] issue names workout id ${row.workoutId} — skipped`)
      continue
    }
    const stats = `${row.stats ?? row.reason ?? 'n/a'}${row.vocab === 'techniques' ? ' (techniques)' : ''}`
    let body
    try {
      body = appendLedgerRow(issue.body, { timestamp, sha: ctx.hostSha, verdict: row.verdict, stats })
    } catch (error) {
      ctx.slog(`ledger: #${issue.number} — ${error.message}`)
      continue
    }
    const tmp = join(tmpdir(), `loop-${issue.number}-${Date.now()}.md`)
    writeFileSync(tmp, body, 'utf8')
    execFileSync('gh', ['issue', 'edit', String(issue.number), '--body-file', tmp], { encoding: 'utf8', cwd: REPO_ROOT })
    ctx.slog(`ledger: #${issue.number} ← drive ${ledgerRows(body).length} (${row.verdict})`)
    issue.body = body
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const manifestFiles = existsSync(MANIFESTS_DIR) ? readdirSync(MANIFESTS_DIR) : []
  const jobs = planJobs(manifestFiles, args)
  const suiteId = String(Date.now())
  const suiteDir = args.out ?? join(SUITES_DIR, suiteId)
  const hostSha = gitShortSha()

  if (args.dryRun) {
    let total = 0
    console.log(`device: ${(() => { try { return pickDevice(args.device) } catch (e) { return `none (${e.message})` } })()}`)
    console.log(`launch: ${args.launch} · vocab ${args.vocab} · sim ${args.sim}${args.simForce ? ' (forced)' : ''} · ${args.firstRoundOnly ? 'first round only' : 'full sessions'} · host sha ${hostSha}`)
    console.log(`suite dir: ${suiteDir}`)
    for (const job of jobs) {
      const manifest = JSON.parse(readFileSync(join(MANIFESTS_DIR, job.manifestFile), 'utf8'))
      const budget = budgetMs(manifest, { firstRoundOnly: args.firstRoundOnly })
      total += budget
      console.log(`  ${job.workoutId.padEnd(26)} ${job.vocab.padEnd(10)} budget ${String(Math.round(budget / 1000)).padStart(4)}s  ${buildRunUrl({ workout: job.workoutId, vocab: job.vocab, sim: args.sim, simForce: args.simForce, simBpm: args.simBpm, nonce: 'dry' })}`)
    }
    console.log(`${jobs.length} drives · worst-case wall time ${Math.round(total / 60_000)} min (budgets are caps; a clean drive ends at its last boundary)`)
    return 0
  }

  ensureDir(suiteDir)
  const suiteLog = createWriteStream(join(suiteDir, 'suite.log'), { flags: 'a' })
  const slog = (msg) => {
    const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`
    console.log(line)
    suiteLog.write(line + '\n')
  }
  const deviceId = pickDevice(args.device)
  const ctx = { args, deviceId, slog, suiteDir, suiteId, hostSha, rows: [], activeCleanup: null }
  slog(`suite ${suiteId} · device ${deviceId} · ${jobs.length} drives · launch ${args.launch} · host sha ${hostSha}`)
  if (args.expectRelease) slog('expecting a RELEASE build (qa.run must report dev=false); swap back with `npm run android` afterwards')

  const restoreVolume = args.keepVolume ? null : muteForSuite(deviceId, slog)
  let restored = false
  const restore = () => {
    if (restored) return
    restored = true
    if (restoreVolume !== null && restoreVolume !== undefined) {
      try {
        setVolume(deviceId, restoreVolume)
        slog(`media volume restored to ${restoreVolume}`)
      } catch (error) {
        slog(`WARN: could not restore media volume (${error.message})`)
      }
    }
  }
  const onSignal = () => {
    slog('interrupted — force-stopping the app and restoring volume')
    try {
      ctx.activeCleanup?.()
    } catch {}
    restore()
    process.exit(130)
  }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  let exitCode = 0
  try {
    for (const job of jobs) {
      const row = await driveOne(ctx, job)
      ctx.rows.push(row)
      writeFileSync(join(suiteDir, 'summary.json'), JSON.stringify({ suiteId, deviceId, args, rows: ctx.rows }, null, 2) + '\n', 'utf8')
    }
    const judged = ctx.rows.filter((r) => !r.superseded)
    exitCode = aggregateVerdicts(judged.map((r) => r.verdict))
    const md = renderSummaryMd(judged, {
      suiteId,
      deviceId,
      launch: args.launch,
      vocab: args.vocab,
      sim: args.sim,
      firstRoundOnly: args.firstRoundOnly,
      timingGate: args.timingGate,
      exitCode,
    })
    writeFileSync(join(suiteDir, 'summary.md'), md, 'utf8')
    writeFileSync(join(suiteDir, 'summary.json'), JSON.stringify({ suiteId, deviceId, args, exitCode, rows: ctx.rows }, null, 2) + '\n', 'utf8')
    console.log('\n' + md)
    if (args.ghLedger) ghLedger(judged, ctx)
    slog(`done · exit ${exitCode} · ${join(suiteDir, 'summary.md')}`)
  } finally {
    restore()
    suiteLog.end()
  }
  return exitCode
}

const invokedDirectly = process.argv[1]?.endsWith('verify-suite.mjs')
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error)
      process.exit(1)
    })
}
