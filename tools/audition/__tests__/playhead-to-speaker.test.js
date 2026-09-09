/**
 * The 5c analysis, checked against sessions whose answer is known.
 *
 * A latency measurement is the easiest kind of tool to be confidently wrong
 * with: it always produces a number, and the number always looks plausible.
 * So the fixtures here are synthesised with a ground truth planted in them —
 * clicks placed at a chosen delay after clock-shifted "playhead" times — and
 * the tests assert the tool recovers that delay rather than merely returning
 * something.
 *
 * Half of this file is the other half of that job: sessions the tool must
 * REFUSE. Every one of them is a failure the previous version reported as a
 * clean result, so each test names the lie it prevents rather than the branch
 * it covers.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { analyze, chooseLatency, detectOnsets, parseRepLines, sourceHeadMs } from '../playhead-to-speaker.mjs'

const SR = 48_000

/** Deterministic PRNG: the gaps must be irregular but the test must not flake. */
function lcg(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function wavBuffer(durationS, regions) {
  const frames = Math.round(durationS * SR)
  const data = Buffer.alloc(frames * 2)
  // Deterministic pseudo-noise: a fixed floor the detector must see past,
  // without a random seed making the test flaky.
  for (let i = 0; i < frames; i += 1) data.writeInt16LE(Math.round(Math.sin(i * 0.7) * 0.002 * 32767), i * 2)
  for (const { atS, lengthS, amp = 0.8, attackS = 0 } of regions) {
    const start = Math.round(atS * SR)
    const len = Math.round(lengthS * SR)
    for (let k = 0; k < len && start + k < frames; k += 1) {
      // attackS = 0 is a hard transient (a bell); a nonzero attack ramps in,
      // which is what makes an energy detector fire late on a soft phoneme.
      const ramp = attackS > 0 ? Math.min(1, k / (attackS * SR)) : 1
      const decay = attackS > 0 ? 1 : Math.exp(-k / (SR * 0.002))
      const v = Math.sin((2 * Math.PI * 1200 * k) / SR) * amp * ramp * decay
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
  return Buffer.concat([header, data])
}

/** 16-bit mono WAV with 8 ms decaying bursts at the given offsets (seconds). */
function writeWav(path, durationS, clickAtS, { amp = 0.8 } = {}) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, wavBuffer(durationS, clickAtS.map((atS) => ({ atS, lengthS: 0.008, amp }))))
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
 * `trueLatencyMs` is what the tool must recover. The device clock is offset
 * from the host by a large constant — the real tablet sits 1.5 s away — so a
 * tool that forgot the correction is wrong by that much and cannot pass by
 * accident.
 *
 * **The gaps are randomised, and that is load-bearing.** Under an even
 * spacing, rep i and the onset of play i+1 differ by latency + spacing for
 * EVERY i, so that wrong delay collects nearly as many votes as the right one
 * and there is no answer in the data at all. That is the hole the old fixture
 * shared with the old probe, and it is why the old tool had to fall back on
 * "which answer looks plausible". Irregular gaps mean only the true delay is
 * agreed on by every play. `spacingS: <number>` forces the degenerate even
 * case, which has its own test below.
 */
function makeSession({
  trueLatencyMs,
  offsetMs,
  reps = 20,
  spacingS = null,
  gapLoS = 0.4,
  gapHiS = 1.0,
  jitterMs = () => 0,
  seed = 7,
  asset = undefined,
  clipLengthS = 0.008,
  attackS = 0,
}) {
  const dir = mkdtempSync(join(tmpdir(), 'p2s-'))
  const wavPath = join(dir, 'capture.wav')
  const audioT0HostEpochMs = 1_700_000_000_000
  const rnd = lcg(seed)

  const regions = []
  const lines = []
  let t = 1.0
  for (let i = 0; i < reps; i += 1) {
    regions.push({ atS: t, lengthS: clipLengthS, attackS })
    const clipStartHostEpochMs = audioT0HostEpochMs + t * 1000
    const playheadHostEpochMs = clipStartHostEpochMs - trueLatencyMs - jitterMs(i)
    lines.push(repLine(i, Math.round(playheadHostEpochMs + offsetMs), asset))
    t += spacingS ?? gapLoS + rnd() * (gapHiS - gapLoS)
  }
  const durationS = t + 1.0
  mkdirSync(dir, { recursive: true })
  writeFileSync(wavPath, wavBuffer(durationS, regions))
  const wavMtimeMs = audioT0HostEpochMs + durationS * 1000

  return {
    dir,
    wavPath,
    logText: lines.join('\n'),
    offsetMs,
    wavMtimeMs,
    triggeredAtHostEpochMs: audioT0HostEpochMs + 500,
    // An honest bracket: ffmpeg opened the device 30 ms before the first
    // sample and took 40 ms to flush and exit after the last one.
    ffmpegSpawnedAtHostEpochMs: audioT0HostEpochMs - 30,
    ffmpegExitedAtHostEpochMs: wavMtimeMs + 40,
    // Point the attack-bias correction at an empty tree so these fixtures stay
    // hermetic; the correction has its own test with a planted source clip.
    repoRoot: dir,
  }
}

describe('onset detection', () => {
  const samplesOf = (path) => {
    const buf = readFileSync(path)
    const frames = (buf.length - 44) / 2
    const out = new Float32Array(frames)
    for (let i = 0; i < frames; i += 1) out[i] = buf.readInt16LE(44 + i * 2) / 32768
    return out
  }

  it('finds one onset per burst and ignores the noise floor', () => {
    const wav = join(mkdtempSync(join(tmpdir(), 'p2s-')), 'c.wav')
    writeWav(wav, 4, [0.5, 1.5, 2.5])
    const { onsets } = detectOnsets(samplesOf(wav), SR)
    expect(onsets).toHaveLength(3)
    for (const [i, expected] of [0.5, 1.5, 2.5].entries()) {
      // Within a frame of the truth; the burst rises fast so this is tight.
      expect(Math.abs(onsets[i] - expected)).toBeLessThan(0.003)
    }
  })

  it('counts one sustained sound once, not once per refractory period', () => {
    // A 700 ms coach word is ONE sound. Measuring the refractory from the last
    // accepted onset instead of the last loud frame re-triggered every 200 ms
    // and invented three plays out of one — extra onsets that then stole
    // matches from real plays further down the recording.
    const dir = mkdtempSync(join(tmpdir(), 'p2s-'))
    const wav = join(dir, 'tone.wav')
    mkdirSync(dir, { recursive: true })
    writeFileSync(wav, wavBuffer(3, [{ atS: 0.5, lengthS: 0.7, attackS: 0.001 }]))
    const { onsets } = detectOnsets(samplesOf(wav), SR)
    expect(onsets).toHaveLength(1)
    expect(Math.abs(onsets[0] - 0.5)).toBeLessThan(0.01)
  })

  it('does not turn digital silence into a hundred onsets', () => {
    // An all-zero stretch makes the 20th-percentile noise floor exactly 0,
    // which collapses the geometric threshold to 0 — every dither bit then
    // reads as a sound.
    const dir = mkdtempSync(join(tmpdir(), 'p2s-'))
    const wav = join(dir, 'silent.wav')
    mkdirSync(dir, { recursive: true })
    writeFileSync(wav, wavBuffer(3, []).fill(0, 44))
    const { onsets } = detectOnsets(samplesOf(wav), SR)
    expect(onsets).toHaveLength(0)
  })
})

describe('rep parsing', () => {
  it('reads the multi-line record shape the logger actually emits', () => {
    const reps = parseRepLines(repLine(7, 1_700_000_001_234))
    expect(reps).toHaveLength(1)
    expect(reps[0]).toMatchObject({ rep: 7, playheadEpochMs: 1_700_000_001_234, asset: 'call cc-1 (48k)' })
  })

  it('does not read an epoch as a duration', () => {
    // `playheadMs` is a substring of `playheadEpochMs`. Unanchored, the field
    // search matched the epoch first and reported a 1.7-trillion-ms playhead.
    const reps = parseRepLines(repLine(0, 1_700_000_001_234))
    expect(reps[0].playheadMs).toBe(120)
    expect(reps[0].statusEpochMs).toBe(1_700_000_001_139)
  })
})

describe('analyze — recovers a planted latency', () => {
  it('recovers 40 ms through a 1.5 s clock offset', () => {
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565 })
    const r = analyze(s)
    expect(r.problems).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.causalityViolationMs).toBeNull()
    expect(r.paired).toBeGreaterThanOrEqual(18)
    // The planted answer, back out the other side.
    expect(Math.abs(r.playheadToSpeakerMs - 40)).toBeLessThan(3)
  })

  it('recovers a different latency and offset — not a fixture coincidence', () => {
    const s = makeSession({ trueLatencyMs: 12, offsetMs: 800, seed: 31 })
    const r = analyze(s)
    expect(r.ok).toBe(true)
    expect(Math.abs(r.playheadToSpeakerMs - 12)).toBeLessThan(3)
  })

  it('picks the latency by vote, with a margin over the next-best delay', () => {
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565, reps: 30, seed: 99 })
    const r = analyze(s)
    expect(r.alignment.decisive).toBe(true)
    expect(Math.abs(r.alignment.coarseMs - 40)).toBeLessThan(3)
    // The margin is the whole claim: the true delay is not merely first, it is
    // far enough ahead that the ordering is not a coin toss.
    expect(r.alignment.votes).toBeGreaterThanOrEqual(r.alignment.runnerUpVotes * 2)
  })

  it('survives missing sounds and spurious onsets without sliding out of step', () => {
    // The dry run had all three: 80 plays, 82 onsets, 78 rep records. Anything
    // that pairs by index reports the gap between two DIFFERENT plays once one
    // event goes missing — a believable number describing nothing.
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565, reps: 30, seed: 12 })
    const rnd = lcg(12)
    const regions = []
    let t = 1.0
    for (let i = 0; i < 30; i += 1) {
      if (i !== 4 && i !== 11 && i !== 19) regions.push({ atS: t, lengthS: 0.008 })
      t += 0.4 + rnd() * 0.6
    }
    // …plus a door slam that is not a play at all.
    regions.push({ atS: t + 0.2, lengthS: 0.008 })
    writeFileSync(s.wavPath, wavBuffer(t + 1.0, regions))

    const r = analyze(s)
    expect(r.ok).toBe(true)
    expect(Math.abs(r.playheadToSpeakerMs - 40)).toBeLessThan(3)
    expect(r.censored).toBe(3)
    expect(r.reusedOnsets).toBe(0)
  })

  it('reports the SPREAD, because the tail is what the breath floor cares about', () => {
    // ±30 ms of jitter around 50: the median must still land, and the spread
    // must show the variation rather than hiding it behind a tidy centre.
    const s = makeSession({ trueLatencyMs: 50, offsetMs: -1565, reps: 30, jitterMs: (i) => (i % 2 ? 30 : -30) })
    const r = analyze(s)
    expect(Math.abs(r.playheadToSpeakerMs - 50)).toBeLessThan(8)
    expect(r.spreadMs).toBeGreaterThan(40)
    // And it must say what the spread cannot exceed, so a spread that has hit
    // the window is readable as the window rather than as a steady path.
    expect(r.spreadCensoredAtMs).toBe(150)
    expect(r.spreadMs).toBeLessThan(r.spreadCensoredAtMs)
  })
})

describe('analyze — the attack-bias correction', () => {
  it('recovers the planted latency from a clip that ramps in, not the ramp plus the latency', () => {
    // A soft first phoneme crosses a detection threshold tens of ms after it
    // began, and every recording of that clip inherits exactly that offset.
    // Reporting it as tablet latency is how two assets on ONE output path came
    // out 69.5 ms apart. Here the play is a 150 ms ramp and the true latency is
    // still 40 ms: the raw reading must be visibly larger, and the correction
    // must put it back.
    const asset = 'call cc-e08318c0 (48k)'
    const s = makeSession({
      trueLatencyMs: 40,
      offsetMs: -1565,
      asset,
      reps: 24,
      clipLengthS: 0.25,
      attackS: 0.15,
      gapLoS: 0.6,
      gapHiS: 1.2,
    })
    const clipPath = join(s.dir, 'assets', 'voice', 'click-scripts', 'cornerman3', 'cc-e08318c0.wav')
    mkdirSync(dirname(clipPath), { recursive: true })
    writeFileSync(clipPath, wavBuffer(0.3, [{ atS: 0, lengthS: 0.25, attackS: 0.15 }]))

    const r = analyze(s)
    expect(r.ok).toBe(true)
    const row = r.byAsset[asset]
    expect(row.sourceHeadMs).toBeGreaterThan(5)
    // The uncorrected reading is the ramp, mistaken for the device.
    expect(row.rawMedianMs).toBeGreaterThan(40 + 5)
    // The corrected one is the device.
    expect(Math.abs(row.correctedMedianMs - 40)).toBeLessThan(3)
  })

  it('measures the source at the same fraction of peak the recording used', () => {
    // `detectOnsets` sets its threshold from each FILE's noise floor, and a
    // source clip is nearly all signal while a recording is mostly room.
    // Re-running the detector on the clip with its own floor would pick a
    // different point on the same envelope and "correct" by a number about
    // neither file. A fraction of peak is the transferable quantity.
    const dir = mkdtempSync(join(tmpdir(), 'p2s-'))
    const clip = join(dir, 'ramp.wav')
    writeFileSync(clip, wavBuffer(0.3, [{ atS: 0, lengthS: 0.25, attackS: 0.15 }]))
    // 5% of peak on a linear 150 ms ramp is 7.5 ms in; 20% is 30 ms in.
    expect(sourceHeadMs(clip, 0.05)).toBeCloseTo(7, 0)
    expect(sourceHeadMs(clip, 0.2)).toBeCloseTo(30, 0)
    expect(sourceHeadMs(clip, undefined)).toBeNull()
  })

  it('does not report a loud asset and a quiet one as two different audio paths', () => {
    // The detector's threshold is ABSOLUTE, so a quiet sound crosses it
    // further up its own envelope than a loud one — a per-asset bias sitting
    // in exactly the quantity being corrected. Two assets on ONE path, same
    // 40 ms latency, same ramp shape, one at a quarter the level: with a single
    // global fraction the correction under-corrects the quiet one and the
    // split survives. The fraction is measured per asset, so it does not.
    // This is the shape of the real 69.5 ms speech-vs-bell disagreement.
    const dir = mkdtempSync(join(tmpdir(), 'p2s-'))
    const audioT0 = 1_700_000_000_000
    const rnd = lcg(44)
    const regions = []
    const lines = []
    let t = 1.0
    for (let i = 0; i < 32; i += 1) {
      const loud = i % 2 === 0
      regions.push({ atS: t, lengthS: 0.25, attackS: 0.15, amp: loud ? 0.8 : 0.2 })
      lines.push(repLine(i, Math.round(audioT0 + t * 1000 - 40 - 1565), loud ? 'call loud' : 'bell quiet'))
      t += 0.6 + rnd() * 0.6
    }
    const durationS = t + 1.0
    writeFileSync(join(dir, 'capture.wav'), wavBuffer(durationS, regions))
    for (const [sub, amp] of [
      [join('assets', 'voice', 'click-scripts', 'cornerman3', 'cc-e08318c0.wav'), 0.8],
      [join('assets', 'voice', 'names', 'standalone', 'bell.wav'), 0.2],
    ]) {
      const p = join(dir, sub)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, wavBuffer(0.3, [{ atS: 0, lengthS: 0.25, attackS: 0.15, amp }]))
    }

    const r = analyze({
      wavPath: join(dir, 'capture.wav'),
      logText: lines.join('\n'),
      offsetMs: -1565,
      wavMtimeMs: audioT0 + durationS * 1000,
      triggeredAtHostEpochMs: audioT0 + 500,
      ffmpegSpawnedAtHostEpochMs: audioT0 - 30,
      ffmpegExitedAtHostEpochMs: audioT0 + durationS * 1000 + 40,
      repoRoot: dir,
    })

    const loud = r.byAsset['call loud']
    const quiet = r.byAsset['bell quiet']
    // The quiet asset really does read later, uncorrected — that is the bias.
    expect(quiet.rawMedianMs).toBeGreaterThan(loud.rawMedianMs + 5)
    // Each is measured at its OWN fraction of peak, and they differ.
    expect(quiet.thresholdFractionOfPeak).toBeGreaterThan(loud.thresholdFractionOfPeak)
    // Corrected, both land on the one latency they actually share.
    expect(Math.abs(loud.correctedMedianMs - 40)).toBeLessThan(4)
    expect(Math.abs(quiet.correctedMedianMs - 40)).toBeLessThan(4)
    expect(r.assetSplitMs).toBeLessThan(8)
  })

  it('leaves the correction null rather than guessing when the clip is missing', () => {
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565 })
    const r = analyze(s)
    expect(r.byAsset['call cc-1 (48k)'].correctedMedianMs).toBeNull()
    expect(Math.abs(r.byAsset['call cc-1 (48k)'].rawMedianMs - 40)).toBeLessThan(3)
  })
})

describe('analyze — refuses a run it cannot trust', () => {
  it('cannot resolve evenly spaced plays, and says so instead of picking one', () => {
    // THE ORIGINAL SIN. Under even spacing, "latency" and "latency + one
    // spacing" are agreed on by the same number of plays — there is no answer
    // in the data. The old tool broke that tie with "which median looks
    // plausible", which was also its only check, and that is how it certified
    // a session with no clock correction as a tidy 20 ms.
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565, spacingS: 0.6, reps: 30 })
    const r = analyze(s)
    expect(r.alignment.decisive).toBe(false)
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/not decisive/)
    expect(r.playheadToSpeakerMs).toBeNull()
  })

  it('a forgotten clock correction cannot pass as a plausible latency', () => {
    // The failure this whole file exists to prevent: pass offset 0 when the
    // device is 1.565 s away. A constant clock error shifts every vote by the
    // same amount, so the tool still finds the delay the plays agree on — and
    // reports it 1565 ms too large, where the plausibility check, no longer
    // doing double duty as the selector, catches it. The search range is wide
    // on purpose: the wrong answer has to be FOUND to be rejected.
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565 })
    const r = analyze({ ...s, offsetMs: 0 })
    expect(r.alignment.decisive).toBe(true)
    expect(Math.abs(r.playheadToSpeakerMs - 1605)).toBeLessThan(5)
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/not physically possible/)
  })

  it('REJECTS a wav anchor that mtime placed LATE — the direction ffmpeg actually errs', () => {
    // ffmpeg's close/flush delay pushes mtime later, which pushes t0 later,
    // which inflates every latency. The old causality check could only fire
    // when the anchor was EARLY, so this had a 2.26 s dead band on real data.
    // The spawn/exit stamps close it: t0 must lie in [spawn, exit − duration].
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565 })
    const r = analyze({ ...s, wavMtimeMs: s.wavMtimeMs + 2_000 })
    expect(r.anchor.inside).toBe(false)
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/outside its hard bracket/)
  })

  it('REJECTS a wav longer than the window ffmpeg was alive for', () => {
    // A reused session directory whose capture.wav was appended to, or simply
    // left over from the previous run. The bracket inverts, which no amount of
    // plausible-looking latency can explain away.
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565 })
    const r = analyze({ ...s, ffmpegSpawnedAtHostEpochMs: s.wavMtimeMs - 1_000 })
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/longer than the window/)
  })

  it('REJECTS a run with no anchor bracket at all', () => {
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565 })
    const r = analyze({ ...s, ffmpegSpawnedAtHostEpochMs: undefined, ffmpegExitedAtHostEpochMs: undefined })
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/spawn\/exit stamps/)
  })

  it('REJECTS a wav anchor that puts sound before its own trigger', () => {
    // Stamp the trigger 4 s after it happened: the first click then lands
    // before the command that caused it. Impossible, so the tap and the
    // recording are not the same run and nothing below them means anything.
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565 })
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

  it('refuses a median built from a self-selected minority of the plays', () => {
    // Delete most of the sounds and keep all the rep records. The survivors
    // agree beautifully — because they are the ones that matched. Ungated,
    // this scored BETTER than an honest run: fewer awkward samples, tighter
    // spread, same confident number.
    const s = makeSession({ trueLatencyMs: 40, offsetMs: -1565, reps: 30, seed: 5 })
    const kept = []
    let t = 1.0
    const rnd = lcg(5)
    for (let i = 0; i < 30; i += 1) {
      if (i % 2 === 0) kept.push({ atS: t, lengthS: 0.008 })
      t += 0.4 + rnd() * 0.6
    }
    writeFileSync(s.wavPath, wavBuffer(t + 1.0, kept))
    const r = analyze(s)
    // The vote still finds the right delay from the half that survived — the
    // point is that it must not then report a confident median built on it.
    expect(r.alignment.decisive).toBe(true)
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/self-selected/)
  })

  it('says so when the mic caught nothing, rather than returning null quietly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'p2s-'))
    const wav = join(dir, 'silent.wav')
    writeWav(wav, 5, [])
    const r = analyze({
      wavPath: wav,
      logText: repLine(0, 1_700_000_001_000),
      offsetMs: 0,
      wavMtimeMs: 1_700_000_005_000,
      triggeredAtHostEpochMs: 1_700_000_000_000,
      repoRoot: dir,
    })
    expect(r.ok).toBe(false)
    expect(r.problems.join(' ')).toMatch(/onset|rep records/)
  })
})

describe('chooseLatency', () => {
  it('is undecided when every delay is agreed on by as many plays', () => {
    // Two periodic sequences of one period. 40 ms and 640 ms are attested
    // equally often; there is no answer in this data, and the only honest
    // output is to say so.
    const playhead = Array.from({ length: 20 }, (_, i) => 1_000 + i * 600)
    const onsets = playhead.map((p) => p + 40)
    expect(chooseLatency(onsets, playhead).decisive).toBe(false)
  })

  it('is decisive when the gaps are irregular', () => {
    const rnd = lcg(3)
    const playhead = []
    let t = 1_000
    for (let i = 0; i < 20; i += 1) {
      playhead.push(t)
      t += 400 + rnd() * 600
    }
    const onsets = playhead.map((p) => p + 40)
    const { decisive, best } = chooseLatency(onsets, playhead)
    expect(decisive).toBe(true)
    expect(best.centreMs).toBeCloseTo(40, 6)
    expect(best.votes).toBe(20)
  })

  it('finds the delay a majority attests even with a third of the sounds gone', () => {
    const rnd = lcg(21)
    const playhead = []
    let t = 1_000
    for (let i = 0; i < 30; i += 1) {
      playhead.push(t)
      t += 400 + rnd() * 600
    }
    const onsets = playhead.filter((_, i) => i % 3 !== 0).map((p) => p + 40)
    const { decisive, best } = chooseLatency(onsets, playhead)
    expect(decisive).toBe(true)
    expect(best.centreMs).toBeCloseTo(40, 6)
    expect(best.votes).toBe(20)
  })
})
