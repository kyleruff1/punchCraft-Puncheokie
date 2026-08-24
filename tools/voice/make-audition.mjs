/**
 * Persona audition — the decisive listening test.
 *
 * Six phrases × four voice blends × two callout vocabularies × three
 * performance states = 144 short assets. Deliberately **not** the full
 * library: the point is to settle the persona before rendering hundreds of
 * clips that would all have to be thrown away if the blend is wrong.
 *
 * The phrase set is chosen to expose the things that actually differ:
 *
 * - `1` and `2` are single strikes, which use the striking profile rather
 *   than the flowing one.
 * - `1-2` is the shortest real combination.
 * - `1-1-2` repeats a word, which is where concatenation used to fail.
 * - `1-2-3-2` is two groups — the "one-TWO | three-TWO" shape.
 * - `1-2-roll-3-2` breaks the melodic run with a defense and resumes it.
 *
 * Pipeline per asset: compile a plan → Kokoro renders one utterance →
 * parselmouth applies the pitch contour and aged drift → ffmpeg applies the
 * gym production chain → trim only the outer silence.
 *
 * Run: node tools/voice/make-audition.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { compilePhrase } from './prosody.mjs'

const OUT_ROOT = join('assets', 'voice', 'audition')

/**
 * Candidate personas.
 *
 * Weights are hypotheses to be judged by ear — voice-embedding interpolation
 * is not linear in perceived age. All four are rendered rather than
 * pre-selecting three: the fourth costs about thirty seconds, which is far
 * less than the cost of guessing wrong.
 */
const BLENDS = {
  'aged-melodic': { am_michael: 0.45, am_fenrir: 0.25, am_puck: 0.2, am_santa: 0.1 },
}

/**
 * Round two settles **expression**, not timbre.
 *
 * Round one compared four blends and aged-melodic won across every phrase, so
 * the blend axis is spent. What it also showed is that the winning voice was
 * still too flat, which is a prosody problem: a different blend would only
 * have produced a different monotone.
 *
 * The phrase set leans on movement tokens, because that is where the delivery
 * was weakest — the roll was being read as one more item in a list.
 */
const EXPRESSIONS = ['measured', 'expressive', 'theatrical']

const PHRASES = ['1', '1-2', '1-2-3-2', '1-2-roll-3-2', '1-slip-2', '2-3-2-roll-1-2']
const VOCABULARIES = ['numbers', 'techniques']
const PERFORMANCES = ['teach', 'work', 'push']
/** One cadence for the audition: the persona, not the tempo, is under test. */
const CADENCE = 'steady'

/** Aged drift — small enough to read as weathered rather than unsteady. */
const DRIFT_SEMITONES = 0.14
const DRIFT_HZ = 4.2

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
  throw new Error('ffmpeg not found. winget install --id Gyan.FFmpeg (see tools/voice/README.md)')
}

const FFMPEG = findFfmpeg()

/* --------------------------------------------------------------- processing */

/**
 * The gym production chain, plus formant scaling for age.
 *
 * A single strike is compressed harder and left drier than a combination: it
 * has to arrive like the coach just saw an opening, and a tail on a 300 ms
 * command only blurs the next one.
 */
function postProcess(path, { profile, finalAccentDb }) {
  const single = profile === 'single'
  const filters = [
    'highpass=f=120',
    // Formant scale below 1 lengthens the vocal tract — the resonance of an
    // older, heavier voice. Pitch is handled by Praat, so this shifts timbre
    // only.
    'rubberband=pitch=1.0:formant=preserved:pitchq=quality',
    `acompressor=threshold=${single ? '-26dB' : '-24dB'}:ratio=${single ? 7 : 5}:attack=${single ? 2 : 4}:release=${single ? 60 : 80}:makeup=${single ? 5 : 4}`,
    'equalizer=f=2400:width_type=o:width=1.0:g=4',
    'equalizer=f=3800:width_type=o:width=1.0:g=3',
    `asoftclip=type=tanh:param=${single ? 0.72 : 0.65}`,
    // A gym, not a hall. Shorter still on singles.
    single ? 'aecho=0.9:0.8:13:0.06' : 'aecho=0.9:0.75:17|29:0.12|0.07',
    'alimiter=limit=0.95:attack=2:release=40',
    `loudnorm=I=${(-15 + finalAccentDb * 0.25).toFixed(1)}:TP=-1.2:LRA=8`,
    'afade=t=in:st=0:d=0.006',
  ].join(',')

  const temp = `${path}.p.wav`
  execFileSync(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-af', filters, '-ar', '24000', '-ac', '1', temp],
    { stdio: 'ignore' },
  )
  if (!existsSync(temp)) throw new Error(`ffmpeg produced nothing for ${path}`)
  renameSync(temp, path)
}

/**
 * Trim only the outer silence.
 *
 * Nothing between words is touched: that spacing is the performance. Singles
 * keep a longer tail than their attack needs, because clipping a final
 * consonant turns "six" into "sih".
 */
/** Parse a 16-bit PCM WAV by walking its chunk list. */
function readWav(path) {
  const buffer = readFileSync(path)
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF') return null

  let offset = 12
  let fmt = null
  let data = null
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      fmt = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      data = { start: body, size: Math.min(size, buffer.length - body) }
    }
    offset = body + size + (size % 2)
  }
  if (!fmt || !data || fmt.bitsPerSample !== 16) return null

  const bytesPerFrame = 2 * fmt.channels
  return { buffer, fmt, data, bytesPerFrame, frames: Math.floor(data.size / bytesPerFrame) }
}

function trimEnds(path, { headMs = 20, tailMs = 100, thresholdRatio = 0.02 } = {}) {
  const wav = readWav(path)
  if (!wav) return null
  const { buffer, fmt, data, bytesPerFrame, frames } = wav
  const threshold = 32_767 * thresholdRatio
  const peakAt = (frame) => {
    let peak = 0
    for (let c = 0; c < fmt.channels; c += 1) {
      peak = Math.max(peak, Math.abs(buffer.readInt16LE(data.start + frame * bytesPerFrame + c * 2)))
    }
    return peak
  }

  let first = 0
  while (first < frames && peakAt(first) < threshold) first += 1
  let last = frames - 1
  while (last > first && peakAt(last) < threshold) last -= 1
  if (first >= last) return null

  const start = Math.max(0, first - Math.round((headMs / 1000) * fmt.sampleRate))
  const end = Math.min(frames - 1, last + Math.round((tailMs / 1000) * fmt.sampleRate))
  const kept = buffer.subarray(
    data.start + start * bytesPerFrame,
    data.start + (end + 1) * bytesPerFrame,
  )

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + kept.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(fmt.channels, 22)
  header.writeUInt32LE(fmt.sampleRate, 24)
  header.writeUInt32LE(fmt.sampleRate * bytesPerFrame, 28)
  header.writeUInt16LE(bytesPerFrame, 32)
  header.writeUInt16LE(fmt.bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(kept.length, 40)
  writeFileSync(path, Buffer.concat([header, kept]))

  return Math.round(((end - start + 1) / fmt.sampleRate) * 1000)
}

/**
 * Set the beats around a movement token, in the rendered audio.
 *
 * ## Why this is not concatenation
 *
 * The objection to stitching words together stands: separately synthesized
 * clips never sound like one person. Nothing is stitched here. This is a
 * single Kokoro utterance, and the only edit is **lengthening a silence the
 * synthesizer already produced** — the timbre, the breath and the pitch
 * contour run continuously across it.
 *
 * It runs before the production chain on purpose. The reverb is applied
 * afterwards, so the room tail decays across the inserted gap; inserting
 * digital silence into a finished, reverberant clip would read as a dropout.
 *
 * The cut point is found by searching for the quietest moment near the
 * estimated boundary rather than trusting the estimate, because the estimate
 * comes from token weights and the truth comes from the audio. A search that
 * lands slightly off lengthens a pause; an arithmetic cut that lands slightly
 * off clips a consonant.
 */
function insertBeats(path, beats) {
  if (!beats || beats.length === 0) return
  const wav = readWav(path)
  if (!wav) return
  const { buffer, fmt, data, bytesPerFrame, frames } = wav
  if (fmt.channels !== 1) return

  const rate = fmt.sampleRate
  const sampleAt = (frame) => buffer.readInt16LE(data.start + frame * bytesPerFrame)
  const windowFrames = Math.max(1, Math.round(rate * 0.008))
  const energy = (centre) => {
    let sum = 0
    const from = Math.max(0, centre - windowFrames)
    const to = Math.min(frames - 1, centre + windowFrames)
    for (let f = from; f <= to; f += 1) sum += Math.abs(sampleAt(f))
    return sum / Math.max(1, to - from + 1)
  }

  const quietLevel = 32_767 * 0.02
  const searchFrames = Math.round(rate * 0.18)

  const cuts = []
  for (const beat of beats) {
    const estimate = Math.round(beat.at * frames)
    let best = estimate
    let bestEnergy = Infinity
    for (
      let f = Math.max(windowFrames, estimate - searchFrames);
      f <= Math.min(frames - 1 - windowFrames, estimate + searchFrames);
      f += windowFrames
    ) {
      const value = energy(f)
      if (value < bestEnergy) {
        bestEnergy = value
        best = f
      }
    }

    // How much silence is already there, so a beat is set to a length rather
    // than blindly extended by a fixed amount.
    let from = best
    while (from > 0 && Math.abs(sampleAt(from)) < quietLevel) from -= 1
    let to = best
    while (to < frames - 1 && Math.abs(sampleAt(to)) < quietLevel) to += 1
    const existingMs = ((to - from) / rate) * 1000

    const padMs = Math.max(0, beat.targetMs - existingMs)
    if (padMs < 10) continue
    cuts.push({ frame: best, padFrames: Math.round((padMs / 1000) * rate) })
  }
  if (cuts.length === 0) return

  cuts.sort((a, b) => a.frame - b.frame)
  const pieces = []
  let cursor = 0
  for (const cut of cuts) {
    if (cut.frame < cursor) continue
    pieces.push(buffer.subarray(data.start + cursor * bytesPerFrame, data.start + cut.frame * bytesPerFrame))
    pieces.push(Buffer.alloc(cut.padFrames * bytesPerFrame))
    cursor = cut.frame
  }
  pieces.push(buffer.subarray(data.start + cursor * bytesPerFrame, data.start + frames * bytesPerFrame))
  const body = Buffer.concat(pieces)

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + body.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(fmt.channels, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * bytesPerFrame, 28)
  header.writeUInt16LE(bytesPerFrame, 32)
  header.writeUInt16LE(fmt.bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(body.length, 40)
  writeFileSync(path, Buffer.concat([header, body]))
}

/**
 * Duration of the finished file.
 *
 * Parses the chunk list rather than assuming a 44-byte header — ffmpeg writes
 * `LIST` metadata alongside `fmt ` and `data`, so a fixed offset reads the
 * wrong field and reports about a millisecond for every clip. The same
 * assumption broke the per-word trimmer earlier; it is wrong for the same
 * reason here.
 */
function measureDuration(path) {
  const wav = readWav(path)
  if (!wav) return 0
  return Math.round((wav.frames / wav.fmt.sampleRate) * 1000)
}

/* -------------------------------------------------------------------- build */

mkdirSync(OUT_ROOT, { recursive: true })
const cwd = process.cwd()

const jobs = []
for (const combination of PHRASES) {
  const tokens = combination.split('-').map((t) => t.trim())
  for (const blend of Object.keys(BLENDS)) {
    for (const vocabulary of VOCABULARIES) {
      for (const performance of PERFORMANCES) {
        for (const expression of EXPRESSIONS) {
          const plan = compilePhrase({ tokens, vocabulary, cadence: CADENCE, performance, expression })
          // A lone command is a bark. At the combination speed it arrives as
          // an announcement, which is the opposite of "the coach just saw an
          // opening".
          if (plan.profile === 'single') plan.speed = Math.round(plan.speed * 1.3 * 100) / 100
          const key = `${combination}.${blend}.${vocabulary}.${performance}.${expression}`
          jobs.push({
            key,
            combination,
            blend,
            vocabulary,
            performance,
            expression,
            plan,
            wav: join(cwd, OUT_ROOT, `${key}.wav`),
          })
        }
      }
    }
  }
}

console.log(`Rendering ${jobs.length} audition assets…`)

const renderOut = execFileSync('python', [join('tools', 'voice', 'kokoro_render.py')], {
  input: JSON.stringify({
    blends: BLENDS,
    jobs: jobs.map((j) => ({ path: j.wav, text: j.plan.renderedText, speed: j.plan.speed, blend: j.blend })),
  }),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
const renderFailures = renderOut.split(/\r?\n/).filter((l) => l.startsWith('FAIL '))
for (const failure of renderFailures) console.error(`  ${failure}`)

// Beats first: the contour is anchored to normalized positions, so setting
// the pauses before it runs is what keeps the accents landing on the right
// words once the phrase has changed length.
console.log('Setting movement beats…')
for (const job of jobs) {
  if (!existsSync(job.wav)) continue
  insertBeats(job.wav, job.plan.beats)
}

console.log('Applying pitch contour and aged drift…')
const contourOut = execFileSync('python', [join('tools', 'voice', 'pitch_contour.py')], {
  input: JSON.stringify(
    jobs
      .filter((j) => existsSync(j.wav))
      .map((j) => ({
        path: j.wav,
        contour: j.plan.pitchContourSemitones,
        shiftSemitones: j.plan.pitchShiftSemitones,
        driftSemitones: DRIFT_SEMITONES,
        driftHz: DRIFT_HZ,
      })),
  ),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
const contourFailures = contourOut.split(/\r?\n/).filter((l) => l.startsWith('FAIL '))
for (const failure of contourFailures) console.error(`  ${failure}`)

const index = []
for (const job of jobs) {
  if (!existsSync(job.wav)) continue
  // Trim first, process second. Processing first was the bug: heavy
  // compression lifts the echo tail and the noise floor, so the trimmer then
  // reads that raised tail as signal and keeps it. Every single strike came
  // out 150-300 ms longer than its target for that reason alone.
  trimEnds(job.wav, job.plan.profile === 'single' ? { tailMs: 70 } : {})
  postProcess(job.wav, { profile: job.plan.profile, finalAccentDb: job.plan.finalAccentDb })
  const durationMs = measureDuration(job.wav)
  index.push({
    cueId: job.key,
    combination: job.combination,
    blend: job.blend,
    vocabulary: job.vocabulary,
    performance: job.performance,
    expression: job.expression,
    cadence: CADENCE,
    file: `${job.key}.wav`,
    spokenText: job.plan.renderedText,
    durationMs,
    profile: job.plan.profile,
    plan: job.plan,
  })
}

writeFileSync(join(OUT_ROOT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)

/* ------------------------------------------------------------- app manifest */

const lines = [
  '/**',
  ' * Persona audition assets (generated).',
  ' *',
  ' * DO NOT EDIT — produced by `node tools/voice/make-audition.mjs`.',
  ' * These are a listening test, not production assets.',
  ' */',
  '',
  '/* eslint-disable @typescript-eslint/no-require-imports */',
  '',
  'export interface AuditionAsset {',
  '  cueId: string',
  '  combination: string',
  '  blend: string',
  '  vocabulary: string',
  '  performance: string',
  '  expression: string',
  '  spokenText: string',
  '  durationMs: number',
  '  profile: string',
  '  module: number',
  '}',
  '',
  'export const auditionAssets: readonly AuditionAsset[] = [',
]
for (const entry of index) {
  lines.push(
    '  {',
    `    cueId: ${JSON.stringify(entry.cueId)},`,
    `    combination: ${JSON.stringify(entry.combination)},`,
    `    blend: ${JSON.stringify(entry.blend)},`,
    `    vocabulary: ${JSON.stringify(entry.vocabulary)},`,
    `    performance: ${JSON.stringify(entry.performance)},`,
    `    expression: ${JSON.stringify(entry.expression)},`,
    `    spokenText: ${JSON.stringify(entry.spokenText)},`,
    `    durationMs: ${entry.durationMs},`,
    `    profile: ${JSON.stringify(entry.profile)},`,
    `    module: require('../../../assets/voice/audition/${entry.file}'),`,
    '  },',
  )
}
lines.push(']', '', '/* eslint-enable @typescript-eslint/no-require-imports */', '')
writeFileSync(join('src', 'audio', 'voiceAssets', 'auditionManifest.ts'), lines.join('\n'))

const singles = index.filter((e) => e.profile === 'single')
const outOfRange = singles.filter((e) => e.durationMs < 220 || e.durationMs > 340)
let bytes = 0
for (const entry of index) bytes += statSync(join(cwd, OUT_ROOT, entry.file)).size

console.log(`\n${index.length}/${jobs.length} assets, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
console.log(`singles within the 220-340 ms target: ${singles.length - outOfRange.length}/${singles.length}`)
if (outOfRange.length > 0) {
  console.log(
    `  outside: ${outOfRange.slice(0, 6).map((e) => `${e.cueId} ${e.durationMs}ms`).join(', ')}`,
  )
}
console.log('Wrote src/audio/voiceAssets/auditionManifest.ts')
