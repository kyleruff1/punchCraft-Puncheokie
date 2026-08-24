/**
 * Shared WAV helpers for the voice build tools.
 *
 * Extracted so the audition tool and the production generator parse, trim and
 * beat clips through exactly the same code — a second copy is a second place
 * for the 44-byte-header assumption to creep back in, which it has, twice.
 *
 * All of this is build-time only; nothing here ships in the app.
 */

import { readFileSync, writeFileSync } from 'node:fs'

/** Parse a 16-bit PCM WAV by walking its chunk list. */
export function readWav(path) {
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

/**
 * Trim dead air from both ends.
 *
 * `thresholdRatio` is deliberately low and `headMs` generous. A speech onset
 * ramps: the /w/ of "one", the burst-then-vowel of "two", the /d/ of "duck"
 * all start well under a couple of percent of full scale and climb over tens
 * of milliseconds. Detecting at 2% and keeping only 20ms before it cut that
 * ramp away, so every clip began mid-sound — audibly truncated, and flatter,
 * because the attack transient is most of what makes a call sound punched
 * rather than spoken. Detecting at 0.4% with a 60ms margin keeps the attack
 * while still removing the silence Kokoro leaves at the head.
 */
export function trimEnds(path, { headMs = 60, tailMs = 100, thresholdRatio = 0.004 } = {}) {
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

export function insertBeats(path, beats) {
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

export function measureDuration(path) {
  const wav = readWav(path)
  if (!wav) return 0
  return Math.round((wav.frames / wav.fmt.sampleRate) * 1000)
}
