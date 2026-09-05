/**
 * Brass tick-engine tests (spec §9/§10) + renderer brass-path tests
 * (accent / transient / whammy-over-arp / panic coverage — spec §11).
 * Run: npm test (tools/punchbridge).
 *
 * TimedFakeScheduler: a due-time-ordered advance(ms) over a FakeClock, so
 * gate ratios, boundary grids, and decay wind-down are asserted against
 * real millisecond arithmetic — no wall clock anywhere.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  INSTRUMENT_SCHEMA_VERSION,
  type ArpeggiatorBackend,
  type CompiledPunchGesture,
  type QuantizedChange,
  type RetriggerPolicy,
  type WhammyAccent,
} from '../../../src/domain/instrument/gestureSchema'
import { stepMsFor } from '../../../src/domain/instrument/brassCube'
import { BrassArpEngine, type BrassEngineOptions } from './brassArpEngine'
import { transientNoteFor, VoiceRenderer, type RampScheduler } from './gestureToMidi'
import { CONTROL_CHANGE, NOTE_OFF, NOTE_ON, PITCH_BEND, type MidiOutputBackend } from './midiBackend'
import type { BridgeClock } from './server'

// ---------------------------------------------------------------------------
// Deterministic time: FakeClock + due-time-ordered TimedFakeScheduler.
// ---------------------------------------------------------------------------

class FakeClock implements BridgeClock {
  t = 0
  now(): number {
    return this.t
  }
}

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

  /** Fire every timer due within the window, in due-time order. */
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

class TimedFakeMidi implements MidiOutputBackend {
  readonly portName = 'fake'
  readonly isReal = false
  readonly sent: Array<{ atMs: number; bytes: number[] }> = []
  allNotesOffCount = 0

  constructor(private readonly clock: FakeClock) {}

  send(bytes: readonly number[]): void {
    this.sent.push({ atMs: this.clock.t, bytes: [...bytes] })
  }

  allNotesOff(): void {
    this.allNotesOffCount += 1
  }

  close(): void {}

  onsAt(channel: number): Array<{ atMs: number; note: number; velocity: number }> {
    return this.sent
      .filter((m) => m.bytes[0] === (NOTE_ON | channel) && m.bytes[2]! > 0)
      .map((m) => ({ atMs: m.atMs, note: m.bytes[1]!, velocity: m.bytes[2]! }))
  }

  offsAt(channel: number): Array<{ atMs: number; note: number }> {
    return this.sent
      .filter(
        (m) =>
          m.bytes[0] === (NOTE_OFF | channel) ||
          (m.bytes[0] === (NOTE_ON | channel) && m.bytes[2] === 0),
      )
      .map((m) => ({ atMs: m.atMs, note: m.bytes[1]! }))
  }

  statusCount(status: number): number {
    return this.sent.filter((m) => (m.bytes[0]! & 0xf0) === status).length
  }
}

// ---------------------------------------------------------------------------
// Builders. Engine-direct tests use wire channels arp=2, bass=1.
// ---------------------------------------------------------------------------

const DM9 = { cellId: 'L0R0', chordName: 'Dm9', pool: [50, 53, 57, 60, 64, 74], bass: 26 }
const F69 = { cellId: 'L1R0', chordName: 'F6/9', pool: [53, 57, 60, 62, 67, 77], bass: 29 }
const G9 = { cellId: 'L2R0', chordName: 'G9', pool: [55, 59, 62, 65, 69, 79], bass: 31 }
const DM9_R2 = { cellId: 'L0R2', chordName: 'Dm9', pool: [57, 60, 64, 74, 77, 81], bass: 26 }
const WEAVE = [0, 2, 1, 3, 2, 4, 3, 5]

const LAYERS = [
  { notesPerMinute: 60, gateRatio: 0.75, patternDepth: 3 },
  { notesPerMinute: 120, gateRatio: 0.65, patternDepth: 4 },
  { notesPerMinute: 180, gateRatio: 0.55, patternDepth: 6 },
  { notesPerMinute: 240, gateRatio: 0.45, patternDepth: 8 },
] as const

/** A pps that HOLDS each layer under decay for the spans tests use. */
const PPS_FOR_LAYER = [0.3, 1.7, 3.1, 50] as const

interface QOpts {
  chord?: { cellId: string; chordName: string; pool: number[]; bass: number }
  layer?: 0 | 1 | 2 | 3
  pps?: number
  retrigger?: RetriggerPolicy
  backend?: ArpeggiatorBackend
  pattern?: readonly number[]
  patternDepth?: number
}

function q(opts: QOpts = {}): QuantizedChange {
  const chord = opts.chord ?? DM9
  const layer = opts.layer ?? 1
  const def = LAYERS[layer]
  return {
    cubeCellId: chord.cellId,
    chordName: chord.chordName,
    bassMidiNote: chord.bass,
    bassChannel: 2,
    chordMidiNotes: chord.pool,
    arpStartIndex: 0,
    arpPattern: opts.pattern ?? WEAVE,
    arpChannel: 3,
    notesPerMinute: def.notesPerMinute,
    gateRatio: def.gateRatio,
    patternDepth: opts.patternDepth ?? def.patternDepth,
    activityLayer: layer,
    activityPps: opts.pps ?? PPS_FOR_LAYER[layer],
    retrigger: opts.retrigger ?? 'quantized-rotate',
    backend: opts.backend ?? 'punchbridge-tick',
  }
}

function makeEngine(opts: Partial<BrassEngineOptions> = {}) {
  const clock = new FakeClock()
  const scheduler = new TimedFakeScheduler(clock)
  const midi = new TimedFakeMidi(clock)
  const engine = new BrassArpEngine(midi, scheduler, clock, {
    arpChannel: 2,
    bassChannel: 1,
    bassOverlapMs: 10,
    ...opts,
  })
  return { clock, scheduler, midi, engine }
}

/** A brass-path gesture for renderer-level tests (doc ch3 arp → wire 2). */
function rGesture(opts: {
  eventId: string
  qOpts?: QOpts
  whammy?: WhammyAccent
  accent?: { midiNote: number; midiVelocity: number }
  transientVelocity?: number
  overshootCents?: number
  durationMs?: number
}): CompiledPunchGesture {
  return {
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    sessionId: 's1',
    eventId: opts.eventId,
    mapHash: 'm1',
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
      transitionDurationMs: opts.durationMs ?? 0,
      pitchOvershootCents: opts.overshootCents ?? 0,
    },
    transient: { note: 36, velocity: opts.transientVelocity ?? 100, layer: 'generic' },
    visual: {
      quadrant: 'upper-left',
      hueDegrees: 200,
      opacity: 0.8,
      radius: 0.1,
      persistenceMs: 4000,
      transitionRibbonMs: 0,
    },
    accent: {
      midiNote: opts.accent?.midiNote ?? 55,
      midiVelocity: opts.accent?.midiVelocity ?? 90,
      channel: 4,
      gateMs: 120,
    },
    quantized: q(opts.qOpts ?? {}),
    ...(opts.whammy ? { whammy: opts.whammy } : {}),
  }
}

/** A legacy latch gesture (doc ch2 → wire 1). */
function latchGesture(eventId: string, note: number): CompiledPunchGesture {
  const g = rGesture({ eventId })
  const { accent: _accent, quantized: _quantized, ...rest } = g
  return {
    ...rest,
    voice: { ...g.voice, targetNote: note },
  }
}

// ---------------------------------------------------------------------------
// Engine: structural + runtime bend/CC neutrality (seam #4).
// ---------------------------------------------------------------------------

test('arp steps emit no bend and no CC — runtime check', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 3 }), 96)
  scheduler.advance(2000)
  assert.equal(midi.statusCount(PITCH_BEND), 0)
  assert.equal(midi.statusCount(CONTROL_CHANGE), 0)
  for (const m of midi.sent) {
    const status = m.bytes[0]! & 0xf0
    assert.ok(status === NOTE_ON || status === NOTE_OFF, `non-note status 0x${status.toString(16)}`)
  }
  assert.ok(midi.onsAt(2).length >= 8)
})

test('structural neutrality: brassArpEngine.ts never imports the bend/CC senders', () => {
  const src = readFileSync(join(__dirname, 'brassArpEngine.ts'), 'utf8')
  assert.ok(!/pitchBend/.test(src), 'engine source mentions the bend sender')
  assert.ok(!/controlChange/.test(src), 'engine source mentions the CC sender')
})

test('renderer brass path: boundaries append only note messages (seam #4)', () => {
  const clock = new FakeClock()
  const scheduler = new TimedFakeScheduler(clock)
  const midi = new TimedFakeMidi(clock)
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler, clock)
  renderer.renderGesture(rGesture({ eventId: 'g1' }))
  scheduler.advance(500) // let the per-punch wah envelope finish
  const bends = midi.statusCount(PITCH_BEND)
  const ccs = midi.statusCount(CONTROL_CHANGE)
  const countBefore = midi.sent.length
  scheduler.advance(3000)
  assert.equal(midi.statusCount(PITCH_BEND), bends, 'a boundary emitted a bend')
  assert.equal(midi.statusCount(CONTROL_CHANGE), ccs, 'a boundary emitted a CC')
  for (const m of midi.sent.slice(countBefore)) {
    const status = m.bytes[0]! & 0xf0
    assert.ok(status === NOTE_ON || status === NOTE_OFF)
  }
})

// ---------------------------------------------------------------------------
// Engine: stepping, gates, boundaries, coalescing, retrigger, decay.
// ---------------------------------------------------------------------------

test('tick backend steps Punch Weave over the rotated pool (R3 golden order)', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 3 }), 96)
  scheduler.advance(1751)
  const ons = midi.onsAt(2)
  assert.deepEqual(
    ons.slice(0, 8).map((o) => o.note),
    [50, 57, 53, 60, 57, 64, 60, 74],
  )
  assert.deepEqual(
    ons.slice(0, 8).map((o) => o.atMs),
    [0, 250, 500, 750, 1000, 1250, 1500, 1750],
  )
  assert.ok(ons.every((o) => o.velocity === 96))
})

test('gated noteOff lands at round(stepMs·gateRatio) for each layer', () => {
  for (const layer of [0, 1, 2, 3] as const) {
    const { scheduler, midi, engine } = makeEngine()
    const def = LAYERS[layer]
    engine.applyGesture(q({ layer }), 96)
    const expectedGate = Math.round(stepMsFor(def.notesPerMinute) * def.gateRatio)
    scheduler.advance(expectedGate - 1)
    assert.equal(midi.offsAt(2).length, 0, `layer ${layer}: off fired early`)
    scheduler.advance(1)
    const offs = midi.offsAt(2)
    assert.equal(offs.length, 1, `layer ${layer}: off missing at the gate`)
    assert.equal(offs[0]!.atMs, expectedGate)
    assert.equal(offs[0]!.note, 50)
  }
})

test('boundary-only commits: a mid-step gesture waits; the in-flight step is never rescheduled', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 1, chord: DM9 }), 96) // 120/min → 500 ms steps
  scheduler.advance(200)
  engine.applyGesture(q({ layer: 3, chord: G9 }), 96) // staged only — no MIDI now
  const onsAtStage = midi.onsAt(2)
  assert.equal(onsAtStage.length, 1, 'staging emitted a step')
  scheduler.advance(1000) // through the 500 ms boundary and the next
  const ons = midi.onsAt(2)
  // Commit landed ON the old grid's boundary (t=500, not t=200), with the
  // new cell's entry tone; the next step then runs at the NEW rate (250).
  assert.deepEqual(
    ons.map((o) => ({ atMs: o.atMs, note: o.note })),
    [
      { atMs: 0, note: 50 },
      { atMs: 500, note: 55 }, // weave[0] = 0 → G9 entry tone
      { atMs: 750, note: 62 }, // weave[1] = 2
      { atMs: 1000, note: 59 }, // weave[2] = 1
    ],
  )
})

test('flurry coalescing: 6 staged gestures inside one step → ONE commit from the newest', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 1, chord: DM9 }), 96)
  scheduler.advance(100)
  for (let i = 0; i < 5; i += 1) engine.applyGesture(q({ layer: 1, chord: F69 }), 96)
  engine.applyGesture(q({ layer: 1, chord: G9 }), 96) // newest wins
  scheduler.advance(400) // to the 500 ms boundary
  const ons = midi.onsAt(2)
  assert.equal(ons.length, 2, 'more than one commit stepped')
  assert.deepEqual(ons[1], { atMs: 500, note: 55, velocity: 96 })
  // Bass: initial root, then ONLY the newest chord's root — the five
  // intermediate F6/9 stages never sounded.
  assert.deepEqual(
    midi.onsAt(1).map((o) => o.note),
    [26, 31],
  )
  assert.ok(midi.sent.every((m) => m.bytes[1] !== 29 || (m.bytes[0]! & 0xf0) === NOTE_OFF))
})

test('quantized-rotate: same-cell commit keeps phase; cell change restarts at the entry tone', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 1, chord: DM9 }), 96)
  scheduler.advance(1100) // steps at 0 (50), 500 (57), 1000 (53) — cursor 3
  engine.applyGesture(q({ layer: 1, chord: DM9 }), 96) // same cell
  scheduler.advance(500) // commit at 1500 → phase kept → pattern[3] = 60
  engine.applyGesture(q({ layer: 1, chord: G9 }), 96) // cell change
  scheduler.advance(400) // commit at 2000 → step 0 → entry tone 55
  assert.deepEqual(
    midi.onsAt(2).map((o) => o.note),
    [50, 57, 53, 60, 55],
  )
})

test('hard-retrigger restarts step 0 on EVERY commit, same cell included', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 1, chord: DM9, retrigger: 'hard-retrigger' }), 96)
  scheduler.advance(1100) // 50, 57, 53
  engine.applyGesture(q({ layer: 1, chord: DM9, retrigger: 'hard-retrigger' }), 96)
  scheduler.advance(500) // commit at 1500 → back to step 0
  assert.deepEqual(
    midi.onsAt(2).map((o) => o.note),
    [50, 57, 53, 50],
  )
})

test('continuous-morph: cursor phase survives a pool swap; next notes come from the NEW pool', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 1, chord: DM9, retrigger: 'continuous-morph' }), 96)
  scheduler.advance(1100) // 50, 57, 53 — cursor 3
  engine.applyGesture(q({ layer: 1, chord: G9, retrigger: 'continuous-morph' }), 96)
  scheduler.advance(500) // commit at 1500 → pattern[3] = 3 → G9 pool[3] = 65
  assert.deepEqual(
    midi.onsAt(2).map((o) => o.note),
    [50, 57, 53, 65],
  )
})

test('decay wind-down: layers fall 240→180→120→60, chord stays latched, engine never stops', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 3, pps: 4.0 }), 96)
  scheduler.advance(13000)
  const ons = midi.onsAt(2)
  // Every note stays inside the latched Dm9 pool.
  for (const on of ons) assert.ok(DM9.pool.includes(on.note), `foreign note ${on.note}`)
  // Consecutive step intervals walk the ladder: 250 → 333 → 500 → 1000.
  const intervals: number[] = []
  for (let i = 1; i < ons.length; i += 1) {
    const delta = Math.round(ons[i]!.atMs - ons[i - 1]!.atMs)
    if (intervals[intervals.length - 1] !== delta) intervals.push(delta)
  }
  assert.deepEqual(intervals, [250, 333, 500, 1000])
  // Still stepping at 60/min at the end — no auto-stop.
  assert.equal(engine.running, true)
  assert.ok(ons[ons.length - 1]!.atMs >= 11500, 'engine stopped stepping')
})

test('patternDepth: layer 0 exposes 3 steps; an 8-deep request over a 6-step pattern is clamped', () => {
  {
    const { scheduler, midi, engine } = makeEngine()
    engine.applyGesture(q({ layer: 0 }), 96)
    scheduler.advance(5001) // 6 boundaries at 1000 ms
    assert.deepEqual(
      midi.onsAt(2).map((o) => o.note),
      [50, 57, 53, 50, 57, 53], // pattern[0..2] cycling
    )
  }
  {
    const { scheduler, midi, engine } = makeEngine()
    const fanfare = [0, 2, 4, 1, 3, 5]
    engine.applyGesture(q({ layer: 3, pattern: fanfare, patternDepth: 8 }), 96)
    scheduler.advance(1501) // 7 boundaries at 250 ms
    assert.deepEqual(
      midi.onsAt(2).map((o) => o.note),
      [50, 57, 64, 53, 60, 74, 50], // effLen = min(8, 6) = 6, then wraps
    )
  }
})

test('bass commits at the boundary with legato overlap and only when the root changed', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 1, chord: DM9 }), 96)
  scheduler.advance(600)
  engine.applyGesture(q({ layer: 1, chord: DM9_R2 }), 96) // same root, new rotation
  scheduler.advance(500) // commit at 1000 — root unchanged → no bass traffic
  assert.deepEqual(
    midi.onsAt(1).map((o) => ({ atMs: o.atMs, note: o.note })),
    [{ atMs: 0, note: 26 }],
  )
  engine.applyGesture(q({ layer: 1, chord: G9 }), 96)
  scheduler.advance(500) // commit at 1500 → new on FIRST, old off after 10 ms
  assert.deepEqual(
    midi.onsAt(1).map((o) => ({ atMs: o.atMs, note: o.note })),
    [
      { atMs: 0, note: 26 },
      { atMs: 1500, note: 31 },
    ],
  )
  assert.deepEqual(midi.offsAt(1), [{ atMs: 1510, note: 26 }])
})

test('studio-one-note-fx latches exactly the six rotated notes, re-strikes on cell change, no stepping', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 1, chord: DM9, backend: 'studio-one-note-fx' }), 96)
  assert.deepEqual(
    midi.onsAt(2).map((o) => o.note),
    DM9.pool, // all six, synchronously at boundary 0
  )
  assert.deepEqual(midi.onsAt(1).map((o) => o.note), [26], 'bass still commits')
  scheduler.advance(1600) // three boundaries — no per-step notes
  assert.equal(midi.onsAt(2).length, 6)
  assert.equal(midi.offsAt(2).length, 0)
  engine.applyGesture(q({ layer: 1, chord: DM9, backend: 'studio-one-note-fx' }), 96)
  scheduler.advance(500) // same cell, quantized-rotate → no re-strike
  assert.equal(midi.onsAt(2).length, 6)
  engine.applyGesture(q({ layer: 1, chord: G9, backend: 'studio-one-note-fx' }), 96)
  scheduler.advance(500) // cell change → offs of the old six BEFORE the new six ons
  const tail = midi.sent.filter((m) => m.atMs >= 2500 && (m.bytes[0]! & 0x0f) === 2)
  const offNotes = tail
    .filter((m) => (m.bytes[0]! & 0xf0) === NOTE_OFF)
    .map((m) => m.bytes[1]!)
  const onNotes = tail
    .filter((m) => (m.bytes[0]! & 0xf0) === NOTE_ON && m.bytes[2]! > 0)
    .map((m) => m.bytes[1]!)
  assert.deepEqual(offNotes, DM9.pool)
  assert.deepEqual(onNotes, G9.pool)
  const firstOn = tail.findIndex((m) => (m.bytes[0]! & 0xf0) === NOTE_ON && m.bytes[2]! > 0)
  const lastOff = tail.map((m) => (m.bytes[0]! & 0xf0) === NOTE_OFF).lastIndexOf(true)
  assert.ok(lastOff < firstOn, 'an old note released after a new one struck')
  assert.deepEqual(
    midi.onsAt(1).map((o) => o.note),
    [26, 31],
  )
})

test('backend switch tick→note-fx on the SAME cell seeds the chord latch at the switch boundary', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 1, chord: DM9 }), 96) // punchbridge-tick
  scheduler.advance(600) // steps at 0 (50) and 500 (57); gates self-fire
  engine.applyGesture(q({ layer: 1, chord: DM9, backend: 'studio-one-note-fx' }), 96)
  scheduler.advance(400) // commit at the 1000 ms boundary
  // The regression: the cell id survives a backend switch, so without the
  // seed the note-fx emit branch (cellChanged || hard-retrigger) never ran
  // and the arp channel stayed SILENT. The full rotated chord must latch
  // on the switch boundary even under the quantized-rotate default.
  assert.deepEqual(
    midi.onsAt(2).filter((o) => o.atMs === 1000).map((o) => o.note),
    DM9.pool,
    'same-cell switch into note-fx latched no chord',
  )
  scheduler.advance(1000) // two more boundaries — note-fx never steps
  assert.equal(midi.onsAt(2).length, 8) // 50, 57, then the six-note latch
  // Reverse switch (note-fx→tick, same cell): held chord released at the
  // boundary, stepping resumes. The switch INTO note-fx counted as a cell
  // change (the seed), so the cursor was reset then — tick restarts the
  // weave at the entry tone (weave[0]=0 → 50), not the pre-switch phase.
  engine.applyGesture(q({ layer: 1, chord: DM9 }), 96)
  scheduler.advance(500) // commit at 2500
  assert.deepEqual(
    midi.offsAt(2).filter((o) => o.atMs === 2500).map((o) => o.note),
    DM9.pool,
    'held chord not released on the switch out of note-fx',
  )
  assert.deepEqual(
    midi.onsAt(2).filter((o) => o.atMs === 2500).map((o) => o.note),
    [50],
  )
  // Bass root never changed → exactly one bass on across all four commits.
  assert.deepEqual(midi.onsAt(1).map((o) => o.note), [26])
})

test('engine.stop flushes the pending gated off + bass, offs everything, then silence', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 1 }), 96)
  scheduler.advance(100) // gate (325 ms) has NOT fired yet
  engine.stop()
  assert.deepEqual(midi.offsAt(2), [{ atMs: 100, note: 50 }], 'pending gated off flushed')
  assert.deepEqual(midi.offsAt(1), [{ atMs: 100, note: 26 }], 'bass released')
  assert.equal(engine.running, false)
  const count = midi.sent.length
  scheduler.advance(5000)
  assert.equal(midi.sent.length, count, 'messages after stop')
})

test('no duplicate offs from fired timers: gate expires, then stop → exactly ONE off for that note', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q({ layer: 1 }), 96)
  scheduler.advance(400) // the 325 ms gate fired and self-cleared
  assert.equal(midi.offsAt(2).length, 1)
  engine.stop()
  assert.equal(
    midi.offsAt(2).filter((o) => o.note === 50).length,
    1,
    'stop re-sent an already-fired gated off',
  )
})

// ---------------------------------------------------------------------------
// Renderer brass path: accents, transients, whammy-over-arp, panic, latch.
// ---------------------------------------------------------------------------

function makeRenderer(profile: string = 'studio-one-stock') {
  const clock = new FakeClock()
  const scheduler = new TimedFakeScheduler(clock)
  const midi = new TimedFakeMidi(clock)
  const renderer = new VoiceRenderer(midi, profile, scheduler, clock)
  return { clock, scheduler, midi, renderer }
}

const bend14 = (bytes: number[]): number => (bytes[1] ?? 0) | ((bytes[2] ?? 0) << 7)

test('immediate accent: wire 3 noteOn at the accent velocity, noteOff after gateMs 120', () => {
  const { scheduler, midi, renderer } = makeRenderer()
  renderer.renderGesture(rGesture({ eventId: 'g1', accent: { midiNote: 55, midiVelocity: 90 } }))
  const ons = midi.onsAt(3)
  assert.deepEqual(ons, [{ atMs: 0, note: 55, velocity: 90 }])
  scheduler.advance(119)
  assert.equal(midi.offsAt(3).length, 0)
  scheduler.advance(1)
  assert.deepEqual(midi.offsAt(3), [{ atMs: 120, note: 55 }])
})

test('transient ladder: 60/85/105/120 → 37/38/36/49 on wire 9, offs after 60 ms; never for latch', () => {
  assert.equal(transientNoteFor(60), 37)
  assert.equal(transientNoteFor(85), 38)
  assert.equal(transientNoteFor(105), 36)
  assert.equal(transientNoteFor(120), 49)
  const { scheduler, midi, renderer } = makeRenderer()
  const velocities = [60, 85, 105, 120]
  for (let i = 0; i < velocities.length; i += 1) {
    renderer.renderGesture(rGesture({ eventId: `g${i}`, transientVelocity: velocities[i]! }))
    scheduler.advance(1000)
  }
  assert.deepEqual(
    midi.onsAt(9).map((o) => ({ atMs: o.atMs, note: o.note, velocity: o.velocity })),
    [
      { atMs: 0, note: 37, velocity: 60 },
      { atMs: 1000, note: 38, velocity: 85 },
      { atMs: 2000, note: 36, velocity: 105 },
      { atMs: 3000, note: 49, velocity: 120 },
    ],
  )
  assert.deepEqual(
    midi.offsAt(9).map((o) => o.atMs),
    [60, 1060, 2060, 3060],
  )
  // A latch gesture sends NO transient (R1 — legacy stream byte-identical).
  const before = midi.onsAt(9).length
  renderer.renderGesture(latchGesture('L1', 60))
  scheduler.advance(500)
  assert.equal(midi.onsAt(9).length, before)
})

test('whammy-over-arp ordering: pattern keeps stepping under the bend ramp (seam #7)', () => {
  const { scheduler, midi, renderer } = makeRenderer()
  renderer.renderGesture(rGesture({ eventId: 'g1', qOpts: { layer: 3 } }))
  scheduler.advance(505)
  renderer.renderGesture(
    rGesture({
      eventId: 'g2',
      qOpts: { layer: 3 },
      whammy: { direction: 'rise', semitones: 12, durationMs: 600 },
    }),
  )
  scheduler.advance(700)
  const bends = midi.sent.filter((m) => m.bytes[0] === (PITCH_BEND | 2))
  assert.equal(bends.length, 121) // exactly the generator's points
  assert.equal(Math.max(...bends.map((m) => bend14(m.bytes))), 16383)
  assert.equal(bend14(bends[bends.length - 1]!.bytes), 8192)
  const firstBendAt = bends[0]!.atMs
  const lastBendAt = bends[bends.length - 1]!.atMs
  const onsDuring = midi
    .onsAt(2)
    .filter((o) => o.atMs > firstBendAt && o.atMs < lastBendAt)
  assert.ok(onsDuring.length >= 2, `pattern paused under the whammy (${onsDuring.length} ons)`)
  // Step offs still pair up (at most the current step's gate outstanding).
  const ons = midi.onsAt(2).length
  const offs = midi.offsAt(2).length
  assert.ok(ons - offs <= 1 && ons >= offs, `unpaired steps: ${ons} ons / ${offs} offs`)
})

test('panic during whammy+arp: engine stopped, gates flushed, EVERY touched channel centered (seam #14 + R5)', () => {
  const { scheduler, midi, renderer } = makeRenderer()
  renderer.renderGesture(rGesture({ eventId: 'g1', qOpts: { layer: 3 } }))
  scheduler.advance(505)
  renderer.renderGesture(
    rGesture({
      eventId: 'g2',
      qOpts: { layer: 3 },
      whammy: { direction: 'rise', semitones: 12, durationMs: 600 },
    }),
  )
  scheduler.advance(50) // whammy mid-flight; accent + transient gates pending
  const panicAt = midi.sent.length
  renderer.panic()
  const tail = midi.sent.slice(panicAt)
  // Center bend + wah baseline reach bass (1), arp (2), accent (3), and
  // transient (9) — the pre-existing gap: none of these hold a latch.
  const centered = new Set(
    tail
      .filter((m) => (m.bytes[0]! & 0xf0) === PITCH_BEND && bend14(m.bytes) === 8192)
      .map((m) => m.bytes[0]! & 0x0f),
  )
  assert.deepEqual([...centered].sort((a, b) => a - b), [1, 2, 3, 9])
  const wahReset = new Set(
    tail
      .filter((m) => (m.bytes[0]! & 0xf0) === CONTROL_CHANGE && m.bytes[1] === 1 && m.bytes[2] === 18)
      .map((m) => m.bytes[0]! & 0x0f),
  )
  assert.deepEqual([...wahReset].sort((a, b) => a - b), [1, 2, 3, 9])
  // Every sounding note released: per channel, ons == offs.
  for (const channel of [1, 2, 3, 9]) {
    assert.equal(
      midi.onsAt(channel).length,
      midi.offsAt(channel).length,
      `channel ${channel} left sounding`,
    )
  }
  assert.equal(midi.allNotesOffCount, 1)
  const after = midi.sent.length
  scheduler.advance(5000)
  assert.equal(midi.sent.length, after, 'messages after panic')
})

test('panic after gates expired re-sends nothing (self-cleared one-shots)', () => {
  const { scheduler, midi, renderer } = makeRenderer()
  renderer.renderGesture(
    rGesture({ eventId: 'g1', accent: { midiNote: 55, midiVelocity: 90 }, transientVelocity: 60 }),
  )
  scheduler.advance(400) // accent off @120, transient off @60, step gate @325 — all fired
  renderer.panic()
  assert.equal(midi.offsAt(3).filter((o) => o.note === 55).length, 1, 'accent off duplicated')
  assert.equal(midi.offsAt(9).filter((o) => o.note === 37).length, 1, 'transient off duplicated')
  assert.equal(midi.offsAt(2).filter((o) => o.note === 50).length, 1, 'step off duplicated')
})

test('a latch gesture after brass gestures stops the engine, then strikes normally (seam #16)', () => {
  const { scheduler, midi, renderer } = makeRenderer()
  renderer.renderGesture(rGesture({ eventId: 'g1', qOpts: { layer: 1 } }))
  scheduler.advance(600) // stepping; the 500 ms boundary's gate is pending
  renderer.renderGesture(latchGesture('L1', 60))
  // Engine flushed: every arp note paired, bass released.
  assert.equal(midi.onsAt(2).length, midi.offsAt(2).length)
  assert.equal(midi.onsAt(1).filter((o) => o.note === 26).length, 1)
  assert.ok(midi.offsAt(1).some((o) => o.note === 26))
  // Normal strike on the latch channel (wire 1): center + note on.
  const strikes = midi.onsAt(1).filter((o) => o.note === 60)
  assert.equal(strikes.length, 1)
  const arpOns = midi.onsAt(2).length
  scheduler.advance(3000)
  assert.equal(midi.onsAt(2).length, arpOns, 'engine kept stepping after the latch gesture')
})
