/**
 * Elastic pitch-bend ramps (instrument-design §9). A gliding voice plays
 * its NEW note immediately, with the bend wheel starting back at the old
 * pitch and ramping through a small overshoot to center — so the audible
 * pitch sweeps old → (past target by a few cents) → target over exactly
 * `transitionDurationMs`, the same number the visuals use.
 *
 * Pure generator so tests can assert bounds without timers.
 */

export const PITCH_BEND_CENTER = 8192
export const PITCH_BEND_MAX = 16383

export interface BendRampSpec {
  /** Signed semitones from the OLD note to the NEW note. */
  intervalSemitones: number
  /** Overshoot past the target, in cents (0 disables). */
  overshootCents: number
  durationMs: number
  stepMs: number
  /** The synth patch's configured bend range (± semitones). */
  bendRangeSemitones: number
}

function bendValue(semitones: number, range: number): number {
  const clamped = Math.max(-range, Math.min(range, semitones))
  return Math.max(
    0,
    Math.min(PITCH_BEND_MAX, Math.round(PITCH_BEND_CENTER + (clamped / range) * (PITCH_BEND_MAX - PITCH_BEND_CENTER))),
  )
}

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

/**
 * The 14-bit wheel positions for one transition, one per step, ending at
 * exactly center. The wheel STARTS at the old note (bend = −interval,
 * clamped to the range — a jump wider than the range sweeps from the
 * range's edge, honest about hardware limits).
 */
export function bendRampPoints(spec: BendRampSpec): number[] {
  const steps = Math.max(1, Math.round(spec.durationMs / spec.stepMs))
  const startSemis = -spec.intervalSemitones
  const overshootSemis = spec.overshootCents / 100
  // Overshoot lands opposite the approach direction's origin — i.e. past
  // center in the direction of travel.
  const overshootPoint = spec.intervalSemitones >= 0 ? overshootSemis : -overshootSemis
  const split = spec.overshootCents > 0 ? 0.7 : 1
  const points: number[] = []
  // i = 0 emits the exact origin (the old pitch) so the wheel jump that
  // precedes the ramp is part of the same point list.
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    let semis: number
    if (t <= split) {
      semis = startSemis + (overshootPoint - startSemis) * smooth(t / split)
    } else {
      semis = overshootPoint * (1 - smooth((t - split) / (1 - split)))
    }
    points.push(bendValue(semis, spec.bendRangeSemitones))
  }
  // Settle exactly on center regardless of rounding.
  points[points.length - 1] = PITCH_BEND_CENTER
  return points
}
