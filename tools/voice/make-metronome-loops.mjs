/**
 * Metronome loop generator (M39-V1b / #280).
 *
 * Produces one-bar boxing-flavored `.wav` per `(division, swing)` combo
 * under `assets/audio/metronome/`, then writes
 * `src/audio/voiceAssets/metronomeAssets.ts` with measured durations
 * and Metro require paths.
 *
 * ## Sound design (placeholder)
 *
 * V1b ships SYNTH placeholders so the on-device gate can hear WHERE the
 * click lands even before final samples exist:
 *
 * - **Downbeat thud** — 80 Hz sine, 150 ms with an exponential fade out.
 *   Rounded low frequency reads as heavy-bag impact when played at
 *   moderate volume; nothing else in the corpus sits in this band.
 * - **Off-beat click** — white noise highpassed at 4 kHz, 40 ms with
 *   an exponential fade, mixed at 0.5 gain so it sits under the coach.
 *   Reads as a speed-bag / hi-hat tick.
 *
 * When production samples are ready, drop them at
 * `assets/audio/metronome/samples/thud.wav` and
 * `assets/audio/metronome/samples/hat.wav` — this script prefers those
 * over the synth if present.
 *
 * ## Grid math (Kyle's spec, verbatim)
 *
 * At `baseBpm = 60` the master beat is exactly 1,000 ms. Loops are
 * exactly one beat long so the native `createAudioPlaylist` loop is
 * seamless. Per division:
 *
 * - Division 1: one thud at t=0. No off-beats.
 * - Division 2: thud at 0, hat at `1000 × swing` ms.
 * - Division 3: thud at 0, hat at 333.33 and 666.67 ms (triplets never
 *   swung — swung triplets read as shuffle-on-shuffle).
 * - Division 4: thud at 0, hats at pairs `[0..1] × 500ms + inside × swing × 500`.
 *
 * Kyle's swing bands: 0.50 (mechanical), 0.54 (rolling — the default),
 * 0.56 (sing-song cornerman), 0.58 (pronounced), 0.62+ (auctioneer, avoid).
 * V1b renders 0.50 and 0.54 per division that admits swing (2 and 4).
 *
 * ## Idempotence & Metro filemap
 *
 * `assets/audio/metronome/` is a NEW top-level asset directory. Metro's
 * Windows-filemap rule is scoped to new subdirs under `assets/voice/`
 * — top-level subdirs of `assets/` (avatar/, branding/, effects/,
 * spike-voice/, voice/, and now audio/) are safe. Confirmed by
 * inspecting the existing tree before landing this generator.
 *
 * Run:
 *   node tools/voice/make-metronome-loops.mjs
 *   node tools/voice/make-metronome-loops.mjs --manifest-only    (skip renders)
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REPO_ROOT = process.cwd()
const OUT_DIR = join(REPO_ROOT, 'assets', 'audio', 'metronome')
const SAMPLES_DIR = join(OUT_DIR, 'samples')
const MANIFEST = join(REPO_ROOT, 'src', 'audio', 'voiceAssets', 'metronomeAssets.ts')

const BASE_BPM = 60
const BEAT_MS = 60_000 / BASE_BPM
const SAMPLE_RATE = 24_000

/** Every loop the runtime can request. Keep this in sync with the runtime's fallback rules. */
const LOOPS = [
  { division: 1, swing: 0.5 },
  { division: 2, swing: 0.5 },
  { division: 2, swing: 0.54 },
  { division: 3, swing: 0.5 },
  { division: 4, swing: 0.5 },
  { division: 4, swing: 0.54 },
]

function findFfmpeg() {
  const candidates = [
    'ffmpeg',
    join(
      homedir(),
      'AppData/Local/Microsoft/WinGet/Packages',
      'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe',
      'ffmpeg-9.0-full_build/bin/ffmpeg.exe',
    ),
  ]
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['-hide_banner', '-version'], { stdio: 'ignore' })
      return candidate
    } catch {
      // Try the next one.
    }
  }
  throw new Error('ffmpeg not found. winget install --id Gyan.FFmpeg')
}
function findFfprobe(ffmpeg) {
  return ffmpeg === 'ffmpeg' ? 'ffprobe' : ffmpeg.replace(/ffmpeg\.exe$/i, 'ffprobe.exe')
}

const FFMPEG = findFfmpeg()
const FFPROBE = findFfprobe(FFMPEG)

/** Grid times (ms) where the hat clicks land, given a division and swing. */
function hatOffsetsMs(division, swing) {
  const out = []
  if (division === 1) return out
  if (division === 2) {
    out.push(BEAT_MS * swing)
    return out
  }
  if (division === 3) {
    // Straight triplets — Kyle's spec: swing does not apply.
    out.push(BEAT_MS / 3)
    out.push((BEAT_MS / 3) * 2)
    return out
  }
  // division 4: swing applied per half-beat pair.
  const half = BEAT_MS / 2
  out.push(half * swing) // hat inside beat 1
  out.push(half) // downbeat of half 2 — hat too (thud only sits on the whole-beat downbeat)
  out.push(half + half * swing) // hat inside beat 2
  return out
}

/** Load or synthesize the thud impulse. Returns the wav path. */
function ensureThudWav() {
  const user = join(SAMPLES_DIR, 'thud.wav')
  if (existsSync(user)) return user
  const synth = join(SAMPLES_DIR, '_synth-thud.wav')
  mkdirSync(SAMPLES_DIR, { recursive: true })
  execFileSync(
    FFMPEG,
    [
      '-v', 'error', '-y',
      '-f', 'lavfi',
      '-i', `sine=frequency=80:duration=0.15:sample_rate=${SAMPLE_RATE}`,
      '-af', 'afade=t=out:st=0:d=0.15:curve=exp',
      '-ac', '1', '-c:a', 'pcm_s16le',
      synth,
    ],
    { stdio: 'ignore' },
  )
  return synth
}

/** Load or synthesize the hat click. Returns the wav path. */
function ensureHatWav() {
  const user = join(SAMPLES_DIR, 'hat.wav')
  if (existsSync(user)) return user
  const synth = join(SAMPLES_DIR, '_synth-hat.wav')
  mkdirSync(SAMPLES_DIR, { recursive: true })
  execFileSync(
    FFMPEG,
    [
      '-v', 'error', '-y',
      '-f', 'lavfi',
      '-i', `anoisesrc=color=white:duration=0.04:sample_rate=${SAMPLE_RATE}`,
      '-af', 'highpass=f=4000,afade=t=out:st=0:d=0.04:curve=exp,volume=0.5',
      '-ac', '1', '-c:a', 'pcm_s16le',
      synth,
    ],
    { stdio: 'ignore' },
  )
  return synth
}

function loopFileName(division, swing) {
  // Swing rendered as an integer % for a stable filename that doesn't
  // depend on locale float formatting: 0.54 → "54".
  const s = String(Math.round(swing * 100))
  return `metronome-d${division}-s${s}.wav`
}

function renderLoop({ division, swing, thud, hat, outPath }) {
  const beatMs = BEAT_MS
  const hats = hatOffsetsMs(division, swing).map((ms) => Math.round(ms))
  // Filter graph: silence bed, thud at 0, hats at their offsets. amix
  // with normalize=0 preserves individual gains; duration=first clamps
  // the mix to exactly one beat.
  const inputs = [
    '-f', 'lavfi', '-i', `anullsrc=r=${SAMPLE_RATE}:cl=mono:d=${beatMs / 1000}`,
    '-i', thud,
  ]
  const chains = [
    `[1:a]adelay=0|0,apad=whole_dur=${beatMs / 1000}[t]`,
  ]
  hats.forEach((ms, i) => {
    inputs.push('-i', hat)
    const inputIdx = i + 2 // 0 = silence bed, 1 = thud, 2..N = hat copies
    chains.push(`[${inputIdx}:a]adelay=${ms}|${ms},apad=whole_dur=${beatMs / 1000}[h${i}]`)
  })
  const mixLabels = ['[0:a]', '[t]', ...hats.map((_, i) => `[h${i}]`)].join('')
  chains.push(
    `${mixLabels}amix=inputs=${2 + hats.length}:duration=first:normalize=0[mix]`,
  )
  const filter = chains.join(';')
  execFileSync(
    FFMPEG,
    [
      '-v', 'error', '-y',
      ...inputs,
      '-filter_complex', filter,
      '-map', '[mix]',
      '-ar', String(SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le',
      outPath,
    ],
    { stdio: 'ignore' },
  )
}

function measureDurationMs(wav) {
  const out = execFileSync(
    FFPROBE,
    [
      '-v', 'error',
      '-show_entries', 'stream=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      wav,
    ],
    { encoding: 'utf8' },
  )
  return Math.round(parseFloat(out.trim()) * 1000)
}

function writeManifest() {
  const rows = LOOPS
    .map((loop) => ({ ...loop, file: loopFileName(loop.division, loop.swing) }))
    .filter((loop) => existsSync(join(OUT_DIR, loop.file)))
    .map((loop) => ({
      ...loop,
      durationMs: measureDurationMs(join(OUT_DIR, loop.file)),
    }))

  const lines = [
    '/**',
    ' * Boxing-flavored metronome loops (generated).',
    ' *',
    ' * DO NOT EDIT — produced by `node tools/voice/make-metronome-loops.mjs`.',
    ' *',
    ' * One entry per (division, swing) combination the runtime may request.',
    " * Kyle's spec 2026-08-30: 60 BPM master pulse, one-beat loops (1,000",
    ' * ms), thud on the downbeat, hats on the subdivisions (with swing on',
    ' * divisions 2 and 4; triplets never swung). Runtime fallback lives in',
    ' * `metronomeLoopFor(division, swing)` — an exact match wins; else the',
    " * straight-swing (0.50) loop for that division wins; else undefined.",
    ' */',
    '',
    '/* eslint-disable @typescript-eslint/no-require-imports */',
    '',
    'export interface MetronomeLoop {',
    '  /** 1..4 — the number of call slots per master beat. */',
    '  division: 1 | 2 | 3 | 4',
    '  /** 0.5 (mechanical) .. 0.62 (avoid). See TimingEngine SWING_* constants. */',
    '  swing: number',
    '  /** Metro module id for the loop wav. */',
    '  module: number',
    '  /** Measured length of one bar. Should equal 1000 ms at baseBpm 60. */',
    '  durationMs: number',
    '}',
    '',
    'export const METRONOME_LOOPS: readonly MetronomeLoop[] = [',
  ]
  for (const row of rows) {
    lines.push(
      `  { division: ${row.division}, swing: ${row.swing}, module: require('../../../assets/audio/metronome/${row.file}'), durationMs: ${row.durationMs} },`,
    )
  }
  lines.push(
    ']',
    '',
    '/**',
    ' * Runtime lookup: an exact match on `(division, swing)` wins; if the',
    ' * requested swing bucket was not rendered, fall back to the same',
    ' * division at straight swing (0.50). Returns undefined only when no',
    ' * loop exists for the division at all — the caller then no-ops.',
    ' */',
    'export function metronomeLoopFor(division: 1 | 2 | 3 | 4, swing: number): MetronomeLoop | undefined {',
    '  const exact = METRONOME_LOOPS.find((l) => l.division === division && Math.abs(l.swing - swing) < 0.005)',
    '  if (exact) return exact',
    '  return METRONOME_LOOPS.find((l) => l.division === division && Math.abs(l.swing - 0.5) < 0.005)',
    '}',
    '',
  )
  writeFileSync(MANIFEST, lines.join('\n'))
  // eslint-disable-next-line no-console
  console.log(`Wrote metronomeAssets.ts (${rows.length}/${LOOPS.length} loops on disk)`)
}

// ---------------------------------------------------------------------------

const manifestOnly = process.argv.includes('--manifest-only')

if (manifestOnly) {
  writeManifest()
  process.exit(0)
}

mkdirSync(OUT_DIR, { recursive: true })
const thud = ensureThudWav()
const hat = ensureHatWav()

for (const { division, swing } of LOOPS) {
  const outPath = join(OUT_DIR, loopFileName(division, swing))
  renderLoop({ division, swing, thud, hat, outPath })
  const bytes = statSync(outPath).size
  // eslint-disable-next-line no-console
  console.log(`  rendered ${loopFileName(division, swing)}  ${bytes} bytes`)
}
writeManifest()
