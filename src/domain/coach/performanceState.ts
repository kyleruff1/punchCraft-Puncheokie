/**
 * Choosing the performance state for a cue — teach, work, or push (Phase C).
 *
 * The library renders every combination at three emotional levels; this picks
 * which one the coach uses for a given cue. The rule is deliberately small and
 * built only from context the timeline already carries, so it is a pure
 * function the announcer's injected selector can call.
 *
 * ## The policy, and why
 *
 * - **push** when the athlete needs driving: a designated intensity block
 *   (`pressure` / `sprint` cadence) or the closing seconds of the round, where
 *   a coach leans in and shouts the finish.
 * - **teach** at the **opening** of a round — the first call sets the tone,
 *   and a warm, deliberate delivery there is what makes the coach sound like
 *   they are showing the work rather than only driving it.
 * - **work** for the body of the round, which is most of it.
 *
 * Push takes precedence over teach: a pressure block's first cue is still a
 * pressure cue, and if a round is short enough that its opening also sits in
 * the closing seconds, the ending wins. Contrast is the whole point of having
 * three states — if everything is push, push becomes the new flat.
 */
import type { PerformanceState } from './VoiceOutputPort'

/**
 * How close to the end of the work period counts as the closing push.
 *
 * Twenty seconds is about the last stretch a coach visibly ramps for; long
 * enough to matter, short enough that the round is not mostly push.
 */
export const PUSH_TAIL_MS = 20_000

/** Cadence profiles that are intensity blocks by design. */
const PRESSURE_CADENCES: ReadonlySet<string> = new Set(['pressure', 'sprint'])

export interface PerformanceContext {
  /** Milliseconds from the start of the round's work period (round-relative). */
  startMsIntoRound: number
  /** The round's work period length, in the same clock. */
  workDurationMs: number
  /** True for the earliest cue of the round. */
  isRoundOpening: boolean
  /** The recipe cadence profile: technical | steady | pressure | sprint. */
  cadenceProfile: string
}

export function selectPerformanceState(ctx: PerformanceContext): PerformanceState {
  const remainingMs = ctx.workDurationMs - ctx.startMsIntoRound
  const inClosingSeconds = remainingMs <= PUSH_TAIL_MS

  if (PRESSURE_CADENCES.has(ctx.cadenceProfile) || inClosingSeconds) return 'push'
  if (ctx.isRoundOpening) return 'teach'
  return 'work'
}
