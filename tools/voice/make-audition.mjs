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
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { compilePhrase, FINISHES } from './prosody.mjs'
import { textureChain } from './texture.mjs'
import {
  PRODUCTION_BLEND,
  PRODUCTION_BLEND_NAME,
  PRODUCTION_EXPRESSION,
  PRODUCTION_TEXTURE,
} from './persona.mjs'
import { insertBeats, measureDuration, trimEnds } from './wav.mjs'

const OUT_ROOT = join('assets', 'voice', 'audition')

/* ------------------------------------------------------- the round under test */

/**
 * Round four polishes **aggression** — the ending inflection.
 *
 * The downward finish is already clamped to the pitch floor under the
 * theatrical setting, so a bigger drop is a dead lever; the inflection that
 * survives is a harder up-kick into the last punch and whether the phrase ends
 * *up* (a shout) rather than settling. That is the axis here.
 *
 * Texture is pinned to the round-three winner (broadcast) so the finish is
 * heard through the production chain, and the phrase set is loaded with
 * **body shots** (`1b`, `2b` → "Body one/two") — a soft-consonant word is
 * exactly what an aggressive finish is most likely to smear, so the two are
 * tested together on purpose.
 */
const AXIS = 'finish'
const VARIANTS = Object.keys(FINISHES)
const TEXTURE = PRODUCTION_TEXTURE

/** Settled in rounds one and two; shared with the production generator. */
const BLEND_NAME = PRODUCTION_BLEND_NAME
const BLENDS = { [BLEND_NAME]: PRODUCTION_BLEND }
const EXPRESSION = PRODUCTION_EXPRESSION

const PHRASES = ['2b', '1b', '1-2b', '2-3-2', '1-2-3-2', '1-2b-3-2']
const VOCABULARIES = ['numbers', 'techniques']
/**
 * `teach` is dropped this round.
 *
 * Aggression is judged on the states that carry a round. A teaching call is
 * the one place a shouted finish would be wrong, so including it would only
 * dilute the comparison.
 */
const PERFORMANCES = ['work', 'push']
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
 * One synthesis per phrase, fanned out to every finish.
 *
 * The finish changes only the pitch contour and the final loudness — never the
 * words, the beats or the trim. So Kokoro runs once per phrase and the take is
 * shared across every finish: any difference heard is the ending under test,
 * not a different synthesis. The contour is what varies, so it moves into the
 * per-finish pass; render, beats and trim stay shared before it.
 */
const sources = []
for (const combination of PHRASES) {
  const tokens = combination.split('-').map((t) => t.trim())
  for (const vocabulary of VOCABULARIES) {
    for (const performance of PERFORMANCES) {
      // The finish does not affect the text, so any finish compiles the shared
      // source; the per-finish plans below carry the contour and accent.
      const plan = compilePhrase({
        tokens,
        vocabulary,
        cadence: CADENCE,
        performance,
        expression: EXPRESSION,
      })
      // A lone command is a bark. At the combination speed it arrives as an
      // announcement, which is the opposite of "the coach just saw an
      // opening".
      if (plan.profile === 'single') plan.speed = Math.round(plan.speed * 1.3 * 100) / 100
      const key = `${combination}.${vocabulary}.${performance}`
      sources.push({
        key,
        combination,
        tokens,
        vocabulary,
        performance,
        plan,
        wav: join(cwd, OUT_ROOT, `_src.${key}.wav`),
      })
    }
  }
}

console.log(`Rendering ${sources.length} phrases → ${sources.length * VARIANTS.length} assets…`)

const renderOut = execFileSync('python', [join('tools', 'voice', 'kokoro_render.py')], {
  input: JSON.stringify({
    blends: BLENDS,
    jobs: sources.map((s) => ({
      path: s.wav,
      text: s.plan.renderedText,
      speed: s.plan.speed,
      blend: BLEND_NAME,
    })),
  }),
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
for (const failure of renderOut.split(/\r?\n/).filter((l) => l.startsWith('FAIL '))) {
  console.error(`  ${failure}`)
}

// Beats and trim are finish-independent, so they happen once on the shared
// source. Trim before the contour and texture, never after: heavy compression
// lifts the echo tail and the noise floor, so trimming last reads that raised
// tail as signal and keeps it — the bug that cost two earlier rounds.
console.log('Setting movement beats and trimming…')
for (const source of sources) {
  if (!existsSync(source.wav)) continue
  insertBeats(source.wav, source.plan.beats)
  trimEnds(source.wav, source.plan.profile === 'single' ? { tailMs: 70 } : {})
}

// One variant per finish: copy the shared source, then give it that finish's
// contour and its accent-boosted texture.
const variants = []
for (const source of sources) {
  if (!existsSync(source.wav)) continue
  for (const variant of VARIANTS) {
    const plan = compilePhrase({
      tokens: source.tokens,
      vocabulary: source.vocabulary,
      cadence: CADENCE,
      performance: source.performance,
      expression: EXPRESSION,
      finish: variant,
    })
    const file = `${source.key}.${variant}.wav`
    const path = join(cwd, OUT_ROOT, file)
    copyFileSync(source.wav, path)
    variants.push({ source, variant, plan, file, path })
  }
}

console.log('Applying the finish contour and aged drift…')
const contourOut = execFileSync('python', [join('tools', 'voice', 'pitch_contour.py')], {
  input: JSON.stringify(
    variants.map((v) => ({
      path: v.path,
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

console.log(`Applying the ${TEXTURE} texture to ${variants.length} clips…`)
const index = []
for (const { source, variant, plan, file, path } of variants) {
  if (!existsSync(path)) continue
  try {
    postProcess(path, {
      texture: TEXTURE,
      profile: plan.profile,
      finalAccentDb: plan.finalAccentDb,
    })
  } catch (error) {
    // One bad filtergraph must not take the round down; a missing variant is
    // visible on the audition screen, a half-written index is not.
    console.error(`  FAIL ${file}: ${error.message.split('\n')[0]}`)
    rmSync(path, { force: true })
    continue
  }
  index.push({
    cueId: `${source.key}.${variant}`,
    combination: source.combination,
    axis: AXIS,
    variant,
    blend: BLEND_NAME,
    expression: EXPRESSION,
    texture: TEXTURE,
    vocabulary: source.vocabulary,
    performance: source.performance,
    cadence: CADENCE,
    file,
    spokenText: plan.renderedText,
    durationMs: measureDuration(path),
    profile: plan.profile,
    plan,
  })
}

for (const source of sources) rmSync(source.wav, { force: true })

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

const expected = sources.length * VARIANTS.length
console.log(`\n${index.length}/${expected} assets, ${(bytes / 1024 / 1024).toFixed(1)} MB`)

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
