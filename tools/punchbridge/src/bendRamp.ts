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
 * Peak-event whammy shape (brass-cube seam plan §3a): center → ±semitones
 * (clamped to the bend range) → exactly center. bendRampPoints is NOT
 * reused — its origin semantics are "start at the old pitch" and its dive
 * case has no settle phase; this generator is index-based so the peak is a
 * GUARANTEED sample for every duration (the naive t-based curve hits the
 * exact peak only when riseFraction·N lands on an integer sample, and the
 * domain emits arbitrary durations like 250/325/333/450 ms).
 */
export interface WhammyRampSpec {
  direction: 'rise' | 'dive'
  semitones: number
  durationMs: number
  stepMs: number
  bendRangeSemitones: number
  /** Fraction of the duration traveling to the peak; the rest settles. */
  riseFraction?: number // default 0.65
}

/**
 * One 14-bit wheel position per step. points[0] is naturally 8192
 * (self-normalizing — starting a whammy needs no preceding center
 * message); points[iPeak] === bendValue(dir·semitones, range) exactly;
 * points[N] is forced to center. Both directions get a real settle phase
 * (iPeak ≤ N−1 whenever N ≥ 2), so a dive never snaps home.
 */
export function whammyRampPoints(spec: WhammyRampSpec): number[] {
  const n = Math.max(1, Math.round(spec.durationMs / spec.stepMs))
  const riseFraction = spec.riseFraction ?? 0.65
  const iPeak = Math.max(1, Math.min(n - 1, Math.round(riseFraction * n)))
  const dir = spec.direction === 'rise' ? 1 : -1
  const target = dir * spec.semitones
  const points: number[] = []
  for (let i = 0; i <= n; i += 1) {
    const semis =
      i <= iPeak
        ? smooth(i / iPeak) * target
        : target * (1 - smooth((i - iPeak) / (n - iPeak)))
    points.push(bendValue(semis, spec.bendRangeSemitones))
  }
  // Settle exactly on center regardless of rounding.
  points[n] = PITCH_BEND_CENTER
  return points
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
