/**
 * Clean-voice bake-off (Kyle, 2026-09-02) — the Phase 0 gate before the
 * full re-render.
 *
 * The echo diagnosis: every cornerman2 clip is three broadcast passes
 * deep (v5 reference = textured render, selfref = concat of shipped
 * textured clips, plus the render-time chain), and the aecho taps stack
 * per pass. Kyle's ruling: keep the broadcast character, remove the
 * echo, rebuild from the cleanest EXISTING raw take.
 *
 * This renders a small matrix for Kyle's ear — nothing here touches
 * production assets:
 *
 *   references  A = cornerman-reference-v4.wav (raw Kyle recording,
 *                    zero texture passes; retired once for its bellow)
 *               B = a fresh UNTEXTURED self-clone: the six intro lines
 *                    re-rendered from v4 with no texture pass, concat
 *                    ~30s (Chatterbox averaging tames the bellow the
 *                    way v5 did, without inheriting any texture)
 *   textures    1 = broadcast-dry          (broadcast minus aecho)
 *               2 = broadcast-dry-gentle   (minus aecho, 8:1 @ -28)
 *
 * Output: tools/voice/bakeoff/{A1,A2,B1,B2}-…/<line>.wav over six real
 * shipped lines (2 lead-ins, 2 calls, 1 rest, 1 warn), plus 0-current/
 * copies of today's shipped clips as the baseline.
 *
 * Run: node tools/voice/bakeoff-clean-voice.mjs [--skip-selfref]
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { compileAdlib } from './prosody.mjs'
import { textureChain } from './texture.mjs'
import { PRODUCTION_EXPRESSION, getPersona } from './persona.mjs'
import { renameWithRetry, trimEnds } from './wav.mjs'
import { createHash } from 'node:crypto'

const CHATTERBOX_PYTHON = process.env.CHATTERBOX_PYTHON ?? 'F:/voice-tools/venv/Scripts/python.exe'
const V4_REFERENCE = join('tools', 'voice', 'reference', 'cornerman-reference-v4.wav')
const OUT_ROOT = join('tools', 'voice', 'bakeoff')
const SELFREF_CLEAN = join(OUT_ROOT, 'ref-selfclone-clean-30s.wav')

const EXAG = getPersona('cornerman').intensity.work // all three states resolve equal

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
const FFMPEG = findFfmpeg()

function renderRaw(reference, jobs) {
  const out = execFileSync(CHATTERBOX_PYTHON, [join('tools', 'voice', 'chatterbox_render.py')], {
    input: JSON.stringify({
      reference,
      attempts: 8,
      jobs: jobs.map((j) => ({
        path: j.wav,
        text: j.plan.renderedText,
        ...EXAG,
        minDurationMs: j.minDurationMs,
        maxDurationMs: j.maxDurationMs,
        expectText: j.plan.renderedText,
        asrMinScore: 0.8,
        ...(j.asrExact ? { asrExact: true } : {}),
      })),
    }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  for (const line of out.split(/\r?\n/)) {
    if (line.startsWith('FAIL ') || line.startsWith('OK ')) console.log(`  ${line}`)
  }
  for (const j of jobs) if (existsSync(j.wav)) trimEnds(j.wav, { tailMs: 120 })
}

function applyTexture(src, dest, texture) {
  const filters = textureChain(texture, { profile: 'single', finalAccentDb: 0 })
  const temp = `${dest}.p.wav`
  execFileSync(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-af', filters, '-ar', '24000', '-ac', '1', temp],
    { stdio: 'ignore' },
  )
  renameWithRetry(temp, dest)
}

// ---------------------------------------------------------------------------
// Stage 1 — the clean self-clone reference (candidate B), built once.
// Same six lines the cornerman2 selfref concatenated, but rendered fresh
// from v4 with NO texture pass: one clean generation.
// ---------------------------------------------------------------------------

const SELFREF_LINES = [
  { id: 'sr-hello', text: "Hello! Welcome to Punchcraft. I'm your coach, Jonathan Punchcraft." },
  { id: 'sr-rounds', text: "Today, we're boxing four rounds of four minutes each, with one minute of rest between rounds." },
  { id: 'sr-prog-beg', text: "Today's program: beginner fundamentals, building your foundation, at a steady pace." },
  { id: 'sr-prog-int', text: "Today's program: intermediate combinations, body work and counters, at a steady pace." },
  { id: 'sr-prog-adv', text: "Today's program: advanced chains, multi phase patterns and pressure, at a steady pace." },
  { id: 'sr-letsgo', text: "Let's get started!" },
]

mkdirSync(join(OUT_ROOT, 'selfref-src'), { recursive: true })

if (!existsSync(SELFREF_CLEAN) && !process.argv.includes('--skip-selfref')) {
  console.log('Stage 1: rendering the clean self-clone reference from v4 (untextured)…')
  const jobs = SELFREF_LINES.map((l) => ({
    ...l,
    plan: compileAdlib(l.text, { performance: 'work', expression: PRODUCTION_EXPRESSION, finish: 'land' }),
    minDurationMs: 900,
    maxDurationMs: 14_000,
    wav: join(process.cwd(), OUT_ROOT, 'selfref-src', `${l.id}.wav`),
  }))
  renderRaw(V4_REFERENCE, jobs)
  const listFile = join(OUT_ROOT, 'selfref-src', 'concat.txt')
  writeFileSync(
    listFile,
    jobs
      .filter((j) => existsSync(j.wav))
      .map((j) => `file '${j.wav.replace(/\\/g, '/')}'`)
      .join('\n') + '\n',
  )
  execFileSync(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-ar', '24000', '-ac', '1', SELFREF_CLEAN],
    { stdio: 'ignore' },
  )
  console.log(`  wrote ${SELFREF_CLEAN}`)
}

// ---------------------------------------------------------------------------
// Stage 2+3 — the matrix over six real shipped lines.
// ---------------------------------------------------------------------------

const hash8 = (text) => createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 8)

const LINES = [
  {
    key: 'leadin-bodywork',
    kind: 'lead-in',
    text: 'One, two-bee, one, two-bee — straight time, thirteen bars. One, two-bee, one, two-bee. Change level without reaching.',
    performance: 'work', finish: 'land', minDurationMs: 800, maxDurationMs: 9_000,
    currentWav: (t) => join('assets', 'voice', 'click-scripts', 'cornerman2', `li-${hash8(t)}.wav`),
  },
  {
    key: 'leadin-speed',
    kind: 'lead-in',
    text: 'One, two, one, two — straight time, fourteen bars. Fast does not mean wild. Four straight slots and back to guard.',
    performance: 'work', finish: 'land', minDurationMs: 800, maxDurationMs: 9_000,
    currentWav: (t) => join('assets', 'voice', 'click-scripts', 'cornerman2', `li-${hash8(t)}.wav`),
  },
  {
    key: 'call-1212',
    kind: 'call',
    text: 'One, two, one, two!',
    performance: 'push', finish: 'shout', minDurationMs: 250, maxDurationMs: 1_550, asrExact: true,
    currentWav: (t) => join('assets', 'voice', 'click-scripts', 'cornerman2', `cc-${hash8(t)}.wav`),
  },
  {
    key: 'call-12b',
    kind: 'call',
    text: 'One, two-bee!',
    performance: 'push', finish: 'shout', minDurationMs: 250, maxDurationMs: 1_100, asrExact: true,
    currentWav: (t) => join('assets', 'voice', 'click-scripts', 'cornerman2', `cc-${hash8(t)}.wav`),
  },
  {
    key: 'rest-trf1',
    kind: 'rest',
    text: 'Good first round. Let the arms hang for a breath, then bring the hands back home. Round two changes levels: first set is one, two, one, two — then one-bee, two, three, two on page two. Stay loose and be ready on the bell.',
    performance: 'teach', finish: 'land', minDurationMs: 3_000, maxDurationMs: 16_000,
    currentWav: (t) => join('assets', 'voice', 'click-scripts', 'cornerman2', `rr-${hash8(t)}.wav`),
  },
  {
    key: 'warn-round2',
    kind: 'warn',
    text: "It's time to get ready for round two, in three... two... one!",
    performance: 'work', finish: 'land', minDurationMs: 900, maxDurationMs: 14_000,
    currentWav: () => join('assets', 'voice', 'numbers', 'standalone', 'warn-round-2.wav'),
  },
]

const REFS = [
  { tag: 'A', label: 'v4raw', reference: V4_REFERENCE },
  { tag: 'B', label: 'selfclone', reference: SELFREF_CLEAN },
]
const TEXS = [
  { tag: '1', label: 'dry', texture: 'broadcast-dry' },
  { tag: '2', label: 'dry-gentle', texture: 'broadcast-dry-gentle' },
]

for (const ref of REFS) {
  if (!existsSync(ref.reference)) {
    console.error(`missing reference ${ref.reference} — run without --skip-selfref first`)
    process.exit(1)
  }
  const rawDir = join(OUT_ROOT, `raw-${ref.tag}`)
  mkdirSync(rawDir, { recursive: true })
  const jobs = LINES.map((l) => ({
    ...l,
    plan: compileAdlib(l.text, { performance: l.performance, expression: PRODUCTION_EXPRESSION, finish: l.finish }),
    wav: join(process.cwd(), rawDir, `${l.key}.wav`),
  }))
  const missing = jobs.filter((j) => !existsSync(j.wav))
  if (missing.length > 0) {
    console.log(`Stage 2: rendering ${missing.length} raw lines from reference ${ref.tag} (${ref.label})…`)
    renderRaw(ref.reference, missing)
  }
  for (const tex of TEXS) {
    const dir = join(OUT_ROOT, `${ref.tag}${tex.tag}-${ref.label}-${tex.label}`)
    mkdirSync(dir, { recursive: true })
    for (const j of jobs) {
      if (!existsSync(j.wav)) continue
      applyTexture(j.wav, join(dir, `${j.key}.wav`), tex.texture)
    }
    console.log(`Stage 3: ${dir} textured (${tex.texture})`)
  }
}

// Baseline: today's shipped sound, copied verbatim.
const baseDir = join(OUT_ROOT, '0-current')
mkdirSync(baseDir, { recursive: true })
for (const l of LINES) {
  const src = l.currentWav(l.text)
  if (existsSync(src)) copyFileSync(src, join(baseDir, `${l.key}.wav`))
  else console.log(`  baseline missing on disk: ${src}`)
}
console.log(`Baseline copies in ${baseDir}`)
console.log('\nBake-off complete. Folders: 0-current, A1, A2, B1, B2 — same six lines each.')
