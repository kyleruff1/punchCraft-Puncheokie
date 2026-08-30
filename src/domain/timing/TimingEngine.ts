/**
 * The Timing Engine — 60 BPM master pulse, subdivisions, swing, density
 * (Kyle's spec, 2026-08-30, verbatim where marked).
 *
 * One stable master clock at `baseBpm` (60 to start: one beat per
 * 1,000 ms). Every coach cadence is a SUBDIVISION of that pulse — the
 * four coaching profiles are four divisions of one clock, not four
 * unrelated BPM values:
 *
 * | Profile   | Division | Interval  | Call slots/min |
 * |-----------|----------|-----------|----------------|
 * | Technical | 1 / beat | 1,000 ms  |  60            |
 * | Steady    | 2 / beat |   500 ms  | 120            |
 * | Pressure  | 3 / beat |   333 ms  | 180            |
 * | Sprint    | 4 / beat |   250 ms  | 240            |
 *
 * Terminology (Kyle's correction): these are BEAT DIVISIONS — "2 calls
 * per beat · 120 calls/min" — not half/quarter notes, which would need
 * an unusual whole-note-=-60 marking to be literal.
 *
 * ## Density is separate from rate
 *
 * A 240-slot grid does NOT mean 240 punches/min. It means 240 possible
 * rhythmic positions; the workout chooses how many are OCCUPIED.
 * Actual pace = slots/min × occupancy. A sprint grid at 50% density
 * feels fast but plans 120 punches/min. `RhythmicCombination` stores
 * the pattern explicitly (steps may be skipped for syncopation) so
 * "ONE-two-THREE … TWO!" is authorable, not an accident of spacing.
 *
 * ## The scheduler is authoritative
 *
 * The master clock drives coach-audio start, ring activation, the
 * expected strike window, and the percussion pulse. A recorded WAV's
 * duration must never define tempo — the render pipeline validates the
 * clip FITS its allocated grid (±5% preferred, ±10% max stretch,
 * beyond that re-render) and the runtime starts it at its scheduled
 * time.
 *
 * Pure module: no React, no audio imports, injected time only — the
 * same purity rules as `../workout/cadence.ts`.
 */

/**
 * Master resolution — ticks per master pulse (Kyle 2026-08-30 V2
 * blueprint §2). Twelve is divisible by every supported division
 * (1, 2, 3, 4), so a single tick grid exactly represents technical
 * (12 ticks/pulse), flow (6/pulse), triplet (4/pulse), and sprint
 * (3/pulse) cadences with no rounding.
 *
 * At 60 BPM base, 1 tick = 60_000 / (60 × 12) = ~83.333 ms.
 *
 * `MetronomeTransport` uses this constant to convert its absolute
 * unwrapped position into ticks. Every downstream consumer that
 * needs to talk in ticks (`compileCue`, ring engine, avatar
 * dispatcher, tracker acceptance windows) reads through helpers
 * grounded here — no hardcoded 12 anywhere else in the codebase.
 */
export const TICKS_PER_PULSE = 12 as const

/** Number of call positions per master beat. */
export type BeatDivision = 1 | 2 | 3 | 4

/**
 * Ticks per one strike unit at the given division. Returns an
 * integer because `TICKS_PER_PULSE` (12) is divisible by every
 * supported division:
 *
 *   division 1 (technical): 12 ticks/unit → 1000 ms at 60 BPM
 *   division 2 (flow):       6 ticks/unit →  500 ms at 60 BPM
 *   division 3 (triplet):    4 ticks/unit →  333 ms at 60 BPM
 *   division 4 (sprint):     3 ticks/unit →  250 ms at 60 BPM
 *
 * Throws on any division outside 1..4 (which would produce a
 * non-integer ticks-per-unit and break the tick-as-integer
 * contract V2 relies on).
 */
export function ticksPerUnit(division: BeatDivision): number {
  const ticks = TICKS_PER_PULSE / division
  if (!Number.isInteger(ticks)) {
    throw new Error(
      `TICKS_PER_PULSE (${TICKS_PER_PULSE}) must divide evenly by division ${division}`,
    )
  }
  return ticks
}

/** Milliseconds per tick at a given master BPM. */
export function tickDurationMs(baseBpm: number): number {
  if (!Number.isFinite(baseBpm) || baseBpm <= 0) {
    throw new Error('baseBpm must be a positive number')
  }
  return 60_000 / (baseBpm * TICKS_PER_PULSE)
}

/** Absolute tick at the given elapsed milliseconds. */
export function tickAt(elapsedMs: number, baseBpm: number): number {
  return (elapsedMs / 60_000) * baseBpm * TICKS_PER_PULSE
}

/** Elapsed milliseconds at the given absolute tick. */
export function msAtTick(tick: number, baseBpm: number): number {
  return (tick / (baseBpm * TICKS_PER_PULSE)) * 60_000
}

export interface CoachTempo {
  /** Master pulse. Start with 60. */
  baseBpm: number
  /**
   * Number of command positions per master beat.
   *
   * 1 = 60 positions/minute at 60 BPM
   * 2 = 120 positions/minute
   * 3 = 180 positions/minute
   * 4 = 240 positions/minute
   */
  division: BeatDivision
  /**
   * 0.50 is perfectly even.
   * 0.54–0.58 provides the rolling old-coach delivery.
   */
  swing: number
}

/**
 * Swing bands (Kyle's spec) — how the number reads on glass:
 * 0.50 exact and mechanical · 0.52 barely perceptible · 0.54 cohesive
 * rolling cadence · 0.56 sing-song old-cornerman flow · 0.58
 * pronounced rhythmic character · 0.62+ approaching exaggerated
 * auctioneer delivery (avoid). Character default range: 0.54–0.57.
 */
export const SWING_EVEN = 0.5
export const SWING_ROLLING = 0.54
export const SWING_SINGSONG = 0.56
/** The ceiling authored swing may not cross — beyond reads as auctioneer. */
export const SWING_MAX = 0.62

/** Duration of one master beat in milliseconds. */
export function beatDurationMs(baseBpm: number): number {
  if (!Number.isFinite(baseBpm) || baseBpm <= 0) {
    throw new Error('baseBpm must be a positive number')
  }
  return 60_000 / baseBpm
}

/** Duration of one call slot (even spacing — swing is applied per step). */
export function callSlotDurationMs(tempo: CoachTempo): number {
  return beatDurationMs(tempo.baseBpm) / tempo.division
}

/** How many call positions exist per minute at this tempo. */
export function callSlotsPerMinute(tempo: CoachTempo): number {
  return tempo.baseBpm * tempo.division
}

/**
 * Millisecond offset of grid step `step` from the start of the grid.
 *
 * Swing (Kyle's spec): the master beat stays exactly `beatDurationMs`
 * long; only the INTERNAL positions shift. At division 2 the off-beat
 * lands at `beat × swing` instead of the midpoint. At division 4 the
 * swing applies to each half-beat pair. Division 3 (triplets) stays
 * straight — swung triplets read as shuffle-on-shuffle and lose the
 * rolling character.
 */
export function stepOffsetMs(step: number, tempo: CoachTempo): number {
  if (!Number.isInteger(step) || step < 0) {
    throw new Error('step must be a non-negative integer')
  }
  const beatMs = beatDurationMs(tempo.baseBpm)
  if (tempo.division === 1) {
    return step * beatMs
  }
  if (tempo.division === 2) {
    const beatIndex = Math.floor(step / 2)
    const insideBeat = step % 2
    return beatIndex * beatMs + (insideBeat === 0 ? 0 : beatMs * tempo.swing)
  }
  if (tempo.division === 3) {
    return step * (beatMs / 3)
  }
  const pairIndex = Math.floor(step / 2)
  const insidePair = step % 2
  const pairDurationMs = beatMs / 2
  return pairIndex * pairDurationMs + (insidePair === 0 ? 0 : pairDurationMs * tempo.swing)
}

/**
 * How the coach voices a block (Kyle 2026-08-30, M39 addendum) —
 * decoupled from the ring cadence so the coach can be human:
 *
 * - `per-punch` — the coach calls every punch on-grid (the pre-M39
 *   behaviour; default for byte-identity during migration).
 * - `per-rep` — Simon-says: one call at the top of each repeat of the
 *   combination; the boxer executes; the coach calls the next rep. The
 *   rings still march to the grid.
 * - `announce-then-work` — one natural-language intro at block start
 *   ("ok, a bunch of jabs coming up, just pump that jab"), then silent
 *   through the block. The rings still march.
 * - `announce-with-affirmations` — announce, then occasional
 *   affirmations ("yes!", "keep going") at authored intervals instead
 *   of on every ring.
 *
 * Runtime consumer decides *when* to fire the voice; the engine only
 * carries the policy tag.
 */
export type VoicePolicy =
  | 'per-punch'
  | 'per-rep'
  | 'announce-then-work'
  | 'announce-with-affirmations'

/** One punch placed on the grid. Steps may be skipped for syncopation. */
export interface RhythmicPunch {
  /** Punch notation token — '1', '2', … '6b'. */
  token: string
  /** Grid position. Not necessarily consecutive. */
  step: number
  /** 0..1 emphasis — drives voice accent and (later) haptic strength. */
  accent: number
}

/** A combination with its rhythm stored explicitly — never assumed. */
export interface RhythmicCombination {
  id: string
  tokens: string[]
  tempo: CoachTempo
  /** Total number of grid positions allocated to the phrase. */
  totalSteps: number
  punches: RhythmicPunch[]
  /** Execution cycles before the next spoken instruction. */
  repeatCount: number
  /**
   * Voice pattern for this combination. Absent → the runtime picks
   * the workout's default (which is `per-punch` during migration
   * for byte-identity with the pre-M39 behaviour).
   */
  voicePolicy?: VoicePolicy
}

/**
 * Occupancy of a combination's grid: punches ÷ totalSteps (0..1].
 * Actual planned pace = `callSlotsPerMinute(tempo) × density`.
 */
export function density(combo: RhythmicCombination): number {
  if (combo.totalSteps <= 0) {
    throw new Error(`combination ${combo.id} allocates no steps`)
  }
  return combo.punches.length / combo.totalSteps
}

/** Planned punches per minute for a combination repeated back to back. */
export function plannedPacePerMinute(combo: RhythmicCombination): number {
  return callSlotsPerMinute(combo.tempo) * density(combo)
}

/** Total grid duration of one pass through the combination. */
export function combinationDurationMs(combo: RhythmicCombination): number {
  return combo.totalSteps * callSlotDurationMs(combo.tempo)
}

/**
 * One scheduled punch, every consumer's timestamps derived from ONE
 * grid time (Kyle's spec): voice onset and ring activation at grid
 * time; the expected physical strike and the acceptance window offset
 * by human reaction constants (see `acceptance.ts`).
 */
export interface ScheduledPunch {
  token: string
  accent: number
  /** Coach audio onset — grid time. */
  spokenAtMs: number
  /** Ring/number-circle activation — grid time. */
  visualAtMs: number
  /** Grid time + EXPECTED_STRIKE_DELAY_MS. */
  expectedStrikeAtMs: number
  /** Acceptance window opening (grid time + ACCEPT_FROM_MS). */
  acceptFromMs: number
  /** Acceptance window close (grid time + accept-until for the division). */
  acceptUntilMs: number
}

import {
  ACCEPT_FROM_MS,
  acceptUntilMsFor,
  EXPECTED_STRIKE_DELAY_MS,
} from './acceptance'

/**
 * Expand a combination into absolute per-punch schedules starting at
 * `atMs` (typically a cue's scheduledStartMs on the work-elapsed
 * clock). Repeats are laid back to back, each pass one grid duration
 * later.
 */
export function scheduleCombination(
  combo: RhythmicCombination,
  atMs: number,
): ScheduledPunch[] {
  const passMs = combinationDurationMs(combo)
  const acceptSpanMs = acceptUntilMsFor(combo.tempo.division)
  const out: ScheduledPunch[] = []
  for (let rep = 0; rep < Math.max(1, combo.repeatCount); rep += 1) {
    const passStart = atMs + rep * passMs
    for (const punch of combo.punches) {
      const gridTime = passStart + stepOffsetMs(punch.step, combo.tempo)
      out.push({
        token: punch.token,
        accent: punch.accent,
        spokenAtMs: gridTime,
        visualAtMs: gridTime,
        expectedStrikeAtMs: gridTime + EXPECTED_STRIKE_DELAY_MS,
        acceptFromMs: gridTime + ACCEPT_FROM_MS,
        acceptUntilMs: gridTime + acceptSpanMs,
      })
    }
  }
  return out
}
