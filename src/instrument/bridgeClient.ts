/**
 * Tablet-side WebSocket client for PunchBridge (instrument-design §11).
 * Sends the semantic messages (hello / heartbeat / test-note / panic /
 * punch-gesture), tracks per-message ack round-trip, and reconnects. Uses
 * RN's global WebSocket — no dependency.
 *
 * The client owns NOTHING musical: it is a transport. It never fabricates
 * gestures; callers hand it compiled ones (P4). For P2 it carries test
 * notes and panic so the bench can prove the wire before the compiler
 * exists.
 */
import {
  HARMONIC_FIELD_REQUIRED_CAPABILITIES,
  HARMONIC_SCHEMA_VERSION,
  INSTRUMENT_SCHEMA_VERSION,
  type CompiledPunchGesture,
  type PunchBridgeAck,
  type VoiceId,
  type WireSchemaVersion,
} from '@domain/instrument/gestureSchema'

export type BridgeStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface BridgeClientCallbacks {
  onStatus?: (status: BridgeStatus, detail?: string) => void
  /** Round-trip millis for an acked message (send → ack receive). */
  onRtt?: (rttMs: number, ack: PunchBridgeAck) => void
}

/**
 * The active patch's wire identity. Presence of `compiledFieldHash`
 * upgrades the session to wire v2 (harmonic-field protocol, am. 8) — the
 * hello then carries the identity block + clock contract and gestures are
 * HELD until the bridge's accept echoes the active effectivePatchHash.
 */
export interface PatchIdentity {
  mapHash: string
  worldManifestHash?: string
  compiledFieldHash?: string
  effectivePatchHash?: string
  patchGeneration?: number
}

const HEARTBEAT_MS = 1000
const RECONNECT_MS = 2000
/** Placeholder until the manifest lands (P3); both ends just need to agree. */
export const DEV_MAP_HASH = 'dev00000'

export class BridgeClient {
  private ws: WebSocket | null = null
  private url = ''
  private sessionId = ''
  private identity: PatchIdentity = { mapHash: DEV_MAP_HASH }
  /** Tablet-owned transport epoch (execution-backends clock contract). */
  private transportGeneration = 0
  /** V2 only: true after an accept echoing the ACTIVE effectivePatchHash. */
  private negotiated = false
  private sequence = 0
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private wantOpen = false
  private readonly sentAt = new Map<number, number>()

  constructor(private readonly cb: BridgeClientCallbacks = {}) {}

  connect(
    url: string,
    sessionId: string,
    mapHash: string = DEV_MAP_HASH,
    identity: Omit<PatchIdentity, 'mapHash'> = {},
  ): void {
    this.url = url
    this.sessionId = sessionId
    this.identity = { mapHash, ...identity }
    this.transportGeneration += 1
    this.negotiated = false
    this.wantOpen = true
    this.openSocket()
  }

  /**
   * A patch change produces a new identity; the bridge accepts the latest
   * hello's identity, so re-hello keeps the session validated (Next-Punch
   * patch-change semantics — no reconnect, no note interruption). On a v2
   * identity the negotiation gate re-arms until the new accept echoes.
   */
  setPatchIdentity(identity: PatchIdentity): void {
    const current = this.identity
    if (
      current.mapHash === identity.mapHash &&
      current.worldManifestHash === identity.worldManifestHash &&
      current.compiledFieldHash === identity.compiledFieldHash &&
      current.effectivePatchHash === identity.effectivePatchHash &&
      current.patchGeneration === identity.patchGeneration
    ) {
      return
    }
    this.identity = { ...identity }
    this.negotiated = false
    if (this.isOpen()) {
      this.sendHello()
    }
  }

  /** V1 convenience (today's jam callers) — hash-only identity. */
  setMapHash(mapHash: string): void {
    this.setPatchIdentity({ mapHash })
  }

  disconnect(): void {
    this.wantOpen = false
    this.negotiated = false
    this.clearTimers()
    if (this.ws) {
      try {
        // Best-effort release before dropping the socket.
        this.sendPanic()
        this.ws.close()
      } catch {
        /* already closing */
      }
      this.ws = null
    }
    this.cb.onStatus?.('idle')
  }

  isOpen(): boolean {
    return this.ws?.readyState === 1
  }

  sendTestNote(voiceId: VoiceId): void {
    this.sendControl('test-note', voiceId)
  }

  sendPanic(): void {
    this.sendControl('panic')
  }

  sendGesture(gesture: CompiledPunchGesture): void {
    if (!this.isOpen()) return
    // The v2 gate (am. 8): field gestures are HELD until the bridge's
    // accept echoed the active patch identity — never a silent legacy
    // fallback, never notes under an unvalidated session.
    if (gesture.schemaVersion === HARMONIC_SCHEMA_VERSION && !this.negotiated) return
    const sequence = this.nextSeq()
    const now = this.nowMs()
    this.sentAt.set(sequence, now)
    this.raw({
      type: 'punch-gesture',
      schemaVersion: gesture.schemaVersion,
      sessionId: this.sessionId,
      sequence,
      mapHash: gesture.mapHash,
      sentAtMonotonicMs: now,
      gesture,
    })
  }

  private sendControl(type: 'test-note' | 'panic', voiceId?: VoiceId): void {
    if (!this.isOpen()) return
    const sequence = this.nextSeq()
    const now = this.nowMs()
    this.sentAt.set(sequence, now)
    this.raw({
      type,
      schemaVersion: this.wireVersion(),
      sessionId: this.sessionId,
      sequence,
      sentAtMonotonicMs: now,
      ...(voiceId ? { voiceId } : {}),
    })
  }

  private wireVersion(): WireSchemaVersion {
    return this.identity.compiledFieldHash !== undefined
      ? HARMONIC_SCHEMA_VERSION
      : INSTRUMENT_SCHEMA_VERSION
  }

  /** Compose the hello for the current identity (v1 shape byte-identical). */
  private sendHello(): void {
    const version = this.wireVersion()
    if (version === HARMONIC_SCHEMA_VERSION) {
      this.raw({
        type: 'hello',
        schemaVersion: HARMONIC_SCHEMA_VERSION,
        sessionId: this.sessionId,
        mapHash: this.identity.mapHash,
        requiredCapabilities: HARMONIC_FIELD_REQUIRED_CAPABILITIES,
        ...(this.identity.worldManifestHash !== undefined
          ? { worldManifestHash: this.identity.worldManifestHash }
          : {}),
        compiledFieldHash: this.identity.compiledFieldHash,
        effectivePatchHash: this.identity.effectivePatchHash ?? this.identity.mapHash,
        patchGeneration: this.identity.patchGeneration ?? 0,
        transportGeneration: this.transportGeneration,
        clock: {
          authority: 'punchbridge',
          beatsPerMinute: 60,
          ticksPerBeat: 960,
          transportEpochId: `${this.sessionId}#${this.transportGeneration}`,
        },
        heartbeatMs: HEARTBEAT_MS,
      })
      return
    }
    this.raw({
      type: 'hello',
      schemaVersion: INSTRUMENT_SCHEMA_VERSION,
      sessionId: this.sessionId,
      mapHash: this.identity.mapHash,
      heartbeatMs: HEARTBEAT_MS,
    })
  }

  private openSocket(): void {
    this.cb.onStatus?.('connecting', this.url)
    let ws: WebSocket
    try {
      ws = new WebSocket(this.url)
    } catch (err) {
      this.cb.onStatus?.('error', String(err))
      this.scheduleReconnect()
      return
    }
    this.ws = ws

    ws.onopen = () => {
      this.cb.onStatus?.('open', this.url)
      this.sendHello()
      this.startHeartbeat()
    }
    ws.onmessage = (ev: WebSocketMessageEvent) => {
      this.onAck(ev.data)
    }
    ws.onerror = () => {
      this.cb.onStatus?.('error', this.url)
    }
    ws.onclose = () => {
      this.stopHeartbeat()
      this.ws = null
      this.negotiated = false // reconnect re-hellos and re-negotiates
      this.cb.onStatus?.('closed', this.url)
      if (this.wantOpen) this.scheduleReconnect()
    }
  }

  private onAck(data: unknown): void {
    if (typeof data !== 'string') return
    let ack: PunchBridgeAck
    try {
      ack = JSON.parse(data) as PunchBridgeAck
    } catch {
      return
    }
    // V2 negotiation (am. 8): the accept must echo the ACTIVE patch
    // identity — a stale accept (from a superseded hello) arms nothing.
    if (ack.type === 'hello-ack' && this.wireVersion() === HARMONIC_SCHEMA_VERSION) {
      const expected = this.identity.effectivePatchHash ?? this.identity.mapHash
      if (ack.accepted === true && ack.effectivePatchHash === expected) {
        this.negotiated = true
        this.cb.onStatus?.('open', 'negotiated')
      } else {
        this.negotiated = false
        this.cb.onStatus?.(
          'error',
          `bridge rejected hello: ${ack.rejected ?? 'patch identity mismatch'}`,
        )
      }
    }
    const sentAt = this.sentAt.get(ack.sequence)
    if (sentAt !== undefined) {
      this.sentAt.delete(ack.sequence)
      this.cb.onRtt?.(Math.max(0, this.nowMs() - sentAt), ack)
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      if (!this.isOpen()) return
      this.raw({
        type: 'heartbeat',
        schemaVersion: INSTRUMENT_SCHEMA_VERSION,
        sessionId: this.sessionId,
        sentAtMonotonicMs: this.nowMs(),
      })
    }, HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat)
      this.heartbeat = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.wantOpen) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.wantOpen) this.openSocket()
    }, RECONNECT_MS)
  }

  private clearTimers(): void {
    this.stopHeartbeat()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private raw(message: object): void {
    try {
      this.ws?.send(JSON.stringify(message))
    } catch {
      /* socket raced closed; reconnect logic will recover */
    }
  }

  private nextSeq(): number {
    this.sequence += 1
    return this.sequence
  }

  private nowMs(): number {
    return globalThis.performance.now()
  }
}
