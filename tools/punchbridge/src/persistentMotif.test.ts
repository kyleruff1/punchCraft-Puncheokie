/**
 * Persistent technique-motif commits (M40-22B #347).
 *
 * The contract: at phrase close ONE pattern commits — the dominant
 * family's named pattern, or the compiled motif when the phrase is mixed.
 * It resolves against the cell sounding AT THE COMMIT (am. 5), never the
 * chord that was active when the phrase opened. Harmony never moves, the
 * arp PHASE is preserved unless the retrigger policy restarts it, and a
 * dense flurry still yields at most one change per pulse.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ARP_PATTERNS } from '../../../src/domain/instrument/brassCube'
import type {
  QuantizedChange,
  StrikeToken,
  TechniqueBlock,
} from '../../../src/domain/instrument/gestureSchema'
import { strikeSignatureKeyOf } from '../../../src/domain/instrument/strikeArticulationCatalog'
import { PHRASE_WINDOW_TICKS } from '../../../src/domain/instrument/techniquePhraseAccumulator'
import { msForTicks } from '../../../src/domain/instrument/transportGrid'
import { BrassArpEngine } from './brassArpEngine'
import { FakeClock, TimedFakeMidi, TimedFakeScheduler } from './testHarness'

const DM9 = { cellId: 'L0R0', chordName: 'Dm9', pool: [50, 53, 57, 60, 64, 74], bass: 26 }
const G9 = { cellId: 'L5R0', chordName: 'G9', pool: [55, 59, 62, 65, 69, 79], bass: 31 }
const WEAVE = [0, 2, 1, 3, 2, 4, 3, 5]

function q(chord = DM9): QuantizedChange {
  return {
    cubeCellId: chord.cellId,
    chordName: chord.chordName,
    bassMidiNote: chord.bass,
    bassChannel: 2,
    chordMidiNotes: chord.pool,
    arpStartIndex: 0,
    arpPattern: WEAVE,
    arpChannel: 3,
    notesPerMinute: 240,
    gateRatio: 0.45,
    patternDepth: 8,
    activityLayer: 3,
    activityPps: 50,
    retrigger: 'quantized-rotate',
    backend: 'punchbridge-tick',
    commitIntervalTicks: 480,
  }
}

function technique(token: StrikeToken): TechniqueBlock {
  const key = strikeSignatureKeyOf(token)
  return {
    identitySource: 'guided-score',
    immediateSignatureId: `${key.family}:${key.hand}:${key.target}`,
    token,
    family: key.family,
    microMutation: { operations: [], maxSteps: 1, rotation: 0 },
  }
}

function makeEngine() {
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

/** One pulse in ms (960 ticks at 60 BPM). */
const PULSE_MS = msForTicks(PHRASE_WINDOW_TICKS)

test('a straight-dominant phrase commits the Up pattern at phrase close', () => {
  const { scheduler, engine } = makeEngine()
  engine.applyGesture(q(), 96, { eventId: 'p0' })
  // Two jabs inside one pulse — straight dominates.
  engine.applyGesture(q(), 96, { eventId: 'p1', technique: technique('1') })
  scheduler.advance(200)
  engine.applyGesture(q(), 96, { eventId: 'p2', technique: technique('1') })
  assert.equal(engine.telemetry().patternCommits, 0, 'committed before the phrase closed')
  scheduler.advance(PULSE_MS + 50) // cross the phrase boundary
  assert.equal(engine.telemetry().patternCommits, 1)
  assert.deepEqual(engine.lastTechniqueMotif?.sourceTokens, ['1', '1'])
  assert.equal(engine.lastTechniqueMotif?.family, 'straight')
})

test('hook-dominant → Pendulum, uppercut-dominant → Fanfare, mixed → the compiled motif', () => {
  const cases: Array<[StrikeToken, StrikeToken, readonly number[] | null]> = [
    ['3', '3', ARP_PATTERNS.pendulum],
    ['5', '5', ARP_PATTERNS.fanfare],
    ['1', '1', ARP_PATTERNS.up],
    ['1', '5', null], // mixed → the motif itself
  ]
  for (const [a, b, expected] of cases) {
    const { scheduler, midi, engine } = makeEngine()
    engine.applyGesture(q(), 96, { eventId: 'p0' })
    engine.applyGesture(q(), 96, { eventId: 'p1', technique: technique(a) })
    scheduler.advance(150)
    engine.applyGesture(q(), 96, { eventId: 'p2', technique: technique(b) })
    scheduler.advance(PULSE_MS + 50)
    const motif = engine.lastTechniqueMotif
    assert.ok(motif, `${a}-${b}: no motif committed`)
    assert.equal(engine.telemetry().patternCommits, 1)
    // Whatever the pattern, every sounded note stays inside the pool.
    for (const on of midi.onsAt(2)) {
      assert.ok(DM9.pool.includes(on.note), `${a}-${b}: foreign note ${on.note}`)
    }
    if (expected === null) {
      assert.equal(motif.family, 'mixed')
    } else {
      assert.notEqual(motif.family, 'mixed')
    }
  }
})

test('am. 5: a phrase crossing a chord change resolves against the COMMIT’s cell', () => {
  const { scheduler, engine } = makeEngine()
  // The phrase opens under Dm9…
  engine.applyGesture(q(DM9), 96, { eventId: 'p0', technique: technique('1') })
  scheduler.advance(200)
  engine.applyGesture(q(DM9), 96, { eventId: 'p1', technique: technique('1') })
  // …then the harmony commits to G9 mid-phrase (staged at 500 ms, audible
  // on the next commit boundary at 1000 ms)…
  scheduler.advance(300)
  engine.applyGesture(q(G9), 96, { eventId: 'p2' })
  scheduler.advance(600)
  assert.equal(engine.lastHarmonicCommit?.resolvedCellId, G9.cellId)
  // …and the phrase closes AFTER it.
  scheduler.advance(PULSE_MS)
  const motif = engine.lastTechniqueMotif
  assert.ok(motif)
  assert.equal(
    motif.resolvedHarmonicCellId,
    G9.cellId,
    'the motif resolved against the phrase-opening chord, not the commit',
  )
})

test('a persistent commit preserves the arp PHASE (quantized-rotate) — no restart', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q(), 96, { eventId: 'p0' })
  engine.applyGesture(q(), 96, { eventId: 'p1', technique: technique('1') })
  scheduler.advance(150)
  engine.applyGesture(q(), 96, { eventId: 'p2', technique: technique('1') })
  const onsBefore = midi.onsAt(2).length
  scheduler.advance(PULSE_MS + 300)
  const ons = midi.onsAt(2)
  assert.ok(ons.length > onsBefore, 'the pattern stopped after the commit')
  // Steps keep marching on the same 250 ms grid across the commit — a
  // phase restart would show as a doubled or dropped step.
  const deltas: number[] = []
  for (let i = 1; i < ons.length; i += 1) deltas.push(Math.round(ons[i]!.atMs - ons[i - 1]!.atMs))
  assert.ok(
    deltas.every((d) => d === 250),
    `phase disturbed by the commit: ${deltas.join(',')}`,
  )
})

test('a ten-punch flurry in one pulse commits AT MOST one pattern', () => {
  const { scheduler, engine } = makeEngine()
  engine.applyGesture(q(), 96, { eventId: 'p0' })
  for (let i = 0; i < 10; i += 1) {
    engine.applyGesture(q(), 96, { eventId: `f${i}`, technique: technique('3') })
    scheduler.advance(60)
  }
  assert.equal(engine.telemetry().patternCommits, 0)
  scheduler.advance(PULSE_MS)
  assert.equal(engine.telemetry().patternCommits, 1)
  // Rule 11: the extra punches raised energy, not the note count.
  assert.ok((engine.lastTechniqueMotif?.sourceTokens.length ?? 0) <= 4)
  assert.ok((engine.lastTechniqueMotif?.sourceStrikeEventIds.length ?? 0) >= 10)
})

test('generic (free-jam) punches never commit a pattern — no technique claim', () => {
  const { scheduler, engine } = makeEngine()
  engine.applyGesture(q(), 96, { eventId: 'p0' })
  for (let i = 0; i < 6; i += 1) {
    engine.applyGesture(q(), 96, {
      eventId: `g${i}`,
      technique: {
        identitySource: 'generic',
        immediateSignatureId: 'straight:physical-left:head',
        microMutation: { operations: ['advance'], maxSteps: 1, rotation: 0 },
      },
    })
    scheduler.advance(100)
  }
  scheduler.advance(PULSE_MS)
  assert.equal(engine.telemetry().patternCommits, 0)
  assert.equal(engine.lastTechniqueMotif, null)
})

test('the harmony never moves on a pattern commit — only a harmonic commit does', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q(), 96, { eventId: 'p0' })
  engine.applyGesture(q(), 96, { eventId: 'p1', technique: technique('5') })
  scheduler.advance(150)
  engine.applyGesture(q(), 96, { eventId: 'p2', technique: technique('5') })
  const bassBefore = midi.onsAt(1).map((o) => o.note)
  const cellBefore = engine.lastHarmonicCommit?.resolvedCellId
  scheduler.advance(PULSE_MS + 200)
  assert.equal(engine.telemetry().patternCommits, 1)
  assert.deepEqual(midi.onsAt(1).map((o) => o.note), bassBefore, 'the bass moved on a pattern commit')
  assert.equal(engine.lastHarmonicCommit?.resolvedCellId, cellBefore)
})

test('stop() clears the open phrase and the last motif', () => {
  const { scheduler, engine } = makeEngine()
  engine.applyGesture(q(), 96, { eventId: 'p0', technique: technique('1') })
  scheduler.advance(100)
  engine.applyGesture(q(), 96, { eventId: 'p1', technique: technique('1') })
  scheduler.advance(PULSE_MS + 50)
  assert.notEqual(engine.lastTechniqueMotif, null)
  engine.stop()
  assert.equal(engine.lastTechniqueMotif, null)
})
