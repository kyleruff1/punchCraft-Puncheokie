/**
 * MIDI velocity curves and accent selection (drum-kit-design §§8-9).
 *
 * Two tracker values, two distinct jobs — the design is explicit that one
 * raw byte must not control every musical property:
 *
 *   acceleration01 → the HIT's MIDI velocity   (impact intensity)
 *   velocity01     → which ARTICULATION to use (accent band), plus mutation
 *                    strength, filter/room modulation, fill length, peak
 *                    eligibility
 *
 * Family-specific floors keep the musical role legible: a soft cross still
 * reads as a backbeat because the snare never drops below 80, while a jab
 * can sit down at 42 and stay a timekeeper rather than a statement.
 *
 * Pure and deterministic.
 */
import { DRUM_GROUP_OF, type LogicalDrumArticulation } from './logicalDrumArticulations'
import type { DrumFamily } from './strikeDrumSignatures'

/** §9, verbatim. */
export function mapDrumVelocity(
  acceleration01: number,
  minimum: number,
  maximum: number,
  gamma = 0.72,
): number {
  const normalized = Math.max(0, Math.min(1, acceleration01))
  return Math.round(minimum + (maximum - minimum) * Math.pow(normalized, gamma))
}

export interface VelocityRange {
  readonly minimum: number
  readonly maximum: number
}

/** The lane a velocity range belongs to — families plus the extra layers. */
export type VelocityLane = DrumFamily | 'body-kick' | 'crash' | 'ghost'

/** §9 "Suggested starting ranges". */
export const VELOCITY_RANGES: Readonly<Record<VelocityLane, VelocityRange>> = {
  jab: { minimum: 42, maximum: 104 }, // ride
  cross: { minimum: 80, maximum: 127 }, // snare
  hook: { minimum: 62, maximum: 119 }, // rack tom
  uppercut: { minimum: 75, maximum: 127 }, // floor tom
  'body-kick': { minimum: 64, maximum: 123 },
  crash: { minimum: 100, maximum: 127 },
  ghost: { minimum: 18, maximum: 45 }, // generated layer only
}

export function velocityForLane(lane: VelocityLane, acceleration01: number): number {
  const range = VELOCITY_RANGES[lane]
  return mapDrumVelocity(acceleration01, range.minimum, range.maximum)
}

/**
 * Which range a PIECE sits in. For the twelve strike rows this agrees with
 * the striking family by construction — a jab plays the ride and the ride
 * is the jab range — but deriving it from the articulation also gives the
 * generic Free Kit (§3) a correct range without inventing a family it is
 * not allowed to claim.
 */
export function laneForArticulation(articulation: LogicalDrumArticulation): VelocityLane {
  if (articulation === 'crash-main') return 'crash'
  switch (DRUM_GROUP_OF[articulation]) {
    case 'cymbal':
      return 'jab' // the ride lane
    case 'snare':
      return 'cross'
    case 'rack-tom':
      return 'hook'
    case 'floor-tom':
      return 'uppercut'
    case 'kick':
      return 'body-kick'
    default:
      // Hats and percussion belong to the generated backbone (§12).
      return 'ghost'
  }
}

export type AccentBand = 'normal' | 'accent' | 'peak'

/** §9 accent selection — keyed on velocity01, NOT acceleration. */
export const ACCENT_THRESHOLD = 0.65
export const PEAK_THRESHOLD = 0.85

export function accentBandFor(velocity01: number): AccentBand {
  if (velocity01 >= PEAK_THRESHOLD) return 'peak'
  if (velocity01 >= ACCENT_THRESHOLD) return 'accent'
  return 'normal'
}

/**
 * §9: "The MIDI gate sent to SD3 can remain short: 25-40 ms. Superior
 * Drummer supplies the acoustic sample tail." The same holds for the
 * tablet's rendered one-shots — the WAV carries its own decay, so the gate
 * is a trigger width, never the audible length of the cymbal or tom.
 */
export const DRUM_GATE_MS_MIN = 25
export const DRUM_GATE_MS_MAX = 40

export function drumGateMs(velocity01: number): number {
  const clamped = Math.max(0, Math.min(1, velocity01))
  return Math.round(DRUM_GATE_MS_MIN + (DRUM_GATE_MS_MAX - DRUM_GATE_MS_MIN) * clamped)
}
