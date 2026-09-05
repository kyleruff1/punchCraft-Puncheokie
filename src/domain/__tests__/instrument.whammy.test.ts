import { compileBrassCube } from '../instrument/brassCube'
import { compilePunchPatch } from '../instrument/cubeCompiler'
import {
  compileGesture,
  emptySessionState,
  type CompileContext,
  type InstrumentSessionState,
} from '../instrument/gestureCompiler'
import {
  fnv1a,
  type CompiledPunchGesture,
  type MusicalPunchInput,
} from '../instrument/gestureSchema'
import { launchPatchById } from '../instrument/punchPatch'
import {
  WHAMMY_COOLDOWN_MS,
  WHAMMY_WARMUP_PUNCHES,
  emptyPeaks,
  notePeak,
} from '../instrument/velocityPeak'

const patch = launchPatchById('dorian-brass-cube')
const cubeMap = compilePunchPatch(patch)
const brassMap = compileBrassCube(patch)

const punch = (
  hand: 'left' | 'right',
  atMs: number,
  velocityRaw: number,
  overrides: Partial<MusicalPunchInput> = {},
): MusicalPunchInput => ({
  eventId: `w-${hand}-${atMs}`,
  hand,
  receivedMonotonicTimeMs: atMs,
  velocityRaw,
  recovered: false,
  ...overrides,
})

const ctx = (velocity01 = 0.5, acceleration01 = 0.5): CompileContext => ({
  sessionId: 'whammy-suite',
  patch,
  cubeMap,
  brassMap,
  velocity01,
  acceleration01,
})

interface Step {
  input: MusicalPunchInput
  velocity01?: number
  acceleration01?: number
}

function run(
  steps: readonly Step[],
  context: (s: Step) => CompileContext = (s) => ctx(s.velocity01, s.acceleration01),
): CompiledPunchGesture[] {
  let state: InstrumentSessionState = emptySessionState()
  const out: CompiledPunchGesture[] = []
  for (const step of steps) {
    const result = compileGesture(step.input, state, context(step))
    if (result) {
      state = result.state
      out.push(result.gesture)
    }
  }
  return out
}

/** Six escalating same-hand punches — the warm-up window, none may fire. */
const warmup = (hand: 'left' | 'right', fromMs: number): Step[] =>
  [10, 20, 30, 40, 50, 60].map((raw, i) => ({ input: punch(hand, fromMs + i * 300, raw) }))

describe('velocityPeak → whammy (seam #20-#29)', () => {
  it('#20 no accent during the per-hand warm-up window', () => {
    const gestures = run(warmup('left', 1000))
    expect(gestures).toHaveLength(WHAMMY_WARMUP_PUNCHES)
    for (const g of gestures) expect(g.whammy).toBeUndefined()
  })

  it('#21 a strictly greater raw after warm-up fires a rise, duration in [200,450]', () => {
    const gestures = run([
      ...warmup('left', 1000),
      { input: punch('left', 3000, 90), acceleration01: 0.9 },
    ])
    const fired = gestures[6]!.whammy
    expect(fired).toEqual({ direction: 'rise', semitones: 12, durationMs: 425 })
    expect(fired!.durationMs).toBeGreaterThanOrEqual(200)
    expect(fired!.durationMs).toBeLessThanOrEqual(450)
  })

  it('#22 a raw equal to the session max does not fire', () => {
    const gestures = run([...warmup('left', 1000), { input: punch('left', 3000, 60) }])
    expect(gestures[6]!.whammy).toBeUndefined()
  })

  it('#23 cooldown suppresses the accent but still raises the bar', () => {
    const gestures = run([
      ...warmup('left', 1000),
      { input: punch('left', 3000, 90) }, // accent A fires
      { input: punch('left', 3400, 120) }, // hotter B inside 2500 ms — silent
      { input: punch('left', 6500, 100) }, // past cooldown, but under B's bar — silent
      { input: punch('left', 6900, 130) }, // beats B — fires
    ])
    expect(gestures[6]!.whammy).toBeDefined()
    expect(gestures[7]!.whammy).toBeUndefined()
    expect(gestures[8]!.whammy).toBeUndefined()
    expect(gestures[9]!.whammy).toBeDefined()
  })

  it('#24 peaks are per hand: a right record leaves the left headroom intact', () => {
    const both: Step[] = []
    // Interleave warm-ups: left raws top out at 60, right at 200.
    for (let i = 0; i < 6; i += 1) {
      both.push({ input: punch('left', 1000 + i * 400, 10 * (i + 1)) })
      both.push({ input: punch('right', 1200 + i * 400, 40 * (i + 1) - 40) })
    }
    both.push({ input: punch('right', 4000, 240) }) // right peak fires
    both.push({ input: punch('left', 7000, 80) }) // < right max, > left max — fires
    const gestures = run(both)
    expect(gestures[12]!.whammy).toBeDefined()
    expect(gestures[13]!.whammy).toBeDefined()
  })

  it('#25 sensitivity invariance: whammy lands on identical eventIds across scalers', () => {
    const stream = [
      ...warmup('left', 1000),
      ...warmup('right', 2600),
      { input: punch('left', 5000, 90) },
      { input: punch('right', 8000, 95) },
      { input: punch('left', 8200, 200) },
    ]
    const idsUnder = (map: (raw: number) => number): string[] =>
      run(stream, (s) => ctx(map(s.input.velocityRaw)))
        .filter((g) => g.whammy)
        .map((g) => g.eventId)
    const normal = idsUnder((raw) => Math.min(1, raw / 255))
    const high = idsUnder((raw) => Math.min(1, raw / 128))
    expect(normal).toEqual(high)
    expect(normal).toEqual(['w-left-5000', 'w-right-8000'])
  })

  it('#26 determinism golden: fixed 20-punch stream serializes byte-identically', () => {
    const stream: Array<['left' | 'right', number, number, number, number]> = [
      ['left', 1000, 20, 0.2, 0.3],
      ['right', 1250, 25, 0.25, 0.35],
      ['left', 1500, 40, 0.35, 0.4],
      ['right', 1750, 45, 0.4, 0.45],
      ['left', 2000, 60, 0.45, 0.5],
      ['right', 2250, 66, 0.5, 0.55],
      ['left', 2500, 80, 0.55, 0.6],
      ['right', 2750, 88, 0.6, 0.65],
      ['left', 3000, 100, 0.65, 0.7],
      ['right', 3250, 110, 0.7, 0.75],
      ['left', 3500, 118, 0.72, 0.8],
      ['right', 3750, 126, 0.74, 0.85],
      ['left', 4000, 135, 0.76, 0.9],
      ['right', 4250, 150, 0.78, 0.95],
      ['left', 5000, 120, 0.6, 0.5],
      ['right', 7000, 140, 0.65, 0.6],
      ['left', 7300, 180, 0.8, 0.75],
      ['right', 7600, 152, 0.7, 0.65],
      ['left', 10200, 90, 0.4, 0.3],
      ['right', 10500, 200, 0.9, 1],
    ]
    const runOnce = (): string => {
      let state = emptySessionState()
      const out: CompiledPunchGesture[] = []
      for (const [hand, atMs, raw, v01, a01] of stream) {
        const result = compileGesture(
          {
            eventId: `w-${hand}-${atMs}`,
            hand,
            receivedMonotonicTimeMs: atMs,
            velocityRaw: raw,
            recovered: false,
          },
          state,
          {
            sessionId: 'whammy-golden',
            patch,
            cubeMap,
            brassMap,
            velocity01: v01,
            acceleration01: a01,
          },
        )
        state = result!.state
        out.push(result!.gesture)
      }
      expect(out.filter((g) => g.whammy).map((g) => g.eventId)).toEqual([
        'w-left-4000',
        'w-left-7300',
        'w-right-10500',
      ])
      return JSON.stringify(out)
    }
    const first = runOnce()
    // Inline golden: length + FNV-1a of the serialized sequence pin every
    // byte of the 20-gesture stream (accent/quantized/whammy included).
    expect(first).toHaveLength(23574)
    expect(fnv1a(first)).toBe('4344b095')
    expect(runOnce()).toBe(first)
  })

  it('#27 whammy absent when the patch omits transition.whammy', () => {
    const legacy = launchPatchById('two-handed-pentatonic')
    const legacyMap = compilePunchPatch(legacy)
    const gestures = run([...warmup('left', 1000), { input: punch('left', 3000, 200) }], (s) => ({
      sessionId: 'whammy-suite',
      patch: legacy,
      cubeMap: legacyMap,
      velocity01: s.velocity01 ?? 0.5,
      acceleration01: s.acceleration01 ?? 0.5,
    }))
    for (const g of gestures) expect(g.whammy).toBeUndefined()
  })

  it('#28 additive wire: no whammy key when silent; schemaVersion stays 1 when present', () => {
    const gestures = run([...warmup('left', 1000), { input: punch('left', 3000, 90) }])
    // A whammy-free brass gesture appends accent+quantized but NO whammy key.
    expect(Object.keys(gestures[0]!)).toEqual([
      'schemaVersion',
      'sessionId',
      'eventId',
      'mapHash',
      'source',
      'cube',
      'voice',
      'transient',
      'visual',
      'accent',
      'quantized',
    ])
    expect(JSON.stringify(gestures[0])).not.toContain('"whammy"')
    const fired = gestures[6]!
    expect(fired.whammy).toBeDefined()
    expect(fired.schemaVersion).toBe(1)
    // The block lands LAST — key order is part of the wire's determinism.
    expect(Object.keys(fired).slice(-3)).toEqual(['accent', 'quantized', 'whammy'])
  })

  it('#29 recovered events touch no peak state', () => {
    const recovered: Step = {
      input: punch('left', 2950, 250, { recovered: true, eventId: 'w-recovered' }),
    }
    const closer: Step = { input: punch('left', 3000, 90) }
    const withRecovered = run([...warmup('left', 1000), recovered, closer])
    const without = run([...warmup('left', 1000), closer])
    // The recovered punch compiled to nothing and moved neither the
    // warm-up count nor the max — the closer still fires identically.
    expect(withRecovered).toHaveLength(7)
    expect(JSON.stringify(withRecovered)).toBe(JSON.stringify(without))
    expect(withRecovered[6]!.whammy).toBeDefined()
  })

  it('pins the peak-detector constants and pure-fold shape', () => {
    expect(WHAMMY_WARMUP_PUNCHES).toBe(6)
    expect(WHAMMY_COOLDOWN_MS).toBe(2500)
    const seed = emptyPeaks()
    const fold = notePeak(seed, 'left', 40, 1000)
    // Pure fold: the input state is untouched.
    expect(seed.left).toEqual({ maxRaw: 0, punches: 0 })
    expect(fold.state.left).toEqual({ maxRaw: 40, punches: 1 })
    expect(fold.accent).toBe(false)
  })
})
