/**
 * Strike articulation catalog (M40-20, technique-motif-design §§2-4,
 * second-pass am. 2 + 11).
 *
 * The governing separation, verbatim from the design: "Harmony supplies the
 * note pool. Punch type supplies the musical gesture. Velocity its strength.
 * Acceleration its attack. Punch rate the arrangement energy." **Punch type
 * NEVER selects chords** — nothing in this file touches a cell, a pool, or a
 * bass note.
 *
 * The twelve signatures are COMPOSED from three dimensions rather than
 * enumerated: family (straight/hook/uppercut) × hand × target (head/body).
 *
 * Amendment 11: the hand dimension is PHYSICAL — `physical-left` /
 * `physical-right`. Semantic lead/rear needs a stance, which arrives with
 * M44-03; encoding it here would mislabel every southpaw. Guided mode later
 * composes stance on top of this seam.
 *
 * Identity policy THIS SLICE (design §2): a guided score's
 * expectedStrikeToken yields the full signature; everything else is
 * 'generic' (hand-only). Raw tracker type bytes are NEVER consulted — the
 * capture campaign (M44-02) must validate their semantics first.
 *
 * Pure and deterministic: no clocks, no randomness, no RN imports.
 */
import type { StrikeToken } from './gestureSchema'

export type StrikeFamily = 'straight' | 'hook' | 'uppercut'

/** Amendment 11: physical hands only — stance semantics arrive with M44. */
export type PhysicalHand = 'physical-left' | 'physical-right'

export type StrikeTarget = 'head' | 'body'

/**
 * Where the immediate stab sits in the sounding pool (never a new chord).
 * One role per family so no two families can collide on pitch: the jab
 * enters, the cross takes the fifth, the hook curves through the colour
 * tone, the uppercut reaches for the anchor.
 */
export type StabRole =
  | 'entry-tone' // jab — the cell's user-selected entry tone, always
  | 'power-anchor' // cross — harmonic WEIGHT (fifth / upper anchor / root)
  | 'lateral-color' // hook — harmonic COLOUR, moving sideways
  | 'upper-extension' // uppercut — the reach upward

export type FilterShape = 'snap' | 'lateral-wah' | 'rising-scoop'

export type DrumClass = 'light' | 'power' | 'sweep' | 'lift'

/**
 * A micro-arp operation name. The full ArpOperation algebra lands with the
 * motif compiler (M40-21); the catalog names the operations each family
 * contributes so both tickets share one vocabulary.
 */
export type ArpOperationName =
  | 'advance'
  | 'skip'
  | 'reverse'
  | 'land-root'
  | 'land-fifth'
  | 'land-upper-anchor'
  | 'octave-pulse-up'
  | 'octave-pulse-down'
  | 'lower-inversion'

/** How a punch sounds the instant it lands (before any quantized commit). */
export interface ImmediateArticulation {
  stabRole: StabRole
  baseGateMs: number
  /** Multiplies the compiled note velocity (hand + target modify it). */
  velocityGain: number
  filterShape: FilterShape
  drumClass: DrumClass
  /** Semitone offset of the stab only — pitch CLASS is never changed. */
  octaveOffset: number
  /** −1 (left) … +1 (right): stereo/pan placement of the immediate layer. */
  stereoBias: number
}

/** The ≤3-step mutation a single punch applies to the running pattern. */
export interface MicroArpArticulation {
  operations: readonly ArpOperationName[]
  /** Hard cap from the design: a punch may color at most three steps. */
  maxSteps: 1 | 2 | 3
  /** Signed rotation nudge; hand-dependent, never a chord change. */
  rotation: -1 | 0 | 1
}

/** What a family asks for once it DOMINATES a phrase (M40-22B applies it). */
export interface PersistentPatternArticulation {
  patternId: string
  /** Punches of this family needed in one phrase before it may commit. */
  requiredEvidence: number
  /** Commit quantization for the pattern change, in transport ticks. */
  commitQuantizationTicks: number
}

/**
 * Within a family the two hands carry different EMPHASIS (design §3:
 * "setup emphasis" vs "power emphasis") — that is what makes a jab and a
 * cross, both straights, unmistakably different: the jab enters on the
 * entry tone and steps; the cross stabs the fifth/anchor, skips, and lands.
 * Emphasis is selected by the hand's entry bias, so it stays free of any
 * stance claim (am. 11).
 */
/**
 * How the stab MOVES (M40-28). This is what keeps the families legible
 * with the drum channel muted — pitch and filter motion, not just pitch
 * choice. Rendered on the accent lane by the bridge; the tablet's
 * pre-rendered one-shots cannot express arcs today (see #355).
 */
export interface StabMotion {
  /** Semitones the stab starts BELOW its target — the uppercut's scoop. */
  scoopSemitones: number
  /** How long the scoop takes to arrive. 0 disables it. */
  scoopMs: number
  /** Cents the stab approaches from ABOVE — the cross's impact settle. */
  settleCents: number
  /** Multiplies the wah peak: the hook's wide lateral arc. 1 = normal. */
  filterArc: number
}

export interface EmphasisVariant {
  stabRole: StabRole
  /** The family's pitch/filter gesture on the immediate hit. */
  motion: StabMotion
  operations: readonly ArpOperationName[]
  maxSteps: 1 | 2 | 3
  /**
   * The drum piece is per-EMPHASIS, not per-family: the design gives
   * straights "light/power drums", which is exactly the jab-vs-cross
   * distinction. Family-level drums would make a jab and a cross share a
   * piece and leave 'power' unused by anything.
   */
  drumClass: DrumClass
  /**
   * Gate is per-EMPHASIS too. A family-level gate made the jab and the
   * cross sit for the identical 110 ms, which is most of why they blurred:
   * "short bright entry-tone stab" and "strong … stab, land firmly" are
   * different lengths, not just different pitches.
   */
  baseGateMs: number
  /** Multiplies the accent on top of family character and hand strength. */
  accentGain: number
}

export interface StrikeArticulationProfile {
  family: StrikeFamily
  immediate: Omit<ImmediateArticulation, 'stabRole' | 'drumClass' | 'baseGateMs'>
  /** Selected by the hand's entryBias: −1 → setup, +1 → power. */
  setup: EmphasisVariant
  power: EmphasisVariant
  microArpRotationBase: 0
  persistentPattern: PersistentPatternArticulation
}

/**
 * Family → contour (design §3), with the §4 table's per-hand emphasis.
 * Composing these three dimensions reproduces all twelve rows exactly.
 */
export const STRIKE_FAMILY_PROFILES: Readonly<Record<StrikeFamily, StrikeArticulationProfile>> = {
  // "linear step or decisive skip, tight short tongued brass"
  straight: {
    family: 'straight',
    immediate: {
      velocityGain: 1,
      filterShape: 'snap',
      octaveOffset: 0,
      stereoBias: 0,
    },
    // 1 · Lead jab: "Short bright entry-tone stab" / "Step upward through
    // two adjacent legal tones".
    setup: {
      stabRole: 'entry-tone',
      operations: ['advance', 'advance'],
      maxSteps: 2,
      drumClass: 'light',
      // Jab: almost no motion — a clear, dry punctuation.
      motion: { scoopSemitones: 0, scoopMs: 0, settleCents: 0, filterArc: 0.9 },
      baseGateMs: 100, // bright snap, driest of the four
      accentGain: 1,
    },
    // 2 · Rear cross: "Strong fifth/upper-anchor stab" / "Skip one pool
    // tone, then land firmly".
    power: {
      stabRole: 'power-anchor',
      operations: ['skip', 'land-fifth'],
      maxSteps: 2,
      drumClass: 'power',
      // Cross: approaches from ~10 cents above and settles onto pitch —
      // an impact weight, not a sweep.
      motion: { scoopSemitones: 0, scoopMs: 90, settleCents: 10, filterArc: 1 },
      baseGateMs: 140, // strong attack, a decisive landing
      accentGain: 1.18,
    },
    microArpRotationBase: 0,
    persistentPattern: { patternId: 'up', requiredEvidence: 2, commitQuantizationTicks: 960 },
  },
  // "pendulum/reversal/curved traversal, wider gate, lateral wah/pan arc"
  hook: {
    family: 'hook',
    immediate: {
      velocityGain: 1.08,
      filterShape: 'lateral-wah',
      octaveOffset: 0,
      stereoBias: 0,
    },
    // 3 · Lead hook: "Reverse into a short pendulum arc".
    setup: {
      stabRole: 'lateral-color',
      operations: ['reverse', 'advance'],
      maxSteps: 3,
      drumClass: 'sweep',
      // Hook: no pitch travel — a wide lateral filter arc instead.
      motion: { scoopSemitones: 0, scoopMs: 0, settleCents: 0, filterArc: 1.45 },
      baseGateMs: 190,
      accentGain: 1,
    },
    // 4 · Rear hook: "Mirrored pendulum, positive rotation" — the SAME
    // curve mirrored by the hand's rotation sign, with a firmer landing.
    power: {
      stabRole: 'lateral-color',
      operations: ['reverse', 'advance', 'land-upper-anchor'],
      maxSteps: 3,
      drumClass: 'sweep',
      motion: { scoopSemitones: 0, scoopMs: 0, settleCents: 0, filterArc: 1.55 },
      baseGateMs: 205,
      accentGain: 1.12,
    },
    microArpRotationBase: 0,
    persistentPattern: { patternId: 'pendulum', requiredEvidence: 2, commitQuantizationTicks: 960 },
  },
  // "rising traversal + octave lift, legato scoop, upward filter/pitch motion"
  uppercut: {
    family: 'uppercut',
    immediate: {
      velocityGain: 1.12,
      filterShape: 'rising-scoop',
      octaveOffset: 0,
      stereoBias: 0,
    },
    // 5 · Lead uppercut: "Three-step rise with a brief octave pulse".
    setup: {
      stabRole: 'upper-extension',
      operations: ['advance', 'octave-pulse-up', 'advance'],
      maxSteps: 3,
      drumClass: 'lift',
      // Uppercut: scoops UP into the target from two semitones below.
      // The scoop's start may be chromatic — it is a transient bend; the
      // DESTINATION is always a legal chord tone.
      motion: { scoopSemitones: 2, scoopMs: 85, settleCents: 0, filterArc: 1.2 },
      baseGateMs: 230,
      accentGain: 1,
    },
    // 6 · Rear uppercut: "Rising phrase … forceful root/fifth landing".
    power: {
      stabRole: 'upper-extension',
      operations: ['advance', 'octave-pulse-up', 'land-fifth'],
      maxSteps: 3,
      drumClass: 'lift',
      motion: { scoopSemitones: 2, scoopMs: 95, settleCents: 0, filterArc: 1.25 },
      baseGateMs: 245,
      accentGain: 1.12,
    },
    microArpRotationBase: 0,
    persistentPattern: { patternId: 'fanfare', requiredEvidence: 2, commitQuantizationTicks: 960 },
  },
}

/**
 * Hand modifier (design §3 "Lead/rear → direction and entry", renamed to
 * physical hands per am. 11). The CHARACTER is real and opposite per hand —
 * entry height, rotation sign, stereo, accent — but nothing here claims
 * which hand is the boxer's lead.
 */
export interface HandArticulationModifier {
  /** Signed pool-entry nudge (lower/earlier vs higher/later entry). */
  entryBias: -1 | 1
  rotation: -1 | 1
  stereoBias: number
  accentMultiplier: number
}

export const HAND_MODIFIERS: Readonly<Record<PhysicalHand, HandArticulationModifier>> = {
  'physical-left': { entryBias: -1, rotation: -1, stereoBias: -0.6, accentMultiplier: 1 },
  'physical-right': { entryBias: 1, rotation: 1, stereoBias: 0.6, accentMultiplier: 1.1 },
}

/**
 * Target modifier (design §3 "Head/body"): a body shot is "a lower, heavier
 * version of the same idea, NEVER a different scale" — one octave down,
 * darker, longer, heavier low transient. Pitch CLASSES are untouched.
 */
export interface TargetArticulationModifier {
  octaveOffset: 0 | -1
  /** Multiplies the profile's gate (body shots sit longer). */
  gateMultiplier: number
  /** Multiplies cutoff/brightness — < 1 is darker. */
  brightnessMultiplier: number
  /** Multiplies the impact transient velocity. */
  transientGain: number
  addLowerInversion: boolean
}

export const TARGET_MODIFIERS: Readonly<Record<StrikeTarget, TargetArticulationModifier>> = {
  head: {
    octaveOffset: 0,
    gateMultiplier: 1,
    brightnessMultiplier: 1,
    transientGain: 1,
    addLowerInversion: false,
  },
  body: {
    octaveOffset: -1,
    gateMultiplier: 1.25,
    brightnessMultiplier: 0.72,
    transientGain: 1.2,
    addLowerInversion: true,
  },
}

/** The three dimensions a token decomposes into (design §3). */
export interface StrikeSignatureKey {
  family: StrikeFamily
  hand: PhysicalHand
  target: StrikeTarget
}

/** One fully composed signature — what the renderer and motif compiler read. */
export interface ComposedStrikeSignature {
  signatureId: string
  token: StrikeToken | null
  key: StrikeSignatureKey
  /** Which variant the hand selected — the jab/cross difference. */
  emphasis: 'setup' | 'power'
  /** The family's pitch/filter gesture on the immediate hit. */
  motion: StabMotion
  immediate: ImmediateArticulation
  microArp: MicroArpArticulation
  persistentPattern: PersistentPatternArticulation
  brightnessMultiplier: number
  transientGain: number
  addLowerInversion: boolean
}

/**
 * Token → dimensions (design §4 table). Digits 1/2 are straights, 3/4
 * hooks, 5/6 uppercuts; odd digits are thrown by the physical LEFT hand and
 * even by the physical RIGHT in the orthodox default the guided score
 * assumes — M44-03 replaces this mapping with stance resolution, which is
 * exactly why the hand axis is named physically here.
 */
const TOKEN_KEYS: Readonly<Record<StrikeToken, StrikeSignatureKey>> = {
  '1': { family: 'straight', hand: 'physical-left', target: 'head' },
  '1B': { family: 'straight', hand: 'physical-left', target: 'body' },
  '2': { family: 'straight', hand: 'physical-right', target: 'head' },
  '2B': { family: 'straight', hand: 'physical-right', target: 'body' },
  '3': { family: 'hook', hand: 'physical-left', target: 'head' },
  '3B': { family: 'hook', hand: 'physical-left', target: 'body' },
  '4': { family: 'hook', hand: 'physical-right', target: 'head' },
  '4B': { family: 'hook', hand: 'physical-right', target: 'body' },
  '5': { family: 'uppercut', hand: 'physical-left', target: 'head' },
  '5B': { family: 'uppercut', hand: 'physical-left', target: 'body' },
  '6': { family: 'uppercut', hand: 'physical-right', target: 'head' },
  '6B': { family: 'uppercut', hand: 'physical-right', target: 'body' },
}

/**
 * The design §4 table order — declared, never derived: JS reorders
 * integer-like object keys ('1','2',… before '1B'), and this order is what
 * the Twelve-Signature Audition lays out on glass.
 */
export const STRIKE_TOKENS: readonly StrikeToken[] = [
  '1',
  '1B',
  '2',
  '2B',
  '3',
  '3B',
  '4',
  '4B',
  '5',
  '5B',
  '6',
  '6B',
]

/** The dimensions behind a token (design §4). */
export function strikeSignatureKeyOf(token: StrikeToken): StrikeSignatureKey {
  return TOKEN_KEYS[token]
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Compose one signature from its three dimensions. Deterministic and pure:
 * the same key always yields byte-identical output, which is what lets the
 * goldens pin all twelve.
 */
export function composeStrikeSignature(
  key: StrikeSignatureKey,
  token: StrikeToken | null = null,
): ComposedStrikeSignature {
  const base = STRIKE_FAMILY_PROFILES[key.family]
  const hand = HAND_MODIFIERS[key.hand]
  const target = TARGET_MODIFIERS[key.target]
  // Emphasis follows the hand's entry bias, never a stance (am. 11).
  const variant = hand.entryBias < 0 ? base.setup : base.power
  return {
    signatureId: `${key.family}:${key.hand}:${key.target}`,
    token,
    key,
    emphasis: hand.entryBias < 0 ? 'setup' : 'power',
    // Body shots darken the arc along with everything else.
    motion: {
      ...variant.motion,
      filterArc: round2(variant.motion.filterArc * target.brightnessMultiplier),
    },
    immediate: {
      stabRole: variant.stabRole,
      baseGateMs: Math.round(variant.baseGateMs * target.gateMultiplier),
      velocityGain: round2(
        base.immediate.velocityGain * hand.accentMultiplier * variant.accentGain,
      ),
      filterShape: base.immediate.filterShape,
      drumClass: variant.drumClass,
      // Body shots drop an octave; the hand's entry bias never changes the
      // octave, only which end of the pool the phrase enters from.
      octaveOffset: base.immediate.octaveOffset + target.octaveOffset,
      stereoBias: round2(hand.stereoBias),
    },
    microArp: {
      operations: target.addLowerInversion
        ? ['lower-inversion', ...variant.operations]
        : variant.operations,
      maxSteps: variant.maxSteps,
      rotation: hand.rotation,
    },
    persistentPattern: base.persistentPattern,
    brightnessMultiplier: target.brightnessMultiplier,
    transientGain: round2(target.transientGain),
    addLowerInversion: target.addLowerInversion,
  }
}

/** The twelve, composed exactly per the design's §4 table. */
export function composeAllStrikeSignatures(): readonly ComposedStrikeSignature[] {
  return STRIKE_TOKENS.map((token) => composeStrikeSignature(TOKEN_KEYS[token], token))
}

// ---------------------------------------------------------------------------
// Identity policy (design §2, this slice).
// ---------------------------------------------------------------------------

export type StrikeIdentitySource = 'guided-score' | 'device-classifier' | 'hand-gesture' | 'generic'

export interface StrikeIdentity {
  source: StrikeIdentitySource
  token?: StrikeToken
  family?: StrikeFamily
  level?: StrikeTarget
  confidence: number
}

export interface ResolveStrikeIdentityInput {
  /** Present only in guided workouts (the runner's InstrumentPort, M44-01). */
  expectedStrikeToken?: StrikeToken
  hand: 'left' | 'right'
}

/**
 * Resolve what we may CLAIM about a punch's technique.
 *
 * This slice supports exactly two sources: 'guided-score' (a score told us
 * the token — full signature, confidence 1) and 'generic' (hand only). The
 * tracker's raw type byte is deliberately not an input: free jam may not
 * claim a technique until M44-02's capture campaign validates per-device
 * semantics. A generic identity still articulates — the hand modifier makes
 * left and right audibly different — it simply never names a family.
 */
export function resolveStrikeIdentity(input: ResolveStrikeIdentityInput): StrikeIdentity {
  if (input.expectedStrikeToken) {
    const key = TOKEN_KEYS[input.expectedStrikeToken]
    return {
      source: 'guided-score',
      token: input.expectedStrikeToken,
      family: key.family,
      level: key.target,
      confidence: 1,
    }
  }
  return { source: 'generic', confidence: 0 }
}

/** The physical hand a live punch was thrown with (never semantic). */
export function physicalHandOf(hand: 'left' | 'right'): PhysicalHand {
  return hand === 'left' ? 'physical-left' : 'physical-right'
}

/*
 * NOTE: the old runtime `stabNoteFor` lived here. It is gone — family stab
 * pitches are now resolved ONCE PER CELL at field-compile time by
 * `stabRoleResolver.ts`, because a pool may place equivalent roles in
 * different octaves and the entry tone is user-selected. A runtime
 * fallback chain could not see the other families' choices, which is how
 * the jab and the cross ended up on the same pitch.
 */

/** Drum piece per family weight (M40-25): the drum carries the family too. */
export const DRUM_NOTE_BY_CLASS: Readonly<Record<DrumClass, number>> = {
  light: 37, // rim / side stick — the jab's tick
  power: 36, // kick — the cross's weight
  sweep: 38, // snare — the hook's lateral push
  lift: 45, // LOW TOM — the uppercut's rise
}

/**
 * The crash is RESERVED, not routine (M40-28): a crash on every uppercut
 * would rapidly dominate the whole instrument. It replaces the family's
 * own piece only on an exceptional event — today a new velocity peak, the
 * same gate the whammy already rides.
 */
export const PEAK_DRUM_NOTE = 49

/**
 * The articulation to actually play for one punch. A guided token composes
 * its full signature; a generic identity composes the neutral 'straight'
 * contour on the punching hand — audibly hand-specific, never a technique
 * claim.
 */
export function resolveStrikeArticulation(
  identity: StrikeIdentity,
  hand: 'left' | 'right',
): ComposedStrikeSignature {
  if (identity.source === 'guided-score' && identity.token) {
    return composeStrikeSignature(TOKEN_KEYS[identity.token], identity.token)
  }
  return composeStrikeSignature({
    family: 'straight',
    hand: physicalHandOf(hand),
    target: 'head',
  })
}
