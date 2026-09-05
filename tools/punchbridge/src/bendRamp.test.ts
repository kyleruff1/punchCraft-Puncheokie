/**
 * Bend-ramp + renderer-transition tests. Run: npm test (tools/punchbridge).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bendRampPoints, whammyRampPoints, PITCH_BEND_CENTER } from './bendRamp'
import {
  CONTROL_CHANGE,
  NOTE_ON,
  PITCH_BEND,
  type MidiOutputBackend,
} from './midiBackend'
import { RAMP_STEP_MS, VoiceRenderer, type RampScheduler } from './gestureToMidi'
import { profileById } from './instrumentProfiles'
import {
  INSTRUMENT_SCHEMA_VERSION,
  type CompiledPunchGesture,
  type WhammyAccent,
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
  private oneShots: Array<(() => void) | null> = []
  setInterval(fn: () => void): unknown {
    this.fns.push(fn)
    return this.fns.length - 1
  }
  clearInterval(handle: unknown): void {
    const idx = handle as number
    this.fns[idx] = () => {}
  }
  setTimeout(fn: () => void): unknown {
    this.oneShots.push(fn)
    return `t${this.oneShots.length - 1}`
  }
  clearTimeout(handle: unknown): void {
    const idx = Number(String(handle).slice(1))
    this.oneShots[idx] = null
  }
  tick(times: number): void {
    for (let i = 0; i < times; i += 1) {
      const due = this.oneShots
        .map((fn, idx) => ({ fn, idx }))
        .filter((e): e is { fn: () => void; idx: number } => e.fn !== null)
      for (const e of due) {
        this.oneShots[e.idx] = null
        e.fn()
      }
      for (const fn of [...this.fns]) fn()
    }
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

test('gs-fallback primes both voice channels + the accent channel with the saw program', () => {
  const midi = new FakeMidi()
  const renderer = new VoiceRenderer(midi, 'gs-fallback', new FakeScheduler())
  renderer.prepareVoices()
  // Spec §13: the brass accent channel (wire 3) is primed too, so the
  // ch4 stabs sound with the same thick saw on GM destinations.
  const programs = midi.sent.filter((b) => (b[0]! & 0xf0) === 0xc0)
  assert.equal(programs.length, 3)
  assert.deepEqual(programs.map((b) => b[0]! & 0x0f), [1, 2, 3])
  assert.ok(programs.every((b) => b[1] === 81))
})

test('studio-one profile sends no program change (the DAW owns the patch)', () => {
  const midi = new FakeMidi()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', new FakeScheduler())
  renderer.prepareVoices()
  assert.equal(midi.sent.filter((b) => (b[0]! & 0xf0) === 0xc0).length, 0)
})

test('legato-glide sends the new Note On BEFORE the old Note Off', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler)
  renderer.renderGesture(gestureFor(60, 'glide', 100)) // first strike
  midi.sent.length = 0
  renderer.renderGesture(gestureFor(64, 'glide', 100)) // legato move
  const kinds = midi.sent
    .filter((b) => (b[0]! & 0xf0) === NOTE_ON || (b[0]! & 0xf0) === 0x80)
    .map((b) => ((b[0]! & 0xf0) === NOTE_ON && b[2]! > 0 ? `on${b[1]}` : `off${b[1]}`))
  // Note On 64 must be present with NO off60 yet (delayed past the overlap).
  assert.ok(kinds.includes('on64'))
  assert.ok(!kinds.includes('off60'), 'old note released too early')
  scheduler.tick(1)
  const laterOffs = midi.sent.filter((b) => ((b[0]! & 0xf0) === 0x80 || ((b[0]! & 0xf0) === NOTE_ON && b[2] === 0)) && b[1] === 60)
  assert.equal(laterOffs.length, 1, 'old note released after the overlap')
})

test('wah envelope rides the punch and settles on the baseline', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler)
  renderer.renderGesture(gestureFor(60, 'glide', 100))
  scheduler.tick(80)
  const wahCcs = midi.ofStatus(CONTROL_CHANGE).filter((b) => b[1] === 1)
  assert.ok(wahCcs.length > 3, 'wah CC ramp emitted')
  assert.equal(wahCcs[wahCcs.length - 1]![2], 18, 'settles on baseline 18')
  const peak = Math.max(...wahCcs.map((b) => b[2]!))
  assert.ok(peak > 60, `peak opened (got ${peak})`)
})

test('panic flushes the pending legato note-off and resets the wah CC', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler)
  renderer.renderGesture(gestureFor(60, 'glide', 100))
  renderer.renderGesture(gestureFor(64, 'glide', 100)) // pending off for 60
  renderer.panic()
  const offs = midi.sent
    .filter((b) => (b[0]! & 0xf0) === 0x80 || ((b[0]! & 0xf0) === NOTE_ON && b[2] === 0))
    .map((b) => b[1])
  assert.ok(offs.includes(60), 'pending old note released at panic')
  assert.ok(offs.includes(64), 'held note released at panic')
  const lastWah = midi
    .ofStatus(CONTROL_CHANGE)
    .filter((b) => b[1] === 1)
    .pop()
  assert.equal(lastWah?.[2], 18, 'wah reset to baseline')
  const after = midi.sent.length
  scheduler.tick(10)
  assert.equal(midi.sent.length, after, 'nothing after panic')
})

// ---------------------------------------------------------------------------
// Whammy generator (brass seam plan §3a — spec §12).
// ---------------------------------------------------------------------------

test('whammy rise starts at center, peaks at the top of a ±12 range AT iPeak, settles exactly center', () => {
  const points = whammyRampPoints({
    direction: 'rise',
    semitones: 12,
    durationMs: 300,
    stepMs: 5,
    bendRangeSemitones: 12,
  })
  const n = 60
  const iPeak = Math.round(0.65 * n) // 39
  assert.equal(points.length, n + 1)
  assert.equal(points[0], PITCH_BEND_CENTER)
  assert.equal(points[points.length - 1], PITCH_BEND_CENTER)
  assert.equal(Math.max(...points), 16383)
  assert.equal(points[iPeak], 16383)
  // The peak is the ONE full-excursion sample.
  assert.equal(points.indexOf(16383), iPeak)
  assert.equal(points.lastIndexOf(16383), iPeak)
})

test('whammy peak is a guaranteed sample for EVERY duration (the t-based miss cases)', () => {
  // At stepMs 5 the naive t-based curve misses the exact peak for these
  // durations (max 16377/16382/16379/16381 — machine-verified); the
  // index-based iPeak form hits 16383 exactly on all of them.
  for (const durationMs of [250, 325, 333, 450]) {
    const points = whammyRampPoints({
      direction: 'rise',
      semitones: 12,
      durationMs,
      stepMs: 5,
      bendRangeSemitones: 12,
    })
    const n = Math.max(1, Math.round(durationMs / 5))
    const iPeak = Math.max(1, Math.min(n - 1, Math.round(0.65 * n)))
    assert.equal(points[iPeak], 16383, `duration ${durationMs}: peak sample missed`)
    assert.equal(Math.max(...points), 16383, `duration ${durationMs}: never reached the peak`)
  }
})

test('whammy clamps to a narrow bend range (±2) and still settles centered', () => {
  const points = whammyRampPoints({
    direction: 'rise',
    semitones: 12,
    durationMs: 300,
    stepMs: 5,
    bendRangeSemitones: 2,
  })
  assert.equal(points[0], PITCH_BEND_CENTER)
  assert.equal(Math.max(...points), 16383) // 12 st clamped to the ±2 edge
  assert.equal(points[points.length - 1], PITCH_BEND_CENTER)
  for (const p of points) assert.ok(p >= 0 && p <= 16383)
})

test('whammy dive mirrors below center with a real settle phase (no terminal snap)', () => {
  const points = whammyRampPoints({
    direction: 'dive',
    semitones: 12,
    durationMs: 400,
    stepMs: 5,
    bendRangeSemitones: 12,
  })
  const n = 80
  const iPeak = Math.round(0.65 * n) // 52
  // Full-down is bendValue(−range, range) = 1, not 0 (symmetric excursion).
  assert.equal(points[iPeak], 1)
  assert.equal(Math.min(...points), 1)
  assert.ok(points.some((p) => p < PITCH_BEND_CENTER))
  assert.equal(points[points.length - 1], PITCH_BEND_CENTER)
  // Bounded adjacent deltas the whole way — the settle eases home instead
  // of snapping (bendRampPoints' dive would jump to center at the end).
  for (let i = 1; i < points.length; i += 1) {
    const delta = Math.abs(points[i]! - points[i - 1]!)
    assert.ok(delta <= 500, `snap at sample ${i}: delta ${delta}`)
  }
  assert.ok(Math.abs(points[points.length - 2]! - PITCH_BEND_CENTER) < 100, 'terminal snap')
})

// ---------------------------------------------------------------------------
// Lane priority + brass-path expression (seam plan §3b — spec §11).
// ---------------------------------------------------------------------------

const zeroClock = { now: () => 0 }

const bend14 = (b: number[]): number => (b[1] ?? 0) | ((b[2] ?? 0) << 7)

/** A brass-path gesture: quantized + accent ride along (arp = doc ch3). */
function brassGestureFor(opts: {
  eventId: string
  hand?: 'left' | 'right'
  overshootCents?: number
  durationMs?: number
  whammy?: WhammyAccent
}): CompiledPunchGesture {
  const hand = opts.hand ?? 'left'
  return {
    schemaVersion: INSTRUMENT_SCHEMA_VERSION,
    sessionId: 's1',
    eventId: opts.eventId,
    mapHash: 'm1',
    source: {
      hand,
      receivedMonotonicTimeMs: 0,
      velocity01: 0.5,
      acceleration01: 0.5,
      punchRate01: 0.2,
      gapSincePreviousPunchMs: 0,
      alternating: false,
    },
    cube: {
      leftZone: 0,
      rightZone: 0,
      activityLayer: 1,
      changedAxis: hand,
      targetCoordinate: [0, 0, 1],
    },
    voice: {
      voiceId: hand,
      midiChannel: hand === 'left' ? 2 : 3,
      targetNote: 50,
      noteVelocity: 96,
      brightness: 90,
      expression: 100,
      transition: 'attack',
      transitionDurationMs: opts.durationMs ?? 0,
      pitchOvershootCents: opts.overshootCents ?? 0,
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
      activityPps: 1.0,
      retrigger: 'quantized-rotate',
      backend: 'punchbridge-tick',
    },
    ...(opts.whammy ? { whammy: opts.whammy } : {}),
  }
}

/** Bend values seen on one wire channel, in order. */
function bendsOn(midi: FakeMidi, channel: number): number[] {
  return midi.sent.filter((b) => b[0] === (PITCH_BEND | channel)).map(bend14)
}

test('a bend ramp survives step boundaries untouched (elastic over the running arp)', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler, zeroClock)
  renderer.renderGesture(brassGestureFor({ eventId: 'b1', overshootCents: 10, durationMs: 100 }))
  scheduler.tick(30)
  // The engine stepped across >=3 boundaries meanwhile...
  const arpOns = midi.sent.filter((b) => b[0] === (NOTE_ON | 2) && b[2]! > 0)
  assert.ok(arpOns.length >= 4, `expected >=4 arp steps, got ${arpOns.length}`)
  // ...and the bend stream is EXACTLY the generator's points plus the one
  // trailing center the elastic lane always sends at natural exhaustion.
  const expected = [
    ...bendRampPoints({
      intervalSemitones: 0,
      overshootCents: 10,
      durationMs: 100,
      stepMs: RAMP_STEP_MS,
      bendRangeSemitones: 12,
    }),
    PITCH_BEND_CENTER,
  ]
  assert.deepEqual(bendsOn(midi, 2), expected)
})

test('the wah envelope survives step boundaries and settles on baseline 18', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler, zeroClock)
  renderer.renderGesture(brassGestureFor({ eventId: 'b1' }))
  scheduler.tick(60)
  const arpOns = midi.sent.filter((b) => b[0] === (NOTE_ON | 2) && b[2]! > 0)
  assert.ok(arpOns.length >= 4)
  const wahCcs = midi.sent.filter((b) => b[0] === (CONTROL_CHANGE | 2) && b[1] === 1)
  assert.ok(wahCcs.length > 3, 'wah CC ramp emitted on the arp channel')
  assert.equal(wahCcs[wahCcs.length - 1]![2], 18, 'settles on baseline 18')
})

test('whammy preempts an in-flight elastic with no extra center message', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler, zeroClock)
  renderer.renderGesture(brassGestureFor({ eventId: 'b1', overshootCents: 12, durationMs: 200 }))
  scheduler.tick(4) // elastic p0 (immediate) + 4 interval points
  renderer.renderGesture(
    brassGestureFor({
      eventId: 'b2',
      whammy: { direction: 'rise', semitones: 12, durationMs: 200 },
    }),
  )
  scheduler.tick(60)
  const elastic = bendRampPoints({
    intervalSemitones: 0,
    overshootCents: 12,
    durationMs: 200,
    stepMs: RAMP_STEP_MS,
    bendRangeSemitones: 12,
  })
  const whammy = whammyRampPoints({
    direction: 'rise',
    semitones: 12,
    durationMs: 200,
    stepMs: RAMP_STEP_MS,
    bendRangeSemitones: 12,
  })
  // Elastic prefix, then EXACTLY the whammy generator's output from its
  // own point 0 — no interposed center, no trailing extra center.
  assert.deepEqual(bendsOn(midi, 2), [...elastic.slice(0, 5), ...whammy])
})

test('an elastic requested during a whammy is dropped; the whammy completes naturally', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler, zeroClock)
  renderer.renderGesture(
    brassGestureFor({
      eventId: 'b1',
      whammy: { direction: 'rise', semitones: 12, durationMs: 200 },
    }),
  )
  scheduler.tick(4)
  // Pool-swap punch mid-whammy wants its elastic ornament — dropped.
  renderer.renderGesture(brassGestureFor({ eventId: 'b2', overshootCents: 12, durationMs: 100 }))
  scheduler.tick(60)
  const whammy = whammyRampPoints({
    direction: 'rise',
    semitones: 12,
    durationMs: 200,
    stepMs: RAMP_STEP_MS,
    bendRangeSemitones: 12,
  })
  assert.deepEqual(bendsOn(midi, 2), whammy)
})

test('a second peak punch restarts the whammy (old lane cancelled, fresh center-peak-center)', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler, zeroClock)
  renderer.renderGesture(
    brassGestureFor({
      eventId: 'b1',
      whammy: { direction: 'rise', semitones: 12, durationMs: 200 },
    }),
  )
  scheduler.tick(4)
  renderer.renderGesture(
    brassGestureFor({
      eventId: 'b2',
      whammy: { direction: 'rise', semitones: 12, durationMs: 300 },
    }),
  )
  scheduler.tick(80)
  const first = whammyRampPoints({
    direction: 'rise',
    semitones: 12,
    durationMs: 200,
    stepMs: RAMP_STEP_MS,
    bendRangeSemitones: 12,
  })
  const second = whammyRampPoints({
    direction: 'rise',
    semitones: 12,
    durationMs: 300,
    stepMs: RAMP_STEP_MS,
    bendRangeSemitones: 12,
  })
  assert.deepEqual(bendsOn(midi, 2), [...first.slice(0, 5), ...second])
})

test('a latch-lane strike cancels a whammy and re-centers (hard-reset rule)', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler, zeroClock)
  renderer.renderGesture(gestureFor(60, 'glide', 100)) // first punch: strike
  renderer.renderGesture({
    ...gestureFor(60, 'retrigger', 0),
    whammy: { direction: 'rise', semitones: 12, durationMs: 200 },
  })
  scheduler.tick(3)
  renderer.renderGesture(gestureFor(60, 'retrigger', 0)) // hard reset
  const bends = bendsOn(midi, 1)
  assert.equal(bends[bends.length - 1], PITCH_BEND_CENTER, 'strike re-centered the wheel')
  const count = bends.length
  scheduler.tick(20)
  assert.equal(bendsOn(midi, 1).length, count, 'whammy emitted nothing after the strike')
})

test('a legato move preserves a running whammy and skips its own elastic', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler, zeroClock)
  renderer.renderGesture(gestureFor(60, 'glide', 100)) // strike (one center bend)
  renderer.renderGesture({
    ...gestureFor(64, 'glide', 100), // legato move — never touches the wheel
    whammy: { direction: 'rise', semitones: 12, durationMs: 200 },
  })
  scheduler.tick(3)
  renderer.renderGesture(gestureFor(67, 'glide', 100)) // legato + elastic → dropped
  scheduler.tick(60)
  const whammy = whammyRampPoints({
    direction: 'rise',
    semitones: 12,
    durationMs: 200,
    stepMs: RAMP_STEP_MS,
    bendRangeSemitones: 12,
  })
  assert.deepEqual(bendsOn(midi, 1), [PITCH_BEND_CENTER, ...whammy])
})

test('a whammy accent punch also fires its wah (CC1 envelope alongside the bend ramp)', () => {
  const midi = new FakeMidi()
  const scheduler = new FakeScheduler()
  const renderer = new VoiceRenderer(midi, 'studio-one-stock', scheduler, zeroClock)
  renderer.renderGesture(
    brassGestureFor({
      eventId: 'b1',
      whammy: { direction: 'rise', semitones: 12, durationMs: 200 },
    }),
  )
  scheduler.tick(60)
  const bends = bendsOn(midi, 2)
  assert.equal(Math.max(...bends), 16383)
  assert.equal(bends[bends.length - 1], PITCH_BEND_CENTER)
  const wahCcs = midi.sent.filter((b) => b[0] === (CONTROL_CHANGE | 2) && b[1] === 1)
  assert.ok(wahCcs.length > 3, 'CC1 envelope present alongside the whammy')
  assert.equal(wahCcs[wahCcs.length - 1]![2], 18)
})

test('whammy bend range resolves by the TARGET LANE, not the punching hand', () => {
  const profile = {
    ...profileById('studio-one-stock'),
    pitchBendRangeByVoice: { left: 2, right: 12 },
  }
  // Brass path, LEFT-hand peak: the whammy rides the arp channel, so it
  // resolves via 'right' (±12) — 12 st reaches the full wheel...
  {
    const midi = new FakeMidi()
    const scheduler = new FakeScheduler()
    const renderer = new VoiceRenderer(midi, profile, scheduler, zeroClock)
    renderer.renderGesture(
      brassGestureFor({
        eventId: 'b1',
        hand: 'left',
        whammy: { direction: 'rise', semitones: 12, durationMs: 200 },
      }),
    )
    scheduler.tick(60)
    assert.equal(Math.max(...bendsOn(midi, 2)), 16383)
  }
  // ...and a 4-st brass whammy peaks at the ±12 lane's PARTIAL excursion
  // (10922) — had the punching hand's 'left: 2' been used, 4 st would
  // have clamped to the range edge and hit 16383.
  {
    const midi = new FakeMidi()
    const scheduler = new FakeScheduler()
    const renderer = new VoiceRenderer(midi, profile, scheduler, zeroClock)
    renderer.renderGesture(
      brassGestureFor({
        eventId: 'b2',
        hand: 'left',
        whammy: { direction: 'rise', semitones: 4, durationMs: 200 },
      }),
    )
    scheduler.tick(60)
    assert.equal(Math.max(...bendsOn(midi, 2)), 10922)
  }
  // Latch path, left voice: the same 4-st accent resolves via 'left' and
  // clamps to the Mojito lane's ±2 → full excursion 16383 on ch2 (wire 1).
  {
    const midi = new FakeMidi()
    const scheduler = new FakeScheduler()
    const renderer = new VoiceRenderer(midi, profile, scheduler, zeroClock)
    renderer.renderGesture(gestureFor(60, 'glide', 100))
    renderer.renderGesture({
      ...gestureFor(60, 'retrigger', 0),
      whammy: { direction: 'rise', semitones: 4, durationMs: 200 },
    })
    scheduler.tick(60)
    assert.equal(Math.max(...bendsOn(midi, 1)), 16383)
  }
})
