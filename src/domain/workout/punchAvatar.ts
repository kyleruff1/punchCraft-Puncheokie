/**
 * Punch-avatar timing and identity — the pure half of the stop-motion card.
 *
 * The card shows a two-frame flip per punch: step 1 is the guard/wind-up,
 * step 2 is the strike. Both frames must appear EVERY time a punch is
 * shown, however tight the tempo — that is the whole contract, and it is
 * what the constants and `avatarFrameAt` below exist to guarantee.
 *
 * Identity is derived from the token itself (`number` + `body`), never
 * from a parallel table: the punch nodes and the avatar read one mapping,
 * so a renamed asset fails in the generator or a Jest test rather than
 * silently drifting on glass.
 *
 * Pure and clock-free — every function takes injected time.
 */
import type { PunchNumber } from './WorkoutTokens'

/** Shortest a single frame may be shown before it stops reading as a pose. */
export const MIN_FRAME_MS = 90
/** Longest a single frame is held during the opening flip. */
export const MAX_FRAME_MS = 220
/** The return-to-guard at the end of a window, so the next strike lands on the beat. */
export const RESET_MS = 130
/** The floor of `minHoldMs` — the tightest a full flip can ever be. */
export const MIN_HOLD_MS = MIN_FRAME_MS * 2

export type AvatarStep = 'step1' | 'step2'

/** Punch notation for a token — '1', '1b', … '6b'. The only avatar key. */
export function punchAvatarKey(number: PunchNumber, body: boolean): string {
  return body ? `${number}b` : `${number}`
}

/**
 * The full flip is sacred: a punch owns the card for at least this long so
 * step 1 AND step 2 both land, even when the next token is already due.
 * Derived from the window rather than fixed, because a slower window draws
 * a longer frame — a flat floor would let a fast token pre-empt the strike.
 * Tokens arriving inside the hold replace each other, so the card skips
 * ahead rather than falling behind the rings.
 */
export function minHoldMs(windowMs: number): number {
  return flipFrameMs(windowMs) * 2
}

/** Frame duration for a window: a quarter of it, fenced by the readability bounds. */
export function flipFrameMs(windowMs: number): number {
  const quarter = Math.max(0, windowMs) * 0.25
  return Math.max(MIN_FRAME_MS, Math.min(MAX_FRAME_MS, quarter))
}

/**
 * When the card returns to guard within a window. Never before the flip has
 * played, so the strike always gets its full frame — this is what makes both
 * frames show for any window at all.
 */
export function avatarResetAtMs(windowMs: number): number {
  const frame = flipFrameMs(windowMs)
  return Math.max(frame * 2, windowMs - RESET_MS)
}

/**
 * Which frame is showing `elapsedMs` into a punch whose window is
 * `windowMs`: wind-up, strike, hold the strike, then back to guard as the
 * next beat approaches. The card schedules its flips off the same two
 * functions, so the spec under test and the runtime cannot drift.
 */
export function avatarFrameAt(elapsedMs: number, windowMs: number): AvatarStep {
  const t = Math.max(0, elapsedMs)
  if (t < flipFrameMs(windowMs)) return 'step1'
  return t < avatarResetAtMs(windowMs) ? 'step2' : 'step1'
}

/**
 * How long the punch at `tokenIndex` owns the card, from the token due
 * times the cue already carries (the rail's `phraseTokenTimesMs` when a
 * clip drives it, the beat grid otherwise). The last token runs to the
 * end of the cue's window.
 */
export function avatarWindowMs(
  dueTimesMs: readonly number[],
  tokenIndex: number,
  cueEndOffsetMs: number,
): number {
  const start = dueTimesMs[tokenIndex] ?? 0
  const next = dueTimesMs[tokenIndex + 1] ?? cueEndOffsetMs
  return Math.max(0, next - start)
}
