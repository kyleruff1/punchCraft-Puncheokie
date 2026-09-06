/**
 * Family activity envelopes (drum-kit-design §14).
 *
 * Five short-lived values tracking which families the boxer is actually
 * throwing. At bar boundaries the arrangement reads them — high hook energy
 * asks for tom movement and a pendulum arp, high body energy asks for kick
 * density — but, per §14's closing line, "They do not independently change
 * chords." Nothing here touches a cell, a pool, or a bass note.
 *
 * Each family decays at its own rate, and that is the point: a jab's
 * timekeeper claim should evaporate in about a second while an uppercut's
 * fill eligibility lingers long enough to still be true at the next bar.
 *
 * Same shape as `activityEnvelope.ts`: pure, clock-injected, advances on
 * punch and decays on read.
 */
import type { DrumFamily } from './strikeDrumSignatures'

/** §14's five lanes — the four families plus the body modifier. */
export type EnergyLane = DrumFamily | 'body'

export const ENERGY_LANES: readonly EnergyLane[] = ['jab', 'cross', 'hook', 'uppercut', 'body']

export type DrumFamilyEnergy = Readonly<Record<EnergyLane, number>>

/** §14 decay times, in seconds. */
export const ENERGY_DECAY_TAU_S: Readonly<Record<EnergyLane, number>> = {
  jab: 1.2,
  cross: 1.5,
  hook: 2.0,
  uppercut: 2.4,
  body: 1.8,
}

/** §14 rise: a flat step plus a velocity-proportional share. */
const RISE_BASE = 0.12
const RISE_PER_VELOCITY: Readonly<Record<EnergyLane, number>> = {
  jab: 0.2,
  cross: 0.2,
  hook: 0.2,
  uppercut: 0.2,
  // The body lane rises slightly more slowly than a family lane (§14).
  body: 0.18,
}

export interface DrumEnergyState {
  readonly values: DrumFamilyEnergy
  readonly stampMs: number
}

export function emptyDrumEnergy(): DrumEnergyState {
  return {
    values: { jab: 0, cross: 0, hook: 0, uppercut: 0, body: 0 },
    stampMs: 0,
  }
}

function decayLane(value: number, lane: EnergyLane, elapsedMs: number): number {
  return value * Math.exp(-Math.max(0, elapsedMs) / 1000 / ENERGY_DECAY_TAU_S[lane])
}

/** All five lanes read at `nowMs` (no state change). */
export function drumEnergyAt(state: DrumEnergyState, nowMs: number): DrumFamilyEnergy {
  const elapsedMs = Math.max(0, nowMs - state.stampMs)
  return {
    jab: decayLane(state.values.jab, 'jab', elapsedMs),
    cross: decayLane(state.values.cross, 'cross', elapsedMs),
    hook: decayLane(state.values.hook, 'hook', elapsedMs),
    uppercut: decayLane(state.values.uppercut, 'uppercut', elapsedMs),
    body: decayLane(state.values.body, 'body', elapsedMs),
  }
}

/** One family's energy at `nowMs`. */
export function laneEnergyAt(state: DrumEnergyState, lane: EnergyLane, nowMs: number): number {
  return decayLane(state.values[lane], lane, Math.max(0, nowMs - state.stampMs))
}

function raise(current: number, lane: EnergyLane, velocity01: number): number {
  const clamped = Math.max(0, Math.min(1, velocity01))
  return Math.min(1, current + RISE_BASE + clamped * RISE_PER_VELOCITY[lane])
}

/**
 * Record one punch: decay every lane to `nowMs` first, then raise the
 * struck family — and the body lane too when the target is the body, which
 * is what lets a body-heavy combination ask for kick density without
 * pretending it was a different strike family (§5.2).
 */
export function noteDrumPunch(
  state: DrumEnergyState,
  input: {
    family: DrumFamily
    target: 'head' | 'body'
    velocity01: number
    nowMs: number
  },
): DrumEnergyState {
  const decayedValues = drumEnergyAt(state, input.nowMs)
  const values: Record<EnergyLane, number> = { ...decayedValues }
  values[input.family] = raise(decayedValues[input.family], input.family, input.velocity01)
  if (input.target === 'body') {
    values.body = raise(decayedValues.body, 'body', input.velocity01)
  }
  return { values, stampMs: input.nowMs }
}

/**
 * The dominant family right now, or null when nothing is meaningfully
 * active. `body` is excluded — it is a modifier, not a family, and letting
 * it win would make every body combination read as its own technique.
 */
export function dominantFamily(
  state: DrumEnergyState,
  nowMs: number,
  threshold = 0.2,
): DrumFamily | null {
  const values = drumEnergyAt(state, nowMs)
  const families: readonly DrumFamily[] = ['jab', 'cross', 'hook', 'uppercut']
  let best: DrumFamily | null = null
  let bestValue = threshold
  for (const family of families) {
    if (values[family] > bestValue) {
      best = family
      bestValue = values[family]
    }
  }
  return best
}
