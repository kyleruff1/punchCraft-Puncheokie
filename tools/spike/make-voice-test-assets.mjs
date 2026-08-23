/**
 * Generate the M34-01 spike's test clips (#195).
 *
 * These are measurement tones, not voice. The spike measures *when a clip
 * becomes audible relative to its deadline*, and for that a synthetic tone
 * is strictly better than a recorded word: it starts at full amplitude on
 * sample zero, so the onset in an external recording is unambiguous. A
 * spoken word ramps in, and the ramp would be indistinguishable from
 * latency.
 *
 * WAV only, and deliberately so — this workstation has no AAC or Vorbis
 * encoder, which is recorded as a gap in the spike write-up rather than
 * papered over.
 *
 * Run: node tools/spike/make-voice-test-assets.mjs
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = join('assets', 'spike-voice')
const SAMPLE_RATE = 44_100

/**
 * A mono 16-bit PCM WAV.
 *
 * The attack is instantaneous on purpose (see the header note); only the
 * tail is faded, to avoid a click at the end that could be mistaken for a
 * second onset.
 */
function tone({ freqHz, durationMs, fadeOutMs = 5 }) {
  const samples = Math.round((durationMs / 1000) * SAMPLE_RATE)
  const fadeSamples = Math.round((fadeOutMs / 1000) * SAMPLE_RATE)
  const data = Buffer.alloc(samples * 2)

  for (let i = 0; i < samples; i += 1) {
    const t = i / SAMPLE_RATE
    let amplitude = 0.8
    const fromEnd = samples - i
    if (fromEnd < fadeSamples) amplitude *= fromEnd / fadeSamples
    const value = Math.round(Math.sin(2 * Math.PI * freqHz * t) * amplitude * 32_767)
    data.writeInt16LE(value, i * 2)
  }

  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16) // PCM chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(SAMPLE_RATE, 24)
  header.writeUInt32LE(SAMPLE_RATE * 2, 28) // byte rate
  header.writeUInt16LE(2, 32) // block align
  header.writeUInt16LE(16, 34) // bits per sample
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)

  return Buffer.concat([header, data])
}

const CLIPS = [
  // Stands in for a spoken digit: the shortest thing the coach ever says.
  { name: 'tone-short.wav', freqHz: 880, durationMs: 150 },
  // Stands in for a four-token phrase at the `names` vocabulary's length.
  { name: 'tone-long.wav', freqHz: 660, durationMs: 900 },
  // The ready tone from doc §18.3.
  { name: 'tone-ready.wav', freqHz: 1_320, durationMs: 80 },
]

mkdirSync(OUT_DIR, { recursive: true })
for (const clip of CLIPS) {
  const buffer = tone(clip)
  writeFileSync(join(OUT_DIR, clip.name), buffer)
  console.log(`${clip.name.padEnd(18)} ${clip.durationMs} ms  ${buffer.length} bytes`)
}
console.log(`\nWrote ${CLIPS.length} clips to ${OUT_DIR}`)
