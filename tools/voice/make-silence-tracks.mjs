/**
 * The silence tracks, generated — at the persona's sample rate.
 *
 * The walkout, the round warning and the recovery walkthrough play as ONE
 * native playlist each, so their pauses have to be tracks too. Those tracks
 * were made once by hand at 24 kHz, and `silenceManifest.ts` stated the
 * reason: "matching the voice clips so the playlist never renegotiates
 * format". The clips they sit between are 48 kHz. Plan 5b measured what the
 * mismatch costs on the tablet — ~95 ms of dead air entering a 24 kHz track
 * and ~193 ms entering a 48 kHz one — so a seven-track walkout ran about
 * 800 ms long, spread as gaps between sentences, and the round warning's
 * countdown ended later than `warnEndToBellMs` believed.
 *
 * This is the generator those files never had. It reads the rate from the
 * one place every renderer must (`OUT_SAMPLE_RATE`), so the silence and the
 * speech cannot disagree again unless someone hardcodes a rate — which
 * `tools/guards/playlist-sample-rate.mjs` then catches.
 *
 * Durations are `SILENCE_TRACKS`' keys, verbatim: every gap the intro planner
 * and the recovery corpus can emit. Adding a hold means adding it there AND
 * here; the manifest does an exact lookup, and a missing gap is logged at
 * runtime by `CeremonyPlaylist.silenceTrack`.
 *
 *   node tools/voice/make-silence-tracks.mjs           # write all 18
 *   node tools/voice/make-silence-tracks.mjs --check   # report, write nothing
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { OUT_SAMPLE_RATE } from './persona.mjs'
import { renameWithRetry } from './wav.mjs'

/** Must match `SILENCE_TRACKS` in src/audio/voiceAssets/silenceManifest.ts. */
const SILENCE_MS = [350, 800, 900, 1000, 1200, 1400, 1500, 1600, 1700, 1800, 2000, 2200, 2500, 3000, 3500, 4000, 4500, 5000]

const OUT_DIR = join('assets', 'voice', 'numbers', 'standalone')
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg'
const check = process.argv.includes('--check')

/** Sample rate from the RIFF fmt chunk, or null. Header only — no decode. */
function sampleRateOf(path) {
  if (!existsSync(path)) return null
  const buf = readFileSync(path)
  if (buf.length < 36 || buf.toString('ascii', 0, 4) !== 'RIFF') return null
  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ') return buf.readUInt32LE(offset + 8 + 4)
    offset += 8 + size + (size % 2)
  }
  return null
}

const want = Number(OUT_SAMPLE_RATE)
let wrote = 0
let stale = 0
for (const ms of SILENCE_MS) {
  const out = join(OUT_DIR, `silence-${ms}.wav`)
  const have = sampleRateOf(out)
  if (have === want) continue
  stale += 1
  if (check) {
    console.log(`STALE ${out}: ${have ?? 'missing'} Hz, want ${want}`)
    continue
  }
  const temp = `${out}.tmp.wav`
  // anullsrc renders digital silence directly at the target rate — no
  // resampling, so the file is exactly `ms` long to the sample.
  execFileSync(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `anullsrc=r=${want}:cl=mono`,
      '-t', String(ms / 1000), '-ar', String(want), '-ac', '1', '-c:a', 'pcm_s16le', temp],
    { stdio: 'inherit' },
  )
  renameWithRetry(temp, out)
  wrote += 1
  console.log(`wrote ${out} @ ${want} Hz (was ${have ?? 'missing'})`)
}

if (check) {
  console.log(stale === 0 ? `all ${SILENCE_MS.length} silence tracks at ${want} Hz` : `${stale} stale`)
  process.exit(stale === 0 ? 0 : 1)
}
console.log(`${wrote} written, ${SILENCE_MS.length - wrote} already at ${want} Hz`)
