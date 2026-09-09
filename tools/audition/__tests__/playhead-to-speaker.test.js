/**
 * The 5c analysis, checked against a session whose answer is known.
 *
 * A latency measurement is the easiest kind of tool to be confidently wrong
 * with: it always produces a number, and the number always looks plausible.
 * So the fixtures here are synthesised with a ground truth planted in them —
 * clicks placed at a chosen delay after clock-shifted "playhead" times — and
 * the test asserts the tool recovers that delay rather than merely returning
 * something.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { analyze, detectOnsets, parseRepLines } from '../playhead-to-speaker.mjs'

const SR = 48_000

/** 16-bit mono WAV with impulses at the given offsets (seconds). */
function writeWav(path, durationS, clickAtS, { amp = 0.8, noise = 0.002 } = {}) {
  const frames = Math.round(durationS * SR)
  const data = Buffer.alloc(frames * 2)
  for (let i = 0; i < frames; i += 1) {
    // Deterministic pseudo-noise: a fixed floor the detector must see past,
    // without a random seed making the test flaky.
    data.writeInt16LE(Math.round(Math.sin(i * 0.7) * noise * 32767), i * 2)
  }
  for (const t of clickAtS) {
    const start = Math.round(t * SR)
    // 8 ms decaying burst — a coach clip's attack, not a single sample, so
    // the detector is exercised on something with a real envelope.
    for (let k = 0; k < SR * 0.008 && start + k < frames; k += 1) {
      const env = amp * Math.exp(-k / (SR * 0.002))
      const v = Math.sin((2 * Math.PI * 1200 * k) / SR) * env
      data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), (start + k) * 2)
    }
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SR, 24)
  header.writeUInt32LE(SR * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([header, data]))
}

const repLine = (rep, playheadEpochMs, asset = 'call cc-1 (48k)') =>
  [
    `08-31 12:00:00.000 I/ReactNativeJS( 100): '[INFO] puncheokie.ruler.rep', 'rep timing', { asset: '${asset}',`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   rep: ${rep},`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   startedEpochMs: ${playheadEpochMs - 120},`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   statusEpochMs: ${playheadEpochMs - 95},`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   playheadEpochMs: ${playheadEpochMs},`,
    `08-31 12:00:00.000 I/ReactNativeJS( 100):   playheadMs: 120 }`,
  ].join('\n')

/**
 * Build a session with a planted answer.
 *
 * TRUE_LATENCY is what the tool must recover. The device clock is offset from
 * the host by a large constant — the real tablet sits 1.5 s away — so a tool
 * that forgot the correction would be wrong by that much and could not
 * accidentally pass.
 */
function makeSession({ trueLatencyMs, offsetMs, reps = 20, spacingS = 0.6, jitterMs = () => 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'p2s-'))
  const wavPath = join(dir, 'capture.wav')
  const audioT0HostEpochMs = 1_700_000_000_000
  const firstClickS = 1.0

  const clickAtS = []
  const lines = []
  for (let i = 0; i < reps; i += 1) {
    const clickS = firstClickS + i * spacingS
    clickAtS.push(clickS)
    const clickHostEpochMs = audioT0HostEpochMs + clickS * 1000
    const playheadHostEpochMs = clickHostEpochMs - trueLatencyMs - jitterMs(i)
    lines.push(repLine(i, Math.round(playheadHostEpochMs + offsetMs)))
  }
  const durationS = firstClickS + reps * spacingS + 1.0
  writeWav(wavPath, durationS, clickAtS)

  return {
    dir,
    wavPath,
    logText: lines.join('\n'),
    offsetMs,
    wavMtimeMs: audioT0HostEpochMs + durationS * 1000,
    triggeredAtHostEpochMs: audioT0HostEpochMs + 500,
  }
}

describe('onset detection', () => {
  it('finds one onset per burst and ignores the noise floor', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p2s-'))
    const wav = join(dir, 'c.wav')
    writeWav(wav, 4, [0.5, 1.5, 2.5])
    const { readFileSync } = require('node:fs')
    const buf = readFileSync(wav)
    const frames = (buf.length - 44) / 2
    const samples = new Float32Array(frames)
    for (let i = 0; i < frames; i += 1) samples[i] = buf.readInt16LE(44 + i * 2) / 32768
    const { onsets } = detectOnsets(samples, SR)
    expect(onsets).toHaveLength(3)
    for (const [i, expected] of [0.5, 1.5, 2.5].entries()) {
      // Within a frame of the truth; the burst rises fast so this is tight.
      expect(Math.abs(onsets[i] - expected)).toBeLessThan(0.003)
    }
  })
})

describe('rep parsing', () => {
  it('reads the multi-line record shape the logger actually emits', () => {
    const reps = parseRepLines(repLine(7, 1_700_000_001_234))
    expect(reps).toHaveLength(1)
    expect(reps[0]).toMatchObject({ rep: 7, playheadEpochMs: 1_700_000_001_234, asset: 'call cc-1 (48k)' })
  })
})

describe('analyze — recovers a planted latency', () => {
  it('recovers 40 ms through a 1.5 s clock offset', () => {
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565 })
    const r = analyze(s)
    expect(r.ok).toBe(true)
    expect(r.causalityViolationMs).toBeNull()
    expect(r.paired).toBeGreaterThanOrEqual(18)
    // The planted answer, back out the other side.
    expect(Math.abs(r.playheadToSpeakerMs - 40)).toBeLessThan(3)
  })

  it('recovers a different latency and offset — not a fixture coincidence', () => {
    const s = makeSession({ trueLatencyMs: 12, offsetMs: 800 })
    const r = analyze(s)
    expect(Math.abs(r.playheadToSpeakerMs - 12)).toBeLessThan(3)
  })

  it('reports the SPREAD, because the tail is what the breath floor cares about', () => {
    // ±30 ms of jitter around 50: the median must still land, and the spread
    // must show the variation rather than hiding it behind a tidy centre.
    const s = makeSession({ trueLatencyMs: 50, offsetMs: -1565, reps: 30, jitterMs: (i) => (i % 2 ? 30 : -30) })
    const r = analyze(s)
    expect(Math.abs(r.playheadToSpeakerMs - 50)).toBeLessThan(8)
    expect(r.spreadMs).toBeGreaterThan(40)
  })

  it('a forgotten clock correction cannot pass as a plausible latency', () => {
    // The failure this whole file exists to prevent: pass offset 0 when the
    // device is 1.565 s away. A tool that "worked" would return a number.
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565 })
    const r = analyze({ ...s, offsetMs: 0 })
    expect(r.playheadToSpeakerMs === null || Math.abs(r.playheadToSpeakerMs - 40) > 500).toBe(true)
  })
})

describe('analyze — refuses a run it cannot trust', () => {
  it('REJECTS a wav anchor that puts sound before its own trigger', () => {
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565 })
    // Claim the recording was closed 2 s later than it was: mtime − duration
    // then places t0 two seconds late, and the first click lands before the
    // command that caused it. That is impossible, and it is exactly the
    // silent failure mode of the mtime formula.
    const r = analyze({ ...s, triggeredAtHostEpochMs: s.triggeredAtHostEpochMs + 4_000 })
    expect(r.causalityViolationMs).toBeGreaterThan(0)
    expect(r.ok).toBe(false)
  })

  it('flags a run with too few reps instead of reporting a confident median', () => {
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565, reps: 5 })
    const r = analyze(s)
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/rep records/)
  })

  it('says so when the mic caught nothing, rather than returning null quietly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p2s-'))
    const wav = join(dir, 'silent.wav')
    writeWav(wav, 5, [], { noise: 0.001 })
    const r = analyze({
      wavPath: wav,
      logText: repLine(0, 1_700_000_001_000),
      offsetMs: 0,
      wavMtimeMs: 1_700_000_005_000,
      triggeredAtHostEpochMs: 1_700_000_000_000,
    })
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/onset|rep records/)
  })
})
