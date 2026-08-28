/**
 * Set-ceremony call-outs — the coach procures every set (Set Ceremonies
 * plan; Kyle's keystone "lifelike trainer" feature).
 *
 * A `SetupCallout` is stamped on a block at GENERATION time — the fill is
 * the only party that knows "this is build1 of the Square Builder" —
 * and travels block → first cue → rhythm map, where the compiler places
 * the ceremony inside time the fill RESERVED for it (`leadInBeats`).
 * Inter-set quiet in a generated round is otherwise ≤3 s, so without a
 * reservation no ceremony fits; with one, no existing call moves.
 *
 * The ceremony shape: [sentence clip] → [optional recitation of the
 * notation, replayed from the existing technical-cadence phrase library]
 * → [optional launch tail ("Okay — go!")]. Whole clips only (D16).
 *
 * Selection density is Kyle's call: nearly every set gets one — the rng
 * picks WHICH PHRASING (variant), not whether to speak. The only skips
 * are mechanical: no rendered clip, or a reservation that doesn't fit.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 * Clip durations are injected (`ReserveMsFor`), never read from a
 * manifest here.
 */

import type { Rng } from './seededRandom'
import type { SetupCallout } from './WorkoutTokens'

export type { SetupCallout } from './WorkoutTokens'

export type SetupPatternId =
  | 'co-first-look'
  | 'co-ones-twos'
  | 'co-double-jab'
  | 'co-hooks'
  | 'co-uppercuts'
  | 'co-square'
  | 'co-buildup-start'
  | 'co-buildup-next'
  | 'co-volume'
  | 'co-jab-volume'
  | 'co-downstairs'
  | 'co-body-to-head'
  | 'co-movement'
  | 'co-pressure'
  | 'co-new-pattern'
  | 'co-settle-in'
  | 'co-flurry'
  | 'co-final-round'
  | 'co-breathe-reset'

export type CalloutTail = 'co-okay-go' | 'co-regular-speed-go'

interface PatternDef {
  variants: number
  recite: boolean
  tail?: CalloutTail
}

/** One row per pattern: variant count mirrors tools/voice/callouts.json. */
export const SETUP_PATTERNS: Readonly<Record<SetupPatternId, PatternDef>> = {
  'co-first-look': { variants: 3, recite: true, tail: 'co-okay-go' },
  'co-ones-twos': { variants: 3, recite: false },
  'co-double-jab': { variants: 2, recite: false },
  'co-hooks': { variants: 3, recite: false },
  'co-uppercuts': { variants: 2, recite: false },
  'co-square': { variants: 2, recite: false },
  'co-buildup-start': { variants: 3, recite: true, tail: 'co-regular-speed-go' },
  'co-buildup-next': { variants: 2, recite: true, tail: 'co-okay-go' },
  'co-volume': { variants: 3, recite: false },
  'co-jab-volume': { variants: 2, recite: false },
  'co-downstairs': { variants: 3, recite: false },
  'co-body-to-head': { variants: 2, recite: false },
  'co-movement': { variants: 2, recite: false },
  'co-pressure': { variants: 3, recite: true, tail: 'co-okay-go' },
  'co-new-pattern': { variants: 2, recite: true, tail: 'co-okay-go' },
  'co-settle-in': { variants: 2, recite: false },
  'co-flurry': { variants: 2, recite: false },
  'co-final-round': { variants: 2, recite: false },
  'co-breathe-reset': { variants: 2, recite: false },
}

/** A same-notation stretch this long MUST be announced (Kyle's rule). */
export const MANDATORY_SAME_MOVE_MS = 60_000

/**
 * Extra reservation for the ROUND-OPENING ceremony, covering the
 * compiler's post-bell quiet (ROUND_OPEN_QUIET_MS) plus margin. Without
 * it the first block's ceremony is priced tight against the bell and the
 * compiler silently drops it when geometry lands short — the listening
 * lab caught V3 opening with no ceremony while V1/V4 got theirs.
 */
export const SETUP_ROUND_OPEN_EXTRA_MS = 2_000

/**
 * A reservation past this would eat the set it announces. Sized for the
 * longest real chain (a 4.7s buildup sentence + technical recitation +
 * "regular speed — okay, go!" ≈ 10.5s with gaps and slack) — the first
 * device run showed 8s silently skipping the marquee buildup ceremony
 * whenever the rng drew a longer variant.
 */
export const MAX_CALLOUT_RESERVE_MS = 12_000

/**
 * Injected from the app layer: measured ceremony length for a concrete
 * variant (+ recitation + tail + gaps + slack), or undefined when any
 * needed clip is missing — which skips the ceremony, never degrades it
 * into guesswork.
 */
export type ReserveMsFor = (
  asset: string,
  notation: string | undefined,
  tail: CalloutTail | undefined,
) => number | undefined

/**
 * Build the callout for a pattern: rng picks the variant (freshness),
 * the injected table prices the reservation. Undefined = skip (missing
 * clip, or the ceremony wouldn't fit its own set).
 */
export function pickCallout(
  pattern: SetupPatternId,
  rng: Rng,
  reserveMsFor: ReserveMsFor,
  notation?: string,
  opts: { variantCeiling?: number } = {},
): SetupCallout | undefined {
  const def = SETUP_PATTERNS[pattern]
  // Always draw, even if we end up skipping — keeps the callout rng
  // stream's draw count stable across clip-availability differences.
  const drawn = 1 + rng.int(def.variants)
  // Tone scaling (Kyle: "this is the payoff" before a 4-punch combo,
  // unironically): a caller may cap the variant range so the grandest
  // phrasings are reserved for patterns that earn them. The draw stays
  // unconditional; only the mapping narrows.
  const ceiling = Math.max(1, Math.min(def.variants, opts.variantCeiling ?? def.variants))
  const variant = 1 + ((drawn - 1) % ceiling)
  const asset = `${pattern}-${String(variant).padStart(2, '0')}`
  const recite = def.recite ? notation : undefined
  const reserveMs = reserveMsFor(asset, recite, def.tail)
  if (reserveMs === undefined || reserveMs > MAX_CALLOUT_RESERVE_MS) return undefined
  return {
    asset,
    ...(recite === undefined ? {} : { notation: recite }),
    ...(def.tail === undefined ? {} : { tail: def.tail }),
    reserveMs,
  }
}

/**
 * The family call-out for a notation — which of the "flavor" patterns
 * describes it. Token classes: 1/2 straights, 3/4 hooks, 5/6 uppercuts,
 * B body. Priority is specificity: square > body-to-head > uppercuts >
 * hooks > double-jab > ones-twos.
 */
export function familyPatternFor(notation: string): SetupPatternId {
  const digits = notation
    .toLowerCase()
    .split('-')
    .map((t) => t.replace('b', ''))
  const set = new Set(digits)
  const hasBody = notation.toLowerCase().includes('b')
  const headAfterBody =
    hasBody &&
    /b/.test(notation.toLowerCase().split('-')[0] ?? '') === false &&
    notation.toLowerCase().indexOf('b') < notation.length - 2
  if (digits.length >= 4 && set.has('1') && set.has('4') && set.has('2') && set.has('3')) {
    return 'co-square'
  }
  if (headAfterBody) return 'co-body-to-head'
  if (set.has('5') || set.has('6')) return 'co-uppercuts'
  if (set.has('3') || set.has('4')) return 'co-hooks'
  if (digits[0] === '1' && digits[1] === '1') return 'co-double-jab'
  return 'co-ones-twos'
}
