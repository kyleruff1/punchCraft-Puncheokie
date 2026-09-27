/**
 * MIDI input abstraction for PunchBridge — the DAW → bridge hop.
 *
 * Mirror of midiBackend.ts for the receive direction: the server holds a
 * MidiInputBackend, so a loopMIDI port, a hardware controller or a test
 * fake are interchangeable and nothing above this file touches the MIDI
 * library. Two rules differ from the output side, on purpose:
 *
 *   1. Opening is OPT-IN with NO "first port" fallback. Output falls back
 *      to port 0 because sounding through the Windows GS synth is a fine
 *      default; on the input side port 0 on this PC is a hardware
 *      keyboard, and silently opening one would be a surprise.
 *   2. The bridge's own OUTPUT port is refused by name. A loopMIDI port is
 *      a loopback — whatever we write to its output side arrives on its
 *      input side — so opening it for input would echo every note we send
 *      straight back at us. Studio One → bridge gets its own port
 *      (README.md, "Studio One → bridge").
 *
 * Nothing downstream consumes these events yet: MidiInMonitor logs them
 * and exposes `subscribe` as the seam. Following the DAW's clock is #351
 * (M45-06) and does not live here.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

import { CONTROL_CHANGE, NOTE_OFF, NOTE_ON, PITCH_BEND, PROGRAM_CHANGE } from './midiBackend'

export const POLY_PRESSURE = 0xa0
export const CHANNEL_PRESSURE = 0xd0
/** System common / real-time status bytes we decode. */
export const SONG_POSITION = 0xf2
export const CLOCK = 0xf8
export const START = 0xfa
export const CONTINUE = 0xfb
export const STOP = 0xfc

/**
 * One decoded inbound message. `channel` is 0-based like the builders in
 * midiBackend.ts (the docs and Studio One count from 1). A Note On with
 * velocity 0 is normalised to `noteOff`, as the MIDI spec intends.
 */
export type MidiInEvent =
  | { kind: 'noteOn'; channel: number; note: number; velocity: number }
  | { kind: 'noteOff'; channel: number; note: number; velocity: number }
  | { kind: 'polyPressure'; channel: number; note: number; pressure: number }
  | { kind: 'cc'; channel: number; controller: number; value: number }
  | { kind: 'programChange'; channel: number; program: number }
  | { kind: 'channelPressure'; channel: number; pressure: number }
  /** 14-bit, 8192 = centre (same scale as midiBackend's PITCH_BEND_CENTER). */
  | { kind: 'pitchBend'; channel: number; value14: number }
  /** Song Position Pointer, in MIDI beats (sixteenth notes). */
  | { kind: 'songPosition'; beats16th: number }
  | { kind: 'clock' }
  | { kind: 'start' }
  | { kind: 'continue' }
  | { kind: 'stop' }

/**
 * Pure decoder: raw bytes → MidiInEvent, or null for anything we do not
 * model (sysex, MTC quarter frames, active sensing, reset, truncated or
 * status-less messages). Never throws.
 */
export function decodeMidiMessage(bytes: readonly number[]): MidiInEvent | null {
  const status = bytes[0]
  if (typeof status !== 'number' || status < 0x80 || status > 0xff) return null
  const d1 = bytes[1]
  const d2 = bytes[2]

  if (status >= 0xf0) {
    switch (status) {
      case CLOCK:
        return { kind: 'clock' }
      case START:
        return { kind: 'start' }
      case CONTINUE:
        return { kind: 'continue' }
      case STOP:
        return { kind: 'stop' }
      case SONG_POSITION:
        if (typeof d1 !== 'number' || typeof d2 !== 'number') return null
        return { kind: 'songPosition', beats16th: (d1 & 0x7f) | ((d2 & 0x7f) << 7) }
      default:
        return null
    }
  }

  const type = status & 0xf0
  const channel = status & 0x0f
  switch (type) {
    case NOTE_OFF:
      if (typeof d1 !== 'number') return null
      return { kind: 'noteOff', channel, note: d1 & 0x7f, velocity: (d2 ?? 0) & 0x7f }
    case NOTE_ON: {
      if (typeof d1 !== 'number') return null
      const note = d1 & 0x7f
      const velocity = (d2 ?? 0) & 0x7f
      return velocity === 0
        ? { kind: 'noteOff', channel, note, velocity: 0 }
        : { kind: 'noteOn', channel, note, velocity }
    }
    case POLY_PRESSURE:
      if (typeof d1 !== 'number' || typeof d2 !== 'number') return null
      return { kind: 'polyPressure', channel, note: d1 & 0x7f, pressure: d2 & 0x7f }
    case CONTROL_CHANGE:
      if (typeof d1 !== 'number' || typeof d2 !== 'number') return null
      return { kind: 'cc', channel, controller: d1 & 0x7f, value: d2 & 0x7f }
    case PROGRAM_CHANGE:
      if (typeof d1 !== 'number') return null
      return { kind: 'programChange', channel, program: d1 & 0x7f }
    case CHANNEL_PRESSURE:
      if (typeof d1 !== 'number') return null
      return { kind: 'channelPressure', channel, pressure: d1 & 0x7f }
    case PITCH_BEND:
      if (typeof d1 !== 'number' || typeof d2 !== 'number') return null
      return { kind: 'pitchBend', channel, value14: (d1 & 0x7f) | ((d2 & 0x7f) << 7) }
    default:
      return null
  }
}

export type MidiBytesHandler = (bytes: number[]) => void

export interface MidiInputBackend {
  /** Human name of the port actually opened (or 'none'). */
  readonly portName: string
  /** True once a real port (not the stub) is delivering. */
  readonly isReal: boolean
  /** Subscribe to raw inbound messages. Returns the unsubscribe. */
  onMessage(handler: MidiBytesHandler): () => void
  close(): void
}

/** No-port stub — what the bridge holds when --midi-in was not given. */
export class NullMidiInputBackend implements MidiInputBackend {
  readonly portName = 'none'
  readonly isReal = false

  onMessage(_handler: MidiBytesHandler): () => void {
    return () => {
      /* nothing subscribed */
    }
  }

  close(): void {
    /* nothing to release */
  }
}

/** Thrown when the requested input port IS the bridge's own output port. */
export class LoopbackRefusedError extends Error {
  constructor(portName: string) {
    super(
      `refusing to open "${portName}" for input: it is the bridge's own output port, and a ` +
        `loopMIDI port is a loopback — every note we send would come straight back in. ` +
        `Create a second loopMIDI port for the DAW → bridge direction and pass it as --midi-in ` +
        `(see tools/punchbridge/README.md).`,
    )
    this.name = 'LoopbackRefusedError'
  }
}

export interface ChooseInputPortOptions {
  /** The bridge's own output port name; never opened for input. */
  excludePortName?: string
}

/**
 * Pick the input port index for `preferred` (case-insensitive substrings,
 * in order). Returns null when nothing matches — deliberately NOT port 0.
 * Throws LoopbackRefusedError when the only port a preference matches is
 * the excluded (output) port; a different port that also matches wins.
 */
export function chooseInputPort(
  names: readonly string[],
  preferred: readonly string[],
  opts: ChooseInputPortOptions = {},
): number | null {
  const excluded = opts.excludePortName?.toLowerCase() ?? null
  for (const want of preferred) {
    const lower = want.trim().toLowerCase()
    if (!lower) continue
    let refused: string | null = null
    for (let i = 0; i < names.length; i += 1) {
      const name = names[i] ?? ''
      if (!name.toLowerCase().includes(lower)) continue
      if (excluded !== null && name.toLowerCase() === excluded) {
        refused = name
        continue
      }
      return i
    }
    if (refused !== null) throw new LoopbackRefusedError(refused)
  }
  return null
}

/** The slice of @julusian/midi's Input we use, typed structurally so a
 * test or a dry run never needs the native module. */
interface NativeInput {
  getPortCount(): number
  getPortName(i: number): string
  ignoreTypes(sysex: boolean, timing: boolean, activeSensing: boolean): void
  openPort(i: number): void
  closePort(): void
  destroy?(): void
  on(event: 'message', handler: (deltaTime: number, message: number[]) => void): unknown
}

function loadNativeInput(): new () => NativeInput {
  const midi = require('@julusian/midi') as { Input: new () => NativeInput }
  return midi.Input
}

function listPortNames(input: NativeInput): string[] {
  const count = input.getPortCount()
  const names: string[] = []
  for (let i = 0; i < count; i += 1) names.push(input.getPortName(i))
  return names
}

/**
 * Real backend over @julusian/midi (prebuilt binaries, no compilation).
 * Loaded lazily so a test or a dry run never needs the native module.
 */
export class JulusianMidiInputBackend implements MidiInputBackend {
  readonly portName: string
  readonly isReal = true
  private readonly input: NativeInput
  private readonly handlers = new Set<MidiBytesHandler>()
  private closed = false

  private constructor(input: NativeInput, portName: string) {
    this.input = input
    this.portName = portName
    input.on('message', (_deltaTime, message) => {
      if (this.closed) return
      // Copy: the native layer may reuse its array; subscribers may keep it.
      const bytes = Array.from(message)
      for (const handler of this.handlers) handler(bytes)
    })
  }

  /**
   * Open the input port `chooseInputPort` picks for `preferred`. Returns
   * null when no port matches (the caller decides how loud to be about
   * it). Throws LoopbackRefusedError per chooseInputPort, and rethrows
   * native load failures.
   */
  static open(
    preferred: readonly string[],
    opts: ChooseInputPortOptions = {},
  ): JulusianMidiInputBackend | null {
    const Input = loadNativeInput()
    const input = new Input()
    const names = listPortNames(input)
    let chosen: number | null
    try {
      chosen = chooseInputPort(names, preferred, opts)
    } catch (err) {
      input.destroy?.()
      throw err
    }
    if (chosen === null) {
      input.destroy?.()
      return null
    }
    // sysex ignored, TIMING KEPT (RtMidi drops clock/start/stop by
    // default — without this the DAW's MIDI Clock never arrives), active
    // sensing ignored. Must be set before the port opens.
    input.ignoreTypes(true, false, true)
    input.openPort(chosen)
    return new JulusianMidiInputBackend(input, names[chosen] ?? `port ${chosen}`)
  }

  static inputPortNames(): string[] {
    const Input = loadNativeInput()
    const input = new Input()
    try {
      return listPortNames(input)
    } finally {
      // An Input holds a native handle even unopened; release it so a
      // listing never keeps the process alive.
      input.destroy?.()
    }
  }

  onMessage(handler: MidiBytesHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.handlers.clear()
    try {
      this.input.closePort()
    } finally {
      this.input.destroy?.()
    }
  }
}

export interface OpenInputBackendOptions extends ChooseInputPortOptions {
  log?: (msg: string) => void
}

/**
 * Open a real input backend for `preferred`, else the stub. An empty
 * `preferred` means "not requested" and is silent. A preference that
 * matches nothing logs once and falls back to the stub (a wrong name is
 * a misconfiguration, not a reason to die). A native load failure does
 * the same. The loopback refusal is the one error that PROPAGATES: the
 * caller must fix the port layout, not carry on half-wired.
 */
export function openInputBackend(
  preferred: readonly string[],
  opts: OpenInputBackendOptions = {},
): MidiInputBackend {
  const log = opts.log ?? ((m: string) => console.log(m))
  const wanted = preferred.map((p) => p.trim()).filter((p) => p.length > 0)
  if (wanted.length === 0) return new NullMidiInputBackend()

  let backend: JulusianMidiInputBackend | null
  try {
    backend = JulusianMidiInputBackend.open(wanted, { excludePortName: opts.excludePortName })
  } catch (err) {
    if (err instanceof LoopbackRefusedError) throw err
    log(`punchbridge: MIDI input unavailable (${String(err)}); nothing will be received`)
    return new NullMidiInputBackend()
  }
  if (!backend) {
    log(
      `punchbridge: no MIDI input port matched ${wanted.map((p) => `"${p}"`).join(', ')} — ` +
        `nothing will be received (run: npm run ports)`,
    )
    return new NullMidiInputBackend()
  }
  log(`punchbridge: MIDI input port opened ← "${backend.portName}"`)
  return backend
}
