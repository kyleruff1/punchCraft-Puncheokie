/**
 * The twelve-strike drum mapping (drum-kit-design §5.1), composed.
 *
 * The design names four drum families — jab, cross, hook, uppercut — while
 * the shipped articulation catalog names three (straight/hook/uppercut) and
 * splits straights by EMPHASIS: a jab is straight+setup, a cross is
 * straight+power. Those are the same distinction under two vocabularies, so
 * this file derives one from the other (`drumFamilyOf`) rather than forking
 * a second source of truth. Change a hand's entry bias in the catalog and
 * the drum table follows automatically.
 *
 * Everything here is composed from three dimensions — drum family × hand ×
 * target — exactly as `strikeArticulationCatalog` composes its twelve. The
 * golden test pins the result against §5.1 row by row, so composition can
 * never quietly disagree with the table Kyle wrote.
 *
 * Pure: no clocks, no randomness, no note numbers, no filenames.
 */
import type { StrikeToken } from '../gestureSchema'
import {
  HAND_MODIFIERS,
  STRIKE_TOKENS,
  strikeSignatureKeyOf,
  type StrikeSignatureKey,
} from '../strikeArticulationCatalog'
import type { LogicalDrumArticulation } from './logicalDrumArticulations'

/** §6's family axis. The catalog's `straight` splits into jab and cross. */
export type DrumFamily = 'jab' | 'cross' | 'hook' | 'uppercut'

export type LayerCondition = 'always' | 'body' | 'high-velocity' | 'new-peak' | 'phrase-ending'

export type ArpMutation =
  | 'advance'
  | 'power-land'
  | 'reverse-left'
  | 'arc-right'
  | 'rise-left'
  | 'rise-right'

export type GrooveRole = 'timekeeper' | 'backbeat' | 'movement' | 'fill'

export type TimingPolicy = 'immediate' | 'soft-grid' | 'grid'

export interface DrumLayer {
  articulation: LogicalDrumArticulation
  condition: LayerCondition
  velocityMultiplier: number
}

/** §6, verbatim. */
export interface StrikeDrumSignature {
  token: StrikeToken
  family: DrumFamily
  primary: {
    normal: LogicalDrumArticulation
    /** Absent = the same piece, played at accent velocity (§9). */
    accent?: LogicalDrumArticulation
    /** Absent = the same piece, played at peak velocity (§9). */
    peak?: LogicalDrumArticulation
  }
  layers: readonly DrumLayer[]
  arpMutation: ArpMutation
  grooveRole: GrooveRole
  timingPolicy: TimingPolicy
}

/**
 * The catalog's vocabulary → the drum design's. A straight is a jab or a
 * cross depending on the hand's entry bias, which is the same switch
 * `composeStrikeSignature` uses to pick its setup/power variant — so the
 * drum family and the stab emphasis can never disagree.
 */
export function drumFamilyOf(key: StrikeSignatureKey): DrumFamily {
  if (key.family === 'hook') return 'hook'
  if (key.family === 'uppercut') return 'uppercut'
  return HAND_MODIFIERS[key.hand].entryBias < 0 ? 'jab' : 'cross'
}

/** §4 core kit roles: which piece each family strikes, per hand. */
const PRIMARY_PIECE: Readonly<Record<DrumFamily, Readonly<Record<'lead' | 'rear', LogicalDrumArticulation>>>> =
  {
    // Jabs keep time on the ride; both hands share it — a jab is a jab.
    jab: { lead: 'ride-bow', rear: 'ride-bow' },
    cross: { lead: 'snare-center', rear: 'snare-center' },
    // Hooks travel the rack toms: high on the lead side, mid on the rear.
    hook: { lead: 'rack-tom-high', rear: 'rack-tom-mid' },
    // Uppercuts descend the floor toms.
    uppercut: { lead: 'floor-tom-high', rear: 'floor-tom-low' },
  }

/**
 * §9's accent ladder. Only where the PIECE actually changes — "accent →
 * stronger ride bow" is the same bow harder, which the velocity curve
 * already expresses, so it stays undefined rather than repeating itself.
 */
const PEAK_PIECE: Readonly<Partial<Record<DrumFamily, LogicalDrumArticulation>>> = {
  jab: 'ride-bell', // normal bow → peak bell
  cross: 'snare-rimshot', // normal center → peak rimshot
  // Hook and uppercut peak on the same tom, played harder (§9).
}

/**
 * §5.1's darker body variants. Only the ride and the snare change piece on
 * a body shot; the toms stay put and darken through the octave-down,
 * lower-filter treatment the strike catalog already applies (§5.2).
 */
const BODY_PIECE: Readonly<Partial<Record<DrumFamily, LogicalDrumArticulation>>> = {
  jab: 'ride-bell', // "1B · Ride bell"
  cross: 'snare-body', // "2B · Lower/darker snare hit"
}

const ARP_MUTATION: Readonly<Record<DrumFamily, Readonly<Record<'lead' | 'rear', ArpMutation>>>> = {
  jab: { lead: 'advance', rear: 'advance' },
  cross: { lead: 'power-land', rear: 'power-land' },
  hook: { lead: 'reverse-left', rear: 'arc-right' },
  uppercut: { lead: 'rise-left', rear: 'rise-right' },
}

const GROOVE_ROLE: Readonly<Record<DrumFamily, GrooveRole>> = {
  jab: 'timekeeper',
  cross: 'backbeat',
  hook: 'movement',
  uppercut: 'fill',
}

/**
 * How hard the body kick lands relative to its own velocity range (§9's
 * 64–123 band). "6B · Heavy lower rise and landing" is heavier than "1B ·
 * lower entry" — the modifier is what makes that true.
 */
const BODY_KICK_WEIGHT: Readonly<Record<DrumFamily, number>> = {
  jab: 0.88,
  cross: 1,
  hook: 0.94,
  uppercut: 1.06,
}

/**
 * The physical-left hand throws the odd digits in the orthodox default the
 * guided score assumes; `lead`/`rear` here means exactly that side, not a
 * stance claim (the catalog's amendment 11 seam).
 */
function sideOf(key: StrikeSignatureKey): 'lead' | 'rear' {
  return key.hand === 'physical-left' ? 'lead' : 'rear'
}

/** Compose one row of §5.1 from its three dimensions. */
export function composeStrikeDrumSignature(token: StrikeToken): StrikeDrumSignature {
  const key = strikeSignatureKeyOf(token)
  const family = drumFamilyOf(key)
  const side = sideOf(key)
  const isBody = key.target === 'body'

  const normal = (isBody ? BODY_PIECE[family] : undefined) ?? PRIMARY_PIECE[family][side]
  const peak = PEAK_PIECE[family]

  const layers: DrumLayer[] = []
  if (isBody) {
    // §5.2: every "B" token adds a kick. The strike family is unchanged.
    layers.push({
      articulation: 'kick-main',
      condition: 'body',
      velocityMultiplier: BODY_KICK_WEIGHT[family],
    })
  }
  // §4: the crash is reserved for genuine peaks, never a punch family. The
  // two-bar cooldown that keeps it consequential lives in the event queue —
  // eligibility is all a signature may declare.
  //
  // BOTH §4 triggers are open to every family: "a new session peak" and
  // "the final strike of a completed eight-hit phrase" name events, not
  // techniques. §16's "peak or phrase-ending uppercut: crash eligible" is
  // confirming that uppercuts are included, not restricting the trigger to
  // them — an eight-punch combination ending on a cross deserves its
  // cymbal too.
  layers.push({ articulation: 'crash-main', condition: 'new-peak', velocityMultiplier: 1 })
  layers.push({
    articulation: 'crash-main',
    condition: 'phrase-ending',
    // The rear uppercut IS the designed landing (§5.1 "Fill/landing"), so
    // it crashes hardest; every other family punctuates a little softer.
    velocityMultiplier: family === 'uppercut' && side === 'rear' ? 1 : 0.9,
  })

  return {
    token,
    family,
    // Only carry `peak` when it names a DIFFERENT piece than `normal` —
    // on 1B the normal hit is already the bell.
    primary: peak && peak !== normal ? { normal, peak } : { normal },
    layers,
    arpMutation: ARP_MUTATION[family][side],
    grooveRole: GROOVE_ROLE[family],
    // §11: soft grid is the recommended default. Full quantization would
    // make a punch instrument feel disconnected; immediate is for the Free
    // Kit and latency testing.
    timingPolicy: 'soft-grid',
  }
}

/** All twelve, in the design's table order. */
export const STRIKE_DRUM_SIGNATURES: readonly StrikeDrumSignature[] =
  STRIKE_TOKENS.map(composeStrikeDrumSignature)

const BY_TOKEN: Readonly<Record<string, StrikeDrumSignature>> = Object.fromEntries(
  STRIKE_DRUM_SIGNATURES.map((signature) => [signature.token, signature]),
)

export function strikeDrumSignatureOf(token: StrikeToken): StrikeDrumSignature {
  const signature = BY_TOKEN[token]
  if (!signature) throw new Error(`no drum signature for token "${token}"`)
  return signature
}

/**
 * Which piece to sound for an accent band (§9). `accent`/`peak` fall back to
 * `normal` by design: the band still raises the MIDI velocity even when the
 * articulation is unchanged.
 */
export function pieceForBand(
  signature: StrikeDrumSignature,
  band: 'normal' | 'accent' | 'peak',
): LogicalDrumArticulation {
  if (band === 'peak') return signature.primary.peak ?? signature.primary.accent ?? signature.primary.normal
  if (band === 'accent') return signature.primary.accent ?? signature.primary.normal
  return signature.primary.normal
}
