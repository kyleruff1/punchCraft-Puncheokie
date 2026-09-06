/**
 * PunchBridge WebSocket server (instrument-design §11). Accepts one tablet
 * connection, validates schema + mapHash, renders gestures/test-notes to
 * MIDI, acknowledges every message, and guarantees no stuck notes: a
 * heartbeat watchdog, a socket close, and an explicit panic all release
 * every voice (§23).
 *
 * Framework-free by design so it can be driven directly in a test with a
 * fake socket — `handleMessage` is pure of the transport.
 */
import {
  HARMONIC_FIELD_REQUIRED_CAPABILITIES,
  HARMONIC_SCHEMA_VERSION,
  INSTRUMENT_SCHEMA_VERSION,
  type PunchBridgeAck,
  type PunchBridgeMessage,
  type PunchHelloMessage,
} from '../../../src/domain/instrument/gestureSchema'
import type { MidiOutputBackend } from './midiBackend'
import type { InstrumentProfile } from './instrumentProfiles'
import { VoiceRenderer, type RampScheduler } from './gestureToMidi'

export interface BridgeClock {
  /** Monotone-ish PC clock in ms for ack stamping + watchdog. */
  now(): number
}

/**
 * What THIS bridge build supports (second-pass am. 8). A v2 hello whose
 * requiredCapabilities are not a subset is REJECTED with the missing list
 * — silent legacy fallback is forbidden by design.
 */
export const BRIDGE_CAPABILITIES: readonly string[] = HARMONIC_FIELD_REQUIRED_CAPABILITIES

/** The only clock authority this release (execution-backends design). */
export const BRIDGE_CLOCK_AUTHORITY = 'punchbridge'

export interface BridgeSocketLike {
  send(data: string): void
  close(): void
}

export interface BridgeSessionOptions {
  midi: MidiOutputBackend
  clock: BridgeClock
  /** Watchdog fires if no message arrives within this window; 0 disables. */
  watchdogMs?: number
  /** Which synth's CC/bend conventions to render with. */
  profile?: InstrumentProfile | string
  /**
   * Timing seam for the renderer's ramps + the brass tick engine; tests
   * pass a fake so the whole session is clock-driven deterministically.
   */
  scheduler?: RampScheduler
  log?: (msg: string) => void
}

/**
 * One tablet connection's state machine. The transport owns the socket and
 * feeds raw text in; this class owns the MIDI + protocol semantics.
 */
export class BridgeSession {
  private readonly renderer: VoiceRenderer
  private readonly clock: BridgeClock
  private readonly watchdogMs: number
  private readonly log: (msg: string) => void
  private helloMapHash: string | null = null
  private sessionId: string | null = null
  private lastSeenAt: number
  private closed = false
  /**
   * Retransmit guard (R5): a duplicated punch-gesture frame is acked but
   * never re-rendered — an accent/whammy punch must not re-fire.
   */
  private lastGestureEventId: string | null = null
  /** V2 negotiation state (am. 8): gestures gate on an ACCEPTED v2 hello. */
  private acceptedV2Hello = false
  private rejectedHelloReason: string | null = null

  constructor(
    private readonly socket: BridgeSocketLike,
    opts: BridgeSessionOptions,
  ) {
    this.renderer = new VoiceRenderer(
      opts.midi,
      opts.profile ?? 'studio-one-stock',
      opts.scheduler,
      opts.clock,
    )
    this.clock = opts.clock
    this.watchdogMs = opts.watchdogMs ?? 0
    this.log = opts.log ?? (() => {})
    this.lastSeenAt = this.clock.now()
  }

  /** Feed one raw text frame from the socket. */
  onText(raw: string): void {
    if (this.closed) return
    this.lastSeenAt = this.clock.now()
    let message: PunchBridgeMessage
    try {
      message = JSON.parse(raw) as PunchBridgeMessage
    } catch {
      this.log('punchbridge: dropped non-JSON frame')
      return
    }
    this.handle(message)
  }

  /** Called by the transport when the socket closes for any reason. */
  onClose(): void {
    if (this.closed) return
    this.closed = true
    this.renderer.panic()
    this.log('punchbridge: socket closed → panic (all notes off)')
  }

  /**
   * Called on a timer by the transport. Releases notes and closes the
   * socket if the tablet has gone silent past the watchdog window.
   */
  checkWatchdog(): void {
    if (this.closed || this.watchdogMs <= 0) return
    if (this.clock.now() - this.lastSeenAt > this.watchdogMs) {
      this.log('punchbridge: heartbeat lost → panic + close')
      this.renderer.panic()
      this.closed = true
      this.socket.close()
    }
  }

  activeVoices(): number {
    return this.renderer.activeCount()
  }

  /** Brass engine latency/robustness counters (am. 14); null while idle. */
  telemetry(): ReturnType<VoiceRenderer['brassTelemetry']> {
    return this.renderer.brassTelemetry()
  }

  private handle(message: PunchBridgeMessage): void {
    // The schemaVersion IS the protocol version (am. 8): anything outside
    // the supported set is rejected outright — which is exactly why an
    // OLD bridge fails closed against a v2 tablet instead of silently
    // playing legacy.
    if (
      message.schemaVersion !== INSTRUMENT_SCHEMA_VERSION &&
      message.schemaVersion !== HARMONIC_SCHEMA_VERSION
    ) {
      this.reject(message, `schema ${String(message.schemaVersion)} != ${INSTRUMENT_SCHEMA_VERSION}|${HARMONIC_SCHEMA_VERSION}`)
      return
    }

    switch (message.type) {
      case 'hello': {
        if (message.schemaVersion === HARMONIC_SCHEMA_VERSION) {
          this.handleV2Hello(message)
          return
        }
        // v1 hello — the pre-field path, byte-identical on the wire.
        this.acceptedV2Hello = false
        this.helloMapHash = message.mapHash
        this.sessionId = message.sessionId
        // Prime GM destinations with the profile's voice program (the
        // thick-saw default) before any note sounds.
        this.renderer.prepareVoices()
        this.ackHello(message.sessionId, message.mapHash)
        return
      }
      case 'heartbeat': {
        // Timestamp already refreshed in onText; nothing else to do.
        return
      }
      case 'test-note': {
        const at = this.clock.now()
        this.renderer.testNote(message.voiceId ?? 'left')
        this.ackControl(message.sessionId, message.sequence, at)
        return
      }
      case 'panic': {
        const at = this.clock.now()
        this.renderer.panic()
        this.ackControl(message.sessionId, message.sequence, at)
        return
      }
      case 'punch-gesture': {
        // V2 gestures flow ONLY after an accepted v2 hello — a rejected
        // handshake must never degrade into silent legacy playback.
        if (message.schemaVersion === HARMONIC_SCHEMA_VERSION && !this.acceptedV2Hello) {
          this.reject(
            message,
            this.rejectedHelloReason
              ? `hello rejected: ${this.rejectedHelloReason}`
              : 'v2 gesture before an accepted v2 hello',
          )
          return
        }
        if (this.helloMapHash !== null && message.mapHash !== this.helloMapHash) {
          this.reject(message, `mapHash ${message.mapHash} != session ${this.helloMapHash}`)
          return
        }
        const at = this.clock.now()
        if (message.gesture.eventId === this.lastGestureEventId) {
          // Retransmitted frame: acknowledge so the tablet stops resending,
          // but render nothing — no second accent, whammy, or stage.
          this.ackGesture(message.sessionId, message.sequence, at)
          return
        }
        this.renderer.renderGesture(message.gesture)
        this.lastGestureEventId = message.gesture.eventId
        this.ackGesture(message.sessionId, message.sequence, at)
        return
      }
      default: {
        // Exhaustiveness guard — an unknown type is a protocol error.
        this.log(`punchbridge: unknown message type ${String((message as { type: string }).type)}`)
      }
    }
  }

  /**
   * V2 hello (am. 8 + the execution-backends clock contract): validate
   * capabilities ⊆ BRIDGE_CAPABILITIES, the identity hashes, and the
   * clock authority; answer with an echoing accept or an explicit
   * rejection. The tablet holds v2 gestures until the accept echoes its
   * ACTIVE effectivePatchHash.
   */
  private handleV2Hello(message: PunchHelloMessage): void {
    const failure = this.validateV2Hello(message)
    const at = this.clock.now()
    if (failure) {
      this.acceptedV2Hello = false
      this.rejectedHelloReason = failure.reason
      this.log(`punchbridge: REJECTED v2 hello — ${failure.reason}`)
      this.emit({
        type: 'hello-ack',
        sessionId: message.sessionId,
        sequence: 0,
        receivedAtPcMs: at,
        midiDispatchedAtPcMs: at,
        midiReady: true,
        accepted: false,
        supportedCapabilities: BRIDGE_CAPABILITIES,
        missingCapabilities: failure.missing,
        rejected: failure.reason,
      })
      return
    }
    this.acceptedV2Hello = true
    this.rejectedHelloReason = null
    this.helloMapHash = message.mapHash
    this.sessionId = message.sessionId
    this.renderer.prepareVoices()
    this.emit({
      type: 'hello-ack',
      sessionId: message.sessionId,
      sequence: 0,
      receivedAtPcMs: at,
      midiDispatchedAtPcMs: at,
      midiReady: true,
      accepted: true,
      supportedCapabilities: BRIDGE_CAPABILITIES,
      missingCapabilities: [],
      compiledFieldHash: message.compiledFieldHash ?? '',
      effectivePatchHash: message.effectivePatchHash ?? message.mapHash,
      patchGeneration: message.patchGeneration ?? 0,
    })
  }

  private validateV2Hello(
    message: PunchHelloMessage,
  ): { reason: string; missing: readonly string[] } | null {
    const required = message.requiredCapabilities
    if (!Array.isArray(required) || required.length === 0) {
      return { reason: 'v2 hello missing requiredCapabilities', missing: [] }
    }
    const missing = required.filter((c) => !BRIDGE_CAPABILITIES.includes(c))
    if (missing.length > 0) {
      return { reason: `unsupported capabilities: ${missing.join(', ')}`, missing }
    }
    if (
      typeof message.compiledFieldHash !== 'string' ||
      typeof message.effectivePatchHash !== 'string'
    ) {
      return { reason: 'v2 hello missing field identity hashes', missing: [] }
    }
    const clock = message.clock
    if (!clock) {
      return { reason: 'v2 hello missing clock contract', missing: [] }
    }
    if (clock.authority !== BRIDGE_CLOCK_AUTHORITY) {
      return {
        reason: `clock authority ${String(clock.authority)} unsupported (${BRIDGE_CLOCK_AUTHORITY} only this release)`,
        missing: [],
      }
    }
    if (clock.ticksPerBeat !== 960) {
      return { reason: `ticksPerBeat ${String(clock.ticksPerBeat)} != 960`, missing: [] }
    }
    return null
  }

  private ackHello(sessionId: string, _mapHash: string): void {
    const at = this.clock.now()
    this.emit({
      type: 'hello-ack',
      sessionId,
      sequence: 0,
      receivedAtPcMs: at,
      midiDispatchedAtPcMs: at,
      midiReady: true,
    })
  }

  private ackControl(sessionId: string, sequence: number, receivedAt: number): void {
    this.emit({
      type: 'control-ack',
      sessionId,
      sequence,
      receivedAtPcMs: receivedAt,
      midiDispatchedAtPcMs: this.clock.now(),
    })
  }

  private ackGesture(sessionId: string, sequence: number, receivedAt: number): void {
    this.emit({
      type: 'gesture-ack',
      sessionId,
      sequence,
      receivedAtPcMs: receivedAt,
      midiDispatchedAtPcMs: this.clock.now(),
    })
  }

  private reject(message: PunchBridgeMessage, reason: string): void {
    this.log(`punchbridge: rejected ${message.type} — ${reason}`)
    const sequence = 'sequence' in message ? message.sequence : 0
    const sessionId = 'sessionId' in message ? message.sessionId : (this.sessionId ?? 'unknown')
    const at = this.clock.now()
    this.emit({
      type: message.type === 'punch-gesture' ? 'gesture-ack' : 'control-ack',
      sessionId,
      sequence,
      receivedAtPcMs: at,
      midiDispatchedAtPcMs: at,
      rejected: reason,
    })
  }

  private emit(ack: PunchBridgeAck): void {
    if (this.closed) return
    try {
      this.socket.send(JSON.stringify(ack))
    } catch (err) {
      this.log(`punchbridge: ack send failed — ${String(err)}`)
    }
  }
}
