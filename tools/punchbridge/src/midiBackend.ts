/**
 * MIDI output abstraction for PunchBridge (instrument-design §11). The
 * server never touches a MIDI library directly — it holds a
 * MidiOutputBackend, so loopMIDI, Windows MIDI Services, a hardware port,
 * or a console stub are interchangeable and the Windows MIDI stack can
 * churn underneath without touching the gesture→MIDI logic.
 */

/* eslint-disable @typescript-eslint/no-var-requires */

export interface MidiOutputBackend {
  /** Human name of the port actually opened (or 'console'). */
  readonly portName: string
  /** True once a real port (not the stub) is sounding. */
  readonly isReal: boolean
  send(bytes: readonly number[]): void
  allNotesOff(): void
  close(): void
}

/** MIDI status bytes (channel is 0-based in the wire, 1-based in the docs). */
export const NOTE_OFF = 0x80
export const NOTE_ON = 0x90
export const CONTROL_CHANGE = 0xb0
export const PROGRAM_CHANGE = 0xc0
export const PITCH_BEND = 0xe0
export const CC_ALL_SOUND_OFF = 120
export const CC_ALL_NOTES_OFF = 123
export const PITCH_BEND_CENTER = 8192

/** Note On for a 0-based channel. */
export function noteOn(channel: number, note: number, velocity: number): number[] {
  return [NOTE_ON | (channel & 0x0f), note & 0x7f, velocity & 0x7f]
}

export function noteOff(channel: number, note: number): number[] {
  return [NOTE_OFF | (channel & 0x0f), note & 0x7f, 0]
}

export function controlChange(channel: number, cc: number, value: number): number[] {
  return [CONTROL_CHANGE | (channel & 0x0f), cc & 0x7f, value & 0x7f]
}

/** Program change (0-indexed GM program number). */
export function programChange(channel: number, program: number): number[] {
  return [PROGRAM_CHANGE | (channel & 0x0f), program & 0x7f]
}

/** 14-bit pitch bend; 8192 is centered. */
export function pitchBend(channel: number, value14: number): number[] {
  const v = Math.max(0, Math.min(16383, Math.round(value14)))
  return [PITCH_BEND | (channel & 0x0f), v & 0x7f, (v >> 7) & 0x7f]
}

/** Console stub — logs the bytes it would send. Always available. */
export class ConsoleMidiBackend implements MidiOutputBackend {
  readonly portName = 'console'
  readonly isReal = false
  private readonly log: (msg: string) => void

  constructor(log: (msg: string) => void = (m) => console.log(m)) {
    this.log = log
  }

  send(bytes: readonly number[]): void {
    this.log(`midi ${bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`)
  }

  allNotesOff(): void {
    this.log('midi all-notes-off')
  }

  close(): void {
    /* nothing to release */
  }
}

/**
 * Real backend over @julusian/midi (prebuilt binaries, no compilation).
 * Loaded lazily so a test or a dry run never needs the native module.
 */
export class JulusianMidiBackend implements MidiOutputBackend {
  readonly portName: string
  readonly isReal = true
  private readonly output: { sendMessage(b: number[]): void; closePort(): void }
  /** Channels we have ever sounded, for a thorough all-notes-off. */
  private readonly touchedChannels = new Set<number>()

  private constructor(
    output: { sendMessage(b: number[]): void; closePort(): void },
    portName: string,
  ) {
    this.output = output
    this.portName = portName
  }

  /**
   * Open the first port whose name contains one of `preferred` (case-
   * insensitive, in order), else the first port at all. Returns the chosen
   * port's name via the instance. Throws if there are no ports.
   */
  static open(preferred: readonly string[]): JulusianMidiBackend {
    const midi = require('@julusian/midi') as {
      Output: new () => {
        getPortCount(): number
        getPortName(i: number): string
        openPort(i: number): void
        sendMessage(b: number[]): void
        closePort(): void
      }
    }
    const output = new midi.Output()
    const count = output.getPortCount()
    if (count === 0) throw new Error('no MIDI output ports available')

    const names: string[] = []
    for (let i = 0; i < count; i += 1) names.push(output.getPortName(i))

    let chosen = -1
    for (const want of preferred) {
      const lower = want.toLowerCase()
      const idx = names.findIndex((n) => n.toLowerCase().includes(lower))
      if (idx >= 0) {
        chosen = idx
        break
      }
    }
    if (chosen < 0) chosen = 0

    output.openPort(chosen)
    return new JulusianMidiBackend(output, names[chosen] ?? `port ${chosen}`)
  }

  static portNames(): string[] {
    const midi = require('@julusian/midi') as {
      Output: new () => { getPortCount(): number; getPortName(i: number): string }
    }
    const output = new midi.Output()
    const count = output.getPortCount()
    const names: string[] = []
    for (let i = 0; i < count; i += 1) names.push(output.getPortName(i))
    return names
  }

  send(bytes: readonly number[]): void {
    const status = bytes[0]
    if (typeof status === 'number') this.touchedChannels.add(status & 0x0f)
    this.output.sendMessage([...bytes])
  }

  allNotesOff(): void {
    // Every channel we have ever used gets a proper reset: notes off, sound
    // off, bend centered (§23 emergency sequence).
    const channels = this.touchedChannels.size > 0 ? [...this.touchedChannels] : range16()
    for (const ch of channels) {
      this.output.sendMessage(controlChange(ch, CC_ALL_NOTES_OFF, 0))
      this.output.sendMessage(controlChange(ch, CC_ALL_SOUND_OFF, 0))
      this.output.sendMessage(pitchBend(ch, PITCH_BEND_CENTER))
    }
  }

  close(): void {
    try {
      this.allNotesOff()
    } finally {
      this.output.closePort()
    }
  }
}

function range16(): number[] {
  return Array.from({ length: 16 }, (_, i) => i)
}

/**
 * Open a real backend if any port is available, else fall back to the
 * console stub so the bridge always runs. `preferred` steers port choice —
 * a loopMIDI/Studio One port when present, otherwise the caller's default.
 */
export function openBestBackend(
  preferred: readonly string[],
  log: (msg: string) => void = (m) => console.log(m),
): MidiOutputBackend {
  try {
    const backend = JulusianMidiBackend.open(preferred)
    log(`punchbridge: MIDI port opened → "${backend.portName}"`)
    return backend
  } catch (err) {
    log(`punchbridge: no MIDI port (${String(err)}); using console backend`)
    return new ConsoleMidiBackend(log)
  }
}
