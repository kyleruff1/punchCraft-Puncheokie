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
  INSTRUMENT_SCHEMA_VERSION,
  type CompiledPunchGesture,
  type PunchBridgeAck,
  type VoiceId,
} from '@domain/instrument/gestureSchema'

export type BridgeStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'

export interface BridgeClientCallbacks {
  onStatus?: (status: BridgeStatus, detail?: string) => void
  /** Round-trip millis for an acked message (send → ack receive). */
  onRtt?: (rttMs: number, ack: PunchBridgeAck) => void
}

const HEARTBEAT_MS = 1000
const RECONNECT_MS = 2000
/** Placeholder until the manifest lands (P3); both ends just need to agree. */
export const DEV_MAP_HASH = 'dev00000'

export class BridgeClient {
  private ws: WebSocket | null = null
  private url = ''
  private sessionId = ''
  private mapHash = DEV_MAP_HASH
  private sequence = 0
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private wantOpen = false
  private readonly sentAt = new Map<number, number>()

  constructor(private readonly cb: BridgeClientCallbacks = {}) {}

  connect(url: string, sessionId: string, mapHash: string = DEV_MAP_HASH): void {
    this.url = url
    this.sessionId = sessionId
    this.mapHash = mapHash
    this.wantOpen = true
    this.openSocket()
  }

  /**
   * A patch change produces a new hash; the bridge accepts the latest
   * hello's hash, so re-hello keeps the session validated (Next-Punch
   * patch-change semantics — no reconnect, no note interruption).
   */
  setMapHash(mapHash: string): void {
    if (this.mapHash === mapHash) return
    this.mapHash = mapHash
    if (this.isOpen()) {
      this.raw({
        type: 'hello',
        schemaVersion: INSTRUMENT_SCHEMA_VERSION,
        sessionId: this.sessionId,
        mapHash,
        heartbeatMs: HEARTBEAT_MS,
      })
    }
  }

  disconnect(): void {
    this.wantOpen = false
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
    const sequence = this.nextSeq()
    const now = this.nowMs()
    this.sentAt.set(sequence, now)
    this.raw({
      type: 'punch-gesture',
      schemaVersion: INSTRUMENT_SCHEMA_VERSION,
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
      schemaVersion: INSTRUMENT_SCHEMA_VERSION,
      sessionId: this.sessionId,
      sequence,
      sentAtMonotonicMs: now,
      ...(voiceId ? { voiceId } : {}),
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
      this.raw({
        type: 'hello',
        schemaVersion: INSTRUMENT_SCHEMA_VERSION,
        sessionId: this.sessionId,
        mapHash: this.mapHash,
        heartbeatMs: HEARTBEAT_MS,
      })
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
