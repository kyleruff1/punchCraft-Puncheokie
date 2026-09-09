/**
 * The arrangement rail (M40-22C #348, second-pass am. 7).
 *
 * The single-authority rule under test: Scene alone owns arp rate, gate,
 * maximum depth, and whammy eligibility; Z may modulate only within those
 * ceilings; scene changes are bar-quantized and rate-limited, so a flurry
 * raises wah and transients NOW but the arrangement only at the next bar,
 * one level at a time — never Pocket straight to Peak.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  advanceArrangement,
  ARRANGEMENT_SCENES,
  BAR_TICKS,
  barIndexAt,
  cappedLayerFor,
  emptyArrangementState,
  modulationWithin,
  SCENE_CEILINGS,
  whammyAllowed,
} from '../../../src/domain/instrument/arrangementRail'
import type { QuantizedChange } from '../../../src/domain/instrument/gestureSchema'
import { msForTicks } from '../../../src/domain/instrument/transportGrid'
import { BrassArpEngine } from './brassArpEngine'
import { FakeClock, TimedFakeMidi, TimedFakeScheduler } from './testHarness'

const DM9 = { cellId: 'L0R0', chordName: 'Dm9', pool: [50, 53, 57, 60, 64, 74], bass: 26 }
const WEAVE = [0, 2, 1, 3, 2, 4, 3, 5]
const LAYERS = [
  { notesPerMinute: 60, gateRatio: 0.75, patternDepth: 3 },
  { notesPerMinute: 120, gateRatio: 0.65, patternDepth: 4 },
  { notesPerMinute: 180, gateRatio: 0.55, patternDepth: 6 },
  { notesPerMinute: 240, gateRatio: 0.45, patternDepth: 8 },
] as const

function q(layer: 0 | 1 | 2 | 3): QuantizedChange {
  const def = LAYERS[layer]
  return {
    cubeCellId: DM9.cellId,
    chordName: DM9.chordName,
    bassMidiNote: DM9.bass,
    bassChannel: 2,
    chordMidiNotes: DM9.pool,
    arpStartIndex: 0,
    arpPattern: WEAVE,
    arpChannel: 3,
    notesPerMinute: def.notesPerMinute,
    gateRatio: def.gateRatio,
    patternDepth: def.patternDepth,
    activityLayer: layer,
    activityPps: [0.3, 1.7, 3.1, 50][layer]!,
    retrigger: 'quantized-rotate',
    backend: 'punchbridge-tick',
    commitIntervalTicks: 480,
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

const BAR_MS = msForTicks(BAR_TICKS)

// ---------------------------------------------------------------------------
// The pure rail.
// ---------------------------------------------------------------------------

test('scene ordinals line up with the Z ladder, so the scene literally caps Z', () => {
  assert.deepEqual([...ARRANGEMENT_SCENES], ['pocket', 'groove', 'drive', 'peak'])
  assert.equal(cappedLayerFor('pocket', 3), 0)
  assert.equal(cappedLayerFor('groove', 3), 1)
  assert.equal(cappedLayerFor('drive', 3), 2)
  assert.equal(cappedLayerFor('peak', 3), 3)
  // A quiet moment is never RAISED by the scene — the cap is a maximum.
  assert.equal(cappedLayerFor('peak', 0), 0)
})

test('ceilings rise monotonically and only Peak licenses the whammy', () => {
  const rates = ARRANGEMENT_SCENES.map((s) => SCENE_CEILINGS[s].notesPerMinute)
  const depths = ARRANGEMENT_SCENES.map((s) => SCENE_CEILINGS[s].maxPatternDepth)
  const brightness = ARRANGEMENT_SCENES.map((s) => SCENE_CEILINGS[s].brightnessCeiling)
  for (let i = 1; i < rates.length; i += 1) {
    assert.ok(rates[i]! > rates[i - 1]!)
    assert.ok(depths[i]! > depths[i - 1]!)
    assert.ok(brightness[i]! > brightness[i - 1]!)
  }
  assert.deepEqual(ARRANGEMENT_SCENES.map(whammyAllowed), [false, false, false, true])
})

test('the rail initialises to the opening energy — a hard first punch is not throttled', () => {
  const opened = advanceArrangement(emptyArrangementState(), 3, 0, false)
  assert.equal(opened.scene, 'peak')
  assert.equal(opened.initialised, true)
  const quiet = advanceArrangement(emptyArrangementState(), 0, 0, false)
  assert.equal(quiet.scene, 'pocket')
})

test('scene changes are BAR-QUANTIZED: a mid-bar flurry moves nothing', () => {
  let state = advanceArrangement(emptyArrangementState(), 0, 0, false) // pocket
  state = advanceArrangement(state, 3, BAR_TICKS / 2, false) // mid-bar
  assert.equal(state.scene, 'pocket')
})

test('at most ONE level up per bar — Pocket can never jump to Peak', () => {
  let state = advanceArrangement(emptyArrangementState(), 0, 0, false)
  assert.equal(state.scene, 'pocket')
  state = advanceArrangement(state, 3, BAR_TICKS, true)
  assert.equal(state.scene, 'groove') // one step, not three
  state = advanceArrangement(state, 3, BAR_TICKS, true) // same bar again
  assert.equal(state.scene, 'groove')
  state = advanceArrangement(state, 3, BAR_TICKS * 2, true)
  assert.equal(state.scene, 'drive')
  state = advanceArrangement(state, 3, BAR_TICKS * 3, true)
  assert.equal(state.scene, 'peak')
})

test('stepping DOWN waits out a cooldown, so one soft moment cannot collapse the arrangement', () => {
  let state = advanceArrangement(emptyArrangementState(), 3, 0, false) // peak, bar 0
  state = advanceArrangement(state, 0, BAR_TICKS, true) // next bar: too soon
  assert.equal(state.scene, 'peak')
  state = advanceArrangement(state, 0, BAR_TICKS * 2, true)
  assert.equal(state.scene, 'drive')
})

test('Z keeps its expressive room UNDER the ceiling', () => {
  const pocket = modulationWithin('pocket', 1, 1)
  const peak = modulationWithin('peak', 1, 1)
  // Same maximal input, different persistent ceilings.
  assert.ok(pocket.brightness < peak.brightness)
  assert.ok(pocket.brightness <= SCENE_CEILINGS.pocket.brightnessCeiling)
  assert.ok(peak.brightness <= SCENE_CEILINGS.peak.brightnessCeiling)
  // …but wah and transients still move freely inside the bar.
  assert.ok(modulationWithin('pocket', 1, 1).wahAmount > modulationWithin('pocket', 0, 0).wahAmount)
  assert.ok(
    modulationWithin('pocket', 1, 0).transientGain > modulationWithin('pocket', 0, 0).transientGain,
  )
})

test('barIndexAt walks the same transport the other grids project from', () => {
  assert.equal(barIndexAt(0), 0)
  assert.equal(barIndexAt(BAR_TICKS - 1), 0)
  assert.equal(barIndexAt(BAR_TICKS), 1)
})

// ---------------------------------------------------------------------------
// The engine under the rail.
// ---------------------------------------------------------------------------

test('the engine opens at the punch’s own scene and caps a mid-bar lift', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q(1), 96, { eventId: 'p0' }) // groove: 120/min = 500 ms
  scheduler.advance(1200)
  assert.equal(engine.arrangementScene, 'groove')
  // A hard flurry mid-bar asks for 240/min…
  engine.applyGesture(q(3), 96, { eventId: 'p1' })
  scheduler.advance(1200)
  // …and is capped at Groove's ceiling until the bar turns.
  assert.equal(engine.arrangementScene, 'groove')
  const ons = midi.onsAt(2).map((o) => Math.round(o.atMs))
  const deltas: number[] = []
  for (let i = 1; i < ons.length; i += 1) deltas.push(ons[i]! - ons[i - 1]!)
  assert.ok(
    deltas.every((d) => d === 500),
    `the rail let Z raise the rate mid-bar: ${deltas.join(',')}`,
  )
})

test('the scene advances ONE level on the bar line and the rate follows there', () => {
  const { scheduler, midi, engine } = makeEngine()
  engine.applyGesture(q(1), 96, { eventId: 'p0' }) // groove
  engine.applyGesture(q(3), 96, { eventId: 'p1' }) // wants peak
  scheduler.advance(BAR_MS + 1200) // cross the bar boundary, then listen
  assert.equal(engine.arrangementScene, 'drive') // one level, not two
  assert.equal(engine.telemetry().sceneChanges, 1)
  // Drive's ceiling is 180/min → 333 ms steps after the bar line.
  const afterBar = midi
    .onsAt(2)
    .map((o) => Math.round(o.atMs))
    .filter((t) => t > BAR_MS)
  assert.ok(afterBar.length >= 2)
  // 320 ticks is 333.33 ms — the lattice, not the millisecond, is exact.
  assert.ok(
    Math.abs(afterBar[1]! - afterBar[0]! - msForTicks(320)) <= 1,
    `expected a ~333 ms Drive stride, got ${afterBar[1]! - afterBar[0]!}`,
  )
})

test('the whammy is licensed only at Peak (design §11)', () => {
  const { scheduler, engine } = makeEngine()
  engine.applyGesture(q(1), 96, { eventId: 'p0' })
  scheduler.advance(100)
  assert.equal(engine.whammyEligible, false)
  const peak = makeEngine()
  peak.engine.applyGesture(q(3), 96, { eventId: 'p0' })
  peak.scheduler.advance(100)
  assert.equal(peak.engine.whammyEligible, true)
})

test('a legacy patch is untouched by the rail (byte-equality)', () => {
  const { scheduler, midi, engine } = makeEngine()
  const legacy = { ...q(3) }
  delete (legacy as { commitIntervalTicks?: number }).commitIntervalTicks
  engine.applyGesture(legacy, 96, { eventId: 'p0' })
  scheduler.advance(2000)
  // The legacy driver runs the Z ladder exactly as before: 240/min.
  const ons = midi.onsAt(2).map((o) => Math.round(o.atMs))
  assert.equal(ons[1]! - ons[0]!, 250)
  assert.equal(engine.telemetry().sceneChanges, 0)
})

test('stop() resets the rail so a new jam opens at its own energy', () => {
  const { scheduler, engine } = makeEngine()
  engine.applyGesture(q(3), 96, { eventId: 'p0' })
  scheduler.advance(100)
  assert.equal(engine.arrangementScene, 'peak')
  engine.stop()
  assert.equal(engine.arrangementScene, 'pocket')
  engine.applyGesture(q(1), 96, { eventId: 'p1' })
  scheduler.advance(100)
  assert.equal(engine.arrangementScene, 'groove')
})
