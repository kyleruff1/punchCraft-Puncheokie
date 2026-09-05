import { brassCellAt, compileBrassCube } from '../instrument/brassCube'
import { compilePunchPatch } from '../instrument/cubeCompiler'
import {
  compileGesture,
  emptySessionState,
  type CompileContext,
  type InstrumentSessionState,
} from '../instrument/gestureCompiler'
import type { CompiledPunchGesture, MusicalPunchInput } from '../instrument/gestureSchema'
import { launchPatchById } from '../instrument/punchPatch'

const brassPatch = launchPatchById('dorian-brass-cube')
const brassCubeMap = compilePunchPatch(brassPatch)
const brassMap = compileBrassCube(brassPatch)

const punch = (
  hand: 'left' | 'right',
  atMs: number,
  overrides: Partial<MusicalPunchInput> = {},
): MusicalPunchInput => ({
  eventId: `p-${hand}-${atMs}`,
  hand,
  receivedMonotonicTimeMs: atMs,
  velocityRaw: 50,
  recovered: false,
  ...overrides,
})

const brassCtx = (velocity01: number, acceleration01: number): CompileContext => ({
  sessionId: 'brass-suite',
  patch: brassPatch,
  cubeMap: brassCubeMap,
  brassMap,
  velocity01,
  acceleration01,
})

/**
 * R1 byte-identity golden — captured from PRE-CHANGE HEAD (commit 6dcb187)
 * by replaying this exact stream through the then-current compiler. A
 * legacy latch patch's wire must never move: same keys, same bytes.
 */
const R1_STREAM: Array<['left' | 'right', number, number, number, number]> = [
  ['left', 1000, 30, 0.3, 0.4],
  ['right', 1200, 80, 0.8, 0.9],
  ['left', 1450, 50, 0.5, 0.2],
  ['right', 1600, 95, 0.95, 0.7],
  ['left', 2100, 10, 0.1, 0.1],
  ['right', 2600, 60, 0.6, 0.55],
]

const R1_GOLDEN: readonly string[] = [
  '{"schemaVersion":1,"sessionId":"r1-golden","eventId":"p-left-1000","mapHash":"84717f3b","source":{"hand":"left","receivedMonotonicTimeMs":1000,"velocity01":0.3,"acceleration01":0.4,"punchRate01":0.1111111111111111,"gapSincePreviousPunchMs":0,"alternating":false},"cube":{"leftZone":1,"rightZone":0,"activityLayer":0,"changedAxis":"left","targetCoordinate":[1,0,0]},"voice":{"voiceId":"left","midiChannel":2,"targetNote":41,"noteVelocity":51,"brightness":78,"expression":81,"transition":"attack","transitionDurationMs":174,"pitchOvershootCents":6},"transient":{"note":36,"velocity":75,"layer":"generic"},"visual":{"quadrant":"lower-left","hueDegrees":190,"opacity":0.58,"radius":0.096,"persistenceMs":3333,"transitionRibbonMs":174}}',
  '{"schemaVersion":1,"sessionId":"r1-golden","eventId":"p-right-1200","mapHash":"84717f3b","source":{"hand":"right","receivedMonotonicTimeMs":1200,"velocity01":0.8,"acceleration01":0.9,"punchRate01":0.2222222222222222,"gapSincePreviousPunchMs":200,"alternating":true},"cube":{"leftZone":1,"rightZone":4,"activityLayer":1,"changedAxis":"right","targetCoordinate":[1,4,1]},"voice":{"voiceId":"right","midiChannel":3,"targetNote":72,"noteVelocity":96,"brightness":78,"expression":82,"transition":"attack","transitionDurationMs":158,"pitchOvershootCents":12},"transient":{"note":36,"velocity":118,"layer":"generic"},"visual":{"quadrant":"upper-right","hueDegrees":45,"opacity":0.9299999999999999,"radius":0.2,"persistenceMs":3667,"transitionRibbonMs":158}}',
  '{"schemaVersion":1,"sessionId":"r1-golden","eventId":"p-left-1450","mapHash":"84717f3b","source":{"hand":"left","receivedMonotonicTimeMs":1450,"velocity01":0.5,"acceleration01":0.2,"punchRate01":0.3333333333333333,"gapSincePreviousPunchMs":250,"alternating":true},"cube":{"leftZone":1,"rightZone":4,"activityLayer":1,"changedAxis":"left","targetCoordinate":[1,4,1]},"voice":{"voiceId":"left","midiChannel":2,"targetNote":41,"noteVelocity":43,"brightness":85,"expression":85,"transition":"retrigger","transitionDurationMs":0,"pitchOvershootCents":0},"transient":{"note":36,"velocity":57,"layer":"generic"},"visual":{"quadrant":"lower-left","hueDegrees":45,"opacity":0.43999999999999995,"radius":0.164,"persistenceMs":4000,"transitionRibbonMs":0}}',
  '{"schemaVersion":1,"sessionId":"r1-golden","eventId":"p-right-1600","mapHash":"84717f3b","source":{"hand":"right","receivedMonotonicTimeMs":1600,"velocity01":0.95,"acceleration01":0.7,"punchRate01":0.4444444444444444,"gapSincePreviousPunchMs":150,"alternating":true},"cube":{"leftZone":1,"rightZone":5,"activityLayer":1,"changedAxis":"right","targetCoordinate":[1,5,1]},"voice":{"voiceId":"right","midiChannel":3,"targetNote":74,"noteVelocity":74,"brightness":74,"expression":87,"transition":"glide","transitionDurationMs":156,"pitchOvershootCents":10},"transient":{"note":36,"velocity":101,"layer":"generic"},"visual":{"quadrant":"upper-right","hueDegrees":50,"opacity":0.7899999999999999,"radius":0.218,"persistenceMs":4333,"transitionRibbonMs":156}}',
  '{"schemaVersion":1,"sessionId":"r1-golden","eventId":"p-left-2100","mapHash":"84717f3b","source":{"hand":"left","receivedMonotonicTimeMs":2100,"velocity01":0.1,"acceleration01":0.1,"punchRate01":0.5555555555555556,"gapSincePreviousPunchMs":500,"alternating":false},"cube":{"leftZone":0,"rightZone":5,"activityLayer":2,"changedAxis":"left","targetCoordinate":[0,5,2]},"voice":{"voiceId":"left","midiChannel":2,"targetNote":38,"noteVelocity":41,"brightness":71,"expression":90,"transition":"glide","transitionDurationMs":139,"pitchOvershootCents":0},"transient":{"note":36,"velocity":49,"layer":"generic"},"visual":{"quadrant":"lower-left","hueDegrees":50,"opacity":0.37,"radius":0.072,"persistenceMs":4667,"transitionRibbonMs":139}}',
  '{"schemaVersion":1,"sessionId":"r1-golden","eventId":"p-right-2600","mapHash":"84717f3b","source":{"hand":"right","receivedMonotonicTimeMs":2600,"velocity01":0.6,"acceleration01":0.55,"punchRate01":0.5555555555555556,"gapSincePreviousPunchMs":500,"alternating":false},"cube":{"leftZone":0,"rightZone":3,"activityLayer":2,"changedAxis":"right","targetCoordinate":[0,3,2]},"voice":{"voiceId":"right","midiChannel":3,"targetNote":69,"noteVelocity":61,"brightness":71,"expression":90,"transition":"glide","transitionDurationMs":169,"pitchOvershootCents":6},"transient":{"note":36,"velocity":88,"layer":"generic"},"visual":{"quadrant":"upper-right","hueDegrees":300,"opacity":0.685,"radius":0.132,"persistenceMs":4667,"transitionRibbonMs":169}}',
]

describe('R1 regression — legacy latch pipeline is byte-identical', () => {
  it('a two-handed-pentatonic stream matches the pre-change HEAD golden', () => {
    const patch = launchPatchById('two-handed-pentatonic')
    const cubeMap = compilePunchPatch(patch)
    let state = emptySessionState()
    const gestures: CompiledPunchGesture[] = []
    for (const [hand, atMs, raw, v01, a01] of R1_STREAM) {
      const result = compileGesture(punch(hand, atMs, { velocityRaw: raw }), state, {
        sessionId: 'r1-golden',
        patch,
        cubeMap,
        velocity01: v01,
        acceleration01: a01,
      })
      state = result!.state
      gestures.push(result!.gesture)
    }
    for (const g of gestures) {
      expect(Object.keys(g)).toEqual([
        'schemaVersion',
        'sessionId',
        'eventId',
        'mapHash',
        'source',
        'cube',
        'voice',
        'transient',
        'visual',
      ])
    }
    gestures.forEach((g, i) => expect(JSON.stringify(g)).toBe(R1_GOLDEN[i]))
  })
})

describe('brass-patch gesture emission', () => {
  it('every live brass punch carries accent + quantized with the staged cell numbers', () => {
    let state: InstrumentSessionState = emptySessionState()
    const velocities = [0.1, 0.45, 0.7, 0.95]
    for (const [i, v01] of velocities.entries()) {
      const result = compileGesture(
        punch(i % 2 ? 'right' : 'left', 1000 + i * 400),
        state,
        brassCtx(v01, 0.5),
      )!
      state = result.state
      const { gesture } = result
      expect(gesture.accent).toBeDefined()
      expect(gesture.quantized).toBeDefined()
      const cell = brassCellAt(brassMap, gesture.cube.leftZone, gesture.cube.rightZone)
      expect(gesture.accent!.midiNote).toBe(cell.startMidiNote)
      expect(gesture.quantized!.cubeCellId).toBe(cell.cellId)
      expect(gesture.quantized!.chordMidiNotes).toEqual(cell.rotatedPool)
      expect(gesture.accent!.channel).toBe(4)
      expect(gesture.accent!.gateMs).toBe(120)
      expect(gesture.quantized!.bassChannel).toBe(2)
      expect(gesture.quantized!.arpChannel).toBe(3)
    }
  })

  it('accent velocity spans 50..118 over acceleration01 0..1', () => {
    const soft = compileGesture(punch('left', 1000), emptySessionState(), brassCtx(0.5, 0))!
    const hard = compileGesture(punch('left', 1000), emptySessionState(), brassCtx(0.5, 1))!
    expect(soft.gesture.accent!.midiVelocity).toBe(50)
    expect(hard.gesture.accent!.midiVelocity).toBe(118)
  })

  it('left punch stages a new chord keeping the held right start; right keeps the chord', () => {
    let state: InstrumentSessionState = emptySessionState()
    // Right zone 3 first: cell L0R3 — Dm9, entry index 3.
    const a = compileGesture(punch('right', 1000), state, brassCtx(0.6, 0.5))!
    state = a.state
    expect(a.gesture.quantized!.cubeCellId).toBe('L0R3')
    expect(a.gesture.quantized!.chordName).toBe('Dm9')
    expect(a.gesture.quantized!.arpStartIndex).toBe(3)
    // Left zone 2: chord moves to G9, the held right start survives.
    const b = compileGesture(punch('left', 1400), state, brassCtx(0.45, 0.5))!
    state = b.state
    expect(b.gesture.quantized!.cubeCellId).toBe('L2R3')
    expect(b.gesture.quantized!.chordName).toBe('G9')
    expect(b.gesture.quantized!.arpStartIndex).toBe(3)
    // Right zone 5: chord holds, only the entry rotates.
    const c = compileGesture(punch('right', 1800), state, brassCtx(0.95, 0.5))!
    expect(c.gesture.quantized!.cubeCellId).toBe('L2R5')
    expect(c.gesture.quantized!.chordName).toBe('G9')
    expect(c.gesture.quantized!.arpStartIndex).toBe(5)
  })

  it('quantized carries the layer ladder and activityPps; transient scales only on brass', () => {
    const brass = compileGesture(punch('left', 1000), emptySessionState(), brassCtx(0.5, 0.5))!
    const q = brass.gesture.quantized!
    // First punch: 1 punch / 1.5 s window ≈ 0.67 pps → layer 0.
    expect(q.activityLayer).toBe(0)
    expect(q.activityPps).toBeGreaterThan(0)
    expect(q.notesPerMinute).toBe(60)
    expect(q.gateRatio).toBe(0.75)
    expect(q.patternDepth).toBe(3)
    expect(q.retrigger).toBe('quantized-rotate')
    expect(q.backend).toBe('punchbridge-tick')
    expect(q.arpPattern).toEqual([0, 2, 1, 3, 2, 4, 3, 5])
    // Layer 0 transient multiplier 0.8: round((40 + 87·0.5) · 0.8) = 67 …
    expect(brass.gesture.transient.velocity).toBe(67)
    // … while the SAME punch through a legacy patch stays unscaled at 84.
    const legacyPatch = launchPatchById('two-handed-pentatonic')
    const legacy = compileGesture(punch('left', 1000), emptySessionState(), {
      sessionId: 'brass-suite',
      patch: legacyPatch,
      cubeMap: compilePunchPatch(legacyPatch),
      velocity01: 0.5,
      acceleration01: 0.5,
    })!
    expect(legacy.gesture.transient.velocity).toBe(84)
    expect(legacy.gesture.accent).toBeUndefined()
    expect(legacy.gesture.quantized).toBeUndefined()
  })

  it('mismatched brassMap/cubeMap patchHash throws', () => {
    const otherMap = compilePunchPatch(launchPatchById('two-handed-pentatonic'))
    expect(() =>
      compileGesture(punch('left', 1000), emptySessionState(), {
        sessionId: 'brass-suite',
        patch: brassPatch,
        cubeMap: otherMap,
        brassMap,
        velocity01: 0.5,
        acceleration01: 0.5,
      }),
    ).toThrow(/patchHash mismatch/)
  })

  it('brass determinism: an identical stream replays byte-identically, whammy included', () => {
    const stream: Array<['left' | 'right', number, number]> = [
      ['left', 1000, 20],
      ['left', 1250, 30],
      ['left', 1500, 40],
      ['left', 1750, 50],
      ['left', 2000, 60],
      ['left', 2250, 70],
      ['left', 2500, 90], // 7th left punch — peak, fires the whammy
      ['right', 2750, 60],
    ]
    const runOnce = (): string => {
      let state = emptySessionState()
      const out: CompiledPunchGesture[] = []
      for (const [hand, atMs, raw] of stream) {
        const result = compileGesture(
          punch(hand, atMs, { velocityRaw: raw }),
          state,
          brassCtx(0.5, 0.6),
        )!
        state = result.state
        out.push(result.gesture)
      }
      return JSON.stringify(out)
    }
    const first = runOnce()
    expect(first).toBe(runOnce())
    expect(first).toContain('"whammy"')
    expect(first).toContain('"accent"')
    expect(first).toContain('"quantized"')
  })
})
