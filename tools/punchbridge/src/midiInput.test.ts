/**
 * DAW → bridge MIDI input: the pure decoder, the port chooser's two
 * safety rules (no port-0 fallback, loopback refusal), and the monitor's
 * logging / tempo / fan-out behaviour against a fake backend and the
 * shared FakeClock. No native module is loaded anywhere in here.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LoopbackRefusedError,
  NullMidiInputBackend,
  chooseInputPort,
  decodeMidiMessage,
  openInputBackend,
  type MidiBytesHandler,
  type MidiInEvent,
  type MidiInputBackend,
} from './midiInput'
import {
  CLOCKS_PER_QUARTER,
  MidiInMonitor,
  describe as describeEvent,
} from './midiInMonitor'
import { FakeClock } from './testHarness'

// ---------------------------------------------------------------------------
// decodeMidiMessage
// ---------------------------------------------------------------------------

test('decode: channel voice messages, 0-based channel, 7-bit masking', () => {
  assert.deepEqual(decodeMidiMessage([0x93, 60, 100]), {
    kind: 'noteOn',
    channel: 3,
    note: 60,
    velocity: 100,
  })
  assert.deepEqual(decodeMidiMessage([0x82, 60, 64]), {
    kind: 'noteOff',
    channel: 2,
    note: 60,
    velocity: 64,
  })
  assert.deepEqual(decodeMidiMessage([0xa0, 60, 33]), {
    kind: 'polyPressure',
    channel: 0,
    note: 60,
    pressure: 33,
  })
  assert.deepEqual(decodeMidiMessage([0xb0, 1, 64]), {
    kind: 'cc',
    channel: 0,
    controller: 1,
    value: 64,
  })
  assert.deepEqual(decodeMidiMessage([0xc1, 5]), { kind: 'programChange', channel: 1, program: 5 })
  assert.deepEqual(decodeMidiMessage([0xd9, 77]), {
    kind: 'channelPressure',
    channel: 9,
    pressure: 77,
  })
  // Data bytes are masked to 7 bits even if a bad sender sets the top bit.
  assert.deepEqual(decodeMidiMessage([0x90, 0xff, 0x81]), {
    kind: 'noteOn',
    channel: 0,
    note: 127,
    velocity: 1,
  })
})

test('decode: note on with velocity 0 is a note off', () => {
  assert.deepEqual(decodeMidiMessage([0x93, 60, 0]), {
    kind: 'noteOff',
    channel: 3,
    note: 60,
    velocity: 0,
  })
})

test('decode: 14-bit pitch bend and song position assemble little-endian 7-bit pairs', () => {
  assert.deepEqual(decodeMidiMessage([0xe0, 0x00, 0x40]), {
    kind: 'pitchBend',
    channel: 0,
    value14: 8192,
  })
  assert.deepEqual(decodeMidiMessage([0xe5, 0x7f, 0x7f]), {
    kind: 'pitchBend',
    channel: 5,
    value14: 16383,
  })
  assert.deepEqual(decodeMidiMessage([0xe0, 0x00, 0x00]), {
    kind: 'pitchBend',
    channel: 0,
    value14: 0,
  })
  assert.deepEqual(decodeMidiMessage([0xf2, 0x10, 0x00]), { kind: 'songPosition', beats16th: 16 })
  assert.deepEqual(decodeMidiMessage([0xf2, 0x00, 0x01]), { kind: 'songPosition', beats16th: 128 })
})

test('decode: real-time transport bytes', () => {
  assert.deepEqual(decodeMidiMessage([0xf8]), { kind: 'clock' })
  assert.deepEqual(decodeMidiMessage([0xfa]), { kind: 'start' })
  assert.deepEqual(decodeMidiMessage([0xfb]), { kind: 'continue' })
  assert.deepEqual(decodeMidiMessage([0xfc]), { kind: 'stop' })
})

test('decode: unmodelled, truncated or status-less input is null, never a throw', () => {
  assert.equal(decodeMidiMessage([]), null)
  assert.equal(decodeMidiMessage([0x40]), null) // data byte with no status
  assert.equal(decodeMidiMessage([0x90]), null) // truncated note on
  assert.equal(decodeMidiMessage([0xb0, 1]), null) // truncated cc
  assert.equal(decodeMidiMessage([0xe0, 0x00]), null) // truncated bend
  assert.equal(decodeMidiMessage([0xf0, 0x7e, 0xf7]), null) // sysex
  assert.equal(decodeMidiMessage([0xf1, 0x00]), null) // MTC quarter frame
  assert.equal(decodeMidiMessage([0xfe]), null) // active sensing
  assert.equal(decodeMidiMessage([0xff]), null) // reset
  assert.equal(decodeMidiMessage([0x100, 1, 2]), null) // out of byte range
})

// ---------------------------------------------------------------------------
// chooseInputPort
// ---------------------------------------------------------------------------

const PORTS = ['V49', 'MIDIIN2 (V49)', 'Focusrite USB MIDI', 'PunchBridge', 'PunchCraft Ctl']

test('chooseInputPort: case-insensitive substring, preference order wins', () => {
  assert.equal(chooseInputPort(PORTS, ['punchcraft ctl']), 4)
  assert.equal(chooseInputPort(PORTS, ['nope', 'focusrite']), 2)
  assert.equal(chooseInputPort(PORTS, ['focusrite', 'v49']), 2)
})

test('chooseInputPort: no match is null — never a silent port-0 fallback', () => {
  assert.equal(chooseInputPort(PORTS, ['loopmidi']), null)
  assert.equal(chooseInputPort(PORTS, []), null)
  assert.equal(chooseInputPort(PORTS, ['', '   ']), null)
  assert.equal(chooseInputPort([], ['anything']), null)
})

test("chooseInputPort: refuses the bridge's own output port with a loopback message", () => {
  assert.throws(
    () => chooseInputPort(PORTS, ['PunchBridge'], { excludePortName: 'PunchBridge' }),
    (err: unknown) =>
      err instanceof LoopbackRefusedError &&
      /loopback/i.test(err.message) &&
      /--midi-in/.test(err.message),
  )
  // Case-insensitive on both sides.
  assert.throws(
    () => chooseInputPort(PORTS, ['punchbridge'], { excludePortName: 'PUNCHBRIDGE' }),
    LoopbackRefusedError,
  )
})

test('chooseInputPort: a different port matching the same substring is still chosen', () => {
  // "punch" matches PunchBridge (excluded) AND PunchCraft Ctl — take the latter.
  assert.equal(chooseInputPort(PORTS, ['punch'], { excludePortName: 'PunchBridge' }), 4)
  // Without the exclusion the first match wins, as on the output side.
  assert.equal(chooseInputPort(PORTS, ['punch']), 3)
})

test('openInputBackend: nothing requested → silent stub', () => {
  const lines: string[] = []
  const backend = openInputBackend([], { log: (m) => lines.push(m) })
  assert.ok(backend instanceof NullMidiInputBackend)
  assert.equal(backend.isReal, false)
  assert.deepEqual(lines, [])
  // The stub's subscription is inert and its close is a no-op.
  const off = backend.onMessage(() => assert.fail('stub must never deliver'))
  off()
  backend.close()
})

// ---------------------------------------------------------------------------
// MidiInMonitor
// ---------------------------------------------------------------------------

class FakeInputBackend implements MidiInputBackend {
  readonly portName = 'fake-in'
  readonly isReal = false
  closed = false
  private readonly handlers = new Set<MidiBytesHandler>()

  onMessage(handler: MidiBytesHandler): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  push(bytes: number[]): void {
    for (const handler of this.handlers) handler(bytes)
  }

  get subscriberCount(): number {
    return this.handlers.size
  }

  close(): void {
    this.closed = true
  }
}

function rig(opts: { maxLinesPerSecond?: number } = {}) {
  const backend = new FakeInputBackend()
  const clock = new FakeClock()
  const lines: string[] = []
  const monitor = new MidiInMonitor(backend, clock, { ...opts, log: (m) => lines.push(m) })
  return { backend, clock, lines, monitor }
}

/** Push `count` clock ticks, advancing the clock by `stepMs` before each. */
function ticks(r: ReturnType<typeof rig>, count: number, stepMs: number): void {
  for (let i = 0; i < count; i += 1) {
    r.clock.t += stepMs
    r.backend.push([0xf8])
  }
}

const tempoLines = (lines: string[]): string[] => lines.filter((l) => l.includes('tempo'))

test('monitor: tempo appears after one quarter note of clock and reads the true bpm', () => {
  const r = rig()
  r.backend.push([0xfa])
  // 24 intervals of 25 ms = 600 ms per quarter = 100 bpm. Needs 25 stamps.
  ticks(r, CLOCKS_PER_QUARTER, 25)
  assert.equal(r.monitor.snapshot().bpm, null, 'no estimate until the ring holds 25 stamps')
  ticks(r, 1, 25)
  assert.equal(r.monitor.snapshot().bpm, 100)
  assert.deepEqual(tempoLines(r.lines), ['punchbridge: midi-in ← tempo 100.0 bpm'])
  // Individual ticks are never logged.
  assert.equal(r.lines.filter((l) => /clock/.test(l)).length, 0)
  assert.equal(r.monitor.snapshot().clockTicks, 25)
})

test('monitor: steady tempo is not re-logged; a step change logs once, settled, never in between', () => {
  const r = rig()
  r.backend.push([0xfa])
  ticks(r, CLOCKS_PER_QUARTER + 1, 25) // 100 bpm logged
  ticks(r, 4 * CLOCKS_PER_QUARTER, 25) // four more quarters of the same
  assert.equal(tempoLines(r.lines).length, 1)

  // Step to 20 ms per tick = 125 bpm. For one quarter the ring is a mix
  // and the estimate climbs ~1 bpm per tick — none of that may be logged.
  ticks(r, CLOCKS_PER_QUARTER, 20)
  assert.equal(tempoLines(r.lines).length, 1, 'no transitional tempo lines while the ring converges')
  assert.equal(r.monitor.snapshot().bpm, 125, 'the estimate itself is exact once the ring is new')

  // One more quarter of holding at 125 → exactly one line, the settled value.
  ticks(r, CLOCKS_PER_QUARTER, 20)
  const after = tempoLines(r.lines)
  assert.equal(after.length, 2, 'exactly one extra tempo line for a step change')
  assert.equal(after[1], 'punchbridge: midi-in ← tempo 125.0 bpm')

  // And it stays quiet from there.
  ticks(r, 8 * CLOCKS_PER_QUARTER, 20)
  assert.equal(tempoLines(r.lines).length, 2)
})

test('monitor: sub-threshold jitter around a steady tempo never re-logs', () => {
  const r = rig()
  r.backend.push([0xfa])
  ticks(r, CLOCKS_PER_QUARTER + 1, 25) // 100.0 logged
  // Alternate 24 / 26 ms intervals: each 24-tick span stays 600 ± 2 ms,
  // i.e. within ±0.4 bpm of 100 — below the 1.0 bpm delta.
  for (let i = 0; i < 12 * CLOCKS_PER_QUARTER; i += 1) ticks(r, 1, i % 2 === 0 ? 24 : 26)
  assert.equal(tempoLines(r.lines).length, 1)
})

test('monitor: transport start/continue/stop drive `running` and reset the tempo window', () => {
  const r = rig()
  assert.equal(r.monitor.snapshot().running, false)
  r.backend.push([0xfa])
  assert.equal(r.monitor.snapshot().running, true)
  ticks(r, CLOCKS_PER_QUARTER + 1, 25)
  assert.equal(r.monitor.snapshot().bpm, 100)
  r.backend.push([0xfc])
  assert.equal(r.monitor.snapshot().running, false)
  assert.equal(r.monitor.snapshot().bpm, null, 'stop clears the estimate')
  r.backend.push([0xfb])
  assert.equal(r.monitor.snapshot().running, true)
  r.backend.push([0xf2, 0x20, 0x00]) // 32 sixteenths = beat 8
  assert.deepEqual(
    r.lines.filter((l) => /transport|song position/.test(l)),
    [
      'punchbridge: midi-in ← transport start',
      'punchbridge: midi-in ← transport stop',
      'punchbridge: midi-in ← transport continue',
      'punchbridge: midi-in ← song position beat 8.00',
    ],
  )
})

test('monitor: channel messages log 1-based channels, one line each', () => {
  const r = rig()
  r.backend.push([0x92, 62, 100])
  r.backend.push([0xb2, 1, 64])
  r.backend.push([0xe2, 0x00, 0x40])
  r.backend.push([0x82, 62, 0])
  assert.deepEqual(r.lines, [
    'punchbridge: midi-in ← noteOn ch3 note 62 vel 100',
    'punchbridge: midi-in ← cc ch3 #1 = 64',
    'punchbridge: midi-in ← bend ch3 8192',
    'punchbridge: midi-in ← noteOff ch3 note 62',
  ])
  assert.equal(r.monitor.snapshot().channelMessages, 4)
})

test('monitor: per-second cap suppresses a flood and reports the count at the next second', () => {
  const r = rig({ maxLinesPerSecond: 3 })
  for (let i = 0; i < 5; i += 1) r.backend.push([0xb0, 74, i])
  assert.deepEqual(r.lines, [
    'punchbridge: midi-in ← cc ch1 #74 = 0',
    'punchbridge: midi-in ← cc ch1 #74 = 1',
    'punchbridge: midi-in ← cc ch1 #74 = 2',
    'punchbridge: midi-in … more than 3 channel messages this second; suppressing the rest',
  ])
  // Still inside the same second: silent.
  r.clock.t = 999
  r.backend.push([0xb0, 74, 5])
  assert.equal(r.lines.length, 4)
  // Next second: the count flushes, then normal logging resumes.
  r.clock.t = 1000
  r.backend.push([0xb0, 74, 6])
  assert.deepEqual(r.lines.slice(4), [
    'punchbridge: midi-in … 3 channel messages suppressed',
    'punchbridge: midi-in ← cc ch1 #74 = 6',
  ])
  // Every message still counts and still reaches subscribers.
  assert.equal(r.monitor.snapshot().channelMessages, 7)
})

test('monitor: subscribers get decoded events with the clock stamp; unsubscribe stops them', () => {
  const r = rig()
  const seen: Array<{ event: MidiInEvent; atMs: number }> = []
  const off = r.monitor.subscribe((event, atMs) => seen.push({ event, atMs }))
  r.clock.t = 42
  r.backend.push([0x90, 60, 90])
  r.backend.push([0xf8])
  r.backend.push([0xf0, 0x00, 0xf7]) // sysex: undecoded, never delivered
  assert.deepEqual(seen, [
    { event: { kind: 'noteOn', channel: 0, note: 60, velocity: 90 }, atMs: 42 },
    { event: { kind: 'clock' }, atMs: 42 },
  ])
  off()
  r.backend.push([0x90, 61, 90])
  assert.equal(seen.length, 2)
  assert.equal(r.monitor.snapshot().lastEventAtMs, 42)
})

test('monitor: a throwing subscriber is logged and does not starve the others', () => {
  const r = rig()
  const seen: string[] = []
  r.monitor.subscribe(() => {
    throw new Error('boom')
  })
  r.monitor.subscribe((event) => seen.push(describeEvent(event)))
  r.backend.push([0x90, 60, 90])
  assert.deepEqual(seen, ['noteOn ch1 note 60 vel 90'])
  assert.ok(r.lines.some((l) => /listener threw/.test(l) && /boom/.test(l)))
})

test('monitor: close releases the backend, flushes a pending suppression, and goes inert', () => {
  const r = rig({ maxLinesPerSecond: 1 })
  const seen: MidiInEvent[] = []
  r.monitor.subscribe((event) => seen.push(event))
  r.backend.push([0x90, 60, 90])
  r.backend.push([0x90, 61, 90]) // suppressed
  assert.equal(r.backend.subscriberCount, 1)
  r.monitor.close()
  assert.equal(r.backend.closed, true)
  assert.equal(r.backend.subscriberCount, 0)
  assert.ok(r.lines.includes('punchbridge: midi-in … 1 channel messages suppressed'))
  r.backend.push([0x90, 62, 90])
  assert.equal(seen.length, 2)
  r.monitor.close() // idempotent
})

test('describe: every event kind has a one-line form', () => {
  const kinds: MidiInEvent[] = [
    { kind: 'noteOn', channel: 0, note: 1, velocity: 2 },
    { kind: 'noteOff', channel: 0, note: 1, velocity: 0 },
    { kind: 'polyPressure', channel: 0, note: 1, pressure: 2 },
    { kind: 'cc', channel: 0, controller: 1, value: 2 },
    { kind: 'programChange', channel: 0, program: 1 },
    { kind: 'channelPressure', channel: 0, pressure: 1 },
    { kind: 'pitchBend', channel: 0, value14: 8192 },
    { kind: 'songPosition', beats16th: 4 },
    { kind: 'clock' },
    { kind: 'start' },
    { kind: 'continue' },
    { kind: 'stop' },
  ]
  for (const event of kinds) {
    const line = describeEvent(event)
    assert.equal(typeof line, 'string')
    assert.ok(line.length > 0, `empty description for ${event.kind}`)
  }
})
