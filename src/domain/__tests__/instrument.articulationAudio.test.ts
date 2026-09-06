/**
 * The M40 exit criterion, asserted where it actually matters — on the
 * COMPILED GESTURE that reaches audio (M40-25 #353).
 *
 * M40-20 proved the catalog composes twelve distinct signatures. That was
 * necessary and not sufficient: none of those fields reached the accent or
 * transient blocks, so a jab and a cross fired the identical note on every
 * output. These tests pin the wiring, not the catalog.
 *
 * Tokens 1 / 3 / 5 are all thrown by the same physical hand at the same
 * velocity, so they resolve to the SAME harmonic cell — which is exactly
 * the criterion's "inside one fixed chord".
 */
import { compileBrassCube } from '../instrument/brassCube'
import { compilePunchPatch } from '../instrument/cubeCompiler'
import { compileGesture, emptySessionState } from '../instrument/gestureCompiler'
import type { CompiledPunchGesture, StrikeToken } from '../instrument/gestureSchema'
import { compileHarmonicField } from '../instrument/harmonicField'
import { launchPatchById } from '../instrument/punchPatch'

function compileToken(token: StrikeToken | undefined, patchId = 'dorian-brass-v2'): CompiledPunchGesture {
  const patch = launchPatchById(patchId)
  const cubeMap = compilePunchPatch(patch)
  const brassMap = compileBrassCube(patch)
  const field = patch.harmonicField
    ? compileHarmonicField(patch.id, patch.harmonicField, brassMap)
    : undefined
  // Fresh state + identical inputs every time: the ONLY variable is the
  // token, so any difference below is the technique and nothing else.
  const result = compileGesture(
    {
      eventId: 'e1',
      hand: 'left',
      receivedMonotonicTimeMs: 0,
      velocityRaw: 50,
      recovered: false,
      ...(token ? { expectedStrikeToken: token } : {}),
    },
    emptySessionState(),
    {
      sessionId: 's',
      patch,
      cubeMap,
      brassMap,
      ...(field ? { field } : {}),
      velocity01: 0.5,
      acceleration01: 0.6,
    },
  )
  if (!result) throw new Error('gesture did not compile')
  return result.gesture
}

describe('the exit criterion: distinct immediate hits inside ONE chord', () => {
  it('jab / hook / uppercut sound three DIFFERENT stab notes in the same cell', () => {
    const jab = compileToken('1')
    const hook = compileToken('3')
    const uppercut = compileToken('5')
    // Same hand, same velocity → same harmonic cell. Verify that first,
    // or the rest of this test proves nothing.
    expect(hook.quantized!.cubeCellId).toBe(jab.quantized!.cubeCellId)
    expect(uppercut.quantized!.cubeCellId).toBe(jab.quantized!.cubeCellId)

    const notes = [jab, hook, uppercut].map((g) => g.accent!.midiNote)
    expect(new Set(notes).size).toBe(3)
    // The roles are real pool tones, not invented pitches.
    const pool = jab.quantized!.chordMidiNotes
    const natural = [...pool].sort((a, b) => a - b)
    for (const note of notes) {
      expect(natural.some((n) => (n - note) % 12 === 0)).toBe(true)
    }
  })

  it('each family lands its OWN drum piece', () => {
    expect(compileToken('1').transient.note).toBe(37) // rim — the jab's tick
    expect(compileToken('3').transient.note).toBe(38) // snare — the hook
    expect(compileToken('5').transient.note).toBe(49) // crash — the uppercut
    expect(compileToken('2').transient.note).toBe(36) // kick — the cross
  })

  it('each family sits for its OWN length', () => {
    expect(compileToken('1').accent!.gateMs).toBe(110)
    expect(compileToken('3').accent!.gateMs).toBe(180)
    expect(compileToken('5').accent!.gateMs).toBe(210)
  })

  it('the rear hand hits harder than the lead at the same acceleration', () => {
    // Same acceleration; only the hand modifier's accent multiplier differs.
    expect(compileToken('2').accent!.midiVelocity).toBeGreaterThan(
      compileToken('1').accent!.midiVelocity,
    )
  })

  it('a jab and a cross are no longer the same note (the bug this ticket fixes)', () => {
    const jab = compileToken('1')
    const cross = compileToken('2')
    expect(cross.accent!.midiNote).not.toBe(jab.accent!.midiNote)
    expect(cross.transient.note).not.toBe(jab.transient.note)
  })
})

describe('the body modifier reaches audio: same idea, lower and heavier', () => {
  it('1B is exactly one octave below 1 — same pitch class, never a new scale', () => {
    const head = compileToken('1')
    const body = compileToken('1B')
    expect(body.accent!.midiNote).toBe(head.accent!.midiNote - 12)
    expect(body.quantized!.cubeCellId).toBe(head.quantized!.cubeCellId)
  })

  it('1B sits longer and lands heavier than 1', () => {
    const head = compileToken('1')
    const body = compileToken('1B')
    expect(body.accent!.gateMs).toBeGreaterThan(head.accent!.gateMs)
    expect(body.transient.velocity).toBeGreaterThan(head.transient.velocity)
  })

  it('every B token is its head twin an octave down, across all six', () => {
    for (const token of ['1', '2', '3', '4', '5', '6'] as const) {
      const head = compileToken(token)
      const body = compileToken(`${token}B` as StrikeToken)
      expect(body.accent!.midiNote).toBe(head.accent!.midiNote - 12)
    }
  })
})

describe('what must NOT change', () => {
  it('free jam (no token) still articulates by hand but claims no technique', () => {
    const generic = compileToken(undefined)
    expect(generic.technique!.identitySource).toBe('generic')
    expect(generic.technique!.token).toBeUndefined()
    // It still gets a real articulation — a straight on the punching hand.
    expect(generic.accent!.gateMs).toBe(110)
    expect(generic.transient.note).toBe(37)
  })

  it('a v1 patch is untouched: cell-derived accent, kick, patch gate', () => {
    const v1 = compileToken('1', 'dorian-brass-cube')
    expect(v1.technique).toBeUndefined()
    // The accent note is the CELL's entry tone, as before…
    expect(v1.accent!.midiNote).toBe(v1.quantized!.chordMidiNotes[0])
    // …the drum is the hardcoded kick, and the gate is the patch's.
    expect(v1.transient.note).toBe(36)
    expect(v1.transient.layer).toBe('generic')
    expect(v1.accent!.gateMs).toBe(120)
  })

  it('the accent note stays a legal MIDI note even at the extremes', () => {
    for (const token of ['1B', '2B', '3B', '4B', '5B', '6B'] as const) {
      const note = compileToken(token).accent!.midiNote
      expect(note).toBeGreaterThanOrEqual(0)
      expect(note).toBeLessThanOrEqual(127)
    }
  })
})
