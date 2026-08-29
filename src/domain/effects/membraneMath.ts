/**
 * Viscoelastic membrane math — the pure half of the reversible backdrop.
 *
 * The membrane is an elastic sheet over immutable textures: a punch
 * spawns a temporary impulse whose traveling wave, gel-sheet kick and
 * churn contribution all decay to EXACTLY zero, so the composition
 * always restores its original arrangement. No state textures, no
 * integrators: every quantity here is a closed-form function of the
 * impulse ring and an injected `nowSec`, which is what makes the whole
 * visual deterministic and Jest-pinnable.
 *
 * Determinism comes from the seeded hash over the impulse's event id —
 * never an ambient random source.
 */
import type { PunchHand } from '../punch/PunchEvent'

/** Hand codes shared with the bus (worklet-friendly plain numbers). */
export const HAND_LEFT = 0
export const HAND_RIGHT = 1
export const HAND_NEUTRAL = 2

/** Fixed impulse ring size — the shader evaluates exactly this many. */
export const MAX_IMPULSES = 16
/** Floats per packed float4 lane. */
export const IMPULSE_FLOATS = MAX_IMPULSES * 4

/**
 * Local wave feel: ~3 Hz wobble, decaying over the impulse lifetime.
 * Damp 1.3 keeps motion readable to ~1.5 s with counter-motion beyond
 * (2.2 measured on-glass as invisible past half a second).
 */
export const WAVE_OMEGA = 2 * Math.PI * 3
export const WAVE_DAMP = 1.3

/**
 * Gel sheet spring (underdamped, damping ratio ~0.55 at ~2.5 Hz). The
 * closed-form response of each impulse is summed read-side; past
 * GEL_WINDOW_S the residual is ~1e-13 of the kick, so it hard-zeros —
 * restoration is exact, not asymptotic.
 */
export const GEL_OMEGA = 2 * Math.PI * 2.5
export const GEL_ZETA = 0.55
export const GEL_OMEGA_D = GEL_OMEGA * Math.sqrt(1 - GEL_ZETA * GEL_ZETA)
export const GEL_WINDOW_S = 4
/** Whole-sheet kick per unit impulse amplitude. */
export const GEL_KICK = 0.55
export const GEL_TWIST = 0.35

/** Churn envelope: activity memory that decays in ~2 s, never displaces. */
export const CHURN_TAU_S = 1.65
export const CONVERGE_WINDOW_S = 0.45

/** Impact energy: the sharp per-hit snap that boosts refraction. */
export const IMPACT_TAU_S = 0.45

/**
 * The Pummel Veil's three particulate scales, each with its own decay
 * clock so a stopped flurry clears in stages: dust first, debris next,
 * the broad blackout veil last — and the original backdrop returns
 * exactly.
 */
export const DUST_TAU_S = 1.5
export const DEBRIS_TAU_S = 3.2
export const VEIL_TAU_S = 4.2
/** Debris (the brief's blackoutCharge) may overshoot to 1.15. */
export const DEBRIS_CAP = 1.15
/** Coverage below this is invisible; the wake window targets it. */
export const VEIL_FLOOR = 0.01

/** Punch-rate window for the flurry response (trailing seconds). */
export const RATE_WINDOW_S = 1.5

/** Sleep: no motion once every impulse has expired for this long. */
export const SLEEP_GRACE_S = 0.5

/** Seeded hash → [0, 1). Deterministic per (seed, lane). */
export function hash01(seed: number, lane: number): number {
  'worklet'
  let h = (seed * 374761393 + lane * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/**
 * Kyle's reading → effect curve: hard punches move a larger share of
 * the field, propagate farther and take longer to settle. Amplitudes
 * are uv fractions (max texture offset stays a few % of the pane).
 */
export interface ImpulseShape {
  amplitude: number
  radius: number
  lifetimeSec: number
  waveSpeed: number
}

export function mapVelocityToEffect(v01: number): ImpulseShape {
  'worklet'
  const v = Math.max(0, Math.min(1, v01))
  const strength = 0.15 + 0.85 * Math.pow(v, 1.4)
  return {
    amplitude: 0.004 + strength * 0.028,
    radius: 0.05 + strength * 0.11,
    lifetimeSec: 1.1 + strength * 2.0,
    waveSpeed: 0.7 + strength * 0.55,
  }
}

/** Splat origin: hand thirds + seeded jitter, in field UV (0..1). */
export function impulseOrigin(handCode: number, seed: number): { x: number; y: number } {
  'worklet'
  const x = handCode === HAND_LEFT ? 0.28 : handCode === HAND_RIGHT ? 0.72 : 0.5
  return { x, y: 0.48 + (hash01(seed, 7) - 0.5) * 0.24 }
}

/** Lateral push direction per hand (left pushes right, and mirror). */
export function impulseDirection(handCode: number): number {
  'worklet'
  return handCode === HAND_LEFT ? 1 : handCode === HAND_RIGHT ? -1 : 0
}

/**
 * Opposite hands inside the window make the center churn: returns the
 * convergence boost (mean strength), else 0.
 */
export function detectConvergence(
  prevHand: number,
  prevTSec: number,
  prevStrength: number,
  hand: number,
  tSec: number,
  strength: number,
): number {
  'worklet'
  if (prevHand === HAND_NEUTRAL || hand === HAND_NEUTRAL) return 0
  if (prevHand === hand) return 0
  if (tSec - prevTSec > CONVERGE_WINDOW_S) return 0
  return (prevStrength + strength) / 2
}

/**
 * Envelopes are (value, stampSec) pairs: bump on punch, decay
 * analytically read-side — no frame loop, no integrator.
 */
export function decayedEnv(value: number, stampSec: number, nowSec: number, tauS: number): number {
  'worklet'
  return value * Math.exp(-Math.max(0, nowSec - stampSec) / tauS)
}

export function bumpEnv(
  value: number,
  stampSec: number,
  nowSec: number,
  tauS: number,
  gain: number,
  cap = 1,
): number {
  'worklet'
  return Math.min(cap, decayedEnv(value, stampSec, nowSec, tauS) + gain)
}

/** Hermite smoothstep over an arbitrary edge pair. */
export function smoothstepOf(edge0: number, edge1: number, value: number): number {
  'worklet'
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Punches per second over the trailing rate window, read straight from
 * the impulse ring's start stamps (convergence center impulses are
 * hand-neutral and excluded).
 */
export function rateOf(ring: readonly MembraneImpulse[], nowSec: number): number {
  'worklet'
  let count = 0
  for (const item of ring) {
    if (item.handCode !== HAND_NEUTRAL && nowSec - item.startSec <= RATE_WINDOW_S) count += 1
  }
  return count / RATE_WINDOW_S
}

export interface PunchGains {
  impact: number
  churn: number
  dust: number
  debris: number
  veil: number
}

/**
 * One punch's contribution to every reaction envelope. Velocity and
 * rate stay distinct on purpose: a hard single deforms plenty but
 * deposits little; only a sustained high-speed flurry feeds the broad
 * veil that can close the pane to black. `sensitivity` scales the veil
 * gains only (the Pummel Sensitivity setting).
 */
export function registerPunchGains(v01: number, rate: number, sensitivity: number): PunchGains {
  'worklet'
  const strength = Math.pow(Math.max(0, Math.min(1, v01)), 1.55)
  const flurry = smoothstepOf(3, 9, rate)
  return {
    impact: 0.2 + 0.8 * strength,
    churn: 0.05 + 0.2 * strength,
    dust: (0.03 + 0.06 * strength + 0.02 * flurry) * sensitivity,
    debris: (0.008 + 0.025 * strength + 0.012 * flurry) * sensitivity,
    veil: flurry * (0.01 + 0.02 * strength) * sensitivity,
  }
}

/** Perceptual coverage: recovery reads different from the raw charge. */
export function visualCoverage(charge: number): number {
  'worklet'
  return Math.pow(Math.max(0, charge), 1.25)
}

/**
 * How long (seconds) the pane must stay awake for every veil charge to
 * fade below the visible floor — keeps the sleep gate from freezing a
 * dimmed frame.
 */
export function veilWakeOf(dust: number, debris: number, veil: number): number {
  'worklet'
  const wakeFor = (charge: number, tauS: number): number =>
    charge <= VEIL_FLOOR ? 0 : tauS * Math.log(charge / VEIL_FLOOR)
  const a = wakeFor(dust, DUST_TAU_S)
  const b = wakeFor(debris, DEBRIS_TAU_S)
  const c = wakeFor(veil, VEIL_TAU_S)
  return Math.max(a, b, c)
}

/** Pummel Sensitivity: how hard a full blackout is to reach. */
export const SENSITIVITY_MULS = { low: 0.6, standard: 1, high: 1.8 } as const
export type PummelSensitivity = keyof typeof SENSITIVITY_MULS

/** One temporary wave impulse — everything the shader needs, plain numbers. */
export interface MembraneImpulse {
  eventId: number
  handCode: number
  startSec: number
  x: number
  y: number
  /** Lateral push, −1..1. */
  dirX: number
  amplitude: number
  radius: number
  lifetimeSec: number
  waveSpeed: number
  /** Seeded spiral: sign picks the turn direction per engagement. */
  spin: number
  /** Seeded wave phase, radians. */
  phase: number
}

export function spawnImpulse(
  handCode: number,
  v01: number,
  eventId: number,
  nowSec: number,
): MembraneImpulse {
  'worklet'
  const origin = impulseOrigin(handCode, eventId)
  const shape = mapVelocityToEffect(v01)
  return {
    eventId,
    handCode,
    startSec: nowSec,
    x: origin.x,
    y: origin.y,
    dirX: impulseDirection(handCode),
    amplitude: shape.amplitude,
    radius: shape.radius,
    lifetimeSec: shape.lifetimeSec,
    waveSpeed: shape.waveSpeed,
    spin: (hash01(eventId, 3) - 0.5) * 2,
    phase: hash01(eventId, 5) * Math.PI * 2,
  }
}

/** Center impulse for a converging pair — still fully temporary. */
export function convergenceImpulse(
  boost: number,
  eventId: number,
  nowSec: number,
): MembraneImpulse {
  'worklet'
  const shape = mapVelocityToEffect(boost)
  return {
    eventId,
    handCode: HAND_NEUTRAL,
    startSec: nowSec,
    x: 0.5,
    y: 0.5 + (hash01(eventId, 13) - 0.5) * 0.1,
    dirX: 0,
    amplitude: shape.amplitude * 1.15,
    radius: shape.radius * 1.2,
    lifetimeSec: shape.lifetimeSec,
    waveSpeed: shape.waveSpeed,
    spin: (hash01(eventId, 3) - 0.5) * 2,
    phase: hash01(eventId, 5) * Math.PI * 2,
  }
}

export function expiryOf(impulse: MembraneImpulse): number {
  'worklet'
  return impulse.startSec + impulse.lifetimeSec
}

/**
 * Push one impulse into the bounded ring. Expired impulses leave
 * first; a full ring then drops its weakest-by-remaining-amplitude
 * member. `spilled` is the dropped remainder, for the caller to fold
 * into the churn envelope so discarded surge is felt, not lost.
 */
export function pushImpulse(
  ring: readonly MembraneImpulse[],
  impulse: MembraneImpulse,
  nowSec: number,
): { ring: MembraneImpulse[]; spilled: number } {
  'worklet'
  const alive: MembraneImpulse[] = []
  for (const item of ring) {
    if (expiryOf(item) > nowSec) alive.push(item)
  }
  let spilled = 0
  if (alive.length >= MAX_IMPULSES) {
    let weakest = 0
    let weakestLeft = Number.POSITIVE_INFINITY
    for (let i = 0; i < alive.length; i += 1) {
      const item = alive[i]!
      const age = nowSec - item.startSec
      const left = item.amplitude * Math.exp(-age * WAVE_DAMP)
      if (left < weakestLeft) {
        weakestLeft = left
        weakest = i
      }
    }
    spilled = Math.min(1, weakestLeft * 20)
    alive.splice(weakest, 1)
  }
  alive.push(impulse)
  return { ring: alive, spilled }
}

/** The latest instant anything in the ring can still be moving. */
export function lastExpiry(ring: readonly MembraneImpulse[]): number {
  'worklet'
  let last = 0
  for (const item of ring) {
    const gelEnd = item.startSec + GEL_WINDOW_S
    const waveEnd = expiryOf(item)
    const end = waveEnd > gelEnd ? waveEnd : gelEnd
    if (end > last) last = end
  }
  return last
}

/** Whole-sheet gel state at `nowSec` — offset x/y plus a small twist. */
export interface GelState {
  offsetX: number
  offsetY: number
  twist: number
}

/**
 * Closed-form underdamped response, summed per impulse: each punch
 * kicks the sheet sideways (left → +x, mirrored) and twists it; the
 * spring pulls back with one or two visible overshoots. Contributions
 * hard-zero past GEL_WINDOW_S (residual ~1e-13), so an empty or
 * expired ring returns the exact origin.
 */
export function gelResponse(ring: readonly MembraneImpulse[], nowSec: number): GelState {
  'worklet'
  let offsetX = 0
  let offsetY = 0
  let twist = 0
  for (const item of ring) {
    const t = nowSec - item.startSec
    if (t <= 0 || t >= GEL_WINDOW_S) continue
    const h = (Math.exp(-GEL_ZETA * GEL_OMEGA * t) * Math.sin(GEL_OMEGA_D * t)) / GEL_OMEGA_D
    const kick = item.amplitude * GEL_KICK
    offsetX += item.dirX * kick * h
    offsetY += (hash01(item.eventId, 11) - 0.5) * kick * h
    twist += (item.dirX !== 0 ? item.dirX : item.spin) * kick * GEL_TWIST * h
  }
  return { offsetX, offsetY, twist }
}

/**
 * Pack the ring into three plain float4[MAX_IMPULSES] arrays for the
 * shader (empty slots amplitude 0 — the loop skips them):
 *   A: originX, originY, startSec, amplitude
 *   B: radius, lifetimeSec, waveSpeed, spin
 *   C: dirX, phase, handTint, 0
 * Plain number[], never Float32Array (the native uniform path
 * truncates typed arrays to 4 floats).
 */
export function packImpulses(ring: readonly MembraneImpulse[]): {
  a: number[]
  b: number[]
  c: number[]
} {
  'worklet'
  const a: number[] = []
  const b: number[] = []
  const c: number[] = []
  for (let i = 0; i < MAX_IMPULSES; i += 1) {
    const item = ring[i]
    if (item) {
      a.push(item.x, item.y, item.startSec, item.amplitude)
      b.push(item.radius, item.lifetimeSec, item.waveSpeed, item.spin)
      c.push(
        item.dirX,
        item.phase,
        item.handCode === HAND_LEFT ? -1 : item.handCode === HAND_RIGHT ? 1 : 0,
        0,
      )
    } else {
      a.push(0, 0, 0, 0)
      b.push(0.001, 0, 1, 0)
      c.push(0, 0, 0, 0)
    }
  }
  return { a, b, c }
}

/** Map the bus's PunchHand to the numeric hand code. */
export function handCodeOf(hand: PunchHand): number {
  'worklet'
  return hand === 'left' ? HAND_LEFT : hand === 'right' ? HAND_RIGHT : HAND_NEUTRAL
}

/** Behavior presets (brief §presets). Reactive is the default. */
export interface MembranePreset {
  /** Scales every impulse's amplitude. */
  surgeMul: number
  /** Scales lifetimes (settle duration). */
  lifeMul: number
  /** Scales the whole-sheet gel response. */
  gelMul: number
  /** Backdrop refraction strength. */
  refraction: number
}

export const MEMBRANE_PRESETS: Record<'controlled' | 'reactive' | 'gelatin', MembranePreset> = {
  controlled: { surgeMul: 0.7, lifeMul: 0.65, gelMul: 0.5, refraction: 0.7 },
  reactive: { surgeMul: 1, lifeMul: 1, gelMul: 1, refraction: 0.9 },
  gelatin: { surgeMul: 1.25, lifeMul: 1.45, gelMul: 1.6, refraction: 1.1 },
}
