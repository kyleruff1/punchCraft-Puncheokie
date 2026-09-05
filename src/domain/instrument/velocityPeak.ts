/**
 * Per-hand session-peak detection — the gate on the exceptional-punch
 * whammy (whammy seam plan §2). A punch is a peak only when its RAW
 * tracker velocity strictly exceeds everything that hand has thrown this
 * session: raw-based because rollingScale saturates at 1.0 and the jam
 * screen swaps sensitivity scalers at runtime — raw detection keeps accent
 * positions invariant across both.
 *
 * Pure fold, clock-injected (receivedMonotonicTimeMs only). Recovered
 * events never reach it — compileGesture returns null first.
 */

export interface HandPeak {
  maxRaw: number
  punches: number
}

export interface PeakState {
  left: HandPeak
  right: HandPeak
  /** Session-wide accent cooldown stamp (monotonic ms). */
  lastAccentAtMs: number | null
}

/** Punches a hand must throw before its first accent can fire (per hand). */
export const WHAMMY_WARMUP_PUNCHES = 6

/** Minimum gap between accents (session-wide — accents stay rare). */
export const WHAMMY_COOLDOWN_MS = 2500

export function emptyPeaks(): PeakState {
  return {
    left: { maxRaw: 0, punches: 0 },
    right: { maxRaw: 0, punches: 0 },
    lastAccentAtMs: null,
  }
}

/**
 * Fold one live punch. The accent fires iff the hand is warmed up, the raw
 * strictly beats that hand's session max, and the session-wide cooldown has
 * elapsed. maxRaw and punches update on EVERY live punch — a suppressed
 * peak still raises the bar; lastAccentAtMs moves only when an accent fires.
 */
export function notePeak(
  state: PeakState,
  hand: 'left' | 'right',
  velocityRaw: number,
  nowMs: number,
): { state: PeakState; accent: boolean } {
  const previous = state[hand]
  const accent =
    previous.punches >= WHAMMY_WARMUP_PUNCHES &&
    velocityRaw > previous.maxRaw &&
    (state.lastAccentAtMs === null || nowMs - state.lastAccentAtMs >= WHAMMY_COOLDOWN_MS)
  return {
    state: {
      ...state,
      [hand]: {
        maxRaw: Math.max(previous.maxRaw, velocityRaw),
        punches: previous.punches + 1,
      },
      lastAccentAtMs: accent ? nowMs : state.lastAccentAtMs,
    },
    accent,
  }
}
