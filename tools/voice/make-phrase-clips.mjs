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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, statSync } from 'node:fs'
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
  technical: { rate: '+15%', groupPauseMs: 260, finalEmphasis: 'moderate' },
  standard: { rate: '+55%', groupPauseMs: 150, finalEmphasis: 'strong' },
  pressure: { rate: '+90%', groupPauseMs: 90, finalEmphasis: 'strong' },
}

/** Spoken form of each token. `1B` never reaches the synthesizer as "one bee". */
const SPOKEN = {
  1: 'One',
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
  '1B': 'Body one',
  '2B': 'Body two',
  roll: 'Roll',
  slip: 'Slip',
}

/**
 * The experiment set, grouped the way a coach would call them.
 *
 * Groups are entry / finish, which is what produces "One-two, three-TWO"
 * instead of four evenly stressed numbers.
 */
const PHRASES = [
  { id: '1-2', groups: [['1', '2']] },
  { id: '1-1-2', groups: [['1', '1'], ['2']] },
  { id: '1-2-3-2', groups: [['1', '2'], ['3', '2']] },
  { id: '1-2-roll-3-2', groups: [['1', '2'], ['roll'], ['3', '2']] },
  { id: '1-1-2-3-2', groups: [['1', '1', '2'], ['3', '2']] },
  { id: '1-2-5-2', groups: [['1', '2'], ['5', '2']] },
]

/** Every token in order, for the sidecar. */
const tokensOf = (phrase) => phrase.groups.flat()

/**
 * SSML for one combination at one cadence.
 *
 * The last token carries the emphasis because a combination ends on its power
 * punch, and a coach lands on it.
 */
function ssmlFor(phrase, cadence) {
  const tokens = tokensOf(phrase)
  const lastIndex = tokens.length - 1
  let index = 0

  const groups = phrase.groups.map((group) => {
    const words = group.map((token) => {
      const word = SPOKEN[token] ?? token
      const isLast = index === lastIndex
      index += 1
      return isLast
        ? `<emphasis level="${cadence.finalEmphasis}">${word}</emphasis>`
        : word
    })
    // Space, not comma. SAPI reads a comma as a substantial pause — measured
    // at ~980 ms between "One" and "two" — which made the gaps *inside* a
    // group twice the gap between groups and inverted the whole grouping.
    // Words inside a group run together; only the group break separates.
    return words.join(' ')
  })

  const body = groups.join(`<break time="${cadence.groupPauseMs}ms"/>`)
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
    `<prosody rate="${cadence.rate}">${body}</prosody></speak>`
  )
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
    'highpass=f=110',
    'acompressor=threshold=-18dB:ratio=3:attack=5:release=90:makeup=2',
    'equalizer=f=3000:width_type=o:width=1.2:g=3',
    'alimiter=limit=0.94:attack=2:release=40',
    'loudnorm=I=-16:TP=-1.5:LRA=9',
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
 * Render every phrase in one PowerShell process, capturing word marks.
 *
 * `SpeakProgress` fires per word with the audio offset the synthesizer itself
 * used — which is the timing the live screen needs, measured at the source
 * rather than inferred from a recording.
 */
function renderAll(jobs) {
  const lines = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    "$s.SelectVoice('Microsoft David Desktop')",
    '$marks = New-Object System.Collections.ArrayList',
    '$handler = { param($sender, $e)',
    '  [void]$marks.Add("$($e.AudioPosition.TotalMilliseconds)|$($e.Text)")',
    '}',
    '$s.add_SpeakProgress($handler)',
  ]
  for (const job of jobs) {
    lines.push(`Write-Output "JOB ${job.key}"`)
    lines.push('$marks.Clear()')
    lines.push(`$s.SetOutputToWaveFile('${job.wav.replace(/'/g, "''")}')`)
    lines.push(`$s.SpeakSsml('${job.ssml.replace(/'/g, "''")}')`)
    lines.push('$s.SetOutputToNull()')
    lines.push('foreach ($m in $marks) { Write-Output "MARK $m" }')
  }
  lines.push('$s.Dispose()')

  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', lines.join('; ')],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  )

  const byKey = new Map()
  let current = null
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('JOB ')) {
      current = line.slice(4)
      byKey.set(current, [])
    } else if (line.startsWith('MARK ') && current) {
      const [ms, ...text] = line.slice(5).split('|')
      byKey.get(current)?.push({ offsetMs: Math.round(Number(ms)), text: text.join('|') })
    }
  }
  return byKey
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
      ssml: ssmlFor(phrase, cadence),
      wav: join(cwd, OUT_ROOT, `${key}.wav`),
    })
  }
}

const marksByKey = renderAll(jobs)

const index = []
for (const job of jobs) {
  // Trim first, process second: `loudnorm` should measure the phrase, not
  // the silence around it.
  const trimmed = trimEnds(job.wav)
  if (trimmed) postProcess(job.wav, trimmed.durationMs)
  const tokens = tokensOf(job.phrase)
  const rawMarks = marksByKey.get(job.key) ?? []
  const headTrimMs = trimmed?.headTrimMs ?? 0

  // One mark per token, in order. SAPI reports a mark per *word*, and
  // "Body one" is two words for one token, so marks are matched by walking
  // both lists rather than by index.
  const wordMarks = []
  let markIndex = 0
  for (let t = 0; t < tokens.length; t += 1) {
    const spoken = String(SPOKEN[tokens[t]] ?? tokens[t])
    const wordCount = spoken.split(' ').length
    const mark = rawMarks[markIndex]
    if (mark) {
      wordMarks.push({
        tokenIndex: t,
        token: tokens[t],
        offsetMs: Math.max(0, mark.offsetMs - headTrimMs),
      })
    }
    markIndex += wordCount
  }

  index.push({
    cueId: job.key,
    combination: job.phrase.id,
    cadence: job.cadenceName,
    file: `${job.key}.wav`,
    tokens,
    durationMs: trimmed?.durationMs ?? 0,
    wordMarks,
    renderer: 'sapi-david-ssml',
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
console.log('Same SAPI voice as the per-word clips — this isolates concatenation from the voice.')
