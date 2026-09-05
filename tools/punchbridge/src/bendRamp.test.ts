/**
 * Bend-ramp + renderer-transition tests. Run: npm test (tools/punchbridge).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bendRampPoints, PITCH_BEND_CENTER } from './bendRamp'
import {
  CONTROL_CHANGE,
  NOTE_ON,
  PITCH_BEND,
  type MidiOutputBackend,
} from './midiBackend'
import { RAMP_STEP_MS, VoiceRenderer, type RampScheduler } from './gestureToMidi'
import {
  INSTRUMENT_SCHEMA_VERSION,
  type CompiledPunchGesture,
} from '../../../src/domain/instrument/gestureSchema'

test('ramp points stay in 14-bit range and settle exactly on center', () => {
  const points = bendRampPoints({
    intervalSemitones: 2,
    overshootCents: 12,
    durationMs: 200,
    stepMs: 5,
    bendRangeSemitones: 2,
  })
  assert.equal(points.length, 41)
  for (const p of points) {
    assert.ok(p >= 0 && p <= 16383, `out of range: ${p}`)
  }
  assert.equal(points[points.length - 1], PITCH_BEND_CENTER)
  // Origin is the OLD pitch: bend = -interval → below center for an
  // upward glide.
  assert.ok((points[0] ?? 0) < PITCH_BEND_CENTER)
})

test('an interval wider than the bend range clamps to the range edge', () => {
  const points = bendRampPoints({
    intervalSemitones: 12,
    overshootCents: 0,
    durationMs: 100,
    stepMs: 5,
    bendRangeSemitones: 2,
  })
  // First point pinned at the bend floor. Symmetric scaling (±8191
  // around center 8192) makes full-down exactly 1, not 0 — equal cents
  // per wheel unit in both directions.
  assert.equal(points[0], 1)
  assert.equal(points[points.length - 1], PITCH_BEND_CENTER)
})

test('overshoot crosses center before settling', () => {
  const points = bendRampPoints({
    intervalSemitones: 2,
    overshootCents: 15,
    durationMs: 300,
    stepMs: 5,
    bendRangeSemitones: 2,
  })
  const beyond = points.some((p) => p > PITCH_BEND_CENTER)
  assert.ok(beyond, 'expected at least one point past center (the overshoot)')
})

class FakeMidi implements MidiOutputBackend {
  readonly portName = 'fake'
  readonly isReal = false
  readonly sent: number[][] = []
  send(bytes: readonly number[]): void {
    this.sent.push([...bytes])
  }
  allNotesOff(): void {}
  close(): void {}
  ofStatus(status: number): number[][] {
    return this.sent.filter((b) => (b[0]! & 0xf0) === status)
  }
}

class FakeScheduler implements RampScheduler {
  private fns: Array<() => void> = []
  setInterval(fn: () => void): unknown {
    this.fns.push(fn)
    return this.fns.length - 1
  }
  clearInterval(handle: unknown): void {
    const idx = handle as number
    this.fns[idx] = () => {}
  }
  tick(times: number): void {
    for (let i = 0; i < times; i += 1) for (const fn of [...this.fns]) fn()
  }
}

function gestureFor(note: number, transition: 'glide' | 'retrigger', durationMs: number): CompiledPunchGesture {
  return {
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    sessionId: 's1',
    eventId: `e${note}`,
    mapHash: 'm1',
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
      brightness: 90,
      expression: 100,
      transition,
      transitionDurationMs: durationMs,
      pitchOvershootCents: 10,
    },
    transient: { note: 36, velocity: 100, layer: 'generic' },
    visual: {
      quadrant: 'upper-left',
      hueDegrees: 200,
      opacity: 0.8,
      radius: 0.1,
      persistenceMs: 4000,
      transitionRibbonMs: durationMs,
    },
  }
}

test('a glide gesture schedules a bend ramp that ends centered', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler)
  renderer.renderGesture(gestureFor(60, 'glide', 100))
  renderer.renderGesture(gestureFor(64, 'glide', 100))
  const bendsBefore = midi.ofStatus(PITCH_BEND).length
  scheduler.tick(Math.ceil(100 / RAMP_STEP_MS) + 2)
  const bends = midi.ofStatus(PITCH_BEND)
  assert.ok(bends.length > bendsBefore, 'ramp emitted bend messages')
  const last = bends[bends.length - 1]!
  const value = (last[1] ?? 0) | ((last[2] ?? 0) << 7)
  assert.equal(value, PITCH_BEND_CENTER)
})

test('a retrigger gesture emits no ramp', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler)
  renderer.renderGesture(gestureFor(60, 'glide', 100))
  const before = midi.ofStatus(PITCH_BEND).length
  renderer.renderGesture(gestureFor(60, 'retrigger', 0))
  scheduler.tick(5)
  // Only the strike's own center reset — no sweeping.
  assert.equal(midi.ofStatus(PITCH_BEND).length, before + 1)
})

test('profile CCs ride each gesture (cutoff 74 + expression 11)', () => {
  const midi = new FakeMidi()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', new FakeScheduler())
  renderer.renderGesture(gestureFor(60, 'glide', 100))
  const ccs = midi.ofStatus(CONTROL_CHANGE).map((b) => b[1])
  assert.ok(ccs.includes(74))
  assert.ok(ccs.includes(11))
  assert.equal(midi.ofStatus(NOTE_ON).filter((b) => b[2]! > 0).length, 1)
})

test('gs-fallback profile skips the cutoff CC', () => {
  const midi = new FakeMidi()
  const renderer = new VoiceRenderer(midi, 'gs-fallback', new FakeScheduler())
  renderer.renderGesture(gestureFor(60, 'glide', 100))
  const ccs = midi.ofStatus(CONTROL_CHANGE).map((b) => b[1])
  assert.ok(!ccs.includes(74))
  assert.ok(ccs.includes(11))
})

test('panic during a ramp cancels it and centers the wheel', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler)
  renderer.renderGesture(gestureFor(60, 'glide', 200))
  renderer.renderGesture(gestureFor(67, 'glide', 200))
  renderer.panic()
  const countAtPanic = midi.sent.length
  scheduler.tick(10)
  assert.equal(midi.sent.length, countAtPanic, 'no messages after panic')
  assert.equal(renderer.activeCount(), 0)
})
