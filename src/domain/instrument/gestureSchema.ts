/**
 * The Puncheoke wire contract — the ONE semantic gesture the tablet compiles
 * and the PunchBridge desktop service renders to MIDI (instrument-design §3,
 * §11). Both ends import THIS file, so the schema can never drift: a
 * relative import reaches it from tools/punchbridge, an alias import from the
 * app.
 *
 * Pure types + pure helpers only — no RN / Expo / BLE / SQLite / node
 * imports, and no Date.now()/Math.random() (domain-purity test + cross-
 * runtime determinism). The mapHash is a dependency-free FNV-1a so the
 * tablet and the bridge compute byte-identical hashes without a crypto lib
 * on either side.
 */
import type { PunchHand } from '../punch/PunchEvent'

/** Bumped only when the wire shape changes incompatibly. */
export const INSTRUMENT_SCHEMA_VERSION = 1

/** The twelve canonical strike tokens (Guided mode; §1). */
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

export type VoiceId = 'left' | 'right'

export type TransitionKind = 'attack' | 'retrigger' | 'glide' | 'scoop' | 'sweep'

export type TransientLayer = 'straight' | 'hook' | 'uppercut' | 'generic'

export type VisualQuadrant = 'upper-left' | 'lower-left' | 'upper-right' | 'lower-right'

/**
 * Who performs the arpeggio pattern (brass-cube-design "Studio One
 * Arpeggiator versus PunchBridge arpeggiator"). The musical preset is
 * identical either way; only the final note sequencing moves.
 */
export type ArpeggiatorBackend = 'studio-one-note-fx' | 'punchbridge-tick'

/** How a committed punch meets the running pattern (brass-cube-design). */
export type RetriggerPolicy = 'quantized-rotate' | 'hard-retrigger' | 'continuous-morph'

/** Immediate per-punch brass stab (design "Immediate response"; R6). */
export interface ImmediateAccent {
  /** The staged cell's rotated entry tone — rotatedPool[0]. */
  midiNote: number
  /** 1..127, round(50 + 68·acceleration01) clamped (design: 50..118). */
  midiVelocity: number
  /** Doc-numbered channel; 4 at launch. */
  channel: number
  /** Gate before the accent note-off; 120 at launch. */
  gateMs: number
}

/** Staged harmonic state, committed by the bridge on the next step boundary. */
export interface QuantizedChange {
  cubeCellId: string // `L${leftZone}R${rightZone}`
  chordName: string
  bassMidiNote: number
  bassChannel: number // doc-numbered; 2
  /** The ROTATED six-note pool, ascending; [0] is the entry tone. */
  chordMidiNotes: readonly number[]
  arpStartIndex: number // right zone 0..5
  arpPattern: readonly number[]
  arpChannel: number // doc-numbered; 3
  notesPerMinute: 60 | 120 | 180 | 240
  gateRatio: number // 0..1 fraction of the step
  patternDepth: number // steps exposed; min'd with pattern length at emit
  activityLayer: 0 | 1 | 2 | 3 // brass bands, not the legacy cube Z
  /** Envelope punches/sec at this punch; the bridge decays it between gestures. */
  activityPps: number
  retrigger: RetriggerPolicy
  backend: ArpeggiatorBackend
}

/**
 * Peak-event pitch accent (transition-design §1 whammy rows, §4 "new
 * velocity peak"). Channel-wide: rides over the arp lane if stepping.
 */
export interface WhammyAccent {
  direction: 'rise' | 'dive' // launch fires only 'rise'
  semitones: number // 12 at launch; bridge clamps to bend range
  durationMs: number // 200..450
}

/**
 * What the compiler consumes — a live punch reduced to the trustworthy
 * fields (§3). `hand` is always resolved to left/right before compilation;
 * 'unknown' punches are dropped upstream.
 */
export interface MusicalPunchInput {
  eventId: string
  hand: Exclude<PunchHand, 'unknown'>
  trackerTimestampMs?: number
  receivedMonotonicTimeMs: number
  velocityRaw: number
  accelerationRaw?: number
  punchTypeRaw?: number
  recovered: boolean
  expectedStrikeToken?: StrikeToken
}

/**
 * The compiled gesture — the single object MIDI, cube, clouds, and haptics
 * all consume (§3). Every field is a plain number/string so it serializes to
 * JSON without loss.
 */
export interface CompiledPunchGesture {
  schemaVersion: typeof INSTRUMENT_SCHEMA_VERSION
  sessionId: string
  eventId: string
  mapHash: string
  source: {
    hand: VoiceId
    trackerTimestampMs?: number
    receivedMonotonicTimeMs: number
    velocity01: number
    acceleration01: number
    punchRate01: number
    gapSincePreviousPunchMs: number
    alternating: boolean
    expectedStrikeToken?: StrikeToken
  }
  cube: {
    leftZone: number
    rightZone: number
    activityLayer: number
    changedAxis: VoiceId
    targetCoordinate: [number, number, number]
  }
  voice: {
    voiceId: VoiceId
    midiChannel: number
    targetNote: number
    noteVelocity: number
    brightness: number
    expression: number
    transition: TransitionKind
    transitionDurationMs: number
    pitchOvershootCents: number
  }
  transient: {
    note: number
    velocity: number
    layer: TransientLayer
  }
  visual: {
    quadrant: VisualQuadrant
    hueDegrees: number
    opacity: number
    radius: number
    persistenceMs: number
    transitionRibbonMs: number
  }
  /**
   * Brass-cube blocks (R1: additive — all three absent on legacy-patch
   * gestures, so a latch stream serializes byte-identically to the
   * pre-brass wire). JSON key order is part of the determinism goldens:
   * these are appended AFTER `visual`.
   */
  accent?: ImmediateAccent
  quantized?: QuantizedChange
  whammy?: WhammyAccent
}

/** Tablet → bridge. */
export interface PunchGestureMessage {
  type: 'punch-gesture'
  schemaVersion: typeof INSTRUMENT_SCHEMA_VERSION
  sessionId: string
  sequence: number
  mapHash: string
  sentAtMonotonicMs: number
  gesture: CompiledPunchGesture
}

/**
 * Tablet → bridge, out of the gesture path: a direct test note (P2
 * deliverable) and the explicit panic/release. These need no compiled
 * gesture, so the bench can prove the wire before the compiler exists.
 */
export interface PunchControlMessage {
  type: 'test-note' | 'panic'
  schemaVersion: typeof INSTRUMENT_SCHEMA_VERSION
  sessionId: string
  sequence: number
  sentAtMonotonicMs: number
  /** For 'test-note': which voice channel to sound. */
  voiceId?: VoiceId
}

export interface PunchHelloMessage {
  type: 'hello'
  schemaVersion: typeof INSTRUMENT_SCHEMA_VERSION
  sessionId: string
  mapHash: string
  /** Millis between heartbeats the tablet promises; bridge watchdog uses it. */
  heartbeatMs: number
}

export interface PunchHeartbeatMessage {
  type: 'heartbeat'
  schemaVersion: typeof INSTRUMENT_SCHEMA_VERSION
  sessionId: string
  sentAtMonotonicMs: number
}

export type PunchBridgeMessage =
  | PunchHelloMessage
  | PunchHeartbeatMessage
  | PunchGestureMessage
  | PunchControlMessage

/** Bridge → tablet: per-message acknowledgment for latency/health. */
export interface PunchBridgeAck {
  type: 'gesture-ack' | 'hello-ack' | 'control-ack'
  sessionId: string
  sequence: number
  receivedAtPcMs: number
  midiDispatchedAtPcMs: number
  /** Present on 'hello-ack': whether the bridge has a live MIDI port. */
  midiReady?: boolean
  /** Present on any ack when the bridge rejects a message. */
  rejected?: string
}

// ---------------------------------------------------------------------------
// mapHash — dependency-free, deterministic across tablet and bridge.
// ---------------------------------------------------------------------------

/**
 * Canonical JSON: object keys sorted recursively, so two equivalent
 * manifests hash identically regardless of key order. Arrays keep order.
 * Rejects non-finite numbers (they would serialize as null and silently
 * collide). Pure — no dependency on JSON.stringify replacer ordering.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonicalize: non-finite number')
    return JSON.stringify(value)
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
  }
  // undefined / function / symbol are not serializable — omit deterministically.
  return 'null'
}

/** FNV-1a 32-bit over UTF-16 code units → 8-hex-char string. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    // hash *= 16777619, kept in 32-bit via Math.imul.
    hash = Math.imul(hash, 0x01000193)
  }
  // >>> 0 forces the unsigned 32-bit view before hex.
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Stable hash of any manifest-shaped value — the wire's `mapHash`. */
export function mapHashOf(manifest: unknown): string {
  return fnv1a(canonicalize(manifest))
}
