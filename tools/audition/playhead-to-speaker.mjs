/**
 * PLAYHEAD_TO_SPEAKER_MS — how long after the playhead starts moving does
 * sound actually leave the tablet (plan step 5c).
 *
 * ## What is left to measure, and why it needs a microphone
 *
 * `OBSERVER_ONSET_SKEW_MS = 95` closed the gap between "the player says it is
 * playing" and "the playhead is moving", and it was measured entirely
 * on-device — one play timed two ways against one clock, no external
 * reference needed. This is the remaining stretch, and it cannot be measured
 * that way: nothing on the device knows when air moved. So the recording is
 * the instrument, and the whole difficulty is putting the recording and the
 * device on one timeline.
 *
 * ## The three terms, and which one is dangerous
 *
 *   acoustic onset (PC epoch)  −  playhead moving (device epoch → PC epoch)
 *
 * 1. **Clock offset.** The tablet is ~1.5 s off this host. Measured by
 *    `clock-offset.mjs`, bounded by intersecting sample brackets. Known.
 * 2. **Acoustic flight.** ~3 µs/mm. With the mic a few cm from the speaker
 *    this is under a millisecond. Negligible if the mic is close, which is
 *    why the runbook says to put it there.
 * 3. **The wav's start epoch.** `anchor.mjs` derives it as `mtime − duration`
 *    — when ffmpeg closed the file, minus its exact byte-derived length. The
 *    close/flush delay is NOT bounded, and `session_report.py` already warns
 *    this formula can go stale. **This is the term that can silently ruin the
 *    answer**, so it gets a causality check rather than trust: the host
 *    records the epoch at which it asked the device to play, and a sound
 *    cannot be captured before the command that caused it. An anchor that
 *    puts the first onset earlier than its trigger is wrong by at least that
 *    much, and the run is rejected instead of reported.
 *
 * ## Reading the output
 *
 * The per-rep values are the whole distribution, not decoration. A tight
 * spread means the path is deterministic and the median is a real constant; a
 * wide one means the number is a summary of something that varies, which
 * matters more than its centre — the surviving −3.9 ms bar in the breath A/B
 * is a tail event, and tails are what this spread describes.
 *
 *   node tools/audition/playhead-to-speaker.mjs --session <dir> [--offset=N]
 *
 * Expects in <dir>: capture.wav, log.txt (adb logcat -v epoch), and
 * trigger.json ({ triggeredAtHostEpochMs }) written by the runbook.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { readWavHeader } from './anchor.mjs'

/** Below this the run is reported but flagged: too few reps to trust a tail. */
const MIN_REPS = 12

/**
 * Onset detection. The probe leaves ~400 ms of silence between plays, so this
 * does not need to be clever — it needs to be honest about what it found.
 * A short-term energy envelope, then the first frame in each burst that
 * crosses a threshold set from the noise floor rather than from a constant,
 * because room noise differs per session and a fixed threshold silently
 * finds nothing (or everything) when it changes.
 */
export function detectOnsets(samples, sampleRate, { frameMs = 1, minGapMs = 200 } = {}) {
  const frame = Math.max(1, Math.round((sampleRate * frameMs) / 1000))
  const env = []
  for (let i = 0; i + frame <= samples.length; i += frame) {
    let peak = 0
    for (let j = i; j < i + frame; j += 1) {
      const v = Math.abs(samples[j])
      if (v > peak) peak = v
    }
    env.push(peak)
  }
  if (env.length === 0) return { onsets: [], noiseFloor: 0, threshold: 0 }

  // Noise floor as the 20th percentile of the envelope: robust to the bursts
  // themselves, which is the point — a mean would be dragged up by the very
  // events being detected.
  const sorted = [...env].sort((a, b) => a - b)
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)]
  const peak = sorted[sorted.length - 1]
  // Geometric midpoint between floor and peak: scale-free, so it behaves the
  // same on a hot recording and a quiet one.
  const threshold = Math.max(noiseFloor * 4, Math.sqrt(Math.max(noiseFloor, 1e-9) * peak))

  const minGapFrames = Math.round(minGapMs / frameMs)
  const onsets = []
  let lastIdx = -Infinity
  for (let i = 0; i < env.length; i += 1) {
    if (env[i] < threshold) continue
    if (i - lastIdx < minGapFrames) continue
    onsets.push((i * frame) / sampleRate)
    lastIdx = i
  }
  return { onsets, noiseFloor, threshold }
}

/** 16-bit PCM mono/stereo → Float32 mono (channel 0). */
function readWavSamples(path) {
  const hdr = readWavHeader(path)
  const buf = readFileSync(path)
  if (hdr.bitsPerSample !== 16) throw new Error(`expected 16-bit PCM, got ${hdr.bitsPerSample}`)
  // Walk to the data chunk rather than assuming offset 44.
  let offset = 12
  let dataStart = null
  let dataBytes = 0
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'data') {
      dataStart = offset + 8
      dataBytes = Math.min(size, buf.length - dataStart)
      break
    }
    offset += 8 + size + (size % 2)
  }
  if (dataStart === null) throw new Error('no data chunk')
  const frames = Math.floor(dataBytes / (2 * hdr.channels))
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i += 1) {
    out[i] = buf.readInt16LE(dataStart + i * 2 * hdr.channels) / 32768
  }
  return { samples: out, sampleRate: hdr.sampleRate, durationS: frames / hdr.sampleRate }
}

/** Per-rep records from the probe: one JSON-ish logcat block per play. */
export function parseRepLines(text) {
  const reps = []
  const lines = String(text).split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('puncheokie.ruler.rep')) continue
    // The record spans continuation lines; gather until the closing brace.
    let block = lines[i]
    for (let j = i + 1; j < lines.length && !block.includes('}'); j += 1) block += ' ' + lines[j]
    const num = (k) => {
      const m = block.match(new RegExp(`${k}:\\s*(-?\\d+(?:\\.\\d+)?)`))
      return m ? Number(m[1]) : null
    }
    const asset = block.match(/asset:\s*'([^']*)'/)?.[1] ?? null
    const playheadEpochMs = num('playheadEpochMs')
    const statusEpochMs = num('statusEpochMs')
    if (playheadEpochMs === null) continue
    reps.push({ asset, rep: num('rep'), playheadEpochMs, statusEpochMs, statusMs: num('statusMs'), playheadMs: num('playheadMs') })
  }
  return reps
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const pct = (v, p) => {
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]
}
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null)

export function analyze({ wavPath, logText, offsetMs, triggeredAtHostEpochMs, wavMtimeMs }) {
  const { samples, sampleRate, durationS } = readWavSamples(wavPath)
  const { onsets, noiseFloor, threshold } = detectOnsets(samples, sampleRate)
  const reps = parseRepLines(logText)

  // anchor.mjs's formula, restated here so the assumption is visible at the
  // point it is used rather than imported silently.
  const audioT0HostEpochMs = wavMtimeMs - durationS * 1000
  const onsetHostEpochMs = onsets.map((s) => audioT0HostEpochMs + s * 1000)
  // hostEpoch = deviceEpoch − offsetMs   (offsetMs is DEVICE − HOST)
  const playheadHostEpochMs = reps.map((r) => r.playheadEpochMs - offsetMs)

  const problems = []
  if (reps.length < MIN_REPS) problems.push(`only ${reps.length} rep records (want ≥ ${MIN_REPS})`)
  if (onsets.length === 0) problems.push('no acoustic onsets detected — is the mic on the right input, and near the speaker?')

  // CAUSALITY. The first sound cannot be recorded before the host asked for
  // it. If it appears earlier, the wav anchor is wrong by at least that much
  // and every latency below is shifted by the same amount — so the run is
  // rejected rather than reported with a plausible-looking number.
  let causalityViolationMs = null
  if (onsetHostEpochMs.length > 0 && Number.isFinite(triggeredAtHostEpochMs)) {
    const slack = onsetHostEpochMs[0] - triggeredAtHostEpochMs
    if (slack < 0) causalityViolationMs = Math.round(-slack)
  }

  // PAIR BY INDEX when the counts agree.
  //
  // The experiment is N isolated plays producing N isolated sounds in order,
  // so rep i belongs to onset i — full stop. An earlier version searched for
  // "the nearest onset after this rep", and that is how a latency tool lies:
  // run it with the clock correction forgotten and every rep quietly matches
  // a sound from two plays earlier, yielding ~405 ms, which is wrong but not
  // absurd enough to notice. Index pairing cannot do that — a misalignment
  // shows up as an impossible latency instead of a believable one.
  const paired = []
  let pairing = 'index'
  if (onsetHostEpochMs.length === playheadHostEpochMs.length && reps.length > 0) {
    for (let i = 0; i < reps.length; i += 1) {
      paired.push({ ...reps[i], latencyMs: onsetHostEpochMs[i] - playheadHostEpochMs[i] })
    }
  } else {
    // Counts differ: a play was missed, or the room added a sound. Fall back
    // to an ordered search, but SAY that the clean correspondence was lost —
    // the result is weaker evidence and should not read as though it were not.
    pairing = 'search'
    problems.push(
      `onset count ${onsetHostEpochMs.length} ≠ rep count ${playheadHostEpochMs.length}` +
        ` — paired by search instead of index; check the recording for missed or extra sounds`,
    )
    let cursor = 0
    for (let i = 0; i < playheadHostEpochMs.length; i += 1) {
      const p = playheadHostEpochMs[i]
      while (cursor < onsetHostEpochMs.length && onsetHostEpochMs[cursor] < p - 50) cursor += 1
      if (cursor >= onsetHostEpochMs.length) break
      const latency = onsetHostEpochMs[cursor] - p
      if (latency >= -50 && latency <= 1000) {
        paired.push({ ...reps[i], latencyMs: latency })
        cursor += 1
      }
    }
  }

  const lat = paired.map((p) => p.latencyMs)

  // PLAUSIBILITY. Sound leaves the speaker after the playhead moves, not
  // before, and not half a second later. A median outside this band means one
  // of the three terms is wrong — almost always the clock offset or the wav
  // anchor — and reporting it as a measurement would be worse than reporting
  // nothing, because it is a number and numbers get quoted.
  const centre = lat.length ? median(lat) : null
  if (centre !== null && (centre < -20 || centre > 400)) {
    problems.push(
      `median latency ${r1(centre)} ms is not physically plausible for playhead → speaker` +
        ` — check the clock offset (${offsetMs} ms) and the wav anchor before believing any of this`,
    )
  }
  const byAsset = {}
  for (const asset of new Set(paired.map((p) => p.asset ?? 'unknown'))) {
    const v = paired.filter((p) => (p.asset ?? 'unknown') === asset).map((p) => p.latencyMs)
    byAsset[asset] = { n: v.length, medianMs: r1(median(v)), p5Ms: r1(pct(v, 5)), p95Ms: r1(pct(v, 95)) }
  }

  return {
    ok: problems.length === 0 && causalityViolationMs === null,
    problems,
    causalityViolationMs,
    audioT0HostEpochMs,
    durationS: r1(durationS),
    sampleRate,
    detection: { onsets: onsets.length, noiseFloor: r1(noiseFloor * 1000) / 1000, threshold: r1(threshold * 1000) / 1000 },
    reps: reps.length,
    paired: paired.length,
    pairing,
    offsetMs,
    playheadToSpeakerMs: lat.length ? r1(median(lat)) : null,
    p5Ms: lat.length ? r1(pct(lat, 5)) : null,
    p95Ms: lat.length ? r1(pct(lat, 95)) : null,
    spreadMs: lat.length ? r1(pct(lat, 95) - pct(lat, 5)) : null,
    byAsset,
  }
}

function main() {
  const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
  const dir = arg('session') ?? process.argv[process.argv.indexOf('--session') + 1]
  if (!dir || !existsSync(dir)) {
    console.error('Usage: playhead-to-speaker.mjs --session <dir> [--offset=N]')
    process.exit(3)
  }
  const wavPath = join(dir, 'capture.wav')
  const logPath = join(dir, 'log.txt')
  for (const p of [wavPath, logPath]) {
    if (!existsSync(p)) {
      console.error(`missing ${p}`)
      process.exit(3)
    }
  }
  const trigPath = join(dir, 'trigger.json')
  const trig = existsSync(trigPath) ? JSON.parse(readFileSync(trigPath, 'utf8')) : {}
  const offsetMs = Number(arg('offset') ?? trig.clockOffsetMs)
  if (!Number.isFinite(offsetMs)) {
    console.error('no clock offset — pass --offset=N or record it in trigger.json (see clock-offset.mjs)')
    process.exit(3)
  }
  const report = analyze({
    wavPath,
    logText: readFileSync(logPath, 'utf8'),
    offsetMs,
    triggeredAtHostEpochMs: trig.triggeredAtHostEpochMs,
    wavMtimeMs: statSync(wavPath).mtimeMs,
  })

  console.log(JSON.stringify(report, null, 2))
  if (report.causalityViolationMs !== null) {
    console.error(
      `\nREJECTED: the first sound lands ${report.causalityViolationMs} ms BEFORE the command that` +
        ` triggered it. The wav anchor (mtime − duration) is wrong by at least that much, so every` +
        ` latency here is shifted by the same amount. Re-record; do not report this number.`,
    )
    process.exit(1)
  }
  if (!report.ok) {
    console.error('\n' + report.problems.map((p) => 'PROBLEM: ' + p).join('\n'))
    process.exit(2)
  }
  console.log(
    `\nPLAYHEAD_TO_SPEAKER_MS ≈ ${report.playheadToSpeakerMs} (p5 ${report.p5Ms}, p95 ${report.p95Ms},` +
      ` spread ${report.spreadMs}) over ${report.paired} paired plays`,
  )
}

if (process.argv[1]?.endsWith('playhead-to-speaker.mjs')) main()
