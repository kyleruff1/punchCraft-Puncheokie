/**
 * StanceMapper — the single source of truth for turning punch numbers into
 * physical hands (#126 M25-01, doc §2, §11; spec §13.2).
 *
 * Punch numbers are technique *roles*, not hands: 1/3/5 are lead, 2/4/6 are
 * rear (doc §2). Which physical hand a role belongs to depends on the
 * effective stance, so every number→hand question in the app routes through
 * here rather than being re-derived. Getting this wrong in two places would
 * mean a combination scored against the wrong glove.
 *
 * This mapping carries unusual weight on current hardware. H12 established
 * that the tracker cannot identify technique, so the hand sequence produced
 * here **is** the entirety of what can be verified — it is the ground truth
 * behind the "hand-sequence match" label (D4, D12, spec §13.3).
 *
 * Pure and deterministic: no wall time, no I/O, no React/Expo/SQLite/BLE
 * imports (spec §15.1).
 */

import type {
  BlockStance,
  PunchNumber,
  Stance,
  WorkoutToken,
} from '../workout/WorkoutTokens'

export interface ExpectedPunch {
  /** Index into the block's token array, so a result maps back to its cue. */
  tokenIndex: number
  number: PunchNumber
  hand: 'left' | 'right'
  /**
   * D10 — display and scoring metadata only. A body shot is thrown with the
   * same hand as its head equivalent, so this never influences `hand`.
   */
  body: boolean
}

/** Lead roles are 1/3/5; rear are 2/4/6 (doc §2). */
const LEAD_NUMBERS: ReadonlySet<PunchNumber> = new Set<PunchNumber>([1, 3, 5])

export function isLeadNumber(number: PunchNumber): boolean {
  return LEAD_NUMBERS.has(number)
}

/**
 * Resolve a punch number to a physical hand under a given stance.
 *
 * Orthodox leads with the left, southpaw with the right, and the two are
 * exact inverses of each other — expressed here as one rule rather than two
 * tables so they cannot drift apart.
 */
export function resolveHand(number: PunchNumber, effectiveStance: Stance): 'left' | 'right' {
  const lead = isLeadNumber(number)
  const leadHand: 'left' | 'right' = effectiveStance === 'orthodox' ? 'left' : 'right'
  const rearHand: 'left' | 'right' = effectiveStance === 'orthodox' ? 'right' : 'left'
  return lead ? leadHand : rearHand
}

/**
 * Resolve a block's stance against the athlete's default (D2).
 *
 * `'inherit'` passes the default through; the absolute values force a stance
 * regardless of it; `'switch'` means the opposite of the default — so a
 * switch block for a southpaw athlete is orthodox, not "the other one from
 * orthodox".
 */
export function resolveEffectiveStance(blockStance: BlockStance, defaultStance: Stance): Stance {
  switch (blockStance) {
    case 'inherit':
      return defaultStance
    case 'orthodox':
      return 'orthodox'
    case 'southpaw':
      return 'southpaw'
    case 'switch':
      return defaultStance === 'orthodox' ? 'southpaw' : 'orthodox'
  }
}

/** The opposite stance. Exposed because §11's switch-on-command needs it too. */
export function oppositeStance(stance: Stance): Stance {
  return stance === 'orthodox' ? 'southpaw' : 'orthodox'
}

/**
 * Expand a token list into the punches a tracker could be expected to see.
 *
 * Only punch tokens produce an `ExpectedPunch`. Defense, footwork and coach
 * tokens are display-only: they consume time and are instructional, but the
 * tracker cannot observe a slip or a pivot, so they are never scored and
 * never counted toward completion (D4). Returning them here would quietly
 * inflate every completion percentage.
 *
 * `tokenIndex` refers to the position in the ORIGINAL token array, not to
 * the position among punches, so a result can always be traced back to the
 * cue that produced it.
 */
export function resolveSequence(
  tokens: readonly WorkoutToken[],
  effectiveStance: Stance,
): ExpectedPunch[] {
  const expected: ExpectedPunch[] = []
  tokens.forEach((token, tokenIndex) => {
    if (token.kind !== 'punch') return
    expected.push({
      tokenIndex,
      number: token.number,
      hand: resolveHand(token.number, effectiveStance),
      body: token.body,
    })
  })
  return expected
}

/**
 * Just the hand sequence, e.g. `['left', 'right', 'left']`.
 *
 * Convenience for matching and for tests that assert the property H12 makes
 * important: two combinations differing only in technique or body target
 * produce identical sequences here, and are therefore indistinguishable to
 * the tracker.
 */
export function handSequence(
  tokens: readonly WorkoutToken[],
  effectiveStance: Stance,
): Array<'left' | 'right'> {
  return resolveSequence(tokens, effectiveStance).map((p) => p.hand)
}
