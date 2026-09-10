#!/usr/bin/env node
/**
 * Playlist sample-rate guard.
 *
 * Fails if any two clips that can sit in the SAME native playlist have
 * different sample rates.
 *
 * ## Why this is a gate and not a note
 *
 * The walkout, the round warning and the recovery walkthrough each play as
 * one `createAudioPlaylist` — clips interleaved with silence tracks. Plan 5b
 * measured, on the tablet, what a sample-rate change at a track boundary
 * costs: nothing when the rates match, ~95 ms of dead air entering a 24 kHz
 * track and ~193 ms entering a 48 kHz one when they do not. The silence tracks
 * were 24 kHz and the speech around them 48 kHz, so a seven-track walkout ran
 * about 800 ms long and the round warning's countdown ended later than the
 * analyzer believed — in the one direction its check could not see.
 *
 * Nothing about that was visible in code. The manifests record a module and a
 * duration, not a rate; the renderers each chose their own; and the file that
 * documented the invariant (`silenceManifest.ts`) was wrong about it. This
 * reads the shipped files' headers and checks the invariant that actually
 * matters: not "one rate everywhere" — a clip played alone through
 * `createAudioPlayer` has no boundary and pays nothing — but **no rate change
 * inside a playlist**.
 *
 * ## The pools
 *
 * Built from the manifests' `require()` paths, which is the same resolution
 * Metro does — so a clip is in a pool iff the player can queue it.
 *
 *   intro     introManifest `intro-*`               + silence
 *   warn      introManifest `warn-*` + calloutManifest `theme-*`
 *             + clickScriptManifest `lead-in/*` (the pre-bell opener) + silence
 *   recovery  recoveryManifest segments             + silence
 */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..')
const MANIFESTS = path.join(REPO_ROOT, 'src', 'audio', 'voiceAssets')

/** Every `require('../../../assets/...')` in a manifest, as repo-relative paths. */
async function requiredAssets(manifestFile, filter = () => true) {
  const text = await fs.readFile(path.join(MANIFESTS, manifestFile), 'utf8')
  const out = []
  for (const line of text.split(/\r?\n/)) {
    if (!filter(line)) continue
    for (const m of line.matchAll(/require\('((?:\.\.\/)+assets\/[^']+\.wav)'\)/g)) {
      out.push(m[1].replace(/^(\.\.\/)+/, ''))
    }
  }
  return out
}

/** Sample rate from the RIFF fmt chunk. Header only — a 660 MB corpus must not be decoded to be checked. */
async function sampleRateOf(relPath) {
  const handle = await fs.open(path.join(REPO_ROOT, relPath), 'r')
  try {
    const buf = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
    if (bytesRead < 36 || buf.toString('ascii', 0, 4) !== 'RIFF') return null
    let offset = 12
    while (offset + 8 <= bytesRead) {
      const id = buf.toString('ascii', offset, offset + 4)
      const size = buf.readUInt32LE(offset + 4)
      if (id === 'fmt ') return buf.readUInt32LE(offset + 8 + 4)
      offset += 8 + size + (size % 2)
    }
    return null
  } finally {
    await handle.close()
  }
}

async function main() {
  const silence = await requiredAssets('silenceManifest.ts')
  const pools = {
    intro: [...(await requiredAssets('introManifest.ts', (l) => l.includes("'intro-"))), ...silence],
    warn: [
      ...(await requiredAssets('introManifest.ts', (l) => l.includes("'warn-"))),
      ...(await requiredAssets('calloutManifest.ts', (l) => l.includes("'theme-"))),
      ...(await requiredAssets('clickScriptManifest.ts', (l) => l.includes("'lead-in/"))),
      ...silence,
    ],
    recovery: [...(await requiredAssets('recoveryManifest.ts')), ...silence],
  }

  let failed = false
  for (const [pool, files] of Object.entries(pools)) {
    const unique = [...new Set(files)]
    if (unique.length === 0) {
      console.error(`playlist-sample-rate: pool "${pool}" resolved to no files — the manifest shape changed under this guard`)
      failed = true
      continue
    }
    const byRate = new Map()
    for (const f of unique) {
      const rate = await sampleRateOf(f)
      const key = rate ?? 'unreadable'
      if (!byRate.has(key)) byRate.set(key, [])
      byRate.get(key).push(f)
    }
    const rates = [...byRate.keys()]
    if (rates.length === 1 && rates[0] !== 'unreadable') {
      console.log(`playlist-sample-rate: ${pool.padEnd(9)} ${unique.length} files, all ${rates[0]} Hz`)
      continue
    }
    failed = true
    console.error(`playlist-sample-rate: pool "${pool}" mixes rates — every boundary between them is a format renegotiation:`)
    for (const [rate, list] of [...byRate.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.error(`  ${String(rate).padStart(10)} Hz  ${list.length} file(s)${list.length <= 25 ? ':' : ', e.g.:'}`)
      for (const f of list.slice(0, 25)) console.error(`             ${f}`)
    }
  }

  if (failed) {
    console.error('\nFix: render to OUT_SAMPLE_RATE (tools/voice/persona.mjs) — never a literal — and regenerate silence with tools/voice/make-silence-tracks.mjs.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(`playlist-sample-rate: ${err.message}`)
  process.exit(2)
})
