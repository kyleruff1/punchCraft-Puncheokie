/**
 * Punch-avatar timing and identity — the pure half of the stop-motion card.
 *
 * The card shows a two-frame flip per punch: step 1 is the STRIKE (the
 * unique, telegraphing frame), step 2 is the RETRACTED position (the
 * generic guard, which looks similar across punches). This ordering was
 * Kyle's call on 2026-08-30: under tight windows the first-shown frame
 * naturally gets slightly more visible time, so the frame that carries
 * the punch's identity goes first and the generic one holds the second
 * half. Both frames must still appear EVERY time — that is the whole
 * contract, and it is what the constants and `avatarFrameAt` below
 * exist to guarantee.
 *
 * The LAST punch of a chain gets a sandwich instead of a flip: its
 * window splits into thirds — STRIKE, RETRACTED, STRIKE — so every
 * combination ends on the identifying frame. The reader sees the same
 * frame at the top and tail of the chain and never notices that the
 * pairing was reversed. Only the last punch does this; every earlier
 * punch keeps the two-frame flip, and the last punch's thirds do not
 * shift any earlier punch's timing (Kyle 2026-08-30).
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


/**
 * 'step1' = strike art, 'step2' = the punch's own retracted art (legacy-
 * inverted names), 'guard' = the universal GUARD stance the cycle
 * settles into (Kyle 2026-09-02: round starts, combo-end breaths, and
 * every pause sit in guard).
 */
export type AvatarStep = 'step1' | 'step2' | 'guard'

/** Punch notation for a token — '1', '1b', … '6b'. The only avatar key. */
export function punchAvatarKey(number: PunchNumber, body: boolean): string {
  return body ? `${number}b` : `${number}`
}

/**
 * The full flip is sacred: a punch owns the card for at least this long so
 * every frame lands, even when the next token is already due. Derived from
 * the window rather than fixed, because a slower window draws a longer
 * frame — a flat floor would let a fast token pre-empt the strike. Tokens
 * arriving inside the hold replace each other, so the card skips ahead
 * rather than falling behind the rings.
 *
 * A last-in-chain punch has three frames to protect (strike, retracted,
 * strike), so its hold is three frame-durations rather than two.
 */
export function minHoldMs(windowMs: number, isLast: boolean = false): number {
  return flipFrameMs(windowMs) * (isLast ? 3 : 2)
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
 * `windowMs`: strike first (unique per punch), retracted-guard second,
 * then hold the guard until just before the next beat where the strike
 * primes again. Pass `isLast` for the final punch of a chain — that one
 * uses a strict three-way split of its window (strike / retracted /
 * strike) so the combination ends on the identifying frame; the last
 * punch's thirds don't affect any earlier punch. The card schedules its
 * flips off the same two functions, so the spec under test and the
 * runtime cannot drift.
 */
export function avatarFrameAt(
  elapsedMs: number,
  windowMs: number,
  isLast: boolean = false,
): AvatarStep {
  // STRIKE-FIRST, GUARD ON ALL SIDES (Kyle, on-glass 2026-09-02: "per
  // punch should be extended, then flip to retracted — reversed — but
  // putting guard on all sides of it"). The identity frame lands ON the
  // node's beat: EXTENDED for the body of the window, a flip-frame of
  // RETRACTED as the hand comes back, then the universal GUARD until the
  // next adoption. Mid-combo the next punch preempts at the guard
  // boundary; at a combo's end the retract->guard IS the finish — no
  // last-punch special case ("guard is designed to be parked on"). The
  // strike is floored at MIN_FRAME_MS so a degenerate window still shows
  // the throw.
  // NOTE the frame names are LEGACY-INVERTED (punchAvatarManifest.ts:
  // step1 = the STRIKE art, step2 = the RETRACTED art).
  void isLast
  const t = Math.max(0, elapsedMs)
  const flip = flipFrameMs(windowMs)
  const strikeEnd = Math.max(MIN_FRAME_MS, windowMs - flip)
  if (t < strikeEnd) return 'step1'
  if (t < strikeEnd + flip) return 'step2'
  return 'guard'
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
