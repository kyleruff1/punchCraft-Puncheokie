/**
 * Tail-breath audit — errant noise after the end of a sentence in a walkout or
 * greeting clip, found, classified, and (on request) trimmed.
 *
 * ## What the signal actually showed
 *
 * The first version of this looked for one thing — a broadband hiss at
 * −30 to −45 dB after the last word — and found none in 72 clips. Dumping the
 * tails showed why, and showed three different things living there:
 *
 * 1. **A burst after silence.** `theme-straight-extension` decays to −80 dB,
 *    goes silent, then RISES back to −40 dB for ~60 ms at the very end. That
 *    is noise the render left after the sentence was over — a breath, a lip
 *    click, a chair. Unambiguously errant, and unambiguously safe to cut,
 *    because everything from the silence on is silence plus noise.
 * 2. **A sustained low tail.** The warn clips sit at −22 to −33 dB for
 *    150–250 ms after the last word and never reach silence — at a
 *    zero-crossing rate of 0.05–0.07, which is tonal, not hiss. That is the
 *    broadcast texture's compressor/reverb tail, not a breath. It may well be
 *    what an ear calls "breathy", but cutting it changes the voice, so it is
 *    REPORTED and never trimmed automatically.
 * 3. **The word's own decay,** which the first version's floor estimate
 *    (a 20th-percentile RMS, on clips that are mostly speech) sat above, so
 *    it hid everything quieter than the decay — including case 1.
 *
 * So the floor is now the 5th-percentile window — actual quiet — and the two
 * errant shapes are told apart by whether the clip went silent first (1) and
 * by texture (2). Mid-clip gaps between sentences are checked the same way,
 * at their MIDDLE rather than their loudest point (which is always the
 * preceding word's decay edge), and reported only: a mid-clip edit moves every
 * planned pause after it.
 *
 * Every number goes in the report so a verdict can be argued with. Nothing
 * changes by default; `--preview` writes trimmed copies next to the report
 * for listening. Nothing ships until the ear has ruled.
 *
 *   node tools/voice/tail-breath-audit.mjs             # report only
 *   node tools/voice/tail-breath-audit.mjs --preview   # + trimmed copies for A/B
 *   node tools/voice/tail-breath-audit.mjs --apply     # rewrite in place, print manifest durations
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { readWav } from './wav.mjs'

const CLIP_DIR = join('assets', 'voice', 'numbers', 'standalone')
/** The walkout and the greetings: everything the intro and warn playlists speak. */
const FAMILIES = [/^intro-.*\.wav$/, /^warn-.*\.wav$/, /^theme-.*\.wav$/]
const REPORT_DIR = join('tools', 'analysis', 'reports')
const PREVIEW_DIR = join('tools', 'analysis', 'listen', 'tail-breath-preview')

const HOP_MS = 5
const WIN_MS = 20
/** Speech: within 20 dB of the clip's own peak. */
const SPEECH_DB = -20
/** Silent: this far below peak, or under twice the true floor — whichever is higher. */
const SILENT_DB = -60
/** A burst after silence must clear this to count; below it is the floor breathing. */
const BURST_DB = -50
/** …and must rise this far above the tail's own trough — the local, not clip-wide, quiet. */
const BURST_RISE_DB = 12
/** A sustained tail is anything in this band, relative to peak, after the last word. */
const TAIL_BAND_DB = -40
const MIN_SPEECH_RUN_MS = 40
const MIN_BURST_MS = 15
const MIN_TAIL_MS = 100
const MIN_GAP_MS = 150
/** Above this zero-crossing rate a stretch is hiss; below, it is tonal. */
const HISS_ZCR = 0.1
const FADE_MS = 15
const TRIM_LEAD_MS = 10

const preview = process.argv.includes('--preview')
const apply = process.argv.includes('--apply')

const db = (ratio) => (ratio <= 0 ? -99 : 20 * Math.log10(ratio))
const r1 = (v) => Math.round(v * 10) / 10
const r3 = (v) => Math.round(v * 1000) / 1000

function samplesOf(wav) {
  const out = new Float32Array(wav.frames)
  for (let i = 0; i < wav.frames; i += 1) out[i] = wav.buffer.readInt16LE(wav.data.start + i * wav.bytesPerFrame) / 32768
  return out
}

/** RMS and zero-crossing rate per hop. */
function envelope(samples, sampleRate) {
  const hop = Math.round((sampleRate * HOP_MS) / 1000)
  const win = Math.round((sampleRate * WIN_MS) / 1000)
  const frames = []
  for (let start = 0; start + win <= samples.length; start += hop) {
    let sum = 0
    let crossings = 0
    for (let i = start; i < start + win; i += 1) {
      const v = samples[i]
      sum += v * v
      if (i > start && (v >= 0) !== (samples[i - 1] >= 0)) crossings += 1
    }
    frames.push({ tMs: (start / sampleRate) * 1000, rms: Math.sqrt(sum / win), zcr: crossings / win })
  }
  return frames
}

/** Contiguous stretches of frames where `pred` holds, at least `minMs` long. */
function runs(frames, pred, minMs) {
  const out = []
  let cur = null
  for (const f of frames) {
    if (pred(f)) {
      if (cur === null) cur = []
      cur.push(f)
    } else if (cur !== null) {
      out.push(cur)
      cur = null
    }
  }
  if (cur !== null) out.push(cur)
  return out
    .map((fr) => ({ startMs: fr[0].tMs, endMs: fr[fr.length - 1].tMs + WIN_MS, frames: fr }))
    .filter((r) => r.endMs - r.startMs >= minMs)
}

const meanZcr = (fr) => fr.reduce((a, f) => a + f.zcr, 0) / fr.length
const peakRms = (fr) => Math.max(...fr.map((f) => f.rms))

export function auditClip(path) {
  const wav = readWav(path)
  if (!wav) return { file: path, error: 'unreadable' }
  const sr = wav.fmt.sampleRate
  const frames = envelope(samplesOf(wav), sr)
  if (frames.length === 0) return { file: path, error: 'empty' }
  const durationMs = (wav.frames / sr) * 1000

  const peak = peakRms(frames)
  const sorted = frames.map((f) => f.rms).sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.05)]
  const speechThr = peak * 10 ** (SPEECH_DB / 20)
  const silentThr = Math.max(peak * 10 ** (SILENT_DB / 20), floor * 2)
  const burstThr = Math.max(peak * 10 ** (BURST_DB / 20), silentThr * 3)
  const tailBandThr = peak * 10 ** (TAIL_BAND_DB / 20)

  const speech = runs(frames, (f) => f.rms >= speechThr, MIN_SPEECH_RUN_MS)
  if (speech.length === 0) return { file: path, error: 'no speech found' }
  const lastSpeechEndMs = speech[speech.length - 1].endMs

  // --- the tail -------------------------------------------------------------
  const tail = frames.filter((f) => f.tMs >= lastSpeechEndMs)
  const findings = []

  // (1) Went silent, then something came back.
  //
  // Judged against the tail's OWN trough, not the clip's floor. The broadcast
  // texture keeps a bed under every inter-sentence gap, so on a clip that is
  // mostly gaps the 5th-percentile "floor" can sit at −45 dB — and a burst
  // threshold derived from it landed at −29 dB and missed a −40 dB burst that
  // followed a −80 dB trough. What makes a burst errant is the RISE after the
  // clip had already died away; that is a local quantity.
  if (tail.length > 0) {
    const troughIdx = tail.reduce((best, f, i) => (f.rms < tail[best].rms ? i : best), 0)
    const trough = tail[troughIdx]
    const wentSilent = trough.rms < Math.max(silentThr, peak * 10 ** ((TAIL_BAND_DB - 10) / 20))
    if (wentSilent && troughIdx < tail.length - 1) {
      const riseThr = Math.max(trough.rms * 10 ** (BURST_RISE_DB / 20), peak * 10 ** (BURST_DB / 20))
      const bursts = runs(tail.slice(troughIdx + 1), (f) => f.rms >= riseThr, MIN_BURST_MS)
      for (const b of bursts) {
        findings.push({
          kind: 'burst-after-silence',
          startMs: r1(b.startMs),
          endMs: r1(b.endMs),
          lengthMs: r1(b.endMs - b.startMs),
          levelDb: r1(db(peakRms(b.frames) / peak)),
          riseDb: r1(db(peakRms(b.frames) / trough.rms)),
          zcr: r3(meanZcr(b.frames)),
          silentFromMs: r1(trough.tMs),
          action: 'trim',
        })
      }
    }
  }

  // (2) Never went silent: a sustained tail in the band under speech.
  const sustained = runs(tail, (f) => f.rms >= tailBandThr && f.rms < speechThr, MIN_TAIL_MS)
  for (const s of sustained) {
    const zcr = meanZcr(s.frames)
    findings.push({
      kind: zcr >= HISS_ZCR ? 'breath-tail' : 'texture-tail',
      startMs: r1(s.startMs),
      endMs: r1(s.endMs),
      lengthMs: r1(s.endMs - s.startMs),
      levelDb: r1(db(peakRms(s.frames) / peak)),
      zcr: r3(zcr),
      action: zcr >= HISS_ZCR ? 'trim' : 'listen',
    })
  }

  // --- gaps between sentences, measured at their middle ---------------------
  const gaps = []
  for (let i = 1; i < speech.length; i += 1) {
    const a = speech[i - 1].endMs
    const b = speech[i].startMs
    if (b - a < MIN_GAP_MS) continue
    const mid = frames.filter((f) => f.tMs >= a + (b - a) * 0.25 && f.tMs <= a + (b - a) * 0.75)
    if (mid.length === 0) continue
    const level = peakRms(mid)
    const zcr = meanZcr(mid)
    const audible = level >= burstThr
    gaps.push({
      startMs: r1(a),
      endMs: r1(b),
      lengthMs: r1(b - a),
      midLevelDb: r1(db(level / peak)),
      midZcr: r3(zcr),
      verdict: !audible ? 'quiet' : zcr >= HISS_ZCR ? 'mid-gap-breath' : 'mid-gap-texture',
    })
  }

  // Where a trim would land: the earliest trimmable finding, led by a few ms.
  const trimmable = findings.filter((f) => f.action === 'trim')
  const trimAtMs = trimmable.length
    ? r1(Math.max(lastSpeechEndMs, Math.min(...trimmable.map((f) => (f.silentFromMs ?? f.startMs) - TRIM_LEAD_MS))))
    : null

  return {
    file: path,
    durationMs: r1(durationMs),
    lastSpeechEndMs: r1(lastSpeechEndMs),
    tailMs: r1(durationMs - lastSpeechEndMs),
    peakDbfs: r1(db(peak)),
    floorDb: r1(db(floor / peak)),
    findings,
    gaps,
    trimAtMs,
  }
}

/** The clip cut at `trimAtMs` with a linear fade, as a 16-bit PCM wav buffer. */
function trimmed(path, trimAtMs) {
  const wav = readWav(path)
  const sr = wav.fmt.sampleRate
  const keep = Math.min(wav.frames, Math.round((trimAtMs / 1000) * sr))
  const fade = Math.min(keep, Math.round((FADE_MS / 1000) * sr))
  const out = Buffer.alloc(44 + keep * 2)
  out.write('RIFF', 0)
  out.writeUInt32LE(36 + keep * 2, 4)
  out.write('WAVE', 8)
  out.write('fmt ', 12)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(sr, 24)
  out.writeUInt32LE(sr * 2, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36)
  out.writeUInt32LE(keep * 2, 40)
  for (let i = 0; i < keep; i += 1) {
    let v = wav.buffer.readInt16LE(wav.data.start + i * wav.bytesPerFrame)
    if (i >= keep - fade) v = Math.round(v * ((keep - i) / fade))
    out.writeInt16LE(v, 44 + i * 2)
  }
  return { buffer: out, durationMs: (keep / sr) * 1000 }
}

function main() {
  const files = readdirSync(CLIP_DIR).filter((n) => FAMILIES.some((re) => re.test(n))).sort()
  const results = files.map((n) => auditClip(join(CLIP_DIR, n)))

  const counts = {}
  console.log(`${'clip'.padEnd(42)}${'dur'.padStart(7)}${'tail'.padStart(6)}  findings`)
  for (const r of results) {
    const name = r.file.split(/[\\/]/).pop()
    if (r.error) {
      console.log(`${name.padEnd(42)} ${r.error}`)
      continue
    }
    const parts = [
      ...r.findings.map((f) => `${f.kind} ${f.startMs}–${f.endMs} (${f.lengthMs} ms, ${f.levelDb} dB, zcr ${f.zcr})`),
      ...r.gaps.filter((g) => g.verdict !== 'quiet').map((g) => `${g.verdict} in gap ${g.startMs}–${g.endMs} (${g.midLevelDb} dB, zcr ${g.midZcr})`),
    ]
    for (const f of r.findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1
    for (const g of r.gaps) if (g.verdict !== 'quiet') counts[g.verdict] = (counts[g.verdict] ?? 0) + 1
    const trim = r.trimAtMs !== null ? `  → trim at ${r.trimAtMs}` : ''
    console.log(`${name.padEnd(42)}${String(r.durationMs).padStart(7)}${String(r.tailMs).padStart(6)}  ${parts.join('; ') || 'clean'}${trim}`)
  }
  const trimmableClips = results.filter((r) => r.trimAtMs !== null)
  console.log(`\n${results.length} clips · ${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'nothing found'}`)
  console.log(`${trimmableClips.length} clip(s) have an errant tail this tool would cut; texture tails and mid-gap findings are reported for the ear only`)

  mkdirSync(REPORT_DIR, { recursive: true })
  writeFileSync(join(REPORT_DIR, 'tail-breath-audit.json'), JSON.stringify(results, null, 2) + '\n')

  if (preview || apply) {
    if (preview) mkdirSync(PREVIEW_DIR, { recursive: true })
    const durations = []
    for (const r of trimmableClips) {
      const name = r.file.split(/[\\/]/).pop()
      const t = trimmed(r.file, r.trimAtMs)
      if (preview) writeFileSync(join(PREVIEW_DIR, name), t.buffer)
      if (apply) writeFileSync(r.file, t.buffer)
      durations.push({ id: name.replace(/\.wav$/, ''), before: r.durationMs, after: r1(t.durationMs) })
    }
    if (preview) console.log(`\n${trimmableClips.length} trimmed preview(s) → ${PREVIEW_DIR}  (originals untouched — listen first)`)
    if (apply) {
      console.log(`\n${trimmableClips.length} clip(s) rewritten in place. Manifest durationMs to update:`)
      for (const d of durations) console.log(`  ${d.id.padEnd(40)} ${d.before} → ${d.after}`)
    }
  }
}

if (process.argv[1]?.endsWith('tail-breath-audit.mjs')) main()
