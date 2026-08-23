/**
 * Simulated punch scripts (M32-01).
 *
 * Offsets are expressed in milliseconds at a nominal 100 BPM (600 ms per
 * beat), the `steady` cadence the sample workouts use. `playScript` rescales
 * them when given a different BPM, so one script serves every cadence.
 *
 * Hand sequences follow orthodox mapping (odd numbers lead/left, even
 * rear/right, doc §11) because that is what the samples are authored in —
 * the source emits hands, never numbers, since a tracker cannot report
 * which technique was thrown (D12).
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import type { PunchType } from '@domain/punch/PunchEvent'

export type SimScriptId = 'alternating-1-2' | 'combo-1-2-3-2' | 'burst'

export interface ScriptStep {
  hand: 'left' | 'right'
  offsetMs: number
  punchType?: PunchType
  velocityRaw?: number
}

/** The BPM the offsets below are written against. */
export const SCRIPT_NOMINAL_BPM = 100

/**
 * `alternating-1-2` — steady jab-cross alternation, one punch every half
 * beat, eight punches. The baseline: even spacing, predictable hands,
 * useful for eyeballing whether the cue ring and the punch land together.
 */
const ALTERNATING_1_2: ScriptStep[] = [
  { hand: 'left', offsetMs: 0, velocityRaw: 7 },
  { hand: 'right', offsetMs: 600, velocityRaw: 11 },
  { hand: 'left', offsetMs: 1200, velocityRaw: 7 },
  { hand: 'right', offsetMs: 1800, velocityRaw: 12 },
  { hand: 'left', offsetMs: 2400, velocityRaw: 6 },
  { hand: 'right', offsetMs: 3000, velocityRaw: 11 },
  { hand: 'left', offsetMs: 3600, velocityRaw: 7 },
  { hand: 'right', offsetMs: 4200, velocityRaw: 13 },
]

/**
 * `combo-1-2-3-2` — a four-punch L-R-L-R combination on the uneven beat
 * offsets doc §17 describes, then a gap before it repeats.
 *
 * The unevenness is the point: a combination whose punches are equally
 * spaced would let a matcher pass on cadence alone, and the acceptance
 * windows (M32-03) have to hold up against real phrasing.
 */
const COMBO_1_2_3_2: ScriptStep[] = [
  { hand: 'left', offsetMs: 0, velocityRaw: 7 },
  { hand: 'right', offsetMs: 420, velocityRaw: 12 },
  { hand: 'left', offsetMs: 900, velocityRaw: 10 },
  { hand: 'right', offsetMs: 1320, velocityRaw: 13 },
]

/**
 * `burst` — a flurry at roughly six punches a second, for stress and for
 * the §19.2 render-budget check. Deliberately faster than anything the
 * generator will prescribe: the live screen has to survive input it did not
 * ask for.
 */
const BURST: ScriptStep[] = Array.from({ length: 24 }, (_, index) => ({
  hand: index % 2 === 0 ? ('left' as const) : ('right' as const),
  offsetMs: index * 165,
  velocityRaw: 8 + (index % 5),
}))

export const SIM_SCRIPTS: Record<SimScriptId, ScriptStep[]> = {
  'alternating-1-2': ALTERNATING_1_2,
  'combo-1-2-3-2': COMBO_1_2_3_2,
  burst: BURST,
}

/** Total span of a script, used to schedule the next loop iteration. */
export function scriptDurationMs(steps: readonly ScriptStep[]): number {
  return steps.length === 0 ? 0 : Math.max(...steps.map((s) => s.offsetMs))
}
