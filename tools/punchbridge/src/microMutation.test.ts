/**
 * Micro-mutation integration (M40-22A #326, second-pass am. 6).
 *
 * The contract: every punch's stab and drum always play; before the next
 * arp step the MOST RECENT valid punch owns the mutation; contradictory
 * operations never stack; the mutation colours at most three steps and
 * then expires; and the running pattern's PHASE is never restarted by a
 * mutation — only a harmonic commit moves harmony, rate, or bass.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  QuantizedChange,
  TechniqueBlock,
} from '../../../src/domain/instrument/gestureSchema'
import {
  backendSupportsPlan,
  BRIDGE_EXACT_CAPABILITIES,
  mutationForStep,
  projectionAccuracyOf,
  STUDIO_ONE_NOTE_FX_CAPABILITIES,
  type PendingMicroMutation,
} from '../../../src/domain/instrument/patternExecutionBackend'
import { BrassArpEngine } from './brassArpEngine'
import { FakeClock, TimedFakeMidi, TimedFakeScheduler } from './testHarness'

const DM9 = { cellId: 'L0R0', chordName: 'Dm9', pool: [50, 53, 57, 60, 64, 74], bass: 26 }
const WEAVE = [0, 2, 1, 3, 2, 4, 3, 5]

function q(): QuantizedChange {
  return {
    cubeCellId: DM9.cellId,
    chordName: DM9.chordName,
    bassMidiNote: DM9.bass,
    bassChannel: 2,
    chordMidiNotes: DM9.pool,
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

function technique(
  operations: readonly string[],
  opts: { rotation?: number; maxSteps?: number; family?: 'straight' | 'hook' | 'uppercut' } = {},
): TechniqueBlock {
  return {
    identitySource: 'guided-score',
    immediateSignatureId: `${opts.family ?? 'straight'}:physical-left:head`,
    ...(opts.family ? { family: opts.family } : {}),
    microMutation: {
      operations: [...operations],
      maxSteps: opts.maxSteps ?? operations.length,
      rotation: opts.rotation ?? 0,
    },
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

// ---------------------------------------------------------------------------
// The backend contract.
// ---------------------------------------------------------------------------

test('bridge-exact promises exact projection; note-fx starts conservative', () => {
  assert.equal(BRIDGE_EXACT_CAPABILITIES.exactStepProjection, true)
  assert.equal(BRIDGE_EXACT_CAPABILITIES.supportsMicroMutations, true)
  assert.equal(projectionAccuracyOf('bridge-exact'), 'exact')
  // Nothing about the Studio One arpeggiator is assumed controllable until
  // M45-06 probes the installed environment.
  assert.equal(STUDIO_ONE_NOTE_FX_CAPABILITIES.exactStepProjection, false)
  assert.equal(STUDIO_ONE_NOTE_FX_CAPABILITIES.supportsMicroMutations, false)
  assert.equal(projectionAccuracyOf('studio-one-note-fx'), 'pattern-symbolic')
})

test('a plan needing micro-mutations may not be handed to a backend without them', () => {
  assert.equal(backendSupportsPlan('bridge-exact', { microMutations: true }), true)
  assert.equal(backendSupportsPlan('studio-one-note-fx', { microMutations: true }), false)
  assert.equal(backendSupportsPlan('imported-midi', { microMutations: true }), true)
})

test('mutationForStep owns exactly its own step window', () => {
  const mutation: PendingMicroMutation = {
    sourcePunchEventId: 'p1',
    createdAtTick: 0,
    appliesFromStepIndex: 4,
    expiresAfterStepIndex: 6,
    operations: ['advance'],
    rotation: 0,
  }
  assert.equal(mutationForStep(mutation, 3), null)
  assert.equal(mutationForStep(mutation, 4), mutation)
  assert.equal(mutationForStep(mutation, 6), mutation)
  assert.equal(mutationForStep(mutation, 7), null)
  assert.equal(mutationForStep(null, 4), null)
})

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

test('a mutation colours the NEXT step and the pattern keeps its phase', () => {
  const { scheduler, midi, engine } = makeEngine()
  // Baseline: the untouched weave over Dm9 at 240/min (250 ms steps).
  engine.applyGesture(q(), 96, { eventId: 'p0' })
  scheduler.advance(1100)
  const baseline = midi.onsAt(2).map((o) => o.note)
  assert.deepEqual(baseline.slice(0, 5), [50, 57, 53, 60, 57])

  const second = makeEngine()
  second.engine.applyGesture(q(), 96, { eventId: 'p0' })
  second.scheduler.advance(600) // steps 0..2 sounded
  // A hook arrives: 'reverse' pulls the NEXT step one pool slot back.
  second.engine.applyGesture(q(), 96, {
    eventId: 'p1',
    technique: technique(['reverse'], { family: 'hook' }),
  })
  second.scheduler.advance(500)
  const mutated = second.midi.onsAt(2).map((o) => o.note)
  // The first three steps match the baseline exactly…
  assert.deepEqual(mutated.slice(0, 3), baseline.slice(0, 3))
  // …the mutated step differs…
  assert.notEqual(mutated[3], baseline[3])
  // …and the phase is intact: the step AFTER the mutation returns to the
  // pattern's own next tone (no restart, no lurch).
  assert.equal(mutated[4], baseline[4])
  assert.ok(second.engine.telemetry().mutatedSteps >= 1)
})

test('newest wins: three contradictory punches before one step do not stack', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q(), 96, { eventId: 'p0' })
  scheduler.advance(600)
  // A jab (advance), then a hook (reverse), then an uppercut (land-fifth)
  // all land inside the same step. Only the LAST may colour the next step.
  engine.applyGesture(q(), 96, { eventId: 'j', technique: technique(['advance']) })
  engine.applyGesture(q(), 96, { eventId: 'h', technique: technique(['reverse']) })
  engine.applyGesture(q(), 96, { eventId: 'u', technique: technique(['land-fifth']) })
  assert.equal(engine.pendingMicroMutation?.sourcePunchEventId, 'u')
  assert.equal(engine.telemetry().supersededMutations, 2)
  scheduler.advance(300)
  // land-fifth pins pool index 2 → Dm9 pool[2] = 57.
  const notes = midi.onsAt(2).map((o) => o.note)
  assert.equal(notes[3], 57)
})

test('a mutation expires after its own steps and never colours later ones', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q(), 96, { eventId: 'p0' })
  scheduler.advance(600)
  engine.applyGesture(q(), 96, {
    eventId: 'p1',
    technique: technique(['land-root'], { maxSteps: 1 }),
  })
  scheduler.advance(300) // the mutated step sounds
  assert.equal(midi.onsAt(2).map((o) => o.note)[3], 50) // land-root → pool[0]
  assert.equal(engine.pendingMicroMutation, null, 'mutation outlived its window')
  scheduler.advance(1000)
  // Every later step comes from the untouched weave.
  const { scheduler: s2, midi: m2, engine: e2 } = makeEngine()
  e2.applyGesture(q(), 96, { eventId: 'b0' })
  s2.advance(1900)
  const baseline = m2.onsAt(2).map((o) => o.note)
  const actual = midi.onsAt(2).map((o) => o.note)
  assert.deepEqual(actual.slice(4), baseline.slice(4, actual.length))
})

test('a mutation never moves harmony, bass, or rate — only a commit does', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q(), 96, { eventId: 'p0' })
  scheduler.advance(600)
  const bassBefore = midi.onsAt(1).length
  const commitBefore = engine.lastHarmonicCommit
  engine.applyGesture(q(), 96, {
    eventId: 'p1',
    technique: technique(['reverse', 'advance'], { family: 'hook' }),
  })
  scheduler.advance(400)
  // Same cell staged → no new bass note, and the step interval is unchanged.
  assert.equal(midi.onsAt(1).length, bassBefore)
  assert.equal(engine.lastHarmonicCommit?.resolvedCellId, commitBefore?.resolvedCellId)
  const ons = midi.onsAt(2)
  const deltas: number[] = []
  for (let i = 1; i < ons.length; i += 1) deltas.push(Math.round(ons[i]!.atMs - ons[i - 1]!.atMs))
  assert.ok(
    deltas.every((d) => d === 250),
    `rate moved under a mutation: ${deltas.join(',')}`,
  )
})

test('a punch with NO technique block mutates nothing (legacy + generic parity)', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q(), 96, { eventId: 'p0' })
  scheduler.advance(600)
  engine.applyGesture(q(), 96, { eventId: 'p1' }) // no technique
  scheduler.advance(700)
  assert.equal(engine.pendingMicroMutation, null)
  assert.equal(engine.telemetry().mutatedSteps, 0)

  const { scheduler: s2, midi: m2, engine: e2 } = makeEngine()
  e2.applyGesture(q(), 96, { eventId: 'b0' })
  s2.advance(1300)
  assert.deepEqual(
    midi.onsAt(2).map((o) => o.note),
    m2.onsAt(2).map((o) => o.note),
  )
})

test('rotation leans the mutated step without leaving the pool', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q(), 96, { eventId: 'p0' })
  scheduler.advance(600)
  engine.applyGesture(q(), 96, {
    eventId: 'p1',
    technique: technique(['land-root'], { rotation: 1, maxSteps: 1 }),
  })
  scheduler.advance(300)
  // land-root (0) + rotation 1 → pool index 1 → Dm9 pool[1] = 53.
  assert.equal(midi.onsAt(2).map((o) => o.note)[3], 53)
  // Still a legal pool tone, whatever the rotation.
  assert.ok(DM9.pool.includes(midi.onsAt(2).map((o) => o.note)[3]!))
})

test('stop() clears the pending mutation with everything else', () => {
  const { scheduler, engine } = makeEngine()
  engine.applyGesture(q(), 96, { eventId: 'p0' })
  scheduler.advance(300)
  engine.applyGesture(q(), 96, { eventId: 'p1', technique: technique(['advance']) })
  assert.notEqual(engine.pendingMicroMutation, null)
  engine.stop()
  assert.equal(engine.pendingMicroMutation, null)
})
