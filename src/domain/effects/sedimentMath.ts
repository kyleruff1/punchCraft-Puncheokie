/**
 * Kinetic Sediment math — the pure half of the persistent backdrop.
 *
 * The sediment pane is an elastoplastic material simulation living in
 * GPU ping-pong textures (see sedimentShaders.ts and the engine in
 * src/components/workout/backdrop/). This module holds everything a
 * Node test can pin: channel encoding for the RGBA8 state textures,
 * the punch → splat mapping, the tray-shake spring, activity
 * envelopes, and the constants both the shaders and the engine share.
 *
 * Every function is pure with injected time ('worklet'-tagged so the
 * UI thread calls the same code the tests do). Determinism comes from
 * the seeded hash — never an ambient random source.
 */
import type { PunchHand } from '../punch/PunchEvent'

/** Hand codes shared with the bus (worklet-friendly plain numbers). */
export const HAND_LEFT = 0
export const HAND_RIGHT = 1
export const HAND_NEUTRAL = 2

/** Simulation grid (start size; the detail knob may raise it). */
export const GRID_W = 256
export const GRID_H = 144

/** Fixed simulation timestep. */
export const STEP_S = 1 / 30

/** Pending punch queue bound (drained per step). */
export const MAX_PENDING = 32
/** Splats applied per simulation step. */
export const SPLATS_PER_STEP = 8
export const SPLAT_FLOATS = SPLATS_PER_STEP * 4

/** Envelope time constants (seconds). */
export const IMPACT_TAU_S = 0.45
export const CHURN_TAU_S = 1.5
export const SESSION_TAU_S = 8
export const PRESSURE_LR_TAU_S = 2.0
export const CONVERGE_WINDOW_S = 0.45

/** Sleep gating (coarse, envelope-driven — no per-cell CPU reads). */
export const SLEEP_AFTER_QUIET_S = 3
export const SLEEP_CHURN_BELOW = 0.01
export const SLEEP_TRAY_BELOW = 0.005

/** Settled displacement clamp, as a fraction of the pane. */
export const MAX_SETTLED_OFFSET = 0.05

/** Tray spring (whole-pane shake). */
export const TRAY_STIFFNESS = 42
export const TRAY_DAMPING = 5.5
export const TRAY_KICK = 0.02

/** Seeded hash → [0, 1). Deterministic per (seed, lane). */
export function hash01(seed: number, lane: number): number {
  'worklet'
  let h = (seed * 374761393 + lane * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/**
 * Signed value → RGBA8 channel (0..1 with 0.5 bias) and back. `range`
 * is the represented magnitude; values outside clamp. The shaders
 * carry the same formulas — the roundtrip test pins both directions.
 */
export function encodeSigned(value: number, range: number): number {
  'worklet'
  const clamped = Math.max(-range, Math.min(range, value))
  return 0.5 + (clamped / range) * 0.5
}

export function decodeSigned(channel: number, range: number): number {
  'worklet'
  return (channel - 0.5) * 2 * range
}

/**
 * Nonlinear splat magnitude: hard punches feel materially stronger
 * (Kyle's curve — 0.15 floor, exponent 1.6).
 */
export function visualStrength(v01: number): number {
  'worklet'
  const clamped = Math.max(0, Math.min(1, v01))
  return 0.15 + 1.85 * Math.pow(clamped, 1.6)
}

/**
 * Share of a disturbance that becomes PERMANENT (plastic yield):
 * light ~4%, normal ~10%, hard ~16%.
 */
export function plasticShare(v01: number): number {
  'worklet'
  const clamped = Math.max(0, Math.min(1, v01))
  return 0.04 + 0.14 * clamped
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
): number {
  'worklet'
  return Math.min(1.5, decayedEnv(value, stampSec, nowSec, tauS) + gain)
}

export interface TrayState {
  offsetX: number
  offsetY: number
  velX: number
  velY: number
}

export function restingTray(): TrayState {
  return { offsetX: 0, offsetY: 0, velX: 0, velY: 0 }
}

/**
 * One damped-spring step for the whole-pane shake. Pure: state in,
 * state out. The engine integrates it per simulation step; the tests
 * pin that it overshoots, decays, and settles.
 */
export function stepTray(tray: TrayState, dtS: number): TrayState {
  'worklet'
  const ax = -TRAY_STIFFNESS * tray.offsetX - TRAY_DAMPING * tray.velX
  const ay = -TRAY_STIFFNESS * tray.offsetY - TRAY_DAMPING * tray.velY
  const velX = tray.velX + ax * dtS
  const velY = tray.velY + ay * dtS
  return {
    offsetX: tray.offsetX + velX * dtS,
    offsetY: tray.offsetY + velY * dtS,
    velX,
    velY,
  }
}

/** The punch's kick to the tray (left → rightward, mirror for right). */
export function kickTray(tray: TrayState, handCode: number, strength: number, seed: number): TrayState {
  'worklet'
  return {
    ...tray,
    velX: tray.velX + impulseDirection(handCode) * TRAY_KICK * strength * 3,
    velY: tray.velY + (hash01(seed, 11) - 0.5) * TRAY_KICK * strength * 1.5,
  }
}

/** One queued splat, in field UV. */
export interface SedimentSplat {
  x: number
  y: number
  strength: number
  radius: number
  dirX: number
  handTint: number
  seed: number
}

export function splatFromPunch(handCode: number, v01: number, seed: number): SedimentSplat {
  'worklet'
  const origin = impulseOrigin(handCode, seed)
  const strength = visualStrength(v01)
  return {
    x: origin.x,
    y: origin.y,
    strength,
    radius: 0.035 + 0.095 * Math.max(0, Math.min(1, v01)),
    dirX: impulseDirection(handCode),
    handTint: handCode === HAND_LEFT ? -1 : handCode === HAND_RIGHT ? 1 : 0,
    seed,
  }
}

/** Center splat for a converging pair. */
export function convergenceSplat(boost: number, seed: number): SedimentSplat {
  'worklet'
  return {
    x: 0.5,
    y: 0.5 + (hash01(seed, 13) - 0.5) * 0.1,
    strength: boost,
    radius: 0.09,
    dirX: 0,
    handTint: 0,
    seed,
  }
}

/**
 * Pack up to SPLATS_PER_STEP splats into two plain float arrays for
 * the motion pass: positions [x, y, strength, radius] and meta
 * [dirX, handTint, seedFrac, 0]. Plain number[], never Float32Array
 * (the native uniform path truncates typed arrays to 4 floats).
 */
export function packSplats(splats: readonly SedimentSplat[]): {
  positions: number[]
  meta: number[]
} {
  'worklet'
  const positions: number[] = []
  const meta: number[] = []
  for (let i = 0; i < SPLATS_PER_STEP; i += 1) {
    const s = splats[i]
    if (s) {
      positions.push(s.x, s.y, s.strength, s.radius)
      meta.push(s.dirX, s.handTint, hash01(s.seed, 3), 0)
    } else {
      positions.push(0, 0, 0, 0.001)
      meta.push(0, 0, 0, 0)
    }
  }
  return { positions, meta }
}

/** Map the bus's PunchHand to the numeric hand code. */
export function handCodeOf(hand: PunchHand): number {
  'worklet'
  return hand === 'left' ? HAND_LEFT : hand === 'right' ? HAND_RIGHT : HAND_NEUTRAL
}
