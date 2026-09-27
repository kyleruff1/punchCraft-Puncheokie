/**
 * MidiInMonitor — the "log and emit" half of the DAW → bridge hop.
 *
 * Decodes every inbound message from a MidiInputBackend, logs the ones a
 * human wants to see, keeps a tempo estimate from MIDI Clock, and fans
 * decoded events out to subscribers. It is the seam a real consumer
 * attaches to later (host-clock authority, #351) — nothing in the
 * harmonic engine reads it today.
 *
 * Logging discipline:
 *   - Channel messages (notes, CCs, bends…) are logged one per line, with
 *     a per-second cap so a dense CC ramp from the DAW cannot flood the
 *     console. When the cap trips, one line says so; when the next second
 *     starts, one line says how many were dropped.
 *   - Clock ticks are NEVER logged individually (24 per quarter note).
 *     Tempo is estimated from the span of the last 24 tick intervals
 *     (one quarter note). The first estimate after a start logs at once —
 *     the ring holds only post-start ticks, so it is exact. After that a
 *     new tempo must HOLD within TEMPO_LOG_DELTA_BPM for a full quarter
 *     before it logs: while a step change works its way through the ring
 *     the estimate moves every tick and never qualifies, so a change
 *     prints exactly one line, with the settled value, instead of a trail
 *     of in-between readings. The same hold keeps clock jitter quiet.
 *   - Transport start / continue / stop and Song Position always log.
 */
import { decodeMidiMessage, type MidiInEvent, type MidiInputBackend } from './midiInput'
import type { BridgeClock } from './server'

export type MidiInListener = (event: MidiInEvent, atMs: number) => void

export interface MidiInSnapshot {
  portName: string
  /** True between a start/continue and the next stop. */
  running: boolean
  /** Latest MIDI-Clock-derived tempo, or null before 24 ticks have arrived. */
  bpm: number | null
  channelMessages: number
  clockTicks: number
  lastEventAtMs: number | null
}

export interface MidiInMonitorOptions {
  /** Channel-message log lines allowed per second before suppression. */
  maxLinesPerSecond?: number
  log?: (msg: string) => void
}

/** MIDI Clock: 24 ticks per quarter note. */
export const CLOCKS_PER_QUARTER = 24
/** Tempo is re-logged only when it moves by more than this — and has held
 * within it for a quarter note. Wide enough that the jitter of a real
 * clock over a 24-tick span (a few tenths of a bpm) never chatters. */
export const TEMPO_LOG_DELTA_BPM = 1.0
export const DEFAULT_MAX_LINES_PER_SECOND = 40

const PREFIX = 'punchbridge: midi-in'

export class MidiInMonitor {
  private readonly backend: MidiInputBackend
  private readonly clock: BridgeClock
  private readonly log: (msg: string) => void
  private readonly maxLinesPerSecond: number
  private readonly listeners = new Set<MidiInListener>()
  private readonly unsubscribe: () => void
  private closed = false

  // Rate cap for channel-message lines.
  private windowStartMs = Number.NEGATIVE_INFINITY
  private linesThisWindow = 0
  private suppressedThisWindow = 0

  // Clock / transport.
  private readonly tickStamps: number[] = []
  private running = false
  private bpm: number | null = null
  private lastLoggedBpm: number | null = null
  /** The tempo currently being watched for a quarter-note hold. */
  private candidateBpm: number | null = null
  private candidateTicks = 0

  // Counters.
  private channelMessages = 0
  private clockTicks = 0
  private lastEventAtMs: number | null = null

  constructor(backend: MidiInputBackend, clock: BridgeClock, opts: MidiInMonitorOptions = {}) {
    this.backend = backend
    this.clock = clock
    this.log = opts.log ?? ((m: string) => console.log(m))
    this.maxLinesPerSecond = Math.max(1, opts.maxLinesPerSecond ?? DEFAULT_MAX_LINES_PER_SECOND)
    this.unsubscribe = backend.onMessage((bytes) => this.onBytes(bytes))
  }

  /** Hear every decoded event. Returns the unsubscribe. */
  subscribe(listener: MidiInListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  snapshot(): MidiInSnapshot {
    return {
      portName: this.backend.portName,
      running: this.running,
      bpm: this.bpm,
      channelMessages: this.channelMessages,
      clockTicks: this.clockTicks,
      lastEventAtMs: this.lastEventAtMs,
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.unsubscribe()
    this.flushSuppressed()
    this.listeners.clear()
    this.backend.close()
  }

  private onBytes(bytes: number[]): void {
    if (this.closed) return
    let event: MidiInEvent | null
    try {
      event = decodeMidiMessage(bytes)
    } catch (err) {
      // decodeMidiMessage never throws by contract; belt and braces so a
      // bad frame can never take the native callback down with it.
      this.log(`${PREFIX} decode failed — ${String(err)}`)
      return
    }
    if (!event) return
    const atMs = this.clock.now()
    this.lastEventAtMs = atMs
    this.track(event, atMs)
    for (const listener of this.listeners) {
      try {
        listener(event, atMs)
      } catch (err) {
        this.log(`${PREFIX} listener threw — ${String(err)}`)
      }
    }
  }

  private track(event: MidiInEvent, atMs: number): void {
    switch (event.kind) {
      case 'clock':
        this.onClock(atMs)
        return
      case 'start':
        this.running = true
        this.resetTempoWindow()
        this.log(`${PREFIX} ← transport start`)
        return
      case 'continue':
        this.running = true
        this.log(`${PREFIX} ← transport continue`)
        return
      case 'stop':
        this.running = false
        this.resetTempoWindow()
        this.log(`${PREFIX} ← transport stop`)
        return
      case 'songPosition':
        this.log(`${PREFIX} ← song position beat ${(event.beats16th / 4).toFixed(2)}`)
        return
      default:
        this.channelMessages += 1
        this.logChannel(describe(event), atMs)
    }
  }

  private resetTempoWindow(): void {
    this.tickStamps.length = 0
    this.bpm = null
    this.candidateBpm = null
    this.candidateTicks = 0
  }

  private onClock(atMs: number): void {
    this.clockTicks += 1
    this.tickStamps.push(atMs)
    if (this.tickStamps.length > CLOCKS_PER_QUARTER + 1) this.tickStamps.shift()
    if (this.tickStamps.length < CLOCKS_PER_QUARTER + 1) return
    const first = this.tickStamps[0]
    if (typeof first !== 'number') return
    const spanMs = atMs - first
    if (spanMs <= 0) return
    // 24 intervals in the ring = exactly one quarter note.
    const bpm = 60_000 / spanMs
    this.bpm = bpm

    if (this.lastLoggedBpm === null) {
      // First full ring since the monitor (or the transport) started: it
      // holds nothing but post-start ticks, so this reading is exact.
      this.logTempo(bpm)
      return
    }

    // A new tempo has to hold for a quarter note before it is worth a
    // line. Any reading more than the delta away from the one being
    // watched restarts the hold — which is precisely what happens on
    // every tick while a step change is still entering the ring.
    if (this.candidateBpm === null || Math.abs(bpm - this.candidateBpm) > TEMPO_LOG_DELTA_BPM) {
      this.candidateBpm = bpm
      this.candidateTicks = 0
    }
    this.candidateTicks += 1
    if (
      this.candidateTicks >= CLOCKS_PER_QUARTER &&
      Math.abs(this.candidateBpm - this.lastLoggedBpm) > TEMPO_LOG_DELTA_BPM
    ) {
      this.logTempo(bpm)
    }
  }

  private logTempo(bpm: number): void {
    this.lastLoggedBpm = bpm
    this.candidateBpm = bpm
    this.candidateTicks = 0
    this.log(`${PREFIX} ← tempo ${bpm.toFixed(1)} bpm`)
  }

  private logChannel(line: string, atMs: number): void {
    if (atMs - this.windowStartMs >= 1000) {
      this.flushSuppressed()
      this.windowStartMs = atMs
      this.linesThisWindow = 0
    }
    if (this.linesThisWindow < this.maxLinesPerSecond) {
      this.linesThisWindow += 1
      this.log(`${PREFIX} ← ${line}`)
      return
    }
    if (this.suppressedThisWindow === 0) {
      this.log(
        `${PREFIX} … more than ${this.maxLinesPerSecond} channel messages this second; suppressing the rest`,
      )
    }
    this.suppressedThisWindow += 1
  }

  private flushSuppressed(): void {
    if (this.suppressedThisWindow === 0) return
    this.log(`${PREFIX} … ${this.suppressedThisWindow} channel messages suppressed`)
    this.suppressedThisWindow = 0
  }
}

/** One-line human form. Channels are shown 1-based, as the DAW shows them. */
export function describe(event: MidiInEvent): string {
  switch (event.kind) {
    case 'noteOn':
      return `noteOn ch${event.channel + 1} note ${event.note} vel ${event.velocity}`
    case 'noteOff':
      return `noteOff ch${event.channel + 1} note ${event.note}`
    case 'polyPressure':
      return `polyPressure ch${event.channel + 1} note ${event.note} = ${event.pressure}`
    case 'cc':
      return `cc ch${event.channel + 1} #${event.controller} = ${event.value}`
    case 'programChange':
      return `program ch${event.channel + 1} = ${event.program}`
    case 'channelPressure':
      return `channelPressure ch${event.channel + 1} = ${event.pressure}`
    case 'pitchBend':
      return `bend ch${event.channel + 1} ${event.value14}`
    case 'songPosition':
      return `song position ${event.beats16th}/16`
    case 'clock':
      return 'clock'
    case 'start':
      return 'start'
    case 'continue':
      return 'continue'
    case 'stop':
      return 'stop'
  }
}
