/**
 * Pace a simulated punch script to a workout (GH #291).
 *
 * The unattended suite drives every workout with `SimulatedPunchSource`, so
 * the script's tempo decides how realistic the run is. Two wrong answers to
 * rule out by construction:
 *
 * - `bpmForRecipe` is NOT the punch tempo. It is the call-slot grid — 240
 *   on metronome recipes — and rescaling `captured-jam` by it would throw
 *   ~5 punches a second, a rate no athlete sustains and the matcher would
 *   drown in.
 * - the script's nominal BPM is not the workout's either: the same script
 *   should punch faster in Speed Combos than in Uppercut Clinic.
 *
 * So the script is scaled so that its own punch rate — steps per pass,
 * pass = span + the loop gap — matches the workout's authored density,
 * `estimatedActivePunchesPerMinute`. That keeps the matcher's load and the
 * instrument's punch→sound rate comparable across all 22 workouts.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */
import type { GeneratedWorkout } from '@domain/workout/GeneratedWorkout'

import { LOOP_GAP_BEATS } from './SimulatedPunchSource'
import { SCRIPT_NOMINAL_BPM, SIM_SCRIPTS, scriptDurationMs, type SimScriptId } from './scripts'

/**
 * Tempo bounds for a scaled script. Below 40 a pass takes minutes and reads
 * as "nothing is happening"; above 400 the steps collapse into each other.
 */
export const SIM_BPM_MIN = 40
export const SIM_BPM_MAX = 400

/** One looped pass of `id` in ms when played at `bpm` — span plus the loop gap. */
export function scriptPassMs(id: SimScriptId, bpm: number = SCRIPT_NOMINAL_BPM): number {
  const steps = SIM_SCRIPTS[id]
  const scale = SCRIPT_NOMINAL_BPM / bpm
  const beatMs = (60_000 / SCRIPT_NOMINAL_BPM) * scale
  return scriptDurationMs(steps) * scale + LOOP_GAP_BEATS * beatMs
}

/** Punches per minute a looped `id` delivers at `bpm`. */
export function scriptPunchesPerMinute(id: SimScriptId, bpm: number = SCRIPT_NOMINAL_BPM): number {
  const steps = SIM_SCRIPTS[id]
  const passMs = scriptPassMs(id, bpm)
  if (steps.length === 0 || passMs <= 0) return 0
  return steps.length / (passMs / 60_000)
}

/**
 * The BPM at which `id` matches `workout`'s authored punch density, scaled
 * by `factor` (1 = match; 0.8 = an athlete keeping 80 % of pace), clamped
 * to the playable range.
 */
export function simBpmForWorkout(
  id: SimScriptId,
  workout: Pick<GeneratedWorkout, 'estimatedActivePunchesPerMinute'>,
  factor = 1,
): number {
  const nominalPpm = scriptPunchesPerMinute(id)
  const targetPpm = workout.estimatedActivePunchesPerMinute * factor
  if (!(nominalPpm > 0) || !Number.isFinite(targetPpm) || targetPpm <= 0) return SIM_BPM_MIN
  // Punch rate is linear in BPM (every offset scales by NOMINAL / bpm).
  const bpm = (SCRIPT_NOMINAL_BPM * targetPpm) / nominalPpm
  return Math.min(SIM_BPM_MAX, Math.max(SIM_BPM_MIN, Math.round(bpm)))
}
