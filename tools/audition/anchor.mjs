/**
 * Audio-t0 anchor helper — one place, one formula.
 *
 * A capture.wav's mtime marks when ffmpeg CLOSED the file, so the true
 * epoch of the first audio sample is `mtime - duration`. Duration is
 * `(bytes - 44) / (2 · sampleRate · channels)` for a 16-bit PCM WAV.
 * Every prior session inlined this arithmetic and it drifted between them;
 * this module is the fixed point.
 *
 * Also writes both anchors into the session's manifest.json so downstream
 * tools (cadence_analyzer.py, validate_capture.py, whatever comes next) can
 * read them instead of re-deriving.
 *
 * Usage:
 *   import { computeAnchors, writeAnchors } from './anchor.mjs'
 *   const anchors = computeAnchors(sessionDir)
 *   writeAnchors(sessionDir, anchors)
 *
 * Or CLI: node tools/audition/anchor.mjs <sessionDir>
 */

import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Read a WAV's fmt chunk. Returns { sampleRate, channels, bitsPerSample,
 * dataBytes }. Walks the RIFF chunks — some ffmpeg builds emit extra
 * chunks after fmt so we cannot assume data starts at offset 44.
 */
export function readWavHeader(wavPath) {
  const buf = readFileSync(wavPath, { flag: 'r' })
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF')
    throw new Error(`not a RIFF WAV: ${wavPath}`)
  if (buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error(`not a WAVE: ${wavPath}`)

  let offset = 12
  let fmt = null
  let dataBytes = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(offset + 8 + 2),
        sampleRate: buf.readUInt32LE(offset + 8 + 4),
        bitsPerSample: buf.readUInt16LE(offset + 8 + 14),
      }
    } else if (id === 'data') {
      dataBytes = size
      break
    }
    offset = offset + 8 + size + (size % 2)
  }
  if (!fmt || dataBytes === null) throw new Error(`missing fmt/data in ${wavPath}`)
  return { ...fmt, dataBytes }
}

/** Duration in seconds for a 16-bit PCM WAV. */
export function wavDurationSeconds({ dataBytes, sampleRate, channels, bitsPerSample }) {
  const bytesPerSample = bitsPerSample / 8
  return dataBytes / (bytesPerSample * channels * sampleRate)
}

/**
 * Compute audioT0EpochMs (start of first sample) and logcatFirstEpochMs
 * (first `-v epoch` line in the log). Returns whichever pieces are present
 * on disk; a captured session always has both, so the caller can treat any
 * missing field as a broken capture.
 */
export function computeAnchors(sessionDir) {
  const anchors = { audioT0EpochMs: null, audioDurationS: null, logcatFirstEpochMs: null }
  const wavPath = join(sessionDir, 'capture.wav')
  try {
    const header = readWavHeader(wavPath)
    const durationS = wavDurationSeconds(header)
    const mtimeMs = statSync(wavPath).mtimeMs
    anchors.audioDurationS = Number(durationS.toFixed(3))
    anchors.audioT0EpochMs = Math.round(mtimeMs - durationS * 1000)
  } catch (err) {
    if (!String(err.message).includes('ENOENT')) throw err
  }
  const logPath = join(sessionDir, 'log.txt')
  try {
    // logcat prepends '--------- beginning of main' before the first epoch
    // line; walk until we find a decimal-epoch prefix.
    const lines = readFileSync(logPath, 'utf8').split(/\r?\n/)
    for (const line of lines) {
      const m = /^\s*(\d+\.\d+)\s/.exec(line)
      if (m) {
        anchors.logcatFirstEpochMs = Math.round(Number(m[1]) * 1000)
        break
      }
    }
  } catch (err) {
    if (!String(err.message).includes('ENOENT')) throw err
  }
  return anchors
}

/** Merge computed anchors into manifest.json without disturbing other fields. */
export function writeAnchors(sessionDir, anchors) {
  const manifestPath = join(sessionDir, 'manifest.json')
  let manifest = {}
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    if (!String(err.message).includes('ENOENT')) throw err
  }
  const merged = { ...manifest, ...anchors }
  writeFileSync(manifestPath, `${JSON.stringify(merged, null, 1)}\n`)
  return merged
}

// -------------------------------------------------------------------- CLI

const _thisFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === resolve(_thisFile)) {
  const sessionDir = process.argv[2]
  if (!sessionDir) {
    console.error('usage: node tools/audition/anchor.mjs <sessionDir>')
    process.exit(1)
  }
  const anchors = computeAnchors(sessionDir)
  const merged = writeAnchors(sessionDir, anchors)
  console.log(JSON.stringify(anchors, null, 2))
  if (!anchors.audioT0EpochMs || !anchors.logcatFirstEpochMs) {
    console.error('WARN: one or both anchors could not be computed.')
    process.exit(1)
  }
  console.log(`Merged into ${join(sessionDir, 'manifest.json')} (keys: ${Object.keys(merged).join(', ')})`)
}
