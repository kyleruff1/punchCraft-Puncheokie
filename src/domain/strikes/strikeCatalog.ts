/**
 * Strike catalog — 12 canonical punch strikes with node id, spoken
 * labels, and avatar frame references (M39-V2 Phase 2, Kyle blueprint
 * 2026-08-30).
 *
 * ## Why a catalog
 *
 * Today the same 12 strikes appear in three separate places, keyed
 * differently and easy to drift:
 *
 *  - `punchAvatarManifest` — `(number, body)` → frame pair
 *  - `TECHNIQUE_WORDS` in `tools/voice/prosody.mjs` — number → spoken
 *    technique name
 *  - `resolveHand` in `StanceMapper.ts` — number + stance → physical
 *    hand
 *
 * The V2 blueprint calls this out: "one strike catalog, referenced by
 * combos and by the visual layer." This module is that catalog. It
 * DOESN'T re-embed avatar frame `require()` calls (those already live
 * in `punchAvatarManifest`) — it exposes lookups over the existing
 * data plus the semantic metadata the runtime needs (family,
 * lead/rear, head/body, node id, spoken labels).
 *
 * ## Stance-relative tokens, stance-mirrored physical hand
 *
 * Tokens stay stance-relative: `1` is always LEAD jab, `2` is always
 * REAR cross. The physical hand for tracker matching is resolved
 * separately via `StanceMapper.resolveHand` (unchanged).
 *
 * ## Pure module
 *
 * No React, no audio, no clock, no filesystem imports. Downstream
 * `compileCue` reads the catalog at compile time to stamp
 * `nodeId` / `spokenLabels` / `avatarFrameKey` onto each
 * `CompiledStrikeEvent`.
 */

import type { PunchNumber } from '@domain/workout/WorkoutTokens'

/** Canonical strike identifier — one of 12 stance-relative shots. */
export type StrikeToken =
  | '1'
  | '1B'
  | '2'
  | '2B'
  | '3'
  | '3B'
  | '4'
  | '4B'
  | '5'
  | '5B'
  | '6'
  | '6B'

/** Technique family, independent of stance. */
export type StrikeFamily = 'jab' | 'cross' | 'hook' | 'uppercut'

/** Which hand throws the strike, stance-relative. */
export type RelativeHand = 'lead' | 'rear'

/** Head vs body target. */
export type StrikeTarget = 'head' | 'body'

export interface StrikeSpokenLabels {
  /** Numbers vocabulary — "One", "One-bee", ..., "Six-bee". */
  numberCall: string
  /** Techniques vocabulary — "Jab", "Body jab", ..., "Rear body uppercut". */
  techniqueCall: string
  /**
   * Compact technique call for tight cadences (sprint / pressure).
   * A full "Rear body uppercut" cannot fit inside a 250 ms sprint
   * slot; the compact form is what the render pipeline uses when
   * the cue's cadence is in the compact set.
   */
  techniqueCompact: string
}

export interface StrikeDefinition {
  token: StrikeToken
  /** Base punch number (1..6). Body flag lives on `target`. */
  number: PunchNumber
  family: StrikeFamily
  relativeHand: RelativeHand
  target: StrikeTarget
  /**
   * Ring node id. Twelve unique nodes — the ring row displays
   * every enabled node; the same combo token always lights the
   * same node. `1` and `1B` are DIFFERENT nodes (head vs body).
   */
  nodeId: string
  spoken: StrikeSpokenLabels
  /**
   * Key into `punchAvatarManifest.findPunchAvatar(number, body)`.
   * Kept as a key (not embedded frame refs) so the catalog stays
   * pure and Metro's require-graph isn't pulled in.
   */
  avatarFrameKey: {
    number: PunchNumber
    body: boolean
  }
}

// ---------------------------------------------------------------------------
// Deterministic derivations. Every catalog field is a pure function of
// the token, so the definitions read as inert data — no maintenance
// burden as strikes evolve.
// ---------------------------------------------------------------------------

function familyFor(number: PunchNumber): StrikeFamily {
  if (number === 1 || number === 2) return number === 1 ? 'jab' : 'cross'
  if (number === 3 || number === 4) return 'hook'
  return 'uppercut'
}

function handFor(number: PunchNumber): RelativeHand {
  // 1, 3, 5 = odd = lead; 2, 4, 6 = even = rear.
  return number % 2 === 1 ? 'lead' : 'rear'
}

function nodeIdFor(number: PunchNumber, body: boolean): string {
  return body ? `node.${number}b` : `node.${number}`
}

// The technique word variants used across the vocabulary. Mirrors
// `TECHNIQUE_WORDS` in `tools/voice/prosody.mjs`; when the render
// pipeline moves to V2 those constants should re-import from here
// so the two never drift again.
const TECHNIQUE_FULL: Record<PunchNumber, string> = {
  1: 'Jab',
  2: 'Cross',
  3: 'Lead hook',
  4: 'Rear hook',
  5: 'Lead uppercut',
  6: 'Rear uppercut',
}
const TECHNIQUE_COMPACT: Record<PunchNumber, string> = {
  1: 'Jab',
  2: 'Cross',
  3: 'Hook',
  4: 'Rear hook',
  5: 'Lead upper',
  6: 'Rear upper',
}

const NUMBER_WORD: Record<PunchNumber, string> = {
  1: 'One',
  2: 'Two',
  3: 'Three',
  4: 'Four',
  5: 'Five',
  6: 'Six',
}

function spokenFor(number: PunchNumber, body: boolean): StrikeSpokenLabels {
  const full = TECHNIQUE_FULL[number]
  const compact = TECHNIQUE_COMPACT[number]
  return {
    numberCall: body ? `${NUMBER_WORD[number]}-bee` : NUMBER_WORD[number],
    techniqueCall: body ? `Body ${full.toLowerCase()}` : full,
    techniqueCompact: body ? `Body ${compact.toLowerCase()}` : compact,
  }
}

function defineStrike(token: StrikeToken): StrikeDefinition {
  const body = token.endsWith('B')
  const number = Number(body ? token.slice(0, -1) : token) as PunchNumber
  return {
    token,
    number,
    family: familyFor(number),
    relativeHand: handFor(number),
    target: body ? 'body' : 'head',
    nodeId: nodeIdFor(number, body),
    spoken: spokenFor(number, body),
    avatarFrameKey: { number, body },
  }
}

/**
 * The 12 canonical strikes, indexed by token. Frozen so consumers
 * cannot mutate — Kyle blueprint §3 "canonical strike occurrence is
 * the primary key" depends on the catalog being stable across the
 * program lifetime.
 */
export const STRIKE_CATALOG: Readonly<Record<StrikeToken, StrikeDefinition>> = Object.freeze({
  '1': defineStrike('1'),
  '1B': defineStrike('1B'),
  '2': defineStrike('2'),
  '2B': defineStrike('2B'),
  '3': defineStrike('3'),
  '3B': defineStrike('3B'),
  '4': defineStrike('4'),
  '4B': defineStrike('4B'),
  '5': defineStrike('5'),
  '5B': defineStrike('5B'),
  '6': defineStrike('6'),
  '6B': defineStrike('6B'),
})

/** Every strike, in canonical order. */
export const STRIKE_TOKENS: readonly StrikeToken[] = Object.freeze([
  '1', '1B', '2', '2B', '3', '3B', '4', '4B', '5', '5B', '6', '6B',
])

/**
 * Lookup a strike by number + body — the shape combo authoring uses
 * today. Returns undefined for out-of-range numbers so callers can
 * decide whether to throw or fall back.
 */
export function strikeFor(number: PunchNumber, body: boolean): StrikeDefinition | undefined {
  const token = (body ? `${number}B` : String(number)) as StrikeToken
  return STRIKE_CATALOG[token]
}

/**
 * A stable per-occurrence identifier for a strike inside a cue.
 * Format: `${cueId}:${tokenIndex}`. Scoped to the round via cueId
 * (round-unique per RhythmMap.ts:213-215 convention).
 *
 * For `1-1-2` at cue `sp1-b2#0`: strikeIds are
 * `sp1-b2#0:0`, `sp1-b2#0:1`, `sp1-b2#0:2` — three distinct
 * identities for what today collapses to `tokenIndex` alone.
 */
export function strikeIdFor(cueId: string, tokenIndex: number): string {
  return `${cueId}:${tokenIndex}`
}
