/**
 * HydroPulse frame math — pure functions from (now, impulses) to what's
 * on screen this frame.
 *
 * The whole theme is *derived*: the scene keeps only a ring buffer of
 * recent punch impulses, and every ripple radius, surge level, and
 * particle position is recomputed each frame from timestamps. Nothing
 * integrates, so nothing drifts, and the water settles on its own when
 * the punches stop — pausing simply stops appends.
 *
 * Every function carries a `'worklet'` directive so the UI thread can
 * call it directly; each remains a plain pure function under Node, which
 * is how the tests drive it. Time is always an injected `now` in ms on
 * an arbitrary monotonic clock (the scene uses Skia's canvas clock).
 *
 * Determinism: per-particle variety comes from `hash01(seed, lane)` —
 * a seeded integer hash, the same trick the simulator uses — never an
 * ambient random source (domain purity).
 */

/** Ripple pool — also the ring-buffer size; "the last N punches". */
export const RIPPLE_POOL = 12
/** Bubbles spawned per impulse; slot i owns atlas lanes i*4..i*4+3. */
export const PARTICLES_PER_IMPULSE = 4
/** Atlas slots per hand batch. */
export const ATLAS_SLOTS = RIPPLE_POOL * PARTICLES_PER_IMPULSE
/** Decay constant of the ambient surge level. */
export const SURGE_TAU_MS = 1800
/** One ripple's life from crest to gone. */
export const RIPPLE_LIFE_MS = 1100
/** Opposite hands inside this window make waves meet in the middle. */
export const MEET_WINDOW_MS = 500
/** How long the center meet-glow lasts after the second punch. */
export const MEET_GLOW_MS = 700
/** Longest bubble life; each lane's actual life is hashed below this. */
export const PARTICLE_LIFE_MAX_MS = 1200

/** Hand codes inside the ring buffer (worklet-friendly plain numbers). */
export const HAND_LEFT = 0
export const HAND_RIGHT = 1
export const HAND_NEUTRAL = 2

/** One recorded punch impulse. `t: INERT_T` means the slot is empty. */
export interface ImpulseSlot {
  t: number
  hand: number
  v01: number
  seed: number
}

export const INERT_T = -1e12

export function emptyPool(size: number): ImpulseSlot[] {
  const pool: ImpulseSlot[] = []
  for (let i = 0; i < size; i += 1) pool.push({ t: INERT_T, hand: HAND_NEUTRAL, v01: 0, seed: i })
  return pool
}

/** Seeded hash → [0, 1). Deterministic per (seed, lane). */
export function hash01(seed: number, lane: number): number {
  'worklet'
  let h = (seed * 374761393 + lane * 668265263) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export function easeOutCubic(p: number): number {
  'worklet'
  const x = Math.min(1, Math.max(0, p))
  const inv = 1 - x
  return 1 - inv * inv * inv
}

export interface RippleFrame {
  cx: number
  cy: number
  r: number
  fillOpacity: number
  crestOpacity: number
}

const INERT_RIPPLE: RippleFrame = { cx: 0, cy: 0, r: 0, fillOpacity: 0, crestOpacity: 0 }

/**
 * One ripple's shape at `now`. A harder punch moves more water: the
 * radius, the lateral push, and the crest all grow with `v01` — never
 * just the opacity.
 */
export function rippleAt(now: number, slot: ImpulseSlot, w: number, h: number): RippleFrame {
  'worklet'
  const age = now - slot.t
  if (age < 0 || age >= RIPPLE_LIFE_MS) return INERT_RIPPLE
  const p = easeOutCubic(age / RIPPLE_LIFE_MS)
  // Left punches rise from the left third and push right; right punches
  // mirror; a hand the decoder couldn't place blooms in the middle.
  const originX = slot.hand === HAND_LEFT ? 0.3 : slot.hand === HAND_RIGHT ? 0.7 : 0.5
  const dir = slot.hand === HAND_LEFT ? 1 : slot.hand === HAND_RIGHT ? -1 : 0
  const cy = h * (0.52 + (hash01(slot.seed, 7) - 0.5) * 0.18)
  const push = (0.06 + 0.1 * slot.v01) * w
  const cx = w * originX + dir * push * p
  const maxR = (0.16 + 0.42 * slot.v01) * Math.min(w, h)
  const fade = (1 - age / RIPPLE_LIFE_MS) ** 2
  return {
    cx,
    cy,
    r: maxR * p,
    fillOpacity: fade * (0.08 + 0.16 * slot.v01),
    crestOpacity: fade * (0.16 + 0.24 * slot.v01),
  }
}

/**
 * The ambient surge level, 0..1 — every recent impulse contributes an
 * exponentially decaying amount, so a sustained combination stirs the
 * whole field and a quiet stretch lets it settle to zero.
 */
export function surgeAt(now: number, slots: readonly ImpulseSlot[]): number {
  'worklet'
  let total = 0
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i]
    if (!slot) continue
    const age = now - slot.t
    if (age < 0) continue
    total += (0.1 + 0.26 * slot.v01) * Math.exp(-age / SURGE_TAU_MS)
  }
  return Math.min(1, total)
}

/**
 * Center meet-glow: >0 only while an opposite-hand pair landed within
 * MEET_WINDOW_MS and the second is younger than MEET_GLOW_MS.
 */
export function meetBoostAt(now: number, slots: readonly ImpulseSlot[]): number {
  'worklet'
  // The two most recent sided impulses, by timestamp.
  let newest: ImpulseSlot | undefined
  let second: ImpulseSlot | undefined
  for (let i = 0; i < slots.length; i += 1) {
    const slot = slots[i]
    if (!slot || slot.t === INERT_T || slot.hand === HAND_NEUTRAL) continue
    if (!newest || slot.t > newest.t) {
      second = newest
      newest = slot
    } else if (!second || slot.t > second.t) {
      second = slot
    }
  }
  if (!newest || !second) return 0
  if (newest.hand === second.hand) return 0
  if (newest.t - second.t > MEET_WINDOW_MS) return 0
  const age = now - newest.t
  if (age < 0 || age >= MEET_GLOW_MS) return 0
  return (1 - age / MEET_GLOW_MS) * ((newest.v01 + second.v01) / 2)
}

export interface ParticleFrame {
  x: number
  y: number
  scos: number
  ssin: number
}

const INERT_PARTICLE: ParticleFrame = { x: 0, y: 0, scos: 0, ssin: 0 }

/**
 * Bubble `lane` (0..PARTICLES_PER_IMPULSE-1) of an impulse, for the
 * atlas batch of `batchHand`. Everything is hashed from the impulse
 * seed, so a lane's whole flight is a function of age — no state.
 * Scale rides inside (scos, ssin), RSXform-style; scale 0 = invisible.
 */
export function particleAt(
  now: number,
  slot: ImpulseSlot,
  lane: number,
  batchHand: number,
  w: number,
  h: number,
): ParticleFrame {
  'worklet'
  if (slot.hand !== batchHand) return INERT_PARTICLE
  const life = 500 + (PARTICLE_LIFE_MAX_MS - 500) * hash01(slot.seed, lane * 5 + 1)
  const age = now - slot.t
  if (age < 0 || age >= life) return INERT_PARTICLE
  const p = age / life
  const originX = slot.hand === HAND_LEFT ? 0.3 : slot.hand === HAND_RIGHT ? 0.7 : 0.5
  const dir = slot.hand === HAND_LEFT ? 1 : slot.hand === HAND_RIGHT ? -1 : 0
  const cy = h * (0.52 + (hash01(slot.seed, 7) - 0.5) * 0.18)
  const spread = (hash01(slot.seed, lane * 2 + 3) - 0.5) * 1.2
  const reach =
    (0.05 + 0.18 * slot.v01 * (0.4 + 0.6 * hash01(slot.seed, lane * 3 + 2))) * Math.min(w, h)
  const travel = reach * easeOutCubic(p)
  const x = w * originX + dir * Math.cos(spread) * travel + Math.sin(spread) * travel * 0.6
  // Bubbles rise as they fade.
  const y = cy - travel * 0.35 - h * 0.06 * p * p
  const scale = (0.4 + 0.8 * slot.v01) * (1 - p)
  const rot = (hash01(slot.seed, lane * 7 + 5) - 0.5) * 2 * p
  return { x, y, scos: scale * Math.cos(rot), ssin: scale * Math.sin(rot) }
}

export interface AmbientBlobFrame {
  cx: number
  cy: number
  r: number
  opacity: number
}

/**
 * One mercury blob of the ambient field. `sway` (0..1, from surge ×
 * calm) scales how far and how visibly it drifts; at 0 the field is a
 * near-still sheen.
 */
export function ambientBlobAt(
  now: number,
  index: number,
  w: number,
  h: number,
  sway: number,
): AmbientBlobFrame {
  'worklet'
  const fa = 0.00006 * (1 + 0.8 * hash01(11, index))
  const fb = 0.00005 * (1 + 0.6 * hash01(23, index))
  const homeX = w * (0.2 + 0.6 * hash01(37, index))
  const homeY = h * (0.3 + 0.4 * hash01(41, index))
  const drift = (0.04 + 0.08 * sway) * Math.min(w, h)
  return {
    cx: homeX + Math.sin(now * fa + index * 2.1) * drift,
    cy: homeY + Math.cos(now * fb + index * 1.3) * drift * 0.7,
    r: Math.min(w, h) * (0.35 + 0.22 * hash01(53, index)),
    opacity: 0.05 + 0.07 * sway,
  }
}
