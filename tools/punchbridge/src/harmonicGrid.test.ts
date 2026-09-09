/**
 * M40-17 — one-transport harmonic commit grid + fail-closed handshake.
 *
 * Covers: the boundary lattice math (crossed boundaries, audible-tick
 * rule), the pure commit fold (coalescing, dedup, stale generations), the
 * field driver's deterministic audible-commit + atomic apply (Kyle's
 * rate-change ambiguity case verbatim), missed-boundary recovery (no
 * burst), window changes on their own boundary, total-silence stop, and
 * the schemaVersion-2 hello negotiation (capability + clock rejects,
 * gesture gating). The legacy byte-equal capture lives in
 * brassArpEngine.test.ts — that entire suite runs against the refactor.
 *
 * Run: npm test (tools/punchbridge).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  HARMONIC_SCHEMA_VERSION,
  INSTRUMENT_SCHEMA_VERSION,
  type CompiledPunchGesture,
  type PunchBridgeAck,
  type QuantizedChange,
} from '../../../src/domain/instrument/gestureSchema'
import {
  foldHarmonicCommit,
  type StagedHarmonicChange,
} from '../../../src/domain/instrument/harmonicCommit'
import {
  arpIntervalTicksFor,
  boundaryTickOf,
  crossedBoundaryIndices,
  msForTicks,
  nextBoundaryTickAtOrAfter,
  TRANSPORT_GCD_TICKS,
} from '../../../src/domain/instrument/transportGrid'
import { BrassArpEngine } from './brassArpEngine'
import { BridgeSession, BRIDGE_CAPABILITIES, type BridgeSocketLike } from './server'
import {
  FakeClock,
  ManualScheduler,
  TimedFakeMidi,
  TimedFakeScheduler,
} from './testHarness'

// ---------------------------------------------------------------------------
// Lattice math.
// ---------------------------------------------------------------------------

test('crossedBoundaryIndices: start-of-transport, mid-span, stall spans, empty', () => {
  const grid = { phaseTick: 0, intervalTicks: 480 }
  assert.deepEqual(crossedBoundaryIndices(-1, 0, grid), [0])
  assert.deepEqual(crossedBoundaryIndices(0, 80, grid), [])
  assert.deepEqual(crossedBoundaryIndices(400, 480, grid), [1])
  assert.deepEqual(crossedBoundaryIndices(0, 1440, grid), [1, 2, 3])
  // Re-anchored grid: boundaries at 640 + k·240.
  const anchored = { phaseTick: 640, intervalTicks: 240 }
  assert.deepEqual(crossedBoundaryIndices(640, 1120, anchored), [1, 2])
  assert.equal(boundaryTickOf(2, anchored), 1120)
})

test('nextBoundaryTickAtOrAfter: on-boundary is itself; the SOUNDING grid decides (am. 4)', () => {
  const sounding320 = { phaseTick: 0, intervalTicks: 320 }
  assert.equal(nextBoundaryTickAtOrAfter(640, sounding320), 640)
  // Kyle's ambiguity case: requested 480 is a boundary under the NEW 240
  // rate but NOT under the sounding 320 grid — audible must be 640.
  assert.equal(nextBoundaryTickAtOrAfter(480, sounding320), 640)
  assert.equal(nextBoundaryTickAtOrAfter(-40, sounding320), 0)
})

test('interval tables: arp rates and the GCD divide every grid', () => {
  assert.deepEqual([60, 120, 180, 240].map(arpIntervalTicksFor), [960, 480, 320, 240])
  for (const interval of [960, 480, 320, 240]) {
    assert.equal(interval % TRANSPORT_GCD_TICKS, 0)
  }
  assert.equal(msForTicks(480), 500)
})

// ---------------------------------------------------------------------------
// The pure fold.
// ---------------------------------------------------------------------------

const DM9 = { cellId: 'L0R0', chordName: 'Dm9', pool: [50, 53, 57, 60, 64, 74], bass: 26 }
const F69 = { cellId: 'L1R0', chordName: 'F6/9', pool: [53, 57, 60, 62, 67, 77], bass: 29 }
const G9 = { cellId: 'L2R0', chordName: 'G9', pool: [55, 59, 62, 65, 69, 79], bass: 31 }
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
  commitIntervalTicks?: number
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
    arpPattern: WEAVE,
    arpChannel: 3,
    notesPerMinute: def.notesPerMinute,
    gateRatio: def.gateRatio,
    patternDepth: def.patternDepth,
    activityLayer: layer,
    activityPps: opts.pps ?? PPS_FOR_LAYER[layer],
    retrigger: 'quantized-rotate',
    backend: 'punchbridge-tick',
    commitIntervalTicks: opts.commitIntervalTicks ?? 480,
  }
}

function stagedOf(eventId: string, opts: QOpts = {}, gen?: { t?: number; p?: number }): StagedHarmonicChange {
  return {
    eventId,
    q: q(opts),
    noteVelocity: 96,
    ...(gen?.t !== undefined ? { transportGeneration: gen.t } : {}),
    ...(gen?.p !== undefined ? { patchGeneration: gen.p } : {}),
  }
}

test('fold: newest wins, ids collected in receipt order, duplicates one vote', () => {
  const folded = foldHarmonicCommit(
    [stagedOf('p1', { chord: DM9 }), stagedOf('p2', { chord: F69 }), stagedOf('p2', { chord: F69 }), stagedOf('p3', { chord: G9, layer: 3 })],
    { previousCellId: null, requestedCommitTick: 480, soundingArpGrid: { phaseTick: 0, intervalTicks: 480 } },
  )
  assert.ok(folded)
  assert.deepEqual(folded.commit.contributingPunchEventIds, ['p1', 'p2', 'p3'])
  assert.equal(folded.commit.resolvedCellId, G9.cellId)
  assert.equal(folded.commit.bassNote, G9.bass)
  assert.equal(folded.commit.entryTone, 55)
  assert.equal(folded.commit.previousCellId, null)
  assert.equal(folded.commit.requestedCommitTick, 480)
  assert.equal(folded.commit.audibleCommitTick, 480)
  assert.equal(folded.commit.previousArpIntervalTicks, 480)
  assert.equal(folded.commit.nextArpIntervalTicks, 240) // layer 3 → 240/min
  assert.equal(folded.commit.nextArpPhaseTick, 480)
  assert.equal(folded.commit.commitId, `c480-${G9.cellId}`)
})

test('fold: stale transport/patch generations dropped; all-stale folds to null', () => {
  const folded = foldHarmonicCommit(
    [stagedOf('old', { chord: G9 }, { t: 1 }), stagedOf('new', { chord: F69 }, { t: 2 })],
    {
      previousCellId: DM9.cellId,
      requestedCommitTick: 960,
      soundingArpGrid: { phaseTick: 0, intervalTicks: 480 },
      currentTransportGeneration: 2,
    },
  )
  assert.ok(folded)
  assert.deepEqual(folded.commit.contributingPunchEventIds, ['new'])
  assert.equal(folded.commit.resolvedCellId, F69.cellId)

  const allStale = foldHarmonicCommit(
    [stagedOf('old', {}, { p: 3 })],
    {
      previousCellId: DM9.cellId,
      requestedCommitTick: 960,
      soundingArpGrid: { phaseTick: 0, intervalTicks: 480 },
      currentPatchGeneration: 4,
    },
  )
  assert.equal(allStale, null)
})

// ---------------------------------------------------------------------------
// Field driver: the ONE transport in the engine.
// ---------------------------------------------------------------------------

function makeFieldEngine() {
  const clock = new FakeClock()
  const scheduler = new TimedFakeScheduler(clock)
  const midi = new TimedFakeMidi(clock)
  const engine = new BrassArpEngine(midi, scheduler, clock, {
    arpChannel: 2,
    bassChannel: 1,
    bassOverlapMs: 10,
  })
  return { clock, scheduler, midi, engine }
}

const ms = (tick: number): number => Math.round(msForTicks(tick))

test('field downbeat: first punch commits and steps at tick 0 synchronously', () => {
  const { midi, engine } = makeFieldEngine()
  engine.applyGesture(q({ chord: DM9 }), 96, { eventId: 'p1' })
  assert.deepEqual(
    midi.onsAt(2).map((o) => ({ atMs: o.atMs, note: o.note })),
    [{ atMs: 0, note: 50 }],
  )
  assert.deepEqual(midi.onsAt(1).map((o) => o.note), [26])
  const commit = engine.lastHarmonicCommit
  assert.ok(commit)
  assert.equal(commit.requestedCommitTick, 0)
  assert.equal(commit.audibleCommitTick, 0)
  assert.deepEqual(commit.contributingPunchEventIds, ['p1'])
})

test('one transport, two projections: a mid-window punch waits for the harmonic boundary, lands on the sounding arp grid (requested 480 → audible 640)', () => {
  const { scheduler, midi, engine } = makeFieldEngine()
  // Establish at 180/min: arp interval 320 ticks (333.3 ms), window 480.
  engine.applyGesture(q({ chord: DM9, layer: 2 }), 96, { eventId: 'p1' })
  scheduler.advance(100) // t=100
  engine.applyGesture(q({ chord: G9, layer: 2 }), 96, { eventId: 'p2' })
  scheduler.advance(1000) // through boundary 480 (500 ms) and beyond
  const ons = midi.onsAt(2)
  // Steps at ticks 0 (Dm9 entry 50), 320 (Dm9), 640 — the COMMIT tick.
  assert.deepEqual(
    ons.slice(0, 3).map((o) => ({ atMs: Math.round(o.atMs), note: o.note })),
    [
      { atMs: 0, note: 50 },
      { atMs: ms(320), note: 57 }, // weave[1]=2 → Dm9 pool[2]
      { atMs: ms(640), note: 55 }, // G9 entry tone — the audible commit
    ],
  )
  // Bass moved WITH the pool at the audible tick — never under the old arp note.
  assert.deepEqual(
    midi.onsAt(1).map((o) => ({ atMs: Math.round(o.atMs), note: o.note })),
    [
      { atMs: 0, note: 26 },
      { atMs: ms(640), note: 31 },
    ],
  )
  const commit = engine.lastHarmonicCommit
  assert.ok(commit)
  assert.equal(commit.requestedCommitTick, 480)
  assert.equal(commit.audibleCommitTick, 640)
})

test("Kyle's rate-change ambiguity: audible tick from the OLD grid; new rate anchors atomically at the audible tick", () => {
  const { scheduler, midi, engine } = makeFieldEngine()
  // Open at layer 3 so the arrangement rail (M40-22C) initialises to Peak
  // and permits the rate change under test; the rail's own bar-quantized
  // limiting is exercised in arrangementRail.test.ts.
  engine.applyGesture(q({ chord: DM9, layer: 3 }), 96, { eventId: 'p0' })
  scheduler.advance(600)
  engine.applyGesture(q({ chord: DM9, layer: 2 }), 96, { eventId: 'p1' }) // → 320-tick grid
  scheduler.advance(600)
  // The sounding grid is anchored where the previous commit left it.
  const soundingPhase = engine.lastHarmonicCommit!.nextArpPhaseTick
  engine.applyGesture(q({ chord: G9, layer: 3 }), 96, { eventId: 'p2' }) // → 240-tick rate
  scheduler.advance(1200)
  const commit = engine.lastHarmonicCommit
  assert.ok(commit)
  const onGrid = (tick: number): boolean => (tick - soundingPhase) % 320 === 0
  // The RELATIONSHIP is the rule (am. 4), not any absolute tick: the
  // sounding grid was 320 ticks, the requested tick is NOT one of its
  // boundaries, and the commit lands on the next one that IS — never a
  // boundary that exists only under the incoming 240-tick rate.
  assert.equal(commit.previousArpIntervalTicks, 320)
  assert.equal(onGrid(commit.requestedCommitTick), false, 'the case needs an off-grid request')
  assert.equal(onGrid(commit.audibleCommitTick), true, 'commit landed off the SOUNDING grid')
  assert.equal(
    commit.audibleCommitTick,
    soundingPhase + Math.ceil((commit.requestedCommitTick - soundingPhase) / 320) * 320,
    'commit did not land on the FIRST sounding boundary at or after the request',
  )
  // The new rate applies atomically there and anchors the next grid.
  assert.equal(commit.nextArpIntervalTicks, 240)
  assert.equal(commit.nextArpPhaseTick, commit.audibleCommitTick)
  // Steps run on the old stride up to the commit, the new stride after it.
  const ons = midi.onsAt(2).map((o) => Math.round(o.atMs))
  const commitMs = ms(commit.audibleCommitTick)
  const before = ons.filter((t) => t <= commitMs)
  const after = ons.filter((t) => t > commitMs)
  assert.equal(Math.round(before[before.length - 1]! - before[before.length - 2]!), ms(320))
  assert.equal(Math.round(after[0]! - commitMs), ms(240))
})

test('flurry coalescing: six punches in one window → ONE commit carrying every eventId', () => {
  const { scheduler, midi, engine } = makeFieldEngine()
  engine.applyGesture(q({ chord: DM9 }), 96, { eventId: 'p0' }) // 480-tick grid + window
  scheduler.advance(50)
  for (let i = 1; i <= 5; i += 1) {
    engine.applyGesture(q({ chord: F69 }), 96, { eventId: `p${i}` })
    scheduler.advance(20)
  }
  engine.applyGesture(q({ chord: G9 }), 96, { eventId: 'p6' }) // newest wins
  scheduler.advance(400) // through the 500 ms boundary
  const commit = engine.lastHarmonicCommit
  assert.ok(commit)
  assert.deepEqual(commit.contributingPunchEventIds, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])
  assert.equal(commit.resolvedCellId, G9.cellId)
  assert.equal(commit.previousCellId, DM9.cellId)
  // Bass: establish root, then ONLY the winner's root — F6/9 never sounded.
  assert.deepEqual(midi.onsAt(1).map((o) => o.note), [26, 31])
  assert.equal(engine.telemetry().commits, 2)
})

test('window change lands on its OWN boundary: the new interval re-anchors from there', () => {
  const { scheduler, midi, engine } = makeFieldEngine()
  engine.applyGesture(q({ chord: DM9, commitIntervalTicks: 480 }), 96, { eventId: 'p1' })
  scheduler.advance(100)
  // A settings-changed patch: the staged punch carries a 960-tick window.
  engine.applyGesture(q({ chord: F69, commitIntervalTicks: 960 }), 96, { eventId: 'p2' })
  scheduler.advance(500) // old-grid boundary at tick 480 folds + commits p2
  assert.equal(engine.lastHarmonicCommit?.resolvedCellId, F69.cellId)
  assert.equal(engine.lastHarmonicCommit?.requestedCommitTick, 480)
  // The NEXT window is 960 ticks anchored at 480 → boundary at tick 1440.
  engine.applyGesture(q({ chord: G9, commitIntervalTicks: 960 }), 96, { eventId: 'p3' })
  scheduler.advance(1000) // t=1600 — past tick 960 (which is NOT a boundary now)
  assert.equal(engine.lastHarmonicCommit?.resolvedCellId, G9.cellId)
  assert.equal(engine.lastHarmonicCommit?.requestedCommitTick, 1440)
  assert.equal(Math.round(midi.onsAt(1)[2]!.atMs), ms(1440))
})

test('stalled scheduler: coalesced commit, no note burst, phase continues, skips recorded', () => {
  const clock = new FakeClock()
  const scheduler = new ManualScheduler(clock)
  const midi = new TimedFakeMidi(clock)
  const engine = new BrassArpEngine(midi, scheduler, clock, {
    arpChannel: 2,
    bassChannel: 1,
    bassOverlapMs: 10,
  })
  // Layer 3: 240-tick steps (250 ms); window 480 (500 ms).
  engine.applyGesture(q({ chord: DM9, layer: 3 }), 96, { eventId: 'p1' })
  assert.equal(midi.onsAt(2).length, 1) // downbeat
  // Run two clean wakeups (the GCD stride), then STALL for ~1.2 s.
  clock.t = msForTicks(80)
  scheduler.drainDue()
  clock.t = msForTicks(160)
  scheduler.drainDue()
  engine.applyGesture(q({ chord: G9, layer: 3 }), 96, { eventId: 'p2' }) // staged mid-window
  const onsBeforeStall = midi.onsAt(2).length
  scheduler.stallUntil(msForTicks(1520)) // sleep through ticks 240..1520
  scheduler.fireNext() // ONE late wakeup spans the whole gap
  const newOns = midi.onsAt(2).slice(onsBeforeStall)
  // Boundaries 240/480/720/960/1200/1440 were slept through — exactly ONE
  // step sounds on recovery (the newest boundary), never a burst.
  assert.equal(newOns.length, 1)
  assert.equal(Math.round(newOns[0]!.atMs), Math.round(msForTicks(1520)))
  // The stalled window folded + committed: the recovery step is G9.
  assert.equal(engine.lastHarmonicCommit?.resolvedCellId, G9.cellId)
  assert.ok(engine.telemetry().skippedArpSteps >= 4, `skips=${engine.telemetry().skippedArpSteps}`)
  assert.ok(engine.telemetry().maxLatenessMs > 1000)
  engine.stop()
})

test('field decay is FALL-only between commits, and the rail caps a mid-bar lift', () => {
  const { scheduler, midi, engine } = makeFieldEngine()
  engine.applyGesture(q({ chord: DM9, layer: 2 }), 96, { eventId: 'p1' }) // 320-tick grid
  scheduler.advance(100)
  engine.applyGesture(q({ chord: G9, layer: 3, pps: 50 }), 96, { eventId: 'p2' })
  scheduler.advance(600) // decay at tick 320, then the audible commit at 640
  // Before the commit the grid must still be 320 ticks: the second step
  // stays at t≈333, not a raised 250 ms stride.
  const ons = midi.onsAt(2)
  assert.equal(Math.round(ons[1]!.atMs), ms(320))
  // And AFTER it the rate is still 320 — the rail opened at Drive, so a
  // layer-3 request mid-bar is capped until the next bar boundary (am. 7).
  assert.equal(engine.arrangementScene, 'drive')
  assert.equal(engine.lastHarmonicCommit?.nextArpIntervalTicks, 320)
})

test('field stop(): total silence — every on paired, nothing after', () => {
  const { scheduler, midi, engine } = makeFieldEngine()
  engine.applyGesture(q({ chord: DM9, layer: 3 }), 96, { eventId: 'p1' })
  scheduler.advance(120) // a gated off is pending
  engine.applyGesture(q({ chord: G9, layer: 3 }), 96, { eventId: 'p2' }) // staged, uncommitted
  engine.stop()
  assert.equal(midi.onsAt(2).length, midi.offsAt(2).length)
  assert.equal(midi.onsAt(1).length, midi.offsAt(1).length)
  assert.equal(engine.running, false)
  const count = midi.sent.length
  scheduler.advance(5000)
  assert.equal(midi.sent.length, count, 'messages after stop')
})

// ---------------------------------------------------------------------------
// The fail-closed v2 handshake (server side).
// ---------------------------------------------------------------------------

class FakeSocket implements BridgeSocketLike {
  readonly sent: string[] = []
  closed = false
  send(data: string): void {
    this.sent.push(data)
  }
  close(): void {
    this.closed = true
  }
  lastAck(): PunchBridgeAck {
    const last = this.sent[this.sent.length - 1]
    assert.ok(last, 'no ack sent')
    return JSON.parse(last) as PunchBridgeAck
  }
}

function makeSession() {
  const clock = new FakeClock()
  const scheduler = new TimedFakeScheduler(clock)
  const midi = new TimedFakeMidi(clock)
  const socket = new FakeSocket()
  const session = new BridgeSession(socket, { midi, clock, scheduler })
  return { clock, scheduler, midi, socket, session }
}

const V2_CLOCK = {
  authority: 'punchbridge',
  beatsPerMinute: 60,
  ticksPerBeat: 960,
  transportEpochId: 's1#1',
}

function v2Hello(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'hello',
    schemaVersion: HARMONIC_SCHEMA_VERSION,
    sessionId: 's1',
    mapHash: 'm2',
    requiredCapabilities: [...BRIDGE_CAPABILITIES],
    worldManifestHash: 'w1',
    compiledFieldHash: 'f1',
    effectivePatchHash: 'e1',
    patchGeneration: 0,
    transportGeneration: 1,
    clock: V2_CLOCK,
    heartbeatMs: 1000,
    ...overrides,
  })
}

function v2Gesture(eventId: string): string {
  const gesture: CompiledPunchGesture = {
    schemaVersion: HARMONIC_SCHEMA_VERSION,
    sessionId: 's1',
    eventId,
    mapHash: 'm2',
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
    quantized: q({ chord: DM9 }),
  }
  return JSON.stringify({
    type: 'punch-gesture',
    schemaVersion: HARMONIC_SCHEMA_VERSION,
    sessionId: 's1',
    sequence: 7,
    mapHash: 'm2',
    sentAtMonotonicMs: 0,
    gesture,
  })
}

test('v2 hello accepted: ack echoes identity + capabilities; gestures then render', () => {
  const { midi, socket, session } = makeSession()
  session.onText(v2Hello())
  const ack = socket.lastAck()
  assert.equal(ack.type, 'hello-ack')
  assert.equal(ack.accepted, true)
  assert.deepEqual(ack.supportedCapabilities, [...BRIDGE_CAPABILITIES])
  assert.deepEqual(ack.missingCapabilities, [])
  assert.equal(ack.compiledFieldHash, 'f1')
  assert.equal(ack.effectivePatchHash, 'e1')
  assert.equal(ack.patchGeneration, 0)
  session.onText(v2Gesture('g1'))
  assert.equal(socket.lastAck().rejected, undefined)
  assert.ok(midi.onsAt(2).length >= 1, 'accepted session rendered nothing')
})

test('missing capability: hello REJECTED with the missing list; v2 gestures stay dead — no silent legacy fallback', () => {
  const { midi, socket, session } = makeSession()
  session.onText(v2Hello({ requiredCapabilities: [...BRIDGE_CAPABILITIES, 'telegraph-wire-v3'] }))
  const ack = socket.lastAck()
  assert.equal(ack.accepted, false)
  assert.deepEqual(ack.missingCapabilities, ['telegraph-wire-v3'])
  assert.match(ack.rejected ?? '', /telegraph-wire-v3/)
  const before = midi.sent.length
  session.onText(v2Gesture('g1'))
  assert.match(socket.lastAck().rejected ?? '', /hello rejected/)
  assert.equal(midi.sent.length, before, 'rejected session emitted MIDI')
})

test('clock contract: a non-punchbridge authority or wrong tick base is rejected', () => {
  {
    const { socket, session } = makeSession()
    session.onText(v2Hello({ clock: { ...V2_CLOCK, authority: 'studio-one-host' } }))
    assert.equal(socket.lastAck().accepted, false)
    assert.match(socket.lastAck().rejected ?? '', /clock authority/)
  }
  {
    const { socket, session } = makeSession()
    session.onText(v2Hello({ clock: { ...V2_CLOCK, ticksPerBeat: 480 } }))
    assert.equal(socket.lastAck().accepted, false)
    assert.match(socket.lastAck().rejected ?? '', /ticksPerBeat/)
  }
  {
    const { socket, session } = makeSession()
    session.onText(v2Hello({ clock: undefined }))
    assert.equal(socket.lastAck().accepted, false)
    assert.match(socket.lastAck().rejected ?? '', /clock contract/)
  }
})

test('a v2 gesture without an accepted v2 hello is rejected (v1 hello does not qualify)', () => {
  const { midi, socket, session } = makeSession()
  session.onText(
    JSON.stringify({
      type: 'hello',
      schemaVersion: INSTRUMENT_SCHEMA_VERSION,
      sessionId: 's1',
      mapHash: 'm2',
      heartbeatMs: 1000,
    }),
  )
  const midiAfterHello = midi.sent.length // v1 prepareVoices traffic only
  session.onText(v2Gesture('g1'))
  assert.match(socket.lastAck().rejected ?? '', /accepted v2 hello/)
  assert.equal(midi.sent.length, midiAfterHello)
})

test('v1 hello-ack stays byte-identical: no negotiation fields leak', () => {
  const { socket, session } = makeSession()
  session.onText(
    JSON.stringify({
      type: 'hello',
      schemaVersion: INSTRUMENT_SCHEMA_VERSION,
      sessionId: 's1',
      mapHash: 'm1',
      heartbeatMs: 1000,
    }),
  )
  const ack = socket.lastAck() as unknown as Record<string, unknown>
  assert.deepEqual(Object.keys(ack).sort(), [
    'midiDispatchedAtPcMs',
    'midiReady',
    'receivedAtPcMs',
    'sequence',
    'sessionId',
    'type',
  ])
})
