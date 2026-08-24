/**
 * Persona audition — the decisive listening test.
 *
 * Deliberately **not** the full library. Each round settles exactly one
 * question before hundreds of clips are rendered against an answer that turns
 * out to be wrong, and the rounds are cumulative:
 *
 * 1. **Timbre** — four voice blends. `aged-melodic` won across every phrase.
 * 2. **Expression** — three depths of pitch movement, plus real beats around
 *    a defense token. `theatrical` won across every phrase.
 * 3. **Texture** — the production chain. Under test now.
 *
 * One axis varies per round and everything else is pinned, because comparing
 * two things at once tells you only that they differ. `AXIS` names the
 * dimension and `VARIANTS` lists its values; the audition screen reads both
 * from the generated manifest, so a new round needs no UI change.
 *
 * The phrase set is chosen to expose the things that actually differ:
 *
 * - `1` is a single strike, which uses the striking profile, not the flowing
 *   one.
 * - `1-2` is the shortest real combination.
 * - `1-2-3-2` is two groups — the "one-TWO | three-TWO" shape.
 * - `1-2-roll-3-2` and `1-slip-2` break the melodic run and resume it.
 * - `2-3-2-roll-1-2` ends on a movement, where there is nothing to resume.
 *
 * Pipeline per asset: compile a plan → Kokoro renders one utterance → the
 * movement beats are set → parselmouth applies the pitch contour and aged
 * drift → the outer silence is trimmed → ffmpeg applies the texture chain.
 *
 * Run: node tools/voice/make-audition.mjs
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { compileAdlib, compilePhrase } from './prosody.mjs'
import { textureChain } from './texture.mjs'
import { PRODUCTION_EXPRESSION, PRODUCTION_FINISH, PRODUCTION_TEXTURE } from './persona.mjs'
import { insertBeats, measureDuration, trimEnds } from './wav.mjs'

const OUT_ROOT = join('assets', 'voice', 'audition')

/* ------------------------------------------------------- the round under test */

/**
 * Round six chases **character at the voice-blend level**.
 *
 * Round five's finding: the production chain is a weak lever for character —
 * broadcast (the cleanest) beat every gritty treatment, because saturation and
 * EQ can only do so much and pushing them just costs intelligibility. The grit
 * and age a cornerman actually has live in the *voice*, so this varies the
 * Kokoro blend instead, with far more headroom.
 *
 * Everything downstream is pinned to the settled persona (theatrical · shout ·
 * broadcast); only the blend changes. `am_onyx` brings depth, `am_fenrir`
 * roughness, `am_santa` age — weighted against `am_michael` for clarity, which
 * a punch call cannot lose. Weights are hypotheses judged by ear, not a
 * formula.
 */
const AXIS = 'blend'
const BLENDS = {
  // The current production blend, as the reference.
  'aged-melodic': { am_michael: 0.45, am_fenrir: 0.25, am_puck: 0.2, am_santa: 0.1 },
  // Depth from onyx, roughness from fenrir.
  gravel: { am_michael: 0.35, am_fenrir: 0.3, am_onyx: 0.25, am_santa: 0.1 },
  // Rough-forward and older.
  grizzled: { am_fenrir: 0.4, am_michael: 0.3, am_santa: 0.2, am_onyx: 0.1 },
  // Dark and deep, onyx-led.
  stone: { am_onyx: 0.42, am_michael: 0.33, am_fenrir: 0.25 },
}
const VARIANTS = Object.keys(BLENDS)

const TEXTURE = PRODUCTION_TEXTURE
const FINISH = PRODUCTION_FINISH
const EXPRESSION = PRODUCTION_EXPRESSION

/**
 * Combinations and ad-libs, tagged by kind. Combos compile through the normal
 * path; ad-libs are fixed exclamations compiled by `compileAdlib`.
 */
const PHRASES = [
  { id: '1-2-3-2', kind: 'combo' },
  { id: '1-2b', kind: 'combo' },
  { id: '2-3-6', kind: 'combo' },
  { id: 'lets-go', kind: 'adlib', text: "Let's go!" },
  { id: 'there-it-is', kind: 'adlib', text: 'There it is!' },
]
const VOCABULARIES = ['numbers']
const PERFORMANCES = ['push']
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

/** Apply one texture's filtergraph, in place. See `texture.mjs`. */
function postProcess(path, { texture, profile, finalAccentDb }) {
  const filters = textureChain(texture, { profile, finalAccentDb })

  const temp = `${path}.p.wav`
  execFileSync(
    FFMPEG,
    ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-af', filters, '-ar', '24000', '-ac', '1', temp],
    { stdio: 'ignore' },
  )
  if (!existsSync(temp)) throw new Error(`ffmpeg produced nothing for ${path}`)
  renameSync(temp, path)
}

/* -------------------------------------------------------------------- build */

mkdirSync(OUT_ROOT, { recursive: true })
const cwd = process.cwd()

/**
 * One clip per (phrase, blend).
 *
 * The blend is the axis, and a blend is a different *voice*, so each variant is
 * its own Kokoro render — there is no shared take to fan out. The plan (text,
 * contour, beats, finish) is identical across blends, so it is compiled once
 * per phrase and reused; only the voice differs.
 */
const variants = []
for (const phrase of PHRASES) {
  for (const vocabulary of VOCABULARIES) {
    for (const performance of PERFORMANCES) {
      const plan =
        phrase.kind === 'adlib'
          ? compileAdlib(phrase.text, { performance, expression: EXPRESSION, finish: FINISH })
          : compilePhrase({
              tokens: phrase.id.split('-').map((t) => t.trim()),
              vocabulary,
              cadence: CADENCE,
              performance,
              expression: EXPRESSION,
              finish: FINISH,
            })
      // A lone call is a bark, not an announcement — push a single faster so it
      // arrives like the coach just saw an opening. Ad-libs carry their own
      // quicker speed.
      if (plan.profile === 'single' && phrase.kind !== 'adlib') {
        plan.speed = Math.round(plan.speed * 1.3 * 100) / 100
      }
      for (const variant of VARIANTS) {
        const key = `${phrase.id}.${vocabulary}.${performance}.${variant}`
        variants.push({
          key,
          phrase,
          vocabulary,
          performance,
          variant,
          plan,
          wav: join(cwd, OUT_ROOT, `${key}.wav`),
        })
      }
    }
  }
}

console.log(`Rendering ${variants.length} clips across ${VARIANTS.length} blends…`)

const renderOut = execFileSync('python', [join('tools', 'voice', 'kokoro_render.py')], {
  input: JSON.stringify({
    blends: BLENDS,
    jobs: variants.map((v) => ({
      path: v.wav,
      text: v.plan.renderedText,
      speed: v.plan.speed,
      blend: v.variant,
    })),
  }),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
for (const failure of renderOut.split(/\r?\n/).filter((l) => l.startsWith('FAIL '))) {
  console.error(`  ${failure}`)
}

// Beats and trim, then the contour, then the fixed broadcast texture — each
// clip through the same downstream pipeline so only the voice differs.
console.log('Setting beats and trimming…')
for (const v of variants) {
  if (!existsSync(v.wav)) continue
  insertBeats(v.wav, v.plan.beats)
  trimEnds(v.wav, v.plan.profile === 'single' ? { tailMs: 70 } : {})
}

console.log('Applying the contour and aged drift…')
const contourOut = execFileSync('python', [join('tools', 'voice', 'pitch_contour.py')], {
  input: JSON.stringify(
    variants
      .filter((v) => existsSync(v.wav))
      .map((v) => ({
        path: v.wav,
        contour: v.plan.pitchContourSemitones,
        shiftSemitones: v.plan.pitchShiftSemitones,
        finish: v.plan.finishShape,
        driftSemitones: DRIFT_SEMITONES,
        driftHz: DRIFT_HZ,
      })),
  ),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
for (const failure of contourOut.split(/\r?\n/).filter((l) => l.startsWith('FAIL '))) {
  console.error(`  ${failure}`)
}

console.log(`Applying the ${TEXTURE} texture…`)
const index = []
for (const v of variants) {
  if (!existsSync(v.wav)) continue
  try {
    postProcess(v.wav, {
      texture: TEXTURE,
      profile: v.plan.profile,
      finalAccentDb: v.plan.finalAccentDb,
    })
  } catch (error) {
    console.error(`  FAIL ${v.key}: ${error.message.split('\n')[0]}`)
    rmSync(v.wav, { force: true })
    continue
  }
  index.push({
    cueId: v.key,
    combination: v.phrase.id,
    axis: AXIS,
    variant: v.variant,
    blend: v.variant,
    expression: EXPRESSION,
    finish: FINISH,
    texture: TEXTURE,
    vocabulary: v.vocabulary,
    performance: v.performance,
    cadence: CADENCE,
    file: `${v.key}.wav`,
    spokenText: v.plan.renderedText,
    durationMs: measureDuration(v.wav),
    profile: v.plan.profile,
    plan: v.plan,
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
  '  variant: string',
  '  axis: string',
  '  vocabulary: string',
  '  performance: string',
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
    `    variant: ${JSON.stringify(entry.variant)},`,
    `    axis: ${JSON.stringify(entry.axis)},`,
    `    vocabulary: ${JSON.stringify(entry.vocabulary)},`,
    `    performance: ${JSON.stringify(entry.performance)},`,
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

console.log(`\n${index.length}/${variants.length} assets, ${(bytes / 1024 / 1024).toFixed(1)} MB`)

// Broken out per variant, because the whole point of the round is that they
// differ — a texture that quietly runs long is a timing problem rather than a
// matter of taste, and it would hide inside a single average.
const mean = (list) =>
  list.length === 0 ? 0 : Math.round(list.reduce((a, e) => a + e.durationMs, 0) / list.length)
for (const variant of VARIANTS) {
  const of = index.filter((e) => e.variant === variant)
  if (of.length === 0) {
    console.log(`  ${variant.padEnd(10)} MISSING`)
    continue
  }
  console.log(
    `  ${variant.padEnd(10)} ${of.length} assets   ` +
      `singles ~${mean(of.filter((e) => e.profile === 'single'))}ms   ` +
      `combos ~${mean(of.filter((e) => e.profile !== 'single'))}ms`,
  )
}

console.log(
  `\nsingles within the 220-340 ms target: ${singles.length - outOfRange.length}/${singles.length}`,
)
console.log('Wrote src/audio/voiceAssets/auditionManifest.ts')
