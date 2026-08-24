/**
 * Whole-phrase combination rendering — experiment 1 (M34 voice architecture).
 *
 * ## Why this exists
 *
 * The concatenation approach is architecturally capped. Playing `one.wav`,
 * `two.wav`, `three.wav` back to back cannot become one utterance, because a
 * speaker shortens phonemes, shifts stress, and blends transitions *across*
 * a phrase — and none of that information exists when each word is rendered
 * alone. Overlapping the clips does not create speed; it plays two finished
 * recordings at once.
 *
 * So a combination is synthesized as a single pass: "One, two — three, TWO!"
 * The synthesizer produces the relative stress and the phrase ending itself.
 *
 * This run deliberately uses the **same SAPI voice** as the per-word clips.
 * That is the point of the experiment: holding the voice constant isolates
 * how much of the robotic quality came from concatenation and how much is
 * the voice. Swapping in a neural renderer is a separate variable.
 *
 * ## Prosody is authored, not left to chance
 *
 * Each combination carries how a coach would group it — entry, then power
 * finish — expressed as SSML breaks and a stressed final punch. `1-2-3-2`
 * becomes "One-two, three-TWO", not four identical syllables.
 *
 * ## Timing comes from the synthesizer, not a microphone
 *
 * SAPI raises `SpeakProgress` per word with an audio offset, so each phrase
 * ships with a sidecar naming when every token is spoken. The live screen can
 * light each circle at the moment its number is actually said, with no
 * envelope detection anywhere near the production path.
 *
 * Run: node tools/voice/make-phrase-clips.mjs
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Locate ffmpeg.
 *
 * Checked rather than assumed: winget installs it without refreshing the
 * current shell's PATH, so a fresh machine has the binary present and
 * invisible. Failing here with the install command is better than every clip
 * silently skipping post-processing.
 */
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
  throw new Error(
    'ffmpeg not found. Install it with:  winget install --id Gyan.FFmpeg  (see docs/dev-setup.md)',
  )
}

const FFMPEG = findFfmpeg()

const OUT_ROOT = join('assets', 'voice', 'phrases')

/**
 * Cadence profiles.
 *
 * The delivery changes, not the playback rate: a phrase rendered urgently is
 * a different performance, whereas speeding a recording up is the same
 * performance with the pitch wrong. `groupPauseMs` is the breath between a
 * coach's entry and their finish, and it is what makes 1-2-3-2 read as two
 * groups rather than four beats.
 */
const CADENCES = {
  technical: { speed: 1.0, groupSeparator: ', ', ending: '.' },
  steady: { speed: 1.15, groupSeparator: ', ', ending: '!' },
  pressure: { speed: 1.32, groupSeparator: ', ', ending: '!' },
  sprint: { speed: 1.5, groupSeparator: ' ', ending: '!' },
}

/**
 * The voice.
 *
 * A male American voice that reads as someone talking rather than an
 * assistant announcing. Changing this changes every clip, so it belongs to
 * the cache key alongside the renderer (D16).
 */
const VOICE = 'am_michael'
const RENDERER = `kokoro-${VOICE}`

/** Numbers, spelled so the synthesizer never reads a bare digit oddly. */
const NUMBER_WORDS = {
  1: 'One',
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
}

/** Defense and footwork words. Anything here is a transition, not a punch. */
const MOVEMENT_WORDS = {
  slip: 'Slip',
  roll: 'Roll',
  duck: 'Duck',
  pull: 'Pull',
  'bob-weave': 'Bob and weave',
  pivot: 'Pivot',
  'step off': 'Step off',
  'step-off': 'Step off',
  circle: 'Circle',
  'cut-off-ring': 'Cut off the ring',
  reset: 'Reset',
}

const isMovement = (token) => MOVEMENT_WORDS[token] !== undefined

/**
 * Spoken form of one notation token.
 *
 * `2b` becomes "Body two", never "two bee" — a body shot has to reach the
 * synthesizer as words a person would actually say (D10 keeps the *visual*
 * notation exact; this is only what the voice says).
 */
function spokenFor(token) {
  if (MOVEMENT_WORDS[token]) return MOVEMENT_WORDS[token]
  const body = /^([1-6])b$/i.exec(token)
  if (body) return `Body ${NUMBER_WORDS[Number(body[1])].toLowerCase()}`
  return NUMBER_WORDS[Number(token)] ?? token
}

/**
 * Group a combination the way a coach would call it.
 *
 * Punches pair up — entry, then finish — and a movement token stands alone
 * because it *is* the transition between them. This is what turns 1-2-3-2
 * into "One-two, three-TWO" rather than four evenly stressed numbers.
 *
 * Grouping lives here, at render time, and deliberately not in the domain:
 * the grouping is baked into the audio, so a runtime copy of these rules
 * would be a second source of truth that could disagree with the clip the
 * athlete actually hears.
 */
function groupTokens(tokens) {
  const groups = []
  let current = []
  for (const token of tokens) {
    if (isMovement(token)) {
      if (current.length > 0) {
        groups.push(current)
        current = []
      }
      groups.push([token])
      continue
    }
    current.push(token)
    if (current.length === 2) {
      groups.push(current)
      current = []
    }
  }
  if (current.length > 0) groups.push(current)
  return groups
}

/**
 * Every combination the authored workouts actually call.
 *
 * Read from the sample sources rather than kept as a second list here. A
 * hand-maintained list drifts, and the failure is silent: the workout calls a
 * combination, no phrase exists, and the coach quietly falls back to the
 * per-word path that this whole change exists to replace.
 *
 * Single-token entries are skipped — one punch is a standalone clip, and
 * rendering it as a "phrase" would just be the same word again.
 */
function combinationsFromSamples() {
  const dir = join('src', 'domain', 'workout', 'samples')
  const found = new Set()
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts')) continue
    const source = readFileSync(join(dir, file), 'utf8')
    for (const match of source.matchAll(/notation:\s*'([^']+)'/g)) {
      const notation = match[1]
      if (notation.split('-').length > 1) found.add(notation)
    }
  }
  return [...found].sort()
}

const PHRASES = combinationsFromSamples().map((id) => ({
  id,
  groups: groupTokens(id.split('-').map((t) => t.trim())),
}))

/** Every token in order, for the sidecar. */
const tokensOf = (phrase) => phrase.groups.flat()

/**
 * SSML for one combination at one cadence.
 *
 * The last token carries the emphasis because a combination ends on its power
 * punch, and a coach lands on it.
 */
function textFor(phrase, cadence) {
  const groups = phrase.groups.map((group) => group.map(spokenFor).join(' '))
  // Kokoro has no SSML, so the prosody is in the text: a space runs words
  // together inside a group, a comma separates the entry from the finish, and
  // the ending punctuation is what lands the final punch. At sprint the comma
  // goes too — there is no breath left to take.
  return `${groups.join(cadence.groupSeparator)}${cadence.ending}`
}

/* --------------------------------------------------------------- trimming */

/**
 * Trim only the outer silence of a complete phrase.
 *
 * Nothing between words is touched — that spacing *is* the performance, and
 * editing it would reintroduce the very problem whole-phrase rendering
 * exists to solve. Generous margins are kept so no attack or final consonant
 * is clipped into.
 */
function trimEnds(path, { thresholdRatio = 0.02, headMs = 25, tailMs = 90 } = {}) {
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
  const frames = Math.floor(data.size / bytesPerFrame)
  const threshold = 32_767 * thresholdRatio
  const peakOf = (frame) => {
    let peak = 0
    for (let c = 0; c < fmt.channels; c += 1) {
      peak = Math.max(peak, Math.abs(buffer.readInt16LE(data.start + frame * bytesPerFrame + c * 2)))
    }
    return peak
  }

  let first = 0
  while (first < frames && peakOf(first) < threshold) first += 1
  let last = frames - 1
  while (last > first && peakOf(last) < threshold) last -= 1
  if (first >= last) return null

  const head = Math.round((headMs / 1000) * fmt.sampleRate)
  const tail = Math.round((tailMs / 1000) * fmt.sampleRate)
  const start = Math.max(0, first - head)
  const end = Math.min(frames - 1, last + tail)
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

  return {
    // How much was cut from the front, so word marks can be shifted to match.
    headTrimMs: Math.round((start / fmt.sampleRate) * 1000),
    durationMs: Math.round(((end - start + 1) / fmt.sampleRate) * 1000),
  }
}

/* -------------------------------------------------------- post-processing */

/**
 * The chain that turns a flat synthesizer read into a command voice.
 *
 * Energy comes from processing, not from pushing the synthesizer into
 * distortion or truncating words — both of which cost intelligibility, which
 * is the one thing a punch call cannot lose.
 *
 * - `highpass` clears rumble that only muddies the low end.
 * - `acompressor` keeps every number equally forward, so the last punch of a
 *   combination is not quieter than the first.
 * - `equalizer` adds a small presence lift where consonants live.
 * - `alimiter` catches peaks without audible pumping.
 * - `loudnorm` normalises across every cue, so no combination is louder than
 *   another — the athlete should never adjust volume between calls.
 * - `afade` removes boundary clicks.
 *
 * Deliberately dry: reverb makes short numbers harder to pick out over music.
 */
function postProcess(path, durationMs) {
  const fadeOutStart = Math.max(0, durationMs / 1000 - 0.012)
  const filters = [
    // Rumble only muddies the low end; a command voice lives above it.
    'highpass=f=120',

    // Aggressive on purpose. A coach across a gym is *projecting*, and what
    // makes that read is every word arriving at the same forward level —
    // not the last punch of a combination being quieter than the first.
    'acompressor=threshold=-24dB:ratio=6:attack=3:release=70:makeup=4',

    // Presence, where intelligibility lives. Two narrow lifts rather than one
    // wide one, so the voice gets clearer without getting shrill.
    'equalizer=f=2400:width_type=o:width=1.0:g=4',
    'equalizer=f=3800:width_type=o:width=1.0:g=3',

    // A very small amount of saturation — the thickness of someone raising
    // their voice, not distortion. Past about 0.75 it starts sounding broken
    // rather than loud, and a broken number is an unusable one.
    'asoftclip=type=tanh:param=0.65',

    // A gym, not a hall. Two early reflections at 17 and 29 ms with low decay
    // put the voice in a room; anything longer smears short numbers into each
    // other, which is the one thing a punch call cannot afford.
    'aecho=0.9:0.75:17|29:0.12|0.07',

    'alimiter=limit=0.95:attack=2:release=40',
    'loudnorm=I=-15:TP=-1.2:LRA=8',
    'afade=t=in:st=0:d=0.008',
    `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.012`,
  ].join(',')

  const temp = `${path}.processed.wav`
  execFileSync(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-af', filters, '-ar', '22050', '-ac', '1', temp],
    { stdio: 'ignore' },
  )
  if (!existsSync(temp)) throw new Error(`ffmpeg produced nothing for ${path}`)
  renameSync(temp, path)
}

/* -------------------------------------------------------------- synthesis */

/**
 * Render every phrase in one Kokoro process.
 *
 * One process for the whole batch: loading the 325 MB model costs far more
 * than synthesising a phrase, so paying it once matters. A phrase that fails
 * is reported and skipped rather than taking the batch down with it.
 */
function renderAll(jobs) {
  const spec = jobs.map((job) => ({
    path: job.wav,
    text: job.text,
    speed: job.speed,
    voice: VOICE,
  }))

  const out = execFileSync('python', [join('tools', 'voice', 'kokoro_render.py')], {
    input: JSON.stringify(spec),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })

  const failures = []
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('FAIL ')) failures.push(line.slice(5))
  }
  if (failures.length > 0) {
    for (const failure of failures) console.error(`  render failed: ${failure}`)
  }
  return failures.length
}

/**
 * Word onsets, measured from the rendered audio.
 *
 * Kokoro exposes no per-word timing, so the onsets are read back off the
 * clip. That is sound here in a way it would not be in production: this is
 * clean synthesized audio with no room and no other source, measured once at
 * build time — not a microphone guessing during a workout.
 *
 * Returns `[]` when the number of detected words does not match the number
 * expected. A wrong mark would light the wrong circle, and no marks at all is
 * a visibly missing sidecar rather than a subtly wrong one.
 */
function measureWordOnsets(path, expectedWords) {
  const buffer = readFileSync(path)
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return []

  // Post-processing rewrites a canonical 44-byte header, so the layout is
  // known by this point.
  const channels = buffer.readUInt16LE(22)
  const sampleRate = buffer.readUInt32LE(24)
  const bytesPerFrame = 2 * channels
  const frames = Math.floor((buffer.length - 44) / bytesPerFrame)

  const peakAt = (frame) => {
    let peak = 0
    for (let c = 0; c < channels; c += 1) {
      peak = Math.max(peak, Math.abs(buffer.readInt16LE(44 + frame * bytesPerFrame + c * 2)))
    }
    return peak
  }

  // A 10 ms envelope, so a syllable does not fragment into several onsets.
  const window = Math.round(sampleRate * 0.01)
  const envelope = []
  for (let f = 0; f < frames; f += window) {
    let peak = 0
    for (let i = f; i < Math.min(f + window, frames); i += 1) peak = Math.max(peak, peakAt(i))
    envelope.push({ atMs: Math.round((f / sampleRate) * 1000), peak })
  }

  const loudest = envelope.reduce((m, e) => Math.max(m, e.peak), 0)
  const threshold = loudest * 0.12
  const minGapWindows = 5 // 50 ms below threshold ends a word

  const onsets = []
  let inWord = false
  let belowFor = 0
  for (const point of envelope) {
    if (point.peak >= threshold) {
      if (!inWord) {
        onsets.push(point.atMs)
        inWord = true
      }
      belowFor = 0
    } else if (inWord) {
      belowFor += 1
      if (belowFor >= minGapWindows) inWord = false
    }
  }

  return onsets.length === expectedWords ? onsets : []
}

/* ------------------------------------------------------------------- main */

mkdirSync(OUT_ROOT, { recursive: true })
const cwd = process.cwd()

const jobs = []
for (const phrase of PHRASES) {
  for (const [cadenceName, cadence] of Object.entries(CADENCES)) {
    const key = `${phrase.id}.${cadenceName}`
    jobs.push({
      key,
      phrase,
      cadenceName,
      text: textFor(phrase, cadence),
      speed: cadence.speed,
      wav: join(cwd, OUT_ROOT, `${key}.wav`),
    })
  }
}

const failed = renderAll(jobs)

const index = []
for (const job of jobs) {
  // Trim first, process second: `loudnorm` should measure the phrase, not
  // the silence around it.
  const trimmed = trimEnds(job.wav)
  if (trimmed) postProcess(job.wav, trimmed.durationMs)
  const tokens = tokensOf(job.phrase)

  // A token can be more than one word — "Body two" — so the onsets are
  // matched by walking both lists rather than by index.
  const wordCounts = tokens.map((t) => spokenFor(t).split(' ').length)
  const expectedWords = wordCounts.reduce((a, b) => a + b, 0)
  const onsets = measureWordOnsets(job.wav, expectedWords)

  const wordMarks = []
  let wordIndex = 0
  for (let t = 0; t < tokens.length; t += 1) {
    const onset = onsets[wordIndex]
    if (onset !== undefined) {
      wordMarks.push({ tokenIndex: t, token: tokens[t], offsetMs: onset })
    }
    wordIndex += wordCounts[t]
  }

  index.push({
    cueId: job.key,
    combination: job.phrase.id,
    cadence: job.cadenceName,
    file: `${job.key}.wav`,
    tokens,
    durationMs: trimmed?.durationMs ?? 0,
    wordMarks,
    renderer: RENDERER,
  })

  const kb = (statSync(job.wav).size / 1024).toFixed(0)
  console.log(
    `${job.key.padEnd(24)} ${String(trimmed?.durationMs ?? 0).padStart(5)} ms  ${kb.padStart(4)} KB  ` +
      `marks ${wordMarks.length}/${tokens.length}`,
  )
}

writeFileSync(join(OUT_ROOT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
/**
 * Emit the app-side manifest.
 *
 * Generated rather than hand-written for the same reason the word manifest is
 * checked against the filesystem: a `require` of a missing asset resolves to
 * nothing at runtime and shows up as a phrase that silently never plays.
 * Generating it means the manifest cannot describe clips that were not made.
 */
const lines = [
  '/**',
  ' * Whole-phrase combination assets (generated).',
  ' *',
  ' * DO NOT EDIT — produced by `node tools/voice/make-phrase-clips.mjs`.',
  ' *',
  ' * Each entry pairs a clip with the word offsets the synthesizer itself',
  ' * reported, so the live screen can light a circle at the moment its number',
  ' * is spoken rather than inferring it from an amplitude envelope.',
  ' */',
  '',
  '/* eslint-disable @typescript-eslint/no-require-imports */',
  '',
  'export interface PhraseWordMark {',
  '  tokenIndex: number',
  '  token: string',
  '  /** Milliseconds from the start of the clip. */',
  '  offsetMs: number',
  '}',
  '',
  'export interface PhraseAsset {',
  '  cueId: string',
  '  combination: string',
  '  cadence: string',
  '  tokens: string[]',
  '  durationMs: number',
  '  wordMarks: PhraseWordMark[]',
  '  /** Metro module id for the clip. */',
  '  module: number',
  '  renderer: string',
  '}',
  '',
  'export const phraseAssets: readonly PhraseAsset[] = [',
]
for (const entry of index) {
  lines.push(
    '  {',
    `    cueId: ${JSON.stringify(entry.cueId)},`,
    `    combination: ${JSON.stringify(entry.combination)},`,
    `    cadence: ${JSON.stringify(entry.cadence)},`,
    `    tokens: ${JSON.stringify(entry.tokens)},`,
    `    durationMs: ${entry.durationMs},`,
    `    wordMarks: ${JSON.stringify(entry.wordMarks)},`,
    `    module: require('../../../assets/voice/phrases/${entry.file}'),`,
    `    renderer: ${JSON.stringify(entry.renderer)},`,
    '  },',
  )
}
lines.push(
  ']',
  '',
  '/* eslint-enable @typescript-eslint/no-require-imports */',
  '',
  '/** Lookup by combination and cadence. */',
  'export function findPhraseAsset(',
  '  combination: string,',
  '  cadence: string,',
  '): PhraseAsset | undefined {',
  '  return phraseAssets.find((a) => a.combination === combination && a.cadence === cadence)',
  '}',
  '',
)
writeFileSync(join('src', 'audio', 'voiceAssets', 'phraseManifest.ts'), lines.join('\n'))

console.log(`\nWrote ${jobs.length} phrases + index.json to ${OUT_ROOT}`)
console.log('Wrote src/audio/voiceAssets/phraseManifest.ts')
if (failed > 0) console.error(`${failed} phrase(s) failed to render`)

const withMarks = index.filter((entry) => entry.wordMarks.length > 0).length
if (withMarks < index.length) {
  console.log(
    `
Word marks: ${withMarks}/${index.length}. Kokoro exposes no per-word timing, and a ` +
      'natural delivery runs words together, so there are no envelope gaps to measure. ' +
      'Circle activation stays on the cue clock until a renderer that reports word ' +
      'boundaries (Azure) or a forced aligner is in play.',
  )
}
console.log(`Renderer: ${RENDERER}. Model files are gitignored — see tools/voice/README.md.`)
