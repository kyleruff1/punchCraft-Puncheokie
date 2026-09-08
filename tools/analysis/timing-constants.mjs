/**
 * The timing constants every analyzer keys its proposals to, read from the
 * TypeScript sources they live in (GH #292, plan C5 — "single-source the
 * constants"). TypeScript stays the source of truth; this dumps a JSON
 * side-file so the Node analyzers and the Python audit tools stop carrying
 * their own literals (`RAIL_K_MS = 120` was duplicated in three places).
 *
 *   node tools/analysis/timing-constants.mjs
 *   → tools/analysis/reports/timing-constants.json
 *
 * Every entry names the file it was read from; a constant that cannot be
 * found is reported as `null` rather than defaulted, so a rename shows up in
 * the report instead of silently pinning an old value.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = import.meta.url
  ? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
  : process.cwd()

export const TIMING_CONSTANTS_PATH = join(REPO_ROOT, 'tools', 'analysis', 'reports', 'timing-constants.json')

const RUNNER = join('src', 'app', '(tabs)', 'punchcraft', '_useWorkoutRunner.ts')
/**
 * Call and lead-in placement moved out of the runner into the domain so the
 * analysis tools and the manifest generator could share it. Read it from its
 * real home — regexing the runner returned `null` for every one of these the
 * moment they moved, and a null reads as "renamed?" rather than "wrong file".
 */
const PLACEMENT = join('src', 'domain', 'coach', 'callPlacement.ts')
const VOICE = join('src', 'audio', 'VoiceOutputExpo.ts')
const RHYTHM_MAP = join('src', 'domain', 'programs', 'RhythmMap.ts')
const RHYTHM_SPINE = join('src', 'domain', 'programs', 'RhythmSpine.ts')
const OBSERVER = join('src', 'audio', 'PlaybackObserver.ts')
const CALIBRATION = join('src', 'audio', 'timingCalibration.ts')

/** `export const NAME = 123` (or `1_500`) → number, else null. */
export function readNumberConst(source, name) {
  const m = source.match(new RegExp(`(?:export )?const ${name}\\s*=\\s*(-?[0-9_.]+)\\b`))
  return m ? Number(m[1].replace(/_/g, '')) : null
}

/**
 * `export const NAME = { numbers: 1, techniques: 2 }` → object, else null.
 *
 * Values may be SUMS OF NAMED CONSTANTS rather than literals — the runner
 * writes `numbers: CALL_PAD_MS + NUMBERS_CALL_LEAD_MS`, and a literals-only
 * reader returned `{}` for the one record every breath proposal is keyed to.
 * `scope` resolves those names; an unresolvable term drops that entry rather
 * than guessing.
 */
export function readRecordConst(source, name, scope = {}) {
  const m = source.match(new RegExp(`(?:export )?const ${name}[^=]*=\\s*\\{([^}]*)\\}`))
  if (!m) return null
  const out = {}
  for (const pair of m[1].matchAll(/([a-zA-Z_]+)\s*:\s*([^,\n]+)/g)) {
    const value = evalSum(pair[2], scope)
    if (value !== null) out[pair[1]] = value
  }
  return out
}

/** `A + B - 12` where each term is a number or a name in `scope`. Null if any term is unknown. */
export function evalSum(expression, scope = {}) {
  const cleaned = expression.split('//')[0].trim().replace(/,$/, '')
  if (cleaned.length === 0) return null
  const terms = cleaned.match(/[+-]?\s*[A-Za-z0-9_.]+/g)
  if (!terms) return null
  let total = 0
  for (const raw of terms) {
    const sign = raw.trim().startsWith('-') ? -1 : 1
    const term = raw.replace(/^[+-]\s*/, '').trim()
    if (term.length === 0) return null
    const asNumber = Number(term.replace(/_/g, ''))
    if (Number.isFinite(asNumber)) {
      total += sign * asNumber
      continue
    }
    if (!(term in scope) || typeof scope[term] !== 'number') return null
    total += sign * scope[term]
  }
  return total
}

/** `CALL_BREATH_OVERRIDES: Record<string, number> = { 'slot': 123, … }` → object. */
export function readOverrides(source, name) {
  const m = source.match(new RegExp(`(?:export )?const ${name}[^=]*=\\s*\\{([\\s\\S]*?)\\}`))
  if (!m) return null
  const out = {}
  for (const pair of m[1].matchAll(/['"]([^'"]+)['"]\s*:\s*(-?[0-9_.]+)/g)) out[pair[1]] = Number(pair[2].replace(/_/g, ''))
  return out
}

function read(rel) {
  const path = join(REPO_ROOT, rel)
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

export function readTimingConstants(repoRoot = REPO_ROOT) {
  const src = (rel) => {
    const path = join(repoRoot, rel)
    return existsSync(path) ? readFileSync(path, 'utf8') : ''
  }
  const runner = src(RUNNER)
  const placement = src(PLACEMENT)
  const voice = src(VOICE)
  const map = src(RHYTHM_MAP)
  const spine = src(RHYTHM_SPINE)
  const observer = src(OBSERVER)
  const calibrationSrc = src(CALIBRATION)

  const rail = {
    RAIL_K_MS: readNumberConst(map, 'RAIL_K_MS'),
    // The spine's copy must agree with the map's; the analyzer flags drift.
    RAIL_K_MS_spine: readNumberConst(spine, 'RAIL_K_MS'),
    source: RHYTHM_MAP,
  }
  // Read the plain leads first: DENSE_BREATH_MS is expressed in terms of them.
  const leadScope = {}
  for (const name of [
    'LEAD_IN_PAD_MS',
    'CALL_PAD_MS',
    'CALL_DISPATCH_LAG_MS',
    'TECHNIQUE_CALL_LEAD_MS',
    'TECHNIQUE_LEADIN_LEAD_MS',
    'NUMBERS_CALL_LEAD_MS',
    'METRONOME_SWAP_LEAD_MS',
    'AVATAR_LEAD_MS',
  ]) {
    const value = readNumberConst(placement, name)
    if (value !== null) leadScope[name] = value
  }
  const breath = {
    DENSE_BREATH_MS: readRecordConst(placement, 'DENSE_BREATH_MS', leadScope),
    MIN_BREATH_MS: readNumberConst(placement, 'MIN_BREATH_MS'),
    BREATH_REF_SLOT_MS: readNumberConst(placement, 'BREATH_REF_SLOT_MS'),
    BREATH_TRACK_GAIN: readNumberConst(placement, 'BREATH_TRACK_GAIN'),
    CALL_BREATH_OVERRIDES: readOverrides(placement, 'CALL_BREATH_OVERRIDES'),
    source: PLACEMENT,
  }
  const leads = {
    LEAD_IN_PAD_MS: readNumberConst(placement, 'LEAD_IN_PAD_MS'),
    CALL_PAD_MS: readNumberConst(placement, 'CALL_PAD_MS'),
    CALL_DISPATCH_LAG_MS: readNumberConst(placement, 'CALL_DISPATCH_LAG_MS'),
    TECHNIQUE_CALL_LEAD_MS: readNumberConst(placement, 'TECHNIQUE_CALL_LEAD_MS'),
    TECHNIQUE_LEADIN_LEAD_MS: readNumberConst(placement, 'TECHNIQUE_LEADIN_LEAD_MS'),
    NUMBERS_CALL_LEAD_MS: readNumberConst(placement, 'NUMBERS_CALL_LEAD_MS'),
    METRONOME_SWAP_LEAD_MS: readNumberConst(runner, 'METRONOME_SWAP_LEAD_MS'),
    AVATAR_LEAD_MS: readNumberConst(runner, 'AVATAR_LEAD_MS'),
    source: PLACEMENT,
  }
  const audio = {
    DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS: readNumberConst(voice, 'DEFAULT_CALIBRATED_AUDIO_OUTPUT_LATENCY_MS'),
    ONE_SHOT_RELEASE_PAD_MS: readNumberConst(voice, 'ONE_SHOT_RELEASE_PAD_MS'),
    CLICK_SCRIPT_PREARM_PAD_MS: readNumberConst(voice, 'CLICK_SCRIPT_PREARM_PAD_MS'),
    OBSERVED_UPDATE_INTERVAL_MS: readNumberConst(voice, 'OBSERVED_UPDATE_INTERVAL_MS'),
    OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS: readNumberConst(observer, 'OBSERVED_PLAYLIST_UPDATE_INTERVAL_MS'),
    source: VOICE,
  }
  // Plan C4: `src/audio/timingCalibration.ts` holds PLAYHEAD_TO_SPEAKER_MS
  // with its evidence once one mic session has produced it. Absent, every
  // consumer must say "uncalibrated" rather than assume 0.
  let calibration = null
  if (calibrationSrc) {
    const value = readNumberConst(calibrationSrc, 'PLAYHEAD_TO_SPEAKER_MS')
    const route = calibrationSrc.match(/route:\s*'([^']+)'/)?.[1] ?? null
    const device = calibrationSrc.match(/device:\s*'([^']+)'/)?.[1] ?? null
    const measuredOn = calibrationSrc.match(/measuredOn:\s*'([^']+)'/)?.[1] ?? null
    const n = calibrationSrc.match(/\bn:\s*(\d+)/)?.[1]
    calibration = { PLAYHEAD_TO_SPEAKER_MS: value, route, device, measuredOn, n: n ? Number(n) : null, source: CALIBRATION }
  }
  return { generatedAt: new Date().toISOString(), rail, breath, leads, audio, calibration }
}

export function writeTimingConstants(repoRoot = REPO_ROOT) {
  const constants = readTimingConstants(repoRoot)
  const out = join(repoRoot, 'tools', 'analysis', 'reports', 'timing-constants.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(constants, null, 2) + '\n', 'utf8')
  return { out, constants }
}

/** Read the dumped side-file if present, else read the sources directly. */
export function loadTimingConstants(repoRoot = REPO_ROOT) {
  const path = join(repoRoot, 'tools', 'analysis', 'reports', 'timing-constants.json')
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      // Fall through to the sources.
    }
  }
  return readTimingConstants(repoRoot)
}

const invokedDirectly = process.argv[1]?.endsWith('timing-constants.mjs')
if (invokedDirectly) {
  const { out, constants } = writeTimingConstants()
  const missing = []
  for (const [group, values] of Object.entries(constants)) {
    if (!values || typeof values !== 'object') continue
    for (const [k, v] of Object.entries(values)) if (v === null && k !== 'calibration') missing.push(`${group}.${k}`)
  }
  console.log(`wrote ${out}`)
  if (constants.rail.RAIL_K_MS !== constants.rail.RAIL_K_MS_spine) {
    console.log(`WARN: RAIL_K_MS differs — RhythmMap ${constants.rail.RAIL_K_MS} vs RhythmSpine ${constants.rail.RAIL_K_MS_spine}`)
  }
  if (!constants.calibration) console.log('calibration: none yet (plan C4 — one mic session produces src/audio/timingCalibration.ts)')
  if (missing.length > 0) console.log(`not found (renamed?): ${missing.join(', ')}`)
  void read
}
