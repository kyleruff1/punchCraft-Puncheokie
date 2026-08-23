/**
 * Generate the Voice Coach clip set (M34-04, D16).
 *
 * D16's rule is that **time-critical speech is never synthesized at runtime** —
 * the clips are rendered ahead of time and the app plays local files. This
 * script is the ahead-of-time step.
 *
 * ## These are placeholders
 *
 * D16 names Kokoro-82M as the shipping voice. This script uses Windows SAPI
 * instead, because it is offline, needs no model download, and produces real
 * WAV files today — which is what unblocks the player, the queue and the
 * manifest. The rule that matters (nothing synthesized at runtime) is
 * unaffected by which renderer produced the file.
 *
 * Swapping in Kokoro later means re-running a different generator over the
 * same word table and dropping the output in the same place. Nothing in
 * `src/audio` knows or cares which one made the file.
 *
 * ## Two vocabularies and two forms, one set of ids (D15)
 *
 * `numbers` says "one"; `names` says "jab". Same `VoiceAssetId`, different
 * clip — which is why the vocabulary belongs to the manifest and not to the
 * id.
 *
 * Each vocabulary is rendered twice more, as a **form**:
 *
 * - `standalone` — a single command, called at a normal, clear pace.
 * - `combo` — the same word inside a combination, clipped and quicker, the
 *   way a coach rattles "one-two-three" rather than announcing three separate
 *   numbers.
 *
 * This is not the same word played faster at runtime; it is a different
 * rendering, so the consonants stay crisp instead of being smeared. Trimming
 * the gap between clips alone made combinations run together but not sound
 * any more like a coach calling them.
 *
 * Deliberate deviation from D15's example wording: `3` is **"lead hook"**, not
 * "left hook". A hook thrown with the lead hand is a left hook in orthodox and
 * a right hook in southpaw, so a clip that says "left" would be wrong every
 * time a southpaw threw it.
 *
 * Run: node tools/voice/make-voice-clips.mjs
 * Requires: Windows PowerShell with System.Speech (built in).
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const OUT_ROOT = join('assets', 'voice')
const SAMPLE_RATE = 44_100

/** Words that differ between vocabularies (D15). */
const VOCABULARY_WORDS = {
  numbers: {
    1: 'one',
    2: 'two',
    3: 'three',
    4: 'four',
    5: 'five',
    6: 'six',
  },
  names: {
    1: 'jab',
    2: 'cross',
    3: 'lead hook',
    4: 'rear hook',
    5: 'lead uppercut',
    6: 'rear uppercut',
  },
}

/** Words that are the same in both vocabularies. */
const SHARED_WORDS = {
  body: 'body',
  slip: 'slip',
  roll: 'roll',
  duck: 'duck',
  pull: 'pull',
  'bob-weave': 'bob and weave',
  pivot: 'pivot',
  'step-off': 'step off',
  circle: 'circle',
  'cut-off-ring': 'cut off the ring',
  reset: 'reset',
  go: 'go',
  stop: 'stop',
  switch: 'switch',
}

/**
 * Tones are sounds, not words, so they are synthesised rather than spoken —
 * and they are identical in both vocabularies.
 *
 * The bell is a longer, lower ring; the ready tone is short and high so it
 * reads as "now" rather than as a word.
 */
const TONES = {
  bell: { freqHz: 660, durationMs: 400, fadeOutMs: 250 },
  'tone-ready': { freqHz: 1_320, durationMs: 80, fadeOutMs: 20 },
  'tone-repeat': { freqHz: 990, durationMs: 60, fadeOutMs: 15 },
  'tone-warning': { freqHz: 520, durationMs: 300, fadeOutMs: 120 },
}

function wavTone({ freqHz, durationMs, fadeOutMs }) {
  const samples = Math.round((durationMs / 1000) * SAMPLE_RATE)
  const fade = Math.round((fadeOutMs / 1000) * SAMPLE_RATE)
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1) {
    const t = i / SAMPLE_RATE
    let amp = 0.7
    const fromEnd = samples - i
    if (fromEnd < fade) amp *= fromEnd / fade
    // A short attack ramp avoids the click an instant onset would give a
    // tone the athlete hears hundreds of times a session.
    if (i < 64) amp *= i / 64
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freqHz * t) * amp * 32_767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/**
 * Render every word in one PowerShell invocation.
 *
 * One process for the whole batch rather than one per clip: SAPI init costs
 * far more than the synthesis, and ~50 separate PowerShell launches would
 * take minutes for no benefit.
 */
function speakBatch(jobs, rate) {
  const lines = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    // A drill-sergeant call is clipped, not languid (D16 register).
    `$s.Rate = ${rate}`,
    "$s.SelectVoice('Microsoft David Desktop')",
  ]
  for (const { path, text } of jobs) {
    lines.push(`$s.SetOutputToWaveFile('${path.replace(/'/g, "''")}')`)
    lines.push(`$s.Speak('${text.replace(/'/g, "''")}')`)
  }
  lines.push('$s.SetOutputToNull()')
  lines.push('$s.Dispose()')

  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', lines.join('; ')], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * Speech rate per form.
 *
 * `combo` is faster because it is a word inside a run, not an announcement.
 * Tones are identical in both forms — a bell is a bell.
 */
const FORM_RATE = { standalone: 2, combo: 5 }

const cwd = process.cwd()
let count = 0

for (const vocabulary of ['numbers', 'names']) {
  for (const form of ['standalone', 'combo']) {
    const dir = join(OUT_ROOT, vocabulary, form)
    mkdirSync(dir, { recursive: true })

    const jobs = []
    for (const [id, text] of Object.entries(VOCABULARY_WORDS[vocabulary])) {
      jobs.push({ path: join(cwd, dir, `${id}.wav`), text })
    }
    for (const [id, text] of Object.entries(SHARED_WORDS)) {
      jobs.push({ path: join(cwd, dir, `${id}.wav`), text })
    }

    speakBatch(jobs, FORM_RATE[form])

    for (const [id, spec] of Object.entries(TONES)) {
      writeFileSync(join(dir, `${id}.wav`), wavTone(spec))
    }

    const paths = [
      ...jobs.map((j) => j.path),
      ...Object.keys(TONES).map((t) => join(cwd, dir, `${t}.wav`)),
    ]
    let bytes = 0
    for (const path of paths) bytes += statSync(path).size
    count += paths.length
    console.log(
      `${vocabulary.padEnd(8)} ${form.padEnd(10)} ${paths.length} clips  ${(bytes / 1024).toFixed(0)} KB`,
    )
  }
}

console.log(`\nWrote ${count} clips to ${OUT_ROOT}`)
console.log('Placeholder voice (Windows SAPI). D16 ships Kokoro-82M — see the header note.')
