/**
 * Bridge protocol + reliability tests — node's built-in runner, no jest.
 * Run: npm test  (in tools/punchbridge)
 *
 * A FakeMidi records every byte sequence so we can assert the reliability
 * invariants the acceptance criteria demand: no stuck notes on disconnect
 * or watchdog, mapHash mismatch refused, schema mismatch refused.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  INSTRUMENT_SCHEMA_VERSION,
  type CompiledPunchGesture,
  type PunchBridgeAck,
} from '../../../src/domain/instrument/gestureSchema'
import { NOTE_OFF, NOTE_ON, PITCH_BEND, type MidiOutputBackend } from './midiBackend'
import type { RampScheduler } from './gestureToMidi'
import { BridgeSession, type BridgeClock } from './server'

class FakeMidi implements MidiOutputBackend {
  readonly portName = 'fake'
  readonly isReal = false
  readonly sent: number[][] = []
  allNotesOffCount = 0
  send(bytes: readonly number[]): void {
    this.sent.push([...bytes])
  }
  allNotesOff(): void {
    this.allNotesOffCount += 1
  }
  close(): void {}
  noteOnCount(): number {
    return this.sent.filter((b) => (b[0]! & 0xf0) === NOTE_ON && b[2]! > 0).length
  }
  noteOffCount(): number {
    return this.sent.filter(
      (b) => (b[0]! & 0xf0) === NOTE_OFF || ((b[0]! & 0xf0) === NOTE_ON && b[2] === 0),
    ).length
  }
}

class FakeClock implements BridgeClock {
  t = 0
  now(): number {
    return this.t
  }
}

class FakeSocket {
  readonly outbound: PunchBridgeAck[] = []
  closed = false
  send(data: string): void {
    this.outbound.push(JSON.parse(data) as PunchBridgeAck)
  }
  close(): void {
    this.closed = true
  }
}

const hello = (mapHash: string) =>
  JSON.stringify({
    type: 'hello',
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    sessionId: 's1',
    mapHash,
    heartbeatMs: 1000,
  })

const testNote = (voiceId: 'left' | 'right', sequence: number) =>
  JSON.stringify({
    type: 'test-note',
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    sessionId: 's1',
    sequence,
    sentAtMonotonicMs: 0,
    voiceId,
  })

function gestureMsg(mapHash: string, sequence: number, note: number): string {
  const gesture: CompiledPunchGesture = {
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    sessionId: 's1',
    eventId: `e${sequence}`,
    mapHash,
    source: {
      hand: 'left',
      receivedMonotonicTimeMs: 0,
      velocity01: 0.5,
      acceleration01: 0.5,
      punchRate01: 0,
      gapSincePreviousPunchMs: 0,
      alternating: false,
    },
    cube: { leftZone: 0, rightZone: 0, activityLayer: 0, changedAxis: 'left', targetCoordinate: [0, 0, 0] },
    voice: {
      voiceId: 'left',
      midiChannel: 2,
      targetNote: note,
      noteVelocity: 100,
      brightness: 64,
      expression: 100,
      transition: 'attack',
      transitionDurationMs: 80,
      pitchOvershootCents: 0,
    },
    transient: { note: 36, velocity: 100, layer: 'generic' },
    visual: {
      quadrant: 'upper-left',
      hueDegrees: 200,
      opacity: 0.8,
      radius: 0.1,
      persistenceMs: 4000,
      transitionRibbonMs: 80,
    },
  }
  return JSON.stringify({
    type: 'punch-gesture',
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    sessionId: 's1',
    sequence,
    mapHash,
    sentAtMonotonicMs: 0,
    gesture,
  })
}

test('a test note sounds and is acknowledged', () => {
  const midi = new FakeMidi()
  const socket = new FakeSocket()
  const session = new BridgeSession(socket, { midi, clock: new FakeClock() })
  session.onText(hello('m1'))
  session.onText(testNote('left', 1))
  assert.equal(midi.noteOnCount(), 1)
  const ack = socket.outbound.find((a) => a.type === 'control-ack' && a.sequence === 1)
  assert.ok(ack, 'control-ack present')
  assert.equal(ack?.rejected, undefined)
})

test('every held note is released on socket close (no stuck notes)', () => {
  const midi = new FakeMidi()
  const session = new BridgeSession(new FakeSocket(), { midi, clock: new FakeClock() })
  session.onText(hello('m1'))
  session.onText(testNote('left', 1))
  session.onText(testNote('right', 2))
  assert.equal(session.activeVoices(), 2)
  session.onClose()
  assert.equal(session.activeVoices(), 0)
  // Both held notes get an explicit note-off, plus the backend's own reset.
  assert.ok(midi.noteOffCount() >= 2, `expected >=2 note-offs, got ${midi.noteOffCount()}`)
  assert.ok(midi.allNotesOffCount >= 1)
})

test('watchdog releases notes and closes when the tablet goes silent', () => {
  const midi = new FakeMidi()
  const clock = new FakeClock()
  const socket = new FakeSocket()
  const session = new BridgeSession(socket, { midi, clock, watchdogMs: 4000 })
  session.onText(hello('m1'))
  session.onText(testNote('left', 1))
  assert.equal(session.activeVoices(), 1)
  clock.t = 5000 // past the 4s window with no new frame
  session.checkWatchdog()
  assert.equal(session.activeVoices(), 0)
  assert.equal(socket.closed, true)
  assert.ok(midi.allNotesOffCount >= 1)
})

test('a heartbeat keeps the watchdog from firing', () => {
  const midi = new FakeMidi()
  const clock = new FakeClock()
  const socket = new FakeSocket()
  const session = new BridgeSession(socket, { midi, clock, watchdogMs: 4000 })
  session.onText(hello('m1'))
  clock.t = 3000
  session.onText(
    JSON.stringify({
      type: 'heartbeat',
      schemaVersion: INSTRUMENT_SCHEMA_VERSION,
      sessionId: 's1',
      sentAtMonotonicMs: 3000,
    }),
  )
  clock.t = 6000 // 3s since the heartbeat, still inside the window
  session.checkWatchdog()
  assert.equal(socket.closed, false)
})

test('a gesture whose mapHash differs from hello is refused', () => {
  const midi = new FakeMidi()
  const socket = new FakeSocket()
  const session = new BridgeSession(socket, { midi, clock: new FakeClock() })
  session.onText(hello('m1'))
  session.onText(gestureMsg('DIFFERENT', 7, 60))
  assert.equal(midi.noteOnCount(), 0)
  const ack = socket.outbound.find((a) => a.sequence === 7)
  assert.ok(ack?.rejected?.includes('mapHash'))
})

test('a matching gesture sounds its target note', () => {
  const midi = new FakeMidi()
  const socket = new FakeSocket()
  const session = new BridgeSession(socket, { midi, clock: new FakeClock() })
  session.onText(hello('m1'))
  session.onText(gestureMsg('m1', 8, 67))
  assert.equal(midi.noteOnCount(), 1)
  const noteOn = midi.sent.find((b) => (b[0]! & 0xf0) === NOTE_ON && b[2]! > 0)
  assert.equal(noteOn?.[1], 67)
})

test('a wrong schema version is refused before any MIDI', () => {
  const midi = new FakeMidi()
  const socket = new FakeSocket()
  const session = new BridgeSession(socket, { midi, clock: new FakeClock() })
  session.onText(
    JSON.stringify({
      type: 'test-note',
      schemaVersion: 999,
      sessionId: 's1',
      sequence: 1,
      sentAtMonotonicMs: 0,
      voiceId: 'left',
    }),
  )
  assert.equal(midi.noteOnCount(), 0)
  const ack = socket.outbound.find((a) => a.sequence === 1)
  assert.ok(ack?.rejected?.includes('schema'))
})

test('same-voice retrigger releases the previous note (no pile-up)', () => {
  const midi = new FakeMidi()
  const session = new BridgeSession(new FakeSocket(), { midi, clock: new FakeClock() })
  session.onText(hello('m1'))
  session.onText(gestureMsg('m1', 1, 60))
  session.onText(gestureMsg('m1', 2, 64))
  // One voice held, and the first note was released before the second.
  assert.equal(session.activeVoices(), 1)
  assert.ok(midi.noteOffCount() >= 1)
})

// ---------------------------------------------------------------------------
// Brass-era session tests: eventId dedupe, whammy round-trip, watchdog
// mid-arp (spec §14 + seam #18/#19). A small timed scheduler drives the
// tick engine off the session's own FakeClock — importing the one in
// brassArpEngine.test.ts would re-register that file's tests here.
// ---------------------------------------------------------------------------

interface FakeTimer {
  dueMs: number
  periodMs: number | null
  fn: () => void
}

class TimedFakeScheduler implements RampScheduler {
  private nextId = 1
  private readonly timers = new Map<number, FakeTimer>()

  constructor(private readonly clock: FakeClock) {}

  setInterval(fn: () => void, ms: number): unknown {
    const id = this.nextId++
    this.timers.set(id, { dueMs: this.clock.t + ms, periodMs: ms, fn })
    return id
  }

  clearInterval(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++
    this.timers.set(id, { dueMs: this.clock.t + ms, periodMs: null, fn })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  advance(ms: number): void {
    const end = this.clock.t + ms
    for (;;) {
      let bestId: number | null = null
      let best: FakeTimer | null = null
      for (const [id, timer] of this.timers) {
        if (timer.dueMs > end) continue
        if (best === null || timer.dueMs < best.dueMs || (timer.dueMs === best.dueMs && id < bestId!)) {
          bestId = id
          best = timer
        }
      }
      if (best === null || bestId === null) break
      this.clock.t = Math.max(this.clock.t, best.dueMs)
      if (best.periodMs === null) this.timers.delete(bestId)
      else best.dueMs += best.periodMs
      best.fn()
    }
    this.clock.t = end
  }
}

/** A brass-path gesture message: accent + quantized + whammy on the wire. */
function brassGestureMsg(mapHash: string, sequence: number): string {
  const gesture: CompiledPunchGesture = {
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    sessionId: 's1',
    eventId: `e${sequence}`,
    mapHash,
    source: {
      hand: 'left',
      receivedMonotonicTimeMs: 0,
      velocity01: 0.5,
      acceleration01: 0.5,
      punchRate01: 0.2,
      gapSincePreviousPunchMs: 0,
      alternating: false,
    },
    cube: { leftZone: 0, rightZone: 0, activityLayer: 1, changedAxis: 'left', targetCoordinate: [0, 0, 1] },
    voice: {
      voiceId: 'left',
      midiChannel: 2,
      targetNote: 50,
      noteVelocity: 96,
      brightness: 90,
      expression: 100,
      transition: 'attack',
      transitionDurationMs: 0,
      pitchOvershootCents: 0,
    },
    transient: { note: 36, velocity: 100, layer: 'generic' },
    visual: {
      quadrant: 'upper-left',
      hueDegrees: 200,
      opacity: 0.8,
      radius: 0.1,
      persistenceMs: 4000,
      transitionRibbonMs: 0,
    },
    accent: { midiNote: 50, midiVelocity: 84, channel: 4, gateMs: 120 },
    quantized: {
      cubeCellId: 'L0R0',
      chordName: 'Dm9',
      bassMidiNote: 26,
      bassChannel: 2,
      chordMidiNotes: [50, 53, 57, 60, 64, 74],
      arpStartIndex: 0,
      arpPattern: [0, 2, 1, 3, 2, 4, 3, 5],
      arpChannel: 3,
      notesPerMinute: 120,
      gateRatio: 0.65,
      patternDepth: 4,
      activityLayer: 1,
      activityPps: 1.7,
      retrigger: 'quantized-rotate',
      backend: 'punchbridge-tick',
    },
    whammy: { direction: 'rise', semitones: 12, durationMs: 300 },
  }
  return JSON.stringify({
    type: 'punch-gesture',
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    sessionId: 's1',
    sequence,
    mapHash,
    sentAtMonotonicMs: 0,
    gesture,
  })
}

test('a duplicate gesture eventId is acked but not re-rendered', () => {
  const midi = new FakeMidi()
  const socket = new FakeSocket()
  const clock = new FakeClock()
  const scheduler = new TimedFakeScheduler(clock)
  const session = new BridgeSession(socket, { midi, clock, scheduler })
  session.onText(hello('m1'))
  session.onText(gestureMsg('m1', 1, 60))
  const sentAfterFirst = midi.sent.length
  session.onText(gestureMsg('m1', 1, 60)) // retransmit: identical eventId e1
  assert.equal(midi.sent.length, sentAfterFirst, 'retransmitted gesture re-rendered')
  const acks = socket.outbound.filter((a) => a.type === 'gesture-ack' && a.sequence === 1)
  assert.equal(acks.length, 2, 'retransmit was not acked')
  assert.ok(acks.every((a) => a.rejected === undefined))
})

test('a gesture carrying whammy+accent+quantized renders and acks cleanly', () => {
  const midi = new FakeMidi()
  const socket = new FakeSocket()
  const clock = new FakeClock()
  const scheduler = new TimedFakeScheduler(clock)
  const session = new BridgeSession(socket, { midi, clock, scheduler })
  session.onText(hello('m1'))
  session.onText(brassGestureMsg('m1', 1))
  const ack = socket.outbound.find((a) => a.type === 'gesture-ack' && a.sequence === 1)
  assert.ok(ack, 'gesture-ack missing')
  assert.equal(ack?.rejected, undefined)
  scheduler.advance(400)
  // Accent (wire 3), arp step 0 (wire 2), bass (wire 1), transient (wire 9).
  const onChannels = new Set(
    midi.sent.filter((b) => (b[0]! & 0xf0) === NOTE_ON && b[2]! > 0).map((b) => b[0]! & 0x0f),
  )
  for (const channel of [1, 2, 3, 9]) {
    assert.ok(onChannels.has(channel), `no noteOn on wire channel ${channel}`)
  }
  const bends = midi.sent.filter((b) => b[0] === (PITCH_BEND | 2))
  assert.ok(bends.length >= 2, 'whammy bend ramp missing on the arp channel')
})

test('watchdog fire mid-arp behaves like panic: engine silenced, socket closed', () => {
  const midi = new FakeMidi()
  const socket = new FakeSocket()
  const clock = new FakeClock()
  const scheduler = new TimedFakeScheduler(clock)
  const session = new BridgeSession(socket, { midi, clock, scheduler, watchdogMs: 4000 })
  session.onText(hello('m1'))
  session.onText(brassGestureMsg('m1', 1))
  scheduler.advance(1000)
  assert.ok(
    midi.sent.filter((b) => b[0] === (NOTE_ON | 2) && b[2]! > 0).length >= 2,
    'engine not stepping before the watchdog',
  )
  scheduler.advance(4500) // tablet silent past the window; engine still runs
  session.checkWatchdog()
  assert.equal(socket.closed, true)
  assert.ok(midi.allNotesOffCount >= 1)
  const count = midi.sent.length
  scheduler.advance(5000)
  assert.equal(midi.sent.length, count, 'engine messages after the watchdog panic')
})
