/**
 * Parser for the `punchcraft://qa/run` deep link (GH #291).
 *
 * Pure: a bag of query strings in, a validated request or a list of errors
 * out. Nothing here touches a store, so the whole contract of the URL is
 * testable without a router.
 *
 *   punchcraft://qa/run?workout=body-work&vocab=techniques&sim=captured-jam
 *                       &autostart=1&qa=1&nonce=suite-1788-body-work-0
 *
 * Every parameter is optional except `workout`. `sim` defaults to `none`
 * rather than to a script — the suite always names its script explicitly,
 * and a bare link that starts throwing simulated punches would be a
 * surprise. `autostart` and `sim` are the privileged actions; the ROUTE
 * (not this parser) downgrades them when the persisted QA flag is off.
 */
import { isSampleWorkoutKey, type SampleWorkoutKey } from '@domain/workout/samples'
import { SIM_SCRIPTS, type SimScriptId } from '@simulation/scripts'
import { SIM_BPM_MAX, SIM_BPM_MIN } from '@simulation/simPace'

import type { QaVocabulary } from './useQaStore'

export { SIM_BPM_MAX, SIM_BPM_MIN }

export interface QaRunRequest {
  workout: SampleWorkoutKey | 'generated'
  vocab: QaVocabulary
  sim: SimScriptId | 'none'
  simForce: boolean
  simBpm?: number
  autostart: boolean
  seed?: string
  /** Present only when the link asked to flip the persisted flag. */
  qa?: boolean
  nonce?: string
}

export type QaRunParseResult =
  | { ok: true; request: QaRunRequest }
  | { ok: false; errors: string[] }

/** expo-router hands back `string | string[]`; a repeated key takes its first value. */
type RawParams = Record<string, string | string[] | undefined>

function first(raw: RawParams, key: string): string | undefined {
  const v = raw[key]
  if (Array.isArray(v)) return v[0]
  return v
}

/** `1`, `true`, `yes`, `on` are true; `0`, `false`, `no`, `off` are false. */
function parseFlag(value: string | undefined, key: string, errors: string[]): boolean | undefined {
  if (value === undefined) return undefined
  const v = value.trim().toLowerCase()
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false
  errors.push(`${key}: expected a boolean, got '${value}'`)
  return undefined
}

export function isSimScriptId(id: string): id is SimScriptId {
  return Object.prototype.hasOwnProperty.call(SIM_SCRIPTS, id)
}

export function parseQaRunParams(raw: RawParams): QaRunParseResult {
  const errors: string[] = []

  const workoutRaw = first(raw, 'workout')
  let workout: QaRunRequest['workout'] | undefined
  if (workoutRaw === undefined || workoutRaw === '') {
    errors.push('workout: required (a sample key or "generated")')
  } else if (workoutRaw === 'generated' || isSampleWorkoutKey(workoutRaw)) {
    workout = workoutRaw
  } else {
    errors.push(`workout: unknown sample '${workoutRaw}'`)
  }

  const vocabRaw = first(raw, 'vocab')
  let vocab: QaVocabulary = 'numbers'
  if (vocabRaw !== undefined) {
    if (vocabRaw === 'numbers' || vocabRaw === 'techniques') vocab = vocabRaw
    else errors.push(`vocab: expected numbers|techniques, got '${vocabRaw}'`)
  }

  const simRaw = first(raw, 'sim')
  let sim: QaRunRequest['sim'] = 'none'
  if (simRaw !== undefined) {
    if (simRaw === 'none' || isSimScriptId(simRaw)) sim = simRaw
    else errors.push(`sim: unknown script '${simRaw}' (known: ${Object.keys(SIM_SCRIPTS).join(', ')}, none)`)
  }

  const simForce = parseFlag(first(raw, 'simForce'), 'simForce', errors) ?? false
  const autostart = parseFlag(first(raw, 'autostart'), 'autostart', errors) ?? false
  const qa = parseFlag(first(raw, 'qa'), 'qa', errors)

  let simBpm: number | undefined
  const simBpmRaw = first(raw, 'simBpm')
  if (simBpmRaw !== undefined) {
    const n = Number(simBpmRaw)
    if (!Number.isFinite(n) || n < SIM_BPM_MIN || n > SIM_BPM_MAX) {
      errors.push(`simBpm: expected ${SIM_BPM_MIN}..${SIM_BPM_MAX}, got '${simBpmRaw}'`)
    } else {
      simBpm = n
    }
  }

  const seed = first(raw, 'seed')
  const nonce = first(raw, 'nonce')

  if (errors.length > 0 || workout === undefined) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    request: {
      workout,
      vocab,
      sim,
      simForce,
      autostart,
      ...(simBpm !== undefined ? { simBpm } : {}),
      ...(seed !== undefined && seed !== '' ? { seed } : {}),
      ...(qa !== undefined ? { qa } : {}),
      ...(nonce !== undefined && nonce !== '' ? { nonce } : {}),
    },
  }
}
