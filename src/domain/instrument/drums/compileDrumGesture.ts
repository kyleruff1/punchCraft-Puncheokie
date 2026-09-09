/**
 * The one place a punch becomes a drum gesture (drum-kit-design §2).
 *
 * The architectural rule, verbatim: PunchBridge, Studio One, Superior
 * Drummer, the tablet visualizer and the workout runner "may perform the
 * compiled gesture, but they must not reinterpret what the punch means."
 * Everything downstream is a RESOLVER — it turns a logical articulation
 * into a note number or a rendered WAV — never a second opinion about which
 * drum a hook should strike.
 *
 * Identity discipline (§3): the full twelve-strike mapping applies only
 * when a guided score supplied the token. Without one this compiles the
 * Two-Piece Free Kit — audibly hand-specific, but making no claim about
 * technique, because the tracker's raw type byte has not been validated.
 *
 * Pure and deterministic: clock injected, no randomness, no note numbers.
 */
import type { StrikeToken } from '../gestureSchema'
import {
  physicalHandOf,
  strikeSignatureKeyOf,
  type StrikeIdentity,
  type PhysicalHand,
} from '../strikeArticulationCatalog'
import {
  accentBandFor,
  drumGateMs,
  laneForArticulation,
  velocityForLane,
  type AccentBand,
  type VelocityLane,
} from './drumVelocity'
import {
  drumEnergyAt,
  noteDrumPunch,
  type DrumEnergyState,
  type DrumFamilyEnergy,
} from './drumFamilyEnergy'
import {
  DRUM_GROUP_OF,
  type DrumGroup,
  type LogicalDrumArticulation,
} from './logicalDrumArticulations'
import {
  drumFamilyOf,
  pieceForBand,
  strikeDrumSignatureOf,
  type ArpMutation,
  type DrumFamily,
  type GrooveRole,
  type TimingPolicy,
} from './strikeDrumSignatures'

/** §17's priority ladder, as an orderable number. */
export type DrumHitPriority = 'direct' | 'generated' | 'ghost'

export const DRUM_PRIORITY: Readonly<Record<DrumHitPriority, number>> = {
  direct: 3, // a punch the boxer actually threw
  generated: 2, // the groove layer's own kick/hat
  ghost: 1, // decoration
}

export interface DrumHit {
  articulation: LogicalDrumArticulation
  midiVelocity: number
  /** Which §9 range produced `midiVelocity` — kept for diagnostics. */
  lane: VelocityLane
  /** Trigger width only; the sample supplies the tail (§9). */
  gateMs: number
  priority: DrumHitPriority
  role: 'primary' | 'layer'
  group: DrumGroup
}

export interface GrooveIntent {
  role: GrooveRole
  /** The five §14 lanes as of this punch — the bar boundary reads these. */
  energy: DrumFamilyEnergy
}

export interface FillIntent {
  eligible: boolean
  /** §16: "Maximum fill length: 8 subdivisions." */
  maxSubdivisions: number
}

export interface DrumVisualResponse {
  /** −1 left … +1 right. */
  side: number
  group: DrumGroup
  /** 0..1 — drives §5.2's "lower-screen compression" on body shots. */
  weight: number
  /** Body shots read low on the screen. */
  low: boolean
}

/** §2's compiled output. */
export interface CompiledDrumGesture {
  schemaVersion: 1
  eventId: string
  identitySource: StrikeIdentity['source']
  token?: StrikeToken
  /** null when identity is too weak to name a family (§3). */
  family: DrumFamily | null
  target: 'head' | 'body'
  accentBand: AccentBand
  hits: readonly DrumHit[]
  /** null in Free Kit — a generic punch may not steer the arpeggiator. */
  arpMutation: ArpMutation | null
  grooveIntent: GrooveIntent
  fillIntent: FillIntent
  timingPolicy: TimingPolicy
  visual: DrumVisualResponse
}

/**
 * §3's Two-Piece Free Kit. Configurable by design; these defaults are a
 * genuine two-piece — a snare and a floor tom — chosen because they are
 * unmistakably different by ear while claiming nothing about technique.
 */
export const FREE_KIT_DEFAULT: Readonly<Record<PhysicalHand, LogicalDrumArticulation>> = {
  'physical-left': 'snare-center',
  'physical-right': 'floor-tom-low',
}

export interface CompileDrumGestureInput {
  eventId: string
  identity: StrikeIdentity
  hand: 'left' | 'right'
  /** Impact intensity → MIDI velocity (§8). */
  acceleration01: number
  /** Accent selection and expression strength (§8). */
  velocity01: number
  nowMs: number
  energy: DrumEnergyState
  /** A new session velocity peak — the §4 crash trigger. */
  isNewPeak?: boolean
  /** Closing strike of a completed phrase — the other §4 crash trigger. */
  isPhraseEnding?: boolean
  /** Overrides for the Free Kit's two pieces (§3). */
  freeKit?: Readonly<Record<PhysicalHand, LogicalDrumArticulation>>
  /** §11: soft grid is the default; the Free Kit prefers immediate. */
  timingPolicy?: TimingPolicy
}

export interface CompileDrumGestureResult {
  gesture: CompiledDrumGesture
  /** Energy advanced by this punch — thread it into the next call. */
  energy: DrumEnergyState
}

function makeHit(
  articulation: LogicalDrumArticulation,
  acceleration01: number,
  velocity01: number,
  role: 'primary' | 'layer',
  multiplier = 1,
): DrumHit {
  const lane = laneForArticulation(articulation)
  const raw = velocityForLane(lane, acceleration01) * multiplier
  return {
    articulation,
    midiVelocity: Math.max(1, Math.min(127, Math.round(raw))),
    lane,
    gateMs: drumGateMs(velocity01),
    // Everything this compiler emits came from a real punch; the groove
    // layer's own hits enter the queue as 'generated' from elsewhere.
    priority: 'direct',
    role,
    group: DRUM_GROUP_OF[articulation],
  }
}

/**
 * Compile one punch. Returns the gesture and the advanced energy state —
 * the caller threads energy forward exactly as it threads session state
 * through `compileGesture`.
 */
export function compileDrumGesture(input: CompileDrumGestureInput): CompileDrumGestureResult {
  const band = accentBandFor(input.velocity01)
  const physicalHand = physicalHandOf(input.hand)
  const token = input.identity.token

  // ---- Free Kit: hand only, no family claim (§3). --------------------------
  if (input.identity.source !== 'guided-score' || token === undefined) {
    const kit = input.freeKit ?? FREE_KIT_DEFAULT
    const piece = kit[physicalHand]
    // Deliberately NOT advanced: crediting any of the five §14 lanes would
    // be a technique claim, and the body lane a target claim. A generic
    // punch drives the groove through punch RATE instead (§3), which the
    // arrangement rail already tracks.
    const energy = input.energy
    return {
      gesture: {
        schemaVersion: 1,
        eventId: input.eventId,
        identitySource: input.identity.source,
        family: null,
        target: 'head',
        accentBand: band,
        hits: [makeHit(piece, input.acceleration01, input.velocity01, 'primary')],
        arpMutation: null,
        grooveIntent: { role: 'timekeeper', energy: drumEnergyAt(input.energy, input.nowMs) },
        fillIntent: { eligible: false, maxSubdivisions: 0 },
        timingPolicy: input.timingPolicy ?? 'immediate',
        visual: {
          side: physicalHand === 'physical-left' ? -0.6 : 0.6,
          group: DRUM_GROUP_OF[piece],
          weight: Math.max(0, Math.min(1, input.velocity01)),
          low: false,
        },
      },
      energy,
    }
  }

  // ---- Guided: the full twelve-strike mapping (§5.1). ----------------------
  const key = strikeSignatureKeyOf(token)
  const signature = strikeDrumSignatureOf(token)
  const family = drumFamilyOf(key)
  const isBody = key.target === 'body'

  const hits: DrumHit[] = [
    makeHit(pieceForBand(signature, band), input.acceleration01, input.velocity01, 'primary'),
  ]

  for (const layer of signature.layers) {
    const applies =
      layer.condition === 'always' ||
      (layer.condition === 'body' && isBody) ||
      (layer.condition === 'high-velocity' && band !== 'normal') ||
      (layer.condition === 'new-peak' && input.isNewPeak === true) ||
      (layer.condition === 'phrase-ending' && input.isPhraseEnding === true)
    if (!applies) continue
    // The crash may be requested twice on a rear uppercut (peak AND phrase
    // ending). It is one cymbal — emit it once and let the stronger
    // multiplier win; the two-bar cooldown still gates it downstream (§4).
    const existing = hits.findIndex((hit) => hit.articulation === layer.articulation)
    const hit = makeHit(
      layer.articulation,
      input.acceleration01,
      input.velocity01,
      'layer',
      layer.velocityMultiplier,
    )
    if (existing >= 0) {
      const previous = hits[existing] as DrumHit
      if (hit.midiVelocity > previous.midiVelocity) hits[existing] = hit
      continue
    }
    hits.push(hit)
  }

  const energy = noteDrumPunch(input.energy, {
    family,
    target: key.target,
    velocity01: input.velocity01,
    nowMs: input.nowMs,
  })
  const energyNow = drumEnergyAt(energy, input.nowMs)

  return {
    gesture: {
      schemaVersion: 1,
      eventId: input.eventId,
      identitySource: input.identity.source,
      token,
      family,
      target: key.target,
      accentBand: band,
      hits,
      arpMutation: signature.arpMutation,
      grooveIntent: { role: signature.grooveRole, energy: energyNow },
      fillIntent: {
        // §16: an uppercut-dominant phrase may schedule ONE generated tom
        // fill at the next boundary. Eligibility is claimed here; the
        // one-per-bar limit belongs to the queue.
        eligible: family === 'uppercut' && energyNow.uppercut >= 0.45,
        maxSubdivisions: 8,
      },
      timingPolicy: input.timingPolicy ?? signature.timingPolicy,
      visual: {
        side: key.hand === 'physical-left' ? -0.6 : 0.6,
        group: DRUM_GROUP_OF[hits[0]?.articulation ?? 'snare-center'],
        weight: Math.max(0, Math.min(1, input.velocity01)),
        low: isBody, // §5.2 "lower-screen compression"
      },
    },
    energy,
  }
}
