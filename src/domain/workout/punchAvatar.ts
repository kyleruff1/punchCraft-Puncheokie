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

export type AvatarStep = 'step1' | 'step2'

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
  // ONE FLIP PER NODE (Kyle, on-glass 2026-09-01, right after the walk
  // closed): "start retracted, then flip to extended — just one flip per
  // node." The old model returned to guard within the window (and cut
  // the last punch into strict thirds), so a node cost up to three
  // visible changes. Now: guard until the flip moment, EXTENDED for the
  // rest of the window — the retraction happens implicitly when the next
  // node's window begins at step1. Pumps inherit it for free: each
  // pulse-wrap is exactly one throw. `isLast` keeps the signature (the
  // hold-to-window-end it used to encode is now everyone's behaviour).
  // NOTE the frame names are LEGACY-INVERTED (punchAvatarManifest.ts:
  // step1 = the STRIKE art, step2 = the RETRACTED/guard art — from the
  // old strike-first model). Kyle's spec reads in ART terms: guard
  // first, extended after the flip — which in manifest terms is
  // step2 -> step1.
  void isLast
  const t = Math.max(0, elapsedMs)
  return t < flipFrameMs(windowMs) ? 'step2' : 'step1'
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
