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

export type SimScriptId = 'alternating-1-2' | 'combo-1-2-3-2' | 'burst' | 'captured-jam'

export interface ScriptStep {
  hand: 'left' | 'right'
  offsetMs: number
  punchType?: PunchType
  velocityRaw?: number
  /**
   * Raw tracker acceleration. Load-bearing for the instrument: the drum
   * kit's MIDI velocity comes from acceleration, not from velocity
   * (drum-kit-design §8), so a script without it cannot reproduce how a
   * punch actually SOUNDS.
   */
  accelerationRaw?: number
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


/**
 * `captured-jam` — real signatures, recorded off the gloves.
 *
 * Every (velocityRaw, accelerationRaw) pair below was logged from an actual
 * jam session on 2026-09-06: 24 punches, both hands, spanning the full range
 * the trackers reported that night (accelerationRaw 41 to 796). Replaying
 * them makes an instrument change audibly comparable run to run without
 * anyone having to throw a punch — and, unlike the synthetic scripts, it
 * exercises the acceleration axis the drum velocity curve actually reads.
 *
 * The hand alternation and the ~500 ms spacing are invented; only the
 * signature pairs are real. Ordered as thrown.
 */
const CAPTURED_JAM: ScriptStep[] = [
  { hand: 'right', offsetMs: 0, velocityRaw: 6, accelerationRaw: 237 },
  { hand: 'left', offsetMs: 500, velocityRaw: 4, accelerationRaw: 92 },
  { hand: 'right', offsetMs: 1000, velocityRaw: 5, accelerationRaw: 197 },
  { hand: 'left', offsetMs: 1500, velocityRaw: 3, accelerationRaw: 41 },
  { hand: 'right', offsetMs: 2000, velocityRaw: 10, accelerationRaw: 721 },
  { hand: 'left', offsetMs: 2500, velocityRaw: 3, accelerationRaw: 110 },
  { hand: 'right', offsetMs: 3000, velocityRaw: 4, accelerationRaw: 104 },
  { hand: 'left', offsetMs: 3500, velocityRaw: 3, accelerationRaw: 116 },
  { hand: 'right', offsetMs: 4000, velocityRaw: 5, accelerationRaw: 120 },
  { hand: 'left', offsetMs: 4500, velocityRaw: 2, accelerationRaw: 175 },
  { hand: 'right', offsetMs: 5000, velocityRaw: 5, accelerationRaw: 76 },
  { hand: 'left', offsetMs: 5500, velocityRaw: 10, accelerationRaw: 796 },
  { hand: 'right', offsetMs: 6000, velocityRaw: 7, accelerationRaw: 484 },
  { hand: 'left', offsetMs: 6500, velocityRaw: 8, accelerationRaw: 217 },
  { hand: 'right', offsetMs: 7000, velocityRaw: 5, accelerationRaw: 215 },
  { hand: 'left', offsetMs: 7500, velocityRaw: 9, accelerationRaw: 564 },
  { hand: 'right', offsetMs: 8000, velocityRaw: 11, accelerationRaw: 602 },
  { hand: 'left', offsetMs: 8500, velocityRaw: 9, accelerationRaw: 548 },
  { hand: 'right', offsetMs: 9000, velocityRaw: 8, accelerationRaw: 230 },
  { hand: 'left', offsetMs: 9500, velocityRaw: 10, accelerationRaw: 643 },
  { hand: 'right', offsetMs: 10000, velocityRaw: 7, accelerationRaw: 466 },
  { hand: 'left', offsetMs: 10500, velocityRaw: 6, accelerationRaw: 470 },
  { hand: 'right', offsetMs: 11000, velocityRaw: 6, accelerationRaw: 360 },
  { hand: 'right', offsetMs: 11500, velocityRaw: 12, accelerationRaw: 380 },
]

export const SIM_SCRIPTS: Record<SimScriptId, ScriptStep[]> = {
  'alternating-1-2': ALTERNATING_1_2,
  'combo-1-2-3-2': COMBO_1_2_3_2,
  burst: BURST,
  'captured-jam': CAPTURED_JAM,
}

/** Total span of a script, used to schedule the next loop iteration. */
export function scriptDurationMs(steps: readonly ScriptStep[]): number {
  return steps.length === 0 ? 0 : Math.max(...steps.map((s) => s.offsetMs))
}
