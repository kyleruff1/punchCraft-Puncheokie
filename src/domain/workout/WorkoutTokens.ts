/**
 * Workout token contracts and combo notation (M31-01, doc §26, §14, §2).
 *
 * The root of the Phase 5 dependency graph: every other workout module
 * imports these types. Pure TypeScript — no React, React Native, Expo,
 * SQLite or BLE imports are permitted in this directory (spec §15.1).
 *
 * Two things this module deliberately does NOT do:
 *
 *   - It never maps a punch number to a physical hand. Numbers are technique
 *     *roles* — 1/3/5 lead, 2/4/6 rear (doc §2) — and resolving a role to a
 *     left or right hand depends on the effective stance, which is
 *     StanceMapper's job (#126 M25-01).
 *   - It never converts beats to milliseconds. `beatOffset` is in beats;
 *     the cadence profile that turns beats into time is M31-02.
 *
 * Terminology: the post-window gap field is `gapBeats` (D5). Two nearby
 * names are deliberately not reused for it — spec §19.3 reserves
 * `recovering` for the BLE connection state, and `active-recovery` is a
 * block kind rather than a gap.
 */

import type { VoicePolicy } from '../timing/TimingEngine'

export type PunchNumber = 1 | 2 | 3 | 4 | 5 | 6

/** D2 — the legacy third stance value is retired; spec §13.2/§13.3 silently equated it with orthodox. */
export type Stance = 'orthodox' | 'southpaw'

/**
 * A block's stance. `'switch'` means the opposite of the athlete's default;
 * the absolute values force a stance regardless of default (D2).
 */
export type BlockStance = 'inherit' | 'orthodox' | 'southpaw' | 'switch'

export type DefenseCommand = 'duck' | 'bob-weave' | 'slip' | 'roll' | 'pull'
export type FootworkCommand = 'pivot' | 'step-off' | 'circle' | 'cut-off-ring' | 'reset'
export type CoachCommand = 'double-up' | 'put-it-on-em' | 'touch-and-go' | 'breathe' | 'hands-up'

export type WorkoutToken =
  | { kind: 'punch'; number: PunchNumber; body: boolean; beatOffset: number; velocityZone?: 1 | 2 | 3 | 4 }
  | { kind: 'defense'; command: DefenseCommand; beatOffset: number }
  | { kind: 'footwork'; command: FootworkCommand; beatOffset: number }
  | { kind: 'coach'; command: CoachCommand; beatOffset: number }
  /**
   * An empty slot in the 4-slot bar — silence the athlete can SEE.
   *
   * A bar is four slots wide; a motif that cannot tile it evenly
   * (`1-1-2`) is padded with rests so every bar reads the same width and
   * the eye always lands in the same four places (GH #305, Kyle
   * 2026-08-31).
   *
   * A rest occupies a beat and a slot. It is never scored, never spoken,
   * and INVISIBLE TO NOTATION — `formatCombo` drops it, so a padded
   * `1-2` still spells `"1-2"` and all 194 committed combo-announce
   * clips keep resolving. Anything needing the true shape reads
   * `tokens.length`, not the notation string.
   */
  | { kind: 'rest'; beatOffset: number }

/**
 * Doc §14's seven block kinds, plus `coast` (D23).
 *
 * **Coast** establishes a back-and-forth between two shots and lets the athlete
 * hold it for a stated time — "coast for half a minute" — rather than naming
 * every punch through the stretch. It is how the coach stops calling without a
 * tone standing in for the calls (D22): the rhythm is spoken once and
 * understood, so silence afterwards means "keep the pattern", not "guess what
 * comes next".
 *
 * It is count-scored like `volume-burst` — output is what it asks for — but is
 * its own kind rather than a flag on one, because it says something different
 * to the athlete and shows something different on screen.
 */
export type BlockKind =
  | 'exact-combo'
  | 'repeated-combo'
  | 'volume-burst'
  | 'defense-counter'
  | 'footwork-exit'
  | 'active-recovery'
  | 'open-pressure'
  | 'coast'
  /**
   * One canonical strike pumped for a fixed window (M39-V2 Phase 4b).
   *
   * The coach speaks a single `sustained-instruction` at cue start
   * ("Pump the jab") and stays silent through the block interior.
   * Rings light every strike; scoring is count. Distinguished from
   * `volume-burst` (which permits multi-token motifs) so the coach
   * lookup is a single-token `sustainedClipFor({ token, vocabulary })`
   * rather than an ad-hoc phrase.
   */
  | 'sustained-strike'

/**
 * A pre-set coach call-out (Set Ceremonies): the sentence variant to
 * play, an optional notation to recite at technical cadence, an optional
 * launch tail, and the lead-in time the fill reserved for the whole
 * ceremony. Structural only — pattern ids and selection rules live in
 * `setupCallouts.ts`, which produces these.
 */
export interface SetupCallout {
  asset: string
  notation?: string
  tail?: string
  reserveMs: number
}

export interface WorkoutBlock {
  id: string
  kind: BlockKind
  startOffsetMs: number
  durationMs: number
  stance: BlockStance
  tokens: WorkoutToken[]
  /** Post-window gap before the next block, in beats. Named per D5. */
  gapBeats: number
  /** Repetition count. Only meaningful on `repeated-combo`. */
  repeat?: number
  targetPunches?: number
  targetVelocityZone?: 1 | 2 | 3 | 4
  graceBeforeMs?: number
  graceAfterMs?: number
  spokenPhrase?: string
  instruction?: string
  /**
   * The pre-set call-out this block earned (Set Ceremonies) — stamped at
   * generation time (only the fill knows "this is build1 of the Square
   * Builder") and threaded to the block's first cue, where the rhythm
   * map compiles the ceremony inside the fill's reservation. The
   * structural type lives here because this module is the import-free
   * root; the pattern table and pickers live in `setupCallouts.ts`.
   */
  setupCallout?: SetupCallout
  /**
   * Voice cadence band for this block (M4, doc §17) — names which phrase
   * RENDERING calls it (a flurry is called in the sprint recording); the
   * beat grid stays on the workout's profile. Absent = workout default.
   */
  cadence?: string
  /**
   * How the coach VOICES this block (M39-V1c, Kyle 2026-08-30).
   *
   * The engine spec decouples the coach voice from the ring cadence.
   * `per-punch` (absent / default) preserves the pre-M39 behaviour:
   * one spoken phrase clip per cue. `announce-then-work` fires a single
   * combo-level announcement at the block's first cue and stays silent
   * on the interior — the sprint/pressure fix, since a per-punch sprint
   * clip is physically unfittable to the 250 ms grid slot.
   *
   * Rings and per-token cue events still fire at grid times regardless
   * of policy — this only gates the announcer's voice dispatch. See
   * `VoicePolicy` in src/domain/timing/TimingEngine.ts:147.
   */
  voicePolicy?: VoicePolicy
}

export interface ProgramRound {
  id: string
  order: number
  /**
   * Warm-up and cooldown occupy session time but do not carry punch goals
   * (doc §9). `countsTowardGoal` must be false for exactly those two.
   */
  kind: 'warm-up' | 'round' | 'cooldown'
  countsTowardGoal: boolean
  theme: string
  workDurationMs: number
  restAfterMs: number
  targetPunches: number
  blocks: WorkoutBlock[]
}

// ---------------------------------------------------------------------------
// Combo notation (D10)
// ---------------------------------------------------------------------------

/**
 * Thrown by `parseCombo` on malformed notation. Carries the offending
 * segment and its index so a template author can be told exactly what
 * failed rather than that "the combo is invalid".
 */
export class ComboParseError extends Error {
  constructor(
    readonly code: 'empty' | 'unknown-segment' | 'punch-out-of-range' | 'malformed-punch',
    readonly segment: string,
    readonly index: number,
    message: string,
  ) {
    super(message)
    this.name = 'ComboParseError'
  }
}

/**
 * Command spellings used in authored notation.
 *
 * These are NOT the enum values. `-` is the notation separator, so a
 * hyphenated enum value like `step-off` cannot appear literally in a combo
 * string — `'1-step-off-2'` would split into `step` and `off`. The doc's own
 * examples already use the spaced form (`1-1-step off-2`, doc §15), so the
 * spaced spelling is authoritative for notation and this map is the single
 * place the two vocabularies meet.
 */
const DEFENSE_WORDS: ReadonlyArray<readonly [string, DefenseCommand]> = [
  ['duck', 'duck'],
  ['bob and weave', 'bob-weave'],
  ['slip', 'slip'],
  ['roll', 'roll'],
  ['pull', 'pull'],
]

const FOOTWORK_WORDS: ReadonlyArray<readonly [string, FootworkCommand]> = [
  ['pivot', 'pivot'],
  ['step off', 'step-off'],
  ['circle', 'circle'],
  ['cut off the ring', 'cut-off-ring'],
  ['reset', 'reset'],
]

const COACH_WORDS: ReadonlyArray<readonly [string, CoachCommand]> = [
  ['double up', 'double-up'],
  ["put it on em", 'put-it-on-em'],
  ['touch and go', 'touch-and-go'],
  ['breathe', 'breathe'],
  ['hands up', 'hands-up'],
]

const DEFENSE_BY_WORD = new Map<string, DefenseCommand>(DEFENSE_WORDS.map(([w, c]) => [w, c]))
const FOOTWORK_BY_WORD = new Map<string, FootworkCommand>(FOOTWORK_WORDS.map(([w, c]) => [w, c]))
const COACH_BY_WORD = new Map<string, CoachCommand>(COACH_WORDS.map(([w, c]) => [w, c]))

const WORD_BY_DEFENSE = new Map<DefenseCommand, string>(DEFENSE_WORDS.map(([w, c]) => [c, w]))
const WORD_BY_FOOTWORK = new Map<FootworkCommand, string>(FOOTWORK_WORDS.map(([w, c]) => [c, w]))
const WORD_BY_COACH = new Map<CoachCommand, string>(COACH_WORDS.map(([w, c]) => [c, w]))

/** `'put it on 'em'` is written with an apostrophe in prose; accept either. */
const normalizeWord = (raw: string): string =>
  raw.trim().toLowerCase().replace(/[''`]/g, '').replace(/\s+/g, ' ')

const isPunchNumber = (n: number): n is PunchNumber => n >= 1 && n <= 6 && Number.isInteger(n)

/**
 * Parse authored combo notation into tokens.
 *
 * `'1-2b-3-2'` → four punch tokens, `body` true only on the second (D10).
 * A trailing `b` or `B` marks a body shot; the badge is rendered uppercase
 * but serialization is always lowercase (doc §13).
 *
 * Emitted `beatOffset`s are the placeholder sequence 0, 1, 2, … — real
 * musical offsets are authored by templates (doc §17) or derived by M31-02.
 * Callers that care about rhythm must not rely on these.
 *
 * Throws `ComboParseError` on malformed input; it never returns a partial
 * result, because a silently-dropped token would change the combination.
 */
export function parseCombo(notation: string): WorkoutToken[] {
  if (notation.trim().length === 0) {
    throw new ComboParseError('empty', notation, 0, 'combo notation is empty')
  }

  const segments = notation.split('-')
  const tokens: WorkoutToken[] = []

  segments.forEach((rawSegment, index) => {
    const beatOffset = index
    const segment = rawSegment.trim()

    if (segment.length === 0) {
      throw new ComboParseError('unknown-segment', rawSegment, index, `empty segment at position ${index}`)
    }

    // Rest: an empty slot that holds the bar's width (GH #305). Spelled
    // `.` — it cannot be `-`, which is the segment separator, and a word
    // like `rest` would collide with the athlete-facing vocabulary.
    //
    // NOTE the asymmetry with `formatCombo`, which DROPS rests: the
    // round-trip law therefore holds only for rest-free notation, by
    // design. Rests are an authoring and layout device, deliberately
    // absent from the notation used as a clip-lookup key.
    if (segment === '.') {
      tokens.push({ kind: 'rest', beatOffset })
      return
    }

    // Punch: digits with an optional b/B body suffix.
    if (/^\d/.test(segment)) {
      const match = /^(\d+)(b?)$/i.exec(segment)
      if (!match) {
        throw new ComboParseError(
          'malformed-punch',
          rawSegment,
          index,
          `'${segment}' is not a punch number with an optional b suffix`,
        )
      }
      const value = Number(match[1])
      if (!isPunchNumber(value)) {
        throw new ComboParseError(
          'punch-out-of-range',
          rawSegment,
          index,
          `punch number must be 1-6, got ${value}`,
        )
      }
      tokens.push({ kind: 'punch', number: value, body: (match[2] ?? '').length > 0, beatOffset })
      return
    }

    const word = normalizeWord(segment)

    const defense = DEFENSE_BY_WORD.get(word)
    if (defense) {
      tokens.push({ kind: 'defense', command: defense, beatOffset })
      return
    }
    const footwork = FOOTWORK_BY_WORD.get(word)
    if (footwork) {
      tokens.push({ kind: 'footwork', command: footwork, beatOffset })
      return
    }
    const coach = COACH_BY_WORD.get(word)
    if (coach) {
      tokens.push({ kind: 'coach', command: coach, beatOffset })
      return
    }

    throw new ComboParseError(
      'unknown-segment',
      rawSegment,
      index,
      `'${segment}' is not a punch number or a known command`,
    )
  })

  return tokens
}

/**
 * Render tokens back to notation. Inverse of `parseCombo`.
 *
 * Round-trip law: `formatCombo(parseCombo(s))` equals the lowercase,
 * whitespace-normalized form of `s`. Body shots always serialize with a
 * lowercase `b` (D10).
 */
export function formatCombo(tokens: readonly WorkoutToken[]): string {
  return tokens
    // Rests are FILTERED, not serialized to '' — joining an empty string
    // would emit `1-2--` and break the round-trip law, every combo-announce
    // lookup, and the 194-clip library's keys. A padded `1-2` must still
    // spell exactly `"1-2"` (GH #305 decision 7).
    .filter((token): token is Exclude<WorkoutToken, { kind: 'rest' }> => token.kind !== 'rest')
    .map((token) => {
      switch (token.kind) {
        case 'punch':
          return `${token.number}${token.body ? 'b' : ''}`
        case 'defense':
          return WORD_BY_DEFENSE.get(token.command) ?? token.command
        case 'footwork':
          return WORD_BY_FOOTWORK.get(token.command) ?? token.command
        case 'coach':
          return WORD_BY_COACH.get(token.command) ?? token.command
      }
    })
    .join('-')
}

/** Punch tokens only — the sole scored token kind (D4). */
export function punchTokens(tokens: readonly WorkoutToken[]): Array<Extract<WorkoutToken, { kind: 'punch' }>> {
  return tokens.filter((t): t is Extract<WorkoutToken, { kind: 'punch' }> => t.kind === 'punch')
}
