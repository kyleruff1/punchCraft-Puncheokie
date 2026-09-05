/**
 * The Z axis: recent punch rate → activity layer 0..3, rising fast and
 * decaying gradually (instrument-design §17, note-cube-design §7). The
 * envelope NEVER moves latched pitches — consumers use the layer for
 * density, effects, and visuals only.
 *
 * Pure, clock-injected: same shape as membraneMath's analytic envelopes —
 * state advances on punch, decays on read.
 */

/** Trailing window for the instantaneous rate, matching membraneMath. */
export const RATE_WINDOW_S = 1.5
/** How gradually the activity envelope releases after a flurry. */
export const ACTIVITY_DECAY_TAU_S = 2.0
/** Rate (punches/sec) mapped to rate01 = 1. */
export const RATE_CEILING_PPS = 6

export interface ActivityState {
  /** Envelope value in punches/sec at `stampMs`. */
  envelope: number
  stampMs: number
  /** Recent punch times (monotonic ms), bounded to the rate window. */
  recentPunchMs: readonly number[]
}

export function emptyActivity(): ActivityState {
  return { envelope: 0, stampMs: 0, recentPunchMs: [] }
}

function decayed(envelope: number, stampMs: number, nowMs: number): number {
  const dtS = Math.max(0, nowMs - stampMs) / 1000
  return envelope * Math.exp(-dtS / ACTIVITY_DECAY_TAU_S)
}

/** Record one live punch; the envelope rises to at least the current rate. */
export function notePunch(state: ActivityState, nowMs: number): ActivityState {
  const windowStart = nowMs - RATE_WINDOW_S * 1000
  const recent = [...state.recentPunchMs.filter((t) => t >= windowStart), nowMs]
  const rate = recent.length / RATE_WINDOW_S
  return {
    envelope: Math.max(decayed(state.envelope, state.stampMs, nowMs), rate),
    stampMs: nowMs,
    recentPunchMs: recent,
  }
}

/** Envelope read at `nowMs` (no state change). */
export function activityAt(state: ActivityState, nowMs: number): number {
  return decayed(state.envelope, state.stampMs, nowMs)
}

/** rate01 in 0..1 for modulation. */
export function rate01At(state: ActivityState, nowMs: number): number {
  return Math.min(1, activityAt(state, nowMs) / RATE_CEILING_PPS)
}

/** Activity layer per the design bands: <1 → 0, <3 → 1, <5 → 2, else 3. */
export function activityLayerAt(state: ActivityState, nowMs: number): 0 | 1 | 2 | 3 {
  const pps = activityAt(state, nowMs)
  if (pps < 1) return 0
  if (pps < 3) return 1
  if (pps < 5) return 2
  return 3
}

// ---------------------------------------------------------------------------
// Brass activity bands (brass-cube-design "Activity controls speed") — the
// arpeggiator's rate ladder, separate from the legacy cube Z bands above.
// The bridge imports these too, so the tablet and the tick engine can never
// disagree on where a layer boundary sits.
// ---------------------------------------------------------------------------

/** Lower bounds (punches/sec) of brass layers 1/2/3. */
export const BRASS_LAYER_THRESHOLDS_PPS = [0.75, 1.75, 3.25] as const

/** A fall must clear the boundary it drops through by this margin. */
export const BRASS_LAYER_HYSTERESIS_PPS = 0.25

/**
 * Brass layer for a rate, with one-sided hysteresis: rises and holds commit
 * immediately ("rising fast"); a fall commits only when the rate clears the
 * previous layer's lower bound by the hysteresis margin.
 */
export function brassLayerFor(pps: number, previousLayer: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  const raw: 0 | 1 | 2 | 3 = pps >= 3.25 ? 3 : pps >= 1.75 ? 2 : pps >= 0.75 ? 1 : 0
  if (raw >= previousLayer) return raw
  const boundary = BRASS_LAYER_THRESHOLDS_PPS[previousLayer - 1] ?? 0
  return pps < boundary - BRASS_LAYER_HYSTERESIS_PPS ? raw : previousLayer
}

/**
 * Decay a stamped punches/sec reading across elapsed time — the same
 * exponential the envelope itself uses, exported so the bridge winds the
 * arp down between gestures with the domain's own curve.
 */
export function decayPps(pps: number, elapsedMs: number): number {
  return pps * Math.exp(-Math.max(0, elapsedMs) / 1000 / ACTIVITY_DECAY_TAU_S)
}
