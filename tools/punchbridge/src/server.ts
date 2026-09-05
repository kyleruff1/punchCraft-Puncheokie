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
  INSTRUMENT_SCHEMA_VERSION,
  type PunchBridgeAck,
  type PunchBridgeMessage,
} from '../../../src/domain/instrument/gestureSchema'
import type { MidiOutputBackend } from './midiBackend'
import type { InstrumentProfile } from './instrumentProfiles'
import { VoiceRenderer } from './gestureToMidi'

export interface BridgeClock {
  /** Monotone-ish PC clock in ms for ack stamping + watchdog. */
  now(): number
}

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

  constructor(
    private readonly socket: BridgeSocketLike,
    opts: BridgeSessionOptions,
  ) {
    this.renderer = new VoiceRenderer(opts.midi, opts.profile ?? 'studio-one-stock')
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

  private handle(message: PunchBridgeMessage): void {
    if (message.schemaVersion !== INSTRUMENT_SCHEMA_VERSION) {
      this.reject(message, `schema ${String(message.schemaVersion)} != ${INSTRUMENT_SCHEMA_VERSION}`)
      return
    }

    switch (message.type) {
      case 'hello': {
        this.helloMapHash = message.mapHash
        this.sessionId = message.sessionId
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
        if (this.helloMapHash !== null && message.mapHash !== this.helloMapHash) {
          this.reject(message, `mapHash ${message.mapHash} != session ${this.helloMapHash}`)
          return
        }
        const at = this.clock.now()
        this.renderer.renderGesture(message.gesture)
        this.ackGesture(message.sessionId, message.sequence, at)
        return
      }
      default: {
        // Exhaustiveness guard — an unknown type is a protocol error.
        this.log(`punchbridge: unknown message type ${String((message as { type: string }).type)}`)
      }
    }
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
