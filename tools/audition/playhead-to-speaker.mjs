/**
 * PLAYHEAD_TO_SPEAKER_MS — how long after the playhead starts moving does
 * sound actually leave the tablet (plan step 5c).
 *
 * ## Why this needs a microphone at all
 *
 * `OBSERVER_ONSET_SKEW_MS = 95` closed the gap between "the player says it is
 * playing" and "the playhead is moving", and it was measured entirely
 * on-device: one play timed two ways against one clock, no external reference.
 * This last stretch cannot be measured that way, because nothing on the device
 * knows when air moved. So a recording becomes the instrument, and the whole
 * difficulty is putting the recording and the device onto one timeline.
 *
 * ## Three ways this tool used to lie, and what replaced each
 *
 * The previous version reported a clean, plausible **20 ms** on a session
 * where the 1565 ms clock correction had been omitted entirely — `ok: true`,
 * `problems: []`. Each cause is worth naming, because each is a way a latency
 * tool produces a wrong number instead of an error.
 *
 * 1. **The alignment had no signal, so plausibility chose it.** The probe
 *    spaced plays evenly, making the plays and the recorded sounds two
 *    periodic sequences of the same period — every candidate alignment fit
 *    equally well. The only thing selecting one was "does this land in a
 *    physically possible band", which was also the check. Circular: the answer
 *    was plausible because implausible answers had been discarded.
 *    The probe now randomises its inter-play gap, and `chooseLatency` votes
 *    over every rep×onset pair, so the true latency is the one delay that a
 *    great many plays agree on. Plausibility goes back to being an independent
 *    test, which is the only thing it was ever able to be honestly.
 * 2. **The anchor could only be wrong in the direction nothing watched.**
 *    `mtime − duration` errs LATE (ffmpeg's close/flush delay), which inflates
 *    latency, while the causality check fired only when the anchor was EARLY —
 *    the one direction ffmpeg cannot produce. On the dry run that left a 2.26 s
 *    dead band. The session now stamps ffmpeg's spawn and exit, giving
 *    `spawn ≤ t0 ≤ exit − duration`: a hard two-sided bracket the mtime
 *    estimate must fall inside, and an inverted bracket that catches a stale
 *    wav in a reused directory.
 * 3. **A corrupted run scored BETTER than an honest one.** `paired` was never
 *    gated, so a run that matched 9 of 80 plays still reported a median; and
 *    `spreadMs` was silently clamped by `MATCH_WINDOW_MS`, so dropping the
 *    awkward samples TIGHTENED the spread while making the answer worse. Pairs
 *    are now gated on count and on fraction, censoring is counted and named,
 *    and the spread is reported next to the window that censors it.
 *
 * ## The asset split
 *
 * Two assets measuring one output path disagreed by 69.5 ms (speech 134.6,
 * bell 65.1). An energy threshold fires when a sound has ramped ENOUGH, which
 * for a soft first phoneme is tens of ms after it began — so part of that gap
 * is the clips' envelopes, not the tablet. `sourceHeadMs` runs the identical
 * detector over the source clip and subtracts what it finds, cancelling the
 * detector's own bias instead of reporting it as latency. Whatever survives
 * the correction is a real difference between audio paths: worth knowing,
 * worth reporting per asset, and not worth averaging into one constant.
 *
 *   node tools/audition/playhead-to-speaker.mjs --session <dir> [--offset=N]
 *
 * Expects in <dir>: capture.wav, log.txt (adb logcat -v epoch), and
 * trigger.json written by run-playhead-session.mjs.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { readWavHeader } from './anchor.mjs'

/** Below this, a tail is not a tail and a median is not a median. */
const MIN_REPS = 12

/** And this fraction of the plays must pair, or the sample is self-selected. */
const MIN_PAIRED_FRACTION = 0.6

/**
 * Physically possible bounds for playhead → speaker. Sound cannot precede the
 * playhead, and a fifth of a second of output buffering would be remarkable on
 * anything that can hold a beat.
 *
 * This is now ONLY a check. It must never also be the selector — that was the
 * circularity that let a 1565 ms clock error out as a tidy "20 ms".
 */
const PLAUSIBLE_LO = -20
const PLAUSIBLE_HI = 400

/** How far from its expected arrival an onset may sit and still be that play. */
const MATCH_WINDOW_MS = 150

/**
 * How far the latency vote looks. Deliberately far wider than anything
 * physically possible: a forgotten clock correction must be FOUND and then
 * REPORTED as impossible, not quietly fail to be found — that difference is
 * the whole reason the old version could return a tidy 20 ms.
 */
const SEARCH_LO_MS = -3_000
const SEARCH_HI_MS = 3_000

/** Half-width of a vote cluster. Must exceed the path's real jitter. */
const VOTE_TOL_MS = 40

/**
 * The winning cluster must carry this many times the runner-up's votes. With
 * randomised gaps the true latency wins by a landslide; a near-tie means the
 * randomisation never reached the recording, and choosing between them is how
 * a measurement becomes a wish.
 */
const VOTE_MARGIN = 2

/**
 * The clips the probe plays, for cancelling the detector's own attack bias.
 * Kept as patterns against the logged `asset` string rather than as an
 * exported map, because the probe names its assets for humans.
 */
const SOURCE_CLIPS = [
  { match: /^call\b/, path: join('assets', 'voice', 'click-scripts', 'cornerman3', 'cc-e08318c0.wav') },
  { match: /^bell\b/, path: join('assets', 'voice', 'names', 'standalone', 'bell.wav') },
]

/**
 * Onset detection: a 1 ms peak envelope, thresholded against the recording's
 * own noise floor rather than a constant, because room noise differs per
 * session and a fixed threshold silently finds nothing or everything.
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
  if (env.length === 0) return { onsets: [], noiseFloor: 0, threshold: 0, peak: 0 }

  // Noise floor as the 20th percentile of the envelope: robust to the bursts
  // themselves, which is the point — a mean would be dragged up by the very
  // events being detected.
  const sorted = [...env].sort((a, b) => a - b)
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)]
  const peak = sorted[sorted.length - 1]
  // Floor the estimate at one 16-bit LSB. A digitally silent stretch makes
  // noiseFloor exactly 0, which collapses the geometric threshold to 0 and
  // turns quantisation dither into a hundred "onsets".
  const floor = Math.max(noiseFloor, 1 / 32768)
  // Geometric midpoint between floor and peak: scale-free, so it behaves the
  // same on a hot recording and a quiet one.
  const threshold = Math.max(floor * 4, Math.sqrt(floor * Math.max(peak, floor)))

  const minGapFrames = Math.round(minGapMs / frameMs)
  const onsets = []
  let lastLoud = -Infinity
  for (let i = 0; i < env.length; i += 1) {
    if (env[i] < threshold) continue
    // The refractory runs from the last LOUD frame, not the last ACCEPTED
    // onset. Measuring it from the accepted onset let sustained audio
    // re-trigger every minGapMs forever: a 500 ms coach word produced three
    // "onsets", inventing plays that were never made. Silence has to actually
    // occur between two sounds for the second one to count as a new sound.
    if (i - lastLoud >= minGapFrames) onsets.push((i * frame) / sampleRate)
    lastLoud = i
  }
  return { onsets, noiseFloor, threshold, peak }
}

/**
 * 16-bit PCM → Float32 mono (channel 0), plus the duration this tool will use.
 *
 * `anchor.mjs` computes duration from the data chunk's DECLARED size; this
 * clamps to the bytes actually present, because a capture killed mid-write
 * declares more than it wrote and the difference lands directly in the anchor.
 * When the two disagree the caller is told rather than quietly given one.
 */
function readWavSamples(path) {
  const hdr = readWavHeader(path)
  if (hdr.bitsPerSample !== 16) throw new Error(`expected 16-bit PCM, got ${hdr.bitsPerSample}`)
  if (!hdr.channels || hdr.channels < 1) throw new Error(`bad channel count ${hdr.channels} in ${path}`)
  const buf = readFileSync(path)
  // Walk to the data chunk rather than assuming offset 44.
  let offset = 12
  let dataStart = null
  let declaredBytes = 0
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'data') {
      dataStart = offset + 8
      declaredBytes = size
      break
    }
    offset += 8 + size + (size % 2)
  }
  if (dataStart === null) throw new Error('no data chunk')
  const presentBytes = Math.min(declaredBytes, buf.length - dataStart)
  const frames = Math.floor(presentBytes / (2 * hdr.channels))
  const out = new Float32Array(frames)
  for (let i = 0; i < frames; i += 1) out[i] = buf.readInt16LE(dataStart + i * 2 * hdr.channels) / 32768
  return {
    samples: out,
    sampleRate: hdr.sampleRate,
    channels: hdr.channels,
    durationS: frames / hdr.sampleRate,
    truncatedBytes: declaredBytes - presentBytes,
  }
}

/**
 * How long after a source clip's first sample the detector would fire on it.
 *
 * Subtracting this makes the result a property of the device rather than of
 * whichever clip happened to be played: a bell with a hard transient and a
 * coach word starting on a soft consonant do not reach a detection threshold
 * at the same point in their own envelopes, and that difference is not latency.
 *
 * The threshold is given as a FRACTION OF PEAK, not reused verbatim, and that
 * distinction is the whole correctness of this function. `detectOnsets` sets
 * its threshold from each file's own noise floor — and a source clip is nearly
 * all signal, while a recording is mostly room. Running the detector on the
 * clip with its own floor would pick a completely different operating point on
 * the envelope and "correct" by a number describing neither file. A fraction
 * of peak is the scale-free quantity: same sound, same point on its rise,
 * whatever the gain or the room.
 */
export function sourceHeadMs(path, thresholdFraction) {
  if (!existsSync(path)) return null
  if (!Number.isFinite(thresholdFraction) || thresholdFraction <= 0) return null
  const { samples, sampleRate } = readWavSamples(path)
  const frame = Math.max(1, Math.round(sampleRate / 1000))
  let peak = 0
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.abs(samples[i])
    if (v > peak) peak = v
  }
  if (peak <= 0) return null
  const cut = peak * thresholdFraction
  for (let i = 0; i + frame <= samples.length; i += frame) {
    for (let j = i; j < i + frame; j += 1) {
      if (Math.abs(samples[j]) >= cut) return (i / sampleRate) * 1000
    }
  }
  return null
}

/** How far past an onset to look for that sound's peak, in the recording. */
const ASSET_PEAK_WINDOW_MS = 250

/** Loudest sample in [fromMs, fromMs + windowMs) of the recording. */
function peakBetween(samples, sampleRate, fromMs, windowMs) {
  const lo = Math.max(0, Math.round((fromMs / 1000) * sampleRate))
  const hi = Math.min(samples.length, lo + Math.round((windowMs / 1000) * sampleRate))
  let peak = 0
  for (let i = lo; i < hi; i += 1) {
    const v = Math.abs(samples[i])
    if (v > peak) peak = v
  }
  return peak
}

/** Per-rep records from the probe: one JSON-ish logcat block per play. */
export function parseRepLines(text) {
  const reps = []
  const lines = String(text).split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].includes('puncheokie.ruler.rep')) continue
    // The record spans continuation lines; gather until the closing brace.
    // Bounded, so a log whose record was cut off at the end of the file does
    // not swallow the remaining megabyte looking for a brace that never comes.
    let block = lines[i]
    for (let j = i + 1; j < lines.length && !block.includes('}') && j - i < 20; j += 1) block += ' ' + lines[j]
    const num = (k) => {
      // Anchored on a word boundary: without it, a search for `playheadMs`
      // matches inside `playheadEpochMs` and reads an epoch as a duration.
      const m = block.match(new RegExp(`\\b${k}:\\s*(-?\\d+(?:\\.\\d+)?)`))
      return m ? Number(m[1]) : null
    }
    const asset = block.match(/asset:\s*'([^']*)'/)?.[1] ?? null
    const playheadEpochMs = num('playheadEpochMs')
    if (playheadEpochMs === null) continue
    reps.push({
      asset,
      rep: num('rep'),
      playheadEpochMs,
      statusEpochMs: num('statusEpochMs'),
      statusMs: num('statusMs'),
      playheadMs: num('playheadMs'),
    })
  }
  return reps
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
/**
 * Nearest-rank percentile. For n ≤ 19, `pct(v, 5)` IS the minimum and
 * `pct(v, 95)` IS the maximum — the same n-vs-tail trap documented in
 * `observed-timing.mjs`. Small-n spreads here describe two samples, not a tail.
 */
const pct = (v, p) => {
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))]
}
/** Median absolute deviation: a spread one wild sample cannot inflate. */
const mad = (v) => {
  if (v.length === 0) return null
  const m = median(v)
  return median(v.map((x) => Math.abs(x - m)))
}
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null)
const r5 = (v) => (Number.isFinite(v) ? Math.round(v * 1e5) / 1e5 : null)

/**
 * Choose the latency from the DATA: the delay that the most plays agree on.
 *
 * Every rep is offered against every onset, and each pair casts one vote for
 * the delay between them. The true latency collects a vote from nearly every
 * play; a wrong delay collects only coincidences. The winner is the densest
 * cluster of votes, and it must beat the nearest rival delay by `VOTE_MARGIN`.
 *
 * Two properties matter here, and an index-shift alignment has neither:
 *
 * - **It survives insertions and deletions.** The dry run produced 80 plays,
 *   82 detected onsets and 78 parseable rep records. Anything that pairs by
 *   INDEX slides permanently out of step the moment one sound is missed or one
 *   spurious onset is found, and then reports the gap between two DIFFERENT
 *   plays as the latency — a believable number with no meaning. A vote does
 *   not care about order or count: a missing sound costs one vote, not the run.
 * - **There is a signal to find, but only with randomised gaps.** Under a
 *   fixed spacing, rep i and onset i+1 differ by latency + spacing for every
 *   single i, so that wrong delay collects nearly as many votes as the right
 *   one. That is not a tie for this function to break — it is a run with no
 *   answer in it, and the margin check is what turns it into a refusal rather
 *   than a coin toss dressed up as a measurement.
 */
export function chooseLatency(onsetHostEpochMs, playheadHostEpochMs) {
  const deltas = []
  for (const p of playheadHostEpochMs) {
    for (const o of onsetHostEpochMs) {
      const d = o - p
      if (d >= SEARCH_LO_MS && d <= SEARCH_HI_MS) deltas.push(d)
    }
  }
  deltas.sort((a, b) => a - b)

  // Densest window of width 2·VOTE_TOL_MS, by one forward sweep.
  const windows = []
  for (let i = 0; i < deltas.length; i += 1) {
    let j = i
    while (j < deltas.length && deltas[j] - deltas[i] <= 2 * VOTE_TOL_MS) j += 1
    windows.push({ n: j - i, centreMs: median(deltas.slice(i, j)) })
  }
  windows.sort((a, b) => b.n - a.n)
  const best = windows[0] ?? null
  // The runner-up must be a DIFFERENT delay, not the same cluster entered one
  // vote later — otherwise every winner ties with its own shoulder.
  const runnerUp = best
    ? windows.find((w) => Math.abs(w.centreMs - best.centreMs) > 4 * VOTE_TOL_MS) ?? null
    : null

  const decisive = best !== null && (runnerUp === null || best.n >= runnerUp.n * VOTE_MARGIN)
  return {
    best: best ? { votes: best.n, centreMs: best.centreMs } : null,
    runnerUp: runnerUp ? { votes: runnerUp.n, centreMs: runnerUp.centreMs } : null,
    decisive,
  }
}

export function analyze({
  wavPath,
  logText,
  offsetMs,
  triggeredAtHostEpochMs,
  wavMtimeMs,
  ffmpegSpawnedAtHostEpochMs,
  ffmpegExitedAtHostEpochMs,
  repoRoot = '.',
}) {
  const { samples, sampleRate, channels, durationS, truncatedBytes } = readWavSamples(wavPath)
  const { onsets, noiseFloor, threshold, peak } = detectOnsets(samples, sampleRate)
  // Where on a sound's rise this recording's detector fires, as a fraction of
  // that sound's peak — the only form of the threshold that transfers to the
  // source clips, which have a different gain and almost no room noise.
  const thresholdFraction = peak > 0 ? threshold / peak : null
  const reps = parseRepLines(logText)
  const problems = []
  const notes = []

  if (truncatedBytes > 0) {
    notes.push(
      `the wav declares ${truncatedBytes} more data bytes than the file holds — ffmpeg did not` +
        ` finalise the header. Duration here is from the bytes present; anchor.mjs would use the` +
        ` declared size and disagree by ${r1((truncatedBytes / (2 * channels * sampleRate)) * 1000)} ms`,
    )
  }

  // anchor.mjs's formula, restated at the point of use so the assumption is
  // visible rather than imported silently.
  const audioT0HostEpochMs = wavMtimeMs - durationS * 1000

  // THE ANCHOR BRACKET. Recording cannot begin before ffmpeg was spawned, and
  // the last sample cannot arrive after it exited:  spawn ≤ t0 ≤ exit − duration.
  // Two-sided, so it catches the LATE error that mtime actually makes.
  let anchor = null
  if (Number.isFinite(ffmpegSpawnedAtHostEpochMs) && Number.isFinite(ffmpegExitedAtHostEpochMs)) {
    const lo = ffmpegSpawnedAtHostEpochMs
    const hi = ffmpegExitedAtHostEpochMs - durationS * 1000
    anchor = {
      loMs: Math.round(lo),
      hiMs: Math.round(hi),
      widthMs: Math.round(hi - lo),
      estimateOffsetMs: Math.round(audioT0HostEpochMs - lo),
      inside: audioT0HostEpochMs >= lo && audioT0HostEpochMs <= hi,
    }
    if (hi < lo) {
      problems.push(
        `the wav is ${r1(lo - hi)} ms longer than the window ffmpeg was alive for — this file was` +
          ` not produced by this session (a reused session dir, or an appended capture.wav)`,
      )
    } else if (!anchor.inside) {
      problems.push(
        `wav anchor ${Math.round(audioT0HostEpochMs)} falls outside its hard bracket ` +
          `[${anchor.loMs}, ${anchor.hiMs}] — mtime − duration is wrong, so every latency below is` +
          ` shifted by the same amount`,
      )
    } else {
      // The bracket bounds GROSS anchor error; it does not certify precision,
      // because ffmpeg's device-open dominates its width. Reported, not gated.
      notes.push(
        `anchor bracket is ${anchor.widthMs} ms wide (ffmpeg device-open + close); the mtime` +
          ` estimate sits ${anchor.estimateOffsetMs} ms into it. The bracket rules out a gross` +
          ` anchor error, it does not measure this one`,
      )
    }
  } else {
    problems.push(
      'no ffmpeg spawn/exit stamps — the wav anchor is unbounded in the one direction mtime' +
        ' actually errs; re-record with run-playhead-session.mjs',
    )
  }

  const onsetHostEpochMs = onsets.map((s) => audioT0HostEpochMs + s * 1000)
  // hostEpoch = deviceEpoch − offsetMs   (offsetMs is DEVICE − HOST)
  const playheadHostEpochMs = reps.map((r) => r.playheadEpochMs - offsetMs)

  if (reps.length < MIN_REPS) problems.push(`only ${reps.length} rep records (want ≥ ${MIN_REPS})`)
  if (onsets.length === 0) problems.push('no acoustic onsets detected — is the mic on the right input, and near the speaker?')

  // A LONG SILENCE IN THE MIDDLE OF A STEADY PROBE MEANS SOUNDS WENT MISSING.
  // The threshold is one absolute level for the whole recording, so a quieter
  // asset — the bell is at a different level from the speech — can fall under
  // it wholesale and simply not appear. The dry run had a 15.25 s hole against
  // a 555 ms median spacing: roughly 27 plays that were never detected, and
  // nothing said so. Detection cannot be fixed from here without a capture to
  // tune against, but it must not be silent.
  let detectionGapMs = null
  if (onsets.length > 2) {
    const gaps = onsets.slice(1).map((v, i) => (v - onsets[i]) * 1000)
    detectionGapMs = Math.round(Math.max(...gaps))
    const typical = median(gaps)
    if (detectionGapMs > Math.max(3 * typical, 2_000)) {
      problems.push(
        `a ${r1(detectionGapMs / 1000)} s stretch has no detected sound, against a ${Math.round(typical)} ms` +
          ` typical spacing — roughly ${Math.round(detectionGapMs / typical)} plays are missing from the` +
          ` recording, not from the tablet. Check the mic level, and whether one asset is quieter than` +
          ` the detector's threshold`,
      )
    }
  }

  // Causality, kept for the direction the bracket cannot see: a trigger stamped
  // after the first sound means the tap and the recording are not the same run.
  let causalityViolationMs = null
  if (onsetHostEpochMs.length > 0 && Number.isFinite(triggeredAtHostEpochMs)) {
    const slack = onsetHostEpochMs[0] - triggeredAtHostEpochMs
    if (slack < 0) causalityViolationMs = Math.round(-slack)
  }

  const chosen = chooseLatency(onsetHostEpochMs, playheadHostEpochMs)

  const paired = []
  const usedOnsets = new Map()
  let censored = 0
  if (chosen.best && chosen.decisive) {
    for (let i = 0; i < playheadHostEpochMs.length; i += 1) {
      // Match each rep to the onset nearest its EXPECTED arrival, anchored to
      // the global estimate rather than to its neighbour — so a missing sound
      // or a spurious onset costs one sample instead of sliding the sequence.
      const expected = playheadHostEpochMs[i] + chosen.best.centreMs
      let best = null
      for (const o of onsetHostEpochMs) {
        const d = Math.abs(o - expected)
        if (d <= MATCH_WINDOW_MS && (best === null || d < Math.abs(best - expected))) best = o
      }
      if (best === null) censored += 1
      else {
        usedOnsets.set(best, (usedOnsets.get(best) ?? 0) + 1)
        paired.push({ ...reps[i], latencyMs: best - playheadHostEpochMs[i], onsetHostEpochMs: best })
      }
    }
  } else if (!chosen.best) {
    problems.push('no rep/onset pair fell inside the search range — there is nothing here to align')
  } else {
    problems.push(
      `the latency is not decisive: ${r1(chosen.best.centreMs)} ms has ${chosen.best.votes} votes and ` +
        `${r1(chosen.runnerUp.centreMs)} ms has ${chosen.runnerUp.votes}. With randomised gaps the true ` +
        `delay should win outright — it does not, so this run cannot be resolved without guessing`,
    )
  }

  // Two reps matching one onset means the pairing is off by a play somewhere,
  // and the duplicate is one of them reported twice.
  const reusedOnsets = [...usedOnsets.values()].filter((c) => c > 1).length
  if (reusedOnsets > 0) {
    problems.push(
      `${reusedOnsets} onset(s) were matched to more than one play — the pairing has slipped, so` +
        ` some latencies below are the same sound counted twice`,
    )
  }

  const lat = paired.map((p) => p.latencyMs)

  if (chosen.decisive) {
    if (paired.length < MIN_REPS) {
      problems.push(`only ${paired.length} plays paired (of ${reps.length}) — too few to report`)
    }
    if (reps.length > 0 && paired.length < reps.length * MIN_PAIRED_FRACTION) {
      problems.push(
        `${paired.length} of ${reps.length} plays paired (want ≥ ${Math.round(MIN_PAIRED_FRACTION * 100)}%)` +
          ` — the survivors are a self-selected subset, and their tight agreement is the selection,` +
          ` not the path`,
      )
    }
  }
  if (censored > 0) {
    notes.push(
      `${censored} of ${reps.length} plays had no onset within ±${MATCH_WINDOW_MS} ms and were dropped.` +
        ` A tighter spread here means samples were discarded, not that the path got steadier`,
    )
  }

  // PLAUSIBILITY — now an independent check, because nothing above consulted it.
  const centre = lat.length ? median(lat) : null
  if (centre !== null && (centre < PLAUSIBLE_LO || centre > PLAUSIBLE_HI)) {
    problems.push(
      `median ${r1(centre)} ms is not physically possible for playhead → speaker — check the clock` +
        ` offset (${offsetMs} ms) and the wav anchor before believing any of this`,
    )
  }

  // Per-asset, with the detector's own attack bias removed.
  //
  // The fraction of peak is computed PER ASSET, not once for the recording.
  // The detector's threshold is absolute, so a quiet asset crosses it further
  // up its own envelope than a loud one does — which is a per-asset bias in
  // exactly the quantity being corrected. Using one global fraction would
  // under-correct the quiet asset and leave that difference sitting in the
  // asset split, where it would read as two audio paths disagreeing.
  const byAsset = {}
  for (const asset of new Set(paired.map((p) => p.asset ?? 'unknown'))) {
    const rows = paired.filter((p) => (p.asset ?? 'unknown') === asset)
    const raw = rows.map((p) => p.latencyMs)
    const assetPeak = median(
      rows.map((p) => peakBetween(samples, sampleRate, p.onsetHostEpochMs - audioT0HostEpochMs, ASSET_PEAK_WINDOW_MS)),
    )
    const fraction = assetPeak > 0 ? threshold / assetPeak : thresholdFraction
    const clip = SOURCE_CLIPS.find((c) => c.match.test(asset))
    let head = null
    try {
      head = clip ? sourceHeadMs(join(repoRoot, clip.path), fraction) : null
    } catch {
      head = null
    }
    byAsset[asset] = {
      n: raw.length,
      rawMedianMs: r1(median(raw)),
      /** Where on THIS asset's rise the recording's detector fired. */
      thresholdFractionOfPeak: r5(fraction),
      /** What this clip's own envelope costs the detector, at that fraction. */
      sourceHeadMs: r1(head),
      /** What the tablet did, as opposed to what the clip's attack did. */
      correctedMedianMs: head === null ? null : r1(median(raw) - head),
      madMs: r1(mad(raw)),
      p5Ms: r1(pct(raw, 5)),
      p95Ms: r1(pct(raw, 95)),
    }
  }

  const corrected = Object.values(byAsset)
    .map((a) => a.correctedMedianMs)
    .filter((v) => v !== null)
  const assetSplitMs = corrected.length > 1 ? r1(Math.max(...corrected) - Math.min(...corrected)) : null
  if (assetSplitMs !== null && assetSplitMs > 25) {
    notes.push(
      `assets still disagree by ${assetSplitMs} ms after correcting for their own attack shape —` +
        ` that residue is a real difference between audio paths, so report them separately rather` +
        ` than averaging them into one constant`,
    )
  }

  return {
    ok: problems.length === 0 && causalityViolationMs === null,
    problems,
    notes,
    causalityViolationMs,
    anchor,
    audioT0HostEpochMs,
    durationS: r1(durationS),
    sampleRate,
    channels,
    detection: {
      onsets: onsets.length,
      noiseFloor: r5(noiseFloor),
      threshold: r5(threshold),
      thresholdFractionOfPeak: r5(thresholdFraction),
      /** Largest silence between detected sounds. A hole here is missing
       *  DETECTIONS, not missing plays. */
      largestGapMs: detectionGapMs,
    },
    reps: reps.length,
    paired: paired.length,
    censored,
    reusedOnsets,
    alignment: chosen.best
      ? {
          coarseMs: r1(chosen.best.centreMs),
          votes: chosen.best.votes,
          decisive: chosen.decisive,
          runnerUpMs: chosen.runnerUp ? r1(chosen.runnerUp.centreMs) : null,
          runnerUpVotes: chosen.runnerUp ? chosen.runnerUp.votes : null,
        }
      : null,
    offsetMs,
    /** Pooled raw median: the detector's reading, attack bias included. */
    playheadToSpeakerMs: lat.length ? r1(median(lat)) : null,
    madMs: lat.length ? r1(mad(lat)) : null,
    p5Ms: lat.length ? r1(pct(lat, 5)) : null,
    p95Ms: lat.length ? r1(pct(lat, 95)) : null,
    spreadMs: lat.length ? r1(pct(lat, 95) - pct(lat, 5)) : null,
    /** The spread cannot exceed this by construction. If it is close, the
     *  window is what you are reading, not the path. */
    spreadCensoredAtMs: MATCH_WINDOW_MS,
    assetSplitMs,
    byAsset,
  }
}

function main() {
  const flag = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
  // Support both `--session=<dir>` and `--session <dir>`. The old form indexed
  // argv[indexOf(...) + 1] unconditionally, so with the `=` form indexOf
  // returned −1 and it silently read argv[0]: the node binary path.
  const spaceIdx = process.argv.indexOf('--session')
  const dir = flag('session') ?? (spaceIdx >= 0 ? process.argv[spaceIdx + 1] : undefined)
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
  const rawOffset = flag('offset') ?? trig.clockOffsetMs
  // Number(null) and Number('') are both 0, and 0 is exactly the catastrophic
  // offset this tool exists to catch — it must not arrive by coercion.
  const offsetMs = rawOffset === undefined || rawOffset === null || rawOffset === '' ? NaN : Number(rawOffset)
  if (!Number.isFinite(offsetMs)) {
    console.error('no clock offset — pass --offset=N or record it in trigger.json (see clock-offset.mjs)')
    process.exit(3)
  }

  const report = analyze({
    wavPath,
    logText: readFileSync(logPath, 'utf8'),
    offsetMs,
    triggeredAtHostEpochMs: trig.triggeredAtHostEpochMs,
    ffmpegSpawnedAtHostEpochMs: trig.ffmpegSpawnedAtHostEpochMs,
    ffmpegExitedAtHostEpochMs: trig.ffmpegExitedAtHostEpochMs,
    wavMtimeMs: statSync(wavPath).mtimeMs,
  })

  console.log(JSON.stringify(report, null, 2))
  if (report.causalityViolationMs !== null) {
    console.error(
      `\nREJECTED: the first sound lands ${report.causalityViolationMs} ms BEFORE the command that` +
        ` triggered it. Re-record; do not report this number.`,
    )
    process.exit(1)
  }
  if (!report.ok) {
    console.error('\n' + report.problems.map((p) => 'PROBLEM: ' + p).join('\n'))
    process.exit(2)
  }
  if (report.notes.length) console.log('\n' + report.notes.map((n) => 'NOTE: ' + n).join('\n'))
  console.log(
    `\nraw median ${report.playheadToSpeakerMs} ms (MAD ${report.madMs}) over ${report.paired} plays` +
      `\nper asset, attack-corrected: ` +
      Object.entries(report.byAsset)
        .map(([k, v]) => `${k} → ${v.correctedMedianMs ?? 'uncorrected ' + v.rawMedianMs}`)
        .join(' · '),
  )
}

if (process.argv[1]?.endsWith('playhead-to-speaker.mjs')) main()
