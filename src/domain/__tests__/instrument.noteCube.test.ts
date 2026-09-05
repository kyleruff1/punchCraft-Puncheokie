import { cellAt, compilePunchPatch, midiNoteName } from '../instrument/cubeCompiler'
import { compileGesture, emptySessionState } from '../instrument/gestureCompiler'
import type { MusicalPunchInput } from '../instrument/gestureSchema'
import { launchPatchById, SOFT_GUARD_ALLOWED, type PunchPatch } from '../instrument/punchPatch'
import { positionInZone, quantizeZone, rawZone } from '../instrument/zoneQuantizer'

const pentatonic = (): PunchPatch => launchPatchById('two-handed-pentatonic')

describe('cubeCompiler', () => {
  it('compiles the default patch to the documented D pentatonic registers', () => {
    const map = compilePunchPatch(pentatonic())
    // Left plane D2 F2 G2 A2 C3 D3, right plane D4 F4 G4 A4 C5 D5
    // (instrument-design §6): x sweeps the left notes, y the right.
    const leftNotes = [0, 1, 2, 3, 4, 5].map((x) => cellAt(map, x, 0).leftMidiNote)
    const rightNotes = [0, 1, 2, 3, 4, 5].map((y) => cellAt(map, 0, y).rightMidiNote)
    expect(leftNotes).toEqual([38, 41, 43, 45, 48, 50])
    expect(rightNotes).toEqual([62, 65, 67, 69, 72, 74])
    expect(cellAt(map, 2, 3).label).toBe('G2 · A4')
    expect(map.cells).toHaveLength(36)
  })

  it('is deterministic: same patch → identical map and patchHash', () => {
    const a = compilePunchPatch(pentatonic())
    const b = compilePunchPatch(pentatonic())
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.patchHash).toMatch(/^[0-9a-f]{8}$/)
  })

  it('different patches hash differently', () => {
    const a = compilePunchPatch(pentatonic())
    const b = compilePunchPatch({ ...pentatonic(), rootPitchClass: 4 })
    expect(a.patchHash).not.toBe(b.patchHash)
  })

  it('root-interval topology derives the right note from the CELL left note', () => {
    const map = compilePunchPatch(launchPatchById('harmonic-cube'))
    // Right = left + register lift + interval; a different x moves BOTH.
    const at00 = cellAt(map, 0, 0)
    const at30 = cellAt(map, 3, 0)
    expect(at00.rightMidiNote - at00.leftMidiNote).toBe(at30.rightMidiNote - at30.leftMidiNote)
    expect(at30.leftMidiNote).toBeGreaterThan(at00.leftMidiNote)
  })

  it('soft-guard resolves a tritone to an allowed interval (design example)', () => {
    // Chromatic-ish probe: force a patch whose free cell would be a
    // tritone, then check soft-guard moves the right note to an allowed
    // class while free mode leaves it alone.
    const free: PunchPatch = {
      ...pentatonic(),
      id: 'probe-free',
      pitchSetId: 'minor-blues', // contains the ♭5 color tone
      harmony: { mode: 'free' },
    }
    const guarded: PunchPatch = {
      ...free,
      id: 'probe-guarded',
      harmony: { mode: 'soft-guard', allowedIntervalClasses: SOFT_GUARD_ALLOWED },
    }
    const freeMap = compilePunchPatch(free)
    const guardedMap = compilePunchPatch(guarded)
    const tritones = freeMap.cells.filter((c) => c.intervalClass === 6)
    expect(tritones.length).toBeGreaterThan(0)
    for (const cell of guardedMap.cells) {
      expect(SOFT_GUARD_ALLOWED).toContain(cell.intervalClass)
    }
    // At least one cell was actually adjusted to get there.
    expect(guardedMap.cells.some((c) => c.harmonyAdjusted)).toBe(true)
  })

  it('interval-lock pins every cell to the locked interval', () => {
    const locked: PunchPatch = {
      ...pentatonic(),
      id: 'probe-locked',
      harmony: { mode: 'interval-lock', lockIntervalSemitones: 7 },
    }
    for (const cell of compilePunchPatch(locked).cells) {
      expect(cell.intervalSemitones).toBe(7)
    }
  })

  it('names notes correctly', () => {
    expect(midiNoteName(38)).toBe('D2')
    expect(midiNoteName(60)).toBe('C4')
    expect(midiNoteName(74)).toBe('D5')
  })
})

describe('zoneQuantizer', () => {
  it('maps the unit interval onto zones', () => {
    expect(rawZone(0, 6)).toBe(0)
    expect(rawZone(0.99, 6)).toBe(5)
    expect(rawZone(1, 6)).toBe(5)
  })

  it('holds the previous zone inside the hysteresis band', () => {
    // Zone 2 spans 0.333..0.5 at six zones; the 3-boundary is 0.5.
    const inTwo = quantizeZone(null, 0.45, 6)
    expect(inTwo.currentZone).toBe(2)
    // Just over the boundary but inside hysteresis → stays 2.
    expect(quantizeZone(inTwo, 0.52, 6).currentZone).toBe(2)
    // Clear of the band → commits 3.
    expect(quantizeZone(inTwo, 0.56, 6).currentZone).toBe(3)
    // Downward the same way.
    const inThree = quantizeZone(null, 0.55, 6)
    expect(quantizeZone(inThree, 0.49, 6).currentZone).toBe(3)
    expect(quantizeZone(inThree, 0.44, 6).currentZone).toBe(2)
  })

  it('positionInZone spans 0..1 inside a zone', () => {
    expect(positionInZone(0.5, 3, 6)).toBeCloseTo(0, 5)
    expect(positionInZone(2 / 3 - 0.001, 3, 6)).toBeGreaterThan(0.9)
  })
})

describe('gestureCompiler', () => {
  const patch = pentatonic()
  const cubeMap = compilePunchPatch(patch)
  const ctx = (velocity01: number, acceleration01: number) => ({
    sessionId: 'jam-1',
    patch,
    cubeMap,
    velocity01,
    acceleration01,
  })
  const punch = (
    hand: 'left' | 'right',
    atMs: number,
    overrides: Partial<MusicalPunchInput> = {},
  ): MusicalPunchInput => ({
    eventId: `e-${hand}-${atMs}`,
    hand,
    receivedMonotonicTimeMs: atMs,
    velocityRaw: 8,
    recovered: false,
    ...overrides,
  })

  it('refuses recovered events', () => {
    const result = compileGesture(
      punch('left', 1000, { recovered: true }),
      emptySessionState(),
      ctx(0.5, 0.5),
    )
    expect(result).toBeNull()
  })

  it('latches per hand: an opposite-hand punch keeps the first voice held', () => {
    let state = emptySessionState()
    const first = compileGesture(punch('left', 1000), state, ctx(0.4, 0.5))!
    state = first.state
    expect(first.gesture.voice.voiceId).toBe('left')
    expect(first.gesture.voice.transition).toBe('attack')

    const second = compileGesture(punch('right', 1300), state, ctx(0.9, 0.5))!
    expect(second.gesture.voice.voiceId).toBe('right')
    // The left latch survives — the cube's left zone is the held one.
    expect(second.gesture.cube.leftZone).toBe(first.gesture.cube.leftZone)
    expect(second.gesture.source.alternating).toBe(true)
    expect(second.gesture.source.gapSincePreviousPunchMs).toBe(300)
  })

  it('same zone retriggers with zero transition; new zone glides', () => {
    let state = emptySessionState()
    const a = compileGesture(punch('left', 1000), state, ctx(0.4, 0.5))!
    state = a.state
    const b = compileGesture(punch('left', 2000), state, ctx(0.41, 0.5))!
    state = b.state
    expect(b.gesture.voice.transition).toBe('retrigger')
    expect(b.gesture.voice.transitionDurationMs).toBe(0)

    const c = compileGesture(punch('left', 3000), state, ctx(0.95, 0.5))!
    expect(c.gesture.voice.transition).toBe('glide')
    expect(c.gesture.voice.transitionDurationMs).toBeGreaterThan(0)
    expect(c.gesture.voice.targetNote).not.toBe(b.gesture.voice.targetNote)
  })

  it('is deterministic over a replayed stream (acceptance #12)', () => {
    const stream: Array<[('left' | 'right'), number, number, number]> = [
      ['left', 1000, 0.3, 0.4],
      ['right', 1200, 0.8, 0.9],
      ['left', 1450, 0.5, 0.2],
      ['right', 1600, 0.95, 0.7],
      ['left', 2600, 0.1, 0.1],
    ]
    const run = (): string => {
      let state = emptySessionState()
      const out: unknown[] = []
      for (const [hand, at, v, a] of stream) {
        const r = compileGesture(punch(hand, at), state, ctx(v, a))!
        state = r.state
        out.push(r.gesture)
      }
      return JSON.stringify(out)
    }
    expect(run()).toBe(run())
  })

  it('activity rises with a flurry and never moves the held note by itself', () => {
    let state = emptySessionState()
    let lastLayer = 0
    // Same-velocity flurry: zones stay put while the Z layer climbs.
    const heldNote = compileGesture(punch('left', 0), state, ctx(0.4, 0.5))!
    state = heldNote.state
    for (let i = 1; i <= 8; i += 1) {
      const r = compileGesture(punch(i % 2 === 0 ? 'left' : 'right', i * 180, {}), state, ctx(0.4, 0.5))!
      state = r.state
      lastLayer = r.gesture.cube.activityLayer
      if (r.gesture.voice.voiceId === 'left') {
        expect(r.gesture.voice.targetNote).toBe(heldNote.gesture.voice.targetNote)
      }
    }
    expect(lastLayer).toBeGreaterThanOrEqual(2)
  })
})
