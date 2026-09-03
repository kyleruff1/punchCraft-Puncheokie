/**
 * Full-workout driver (Kyle, 2026-09-02): launch a click workout and let
 * it run ALL rounds + rests to completion — no first-round cutoff — while
 * capturing logcat for a whole-session summary. The first-round harness
 * stays the precision instrument; this is the sit-back preview.
 *
 * Run: node tools/analysis/drive-full-workout.mjs --workout=<id> [--device=<serial>]
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const workoutId = arg('workout')
const deviceId = arg('device') ?? process.env.ANDROID_SERIAL ?? '192.168.86.59:37979'
const vocab = arg('vocab') ?? 'numbers'
if (!workoutId) {
  console.error('usage: node tools/analysis/drive-full-workout.mjs --workout=<id> [--vocab=techniques]')
  process.exit(1)
}
if (vocab !== 'numbers' && vocab !== 'techniques') {
  console.error(`--vocab must be numbers or techniques, got '${vocab}'`)
  process.exit(1)
}

const log = (msg) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${msg}`)
const adbShell = (cmd) =>
  execFileSync('adb', ['-s', deviceId, 'shell', cmd], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })

function dumpUi() {
  adbShell('uiautomator dump /sdcard/ui.xml')
  return adbShell('cat /sdcard/ui.xml')
}
function findTapTarget(xml, resourceId) {
  const nodeRe = /<node[^>]*>/g
  let match
  while ((match = nodeRe.exec(xml)) !== null) {
    const node = match[0]
    if (!node.includes(`resource-id="${resourceId}"`)) continue
    const b = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    if (!b) continue
    const [, x1, y1, x2, y2] = b.map(Number)
    return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) }
  }
  return null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The vocab radio has no resource-id, only an accessibilityLabel
// (content-desc). Match on that so a full session can be driven in
// techniques from round one.
function findByContentDesc(xml, substr) {
  const nodeRe = /<node[^>]*>/g
  let match
  while ((match = nodeRe.exec(xml)) !== null) {
    const node = match[0]
    if (!node.match(new RegExp(`content-desc="[^"]*${substr}[^"]*"`))) continue
    const b = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/)
    if (!b) continue
    const [, x1, y1, x2, y2] = b.map(Number)
    return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) }
  }
  return null
}

async function tapWhenVisible(resourceId, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    let target = null
    try {
      target = findTapTarget(dumpUi(), resourceId)
    } catch {
      // uiautomator flakes on transitions; poll again.
    }
    if (target) {
      log(`tapping ${resourceId} at ${target.x},${target.y}`)
      adbShell(`input tap ${target.x} ${target.y}`)
      return true
    }
    await sleep(1500)
  }
  throw new Error(`${resourceId} never appeared`)
}

const sessionDir = join('tools', 'analysis', 'sessions', `${workoutId}-full-${Date.now()}`)
mkdirSync(sessionDir, { recursive: true })

// Fresh logcat, background capture for the whole session.
execFileSync('adb', ['-s', deviceId, 'logcat', '-c'])
const logcatPath = join(sessionDir, 'logcat.txt')
const logcat = spawn('adb', ['-s', deviceId, 'logcat', '-v', 'time',
  'ReactNativeJS:V', 'puncheokie:V', 'AndroidRuntime:E', 'System.err:W', '*:S'])
const chunks = []
logcat.stdout.on('data', (d) => chunks.push(d))

adbShell('input keyevent KEYCODE_WAKEUP')
try { adbShell('wm dismiss-keyguard') } catch { /* unlocked */ }

await tapWhenVisible(`preset-${workoutId}`)
await sleep(2500)
await tapWhenVisible('quick-start')
await sleep(3500)
// Flip the vocabulary BEFORE Hit It so every round compiles in it.
if (vocab === 'techniques') {
  const radio = findByContentDesc(dumpUi(), 'Technique callouts')
  if (!radio) throw new Error('Technique callouts radio not found on the live screen')
  log(`tapping Techniques radio at ${radio.x},${radio.y}`)
  adbShell(`input tap ${radio.x} ${radio.y}`)
  await sleep(800)
}
await tapWhenVisible('start-workout')
log(`workout started (${vocab}) — running to completion (no cutoff)`)

// Poll the captured stream for the completion transition. Generous cap:
// longest workout is 4x4min + 3x1min + walkout ~= 20.5min.
const CAP_MS = 26 * 60_000
const started = Date.now()
let outcome = 'timeout'
while (Date.now() - started < CAP_MS) {
  await sleep(10_000)
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.includes("transition: 'completed'")) { outcome = 'completed'; break }
  if (text.includes("transition: 'cancelled'")) { outcome = 'cancelled'; break }
}
await sleep(5_000)
logcat.kill()
writeFileSync(logcatPath, Buffer.concat(chunks))
log(`outcome: ${outcome} — logcat ${Buffer.concat(chunks).length} bytes -> ${logcatPath}`)

// Whole-session summary from the capture.
const text = Buffer.concat(chunks).toString('utf8')
const count = (re) => (text.match(re) ?? []).length
console.log(JSON.stringify({
  sessionDir,
  workoutId,
  outcome,
  workEntered: count(/transition: 'work-entered'/g),
  restEntered: count(/transition: 'rest-entered'/g),
  leadInsDispatched: count(/kind: 'lead-in'/g),
  callsDispatched: count(/kind: 'call'/g),
  restScriptsLoaded: count(/recovery loaded/g),
  warnCeremonies: count(/round warning prepared/g),
  playFailed: count(/voice\.playFailed/g),
  redbox: count(/AndroidRuntime/g),
}, null, 2))
