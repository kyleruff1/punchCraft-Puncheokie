/**
 * Motif compiler + phrase accumulator goldens (M40-21 #325).
 *
 * The primary golden is the design's own worked example (§9): 1-2-3-2 on
 * Dm9 compiles to F · C · 5 · U · 5 · C · 5 · F. Under the role-GROUP
 * reading (flagged for Kyle on #325) that is pool indices
 * [0, 1, 2, 5, 2, 3, 2, 0] — and the SAME tokens give the SAME contour on
 * F6/9, because the abstract motif holds operations, not notes.
 *
 * Amendment 5 is the other load-bearing rule here: a phrase that crosses a
 * chord change resolves against the cell sounding AT THE COMMIT, never the
 * chord that happened to be active when the first punch landed.
 */
import { naturalPoolOf, DORIAN_CHORD_BANK } from '../instrument/brassCube'
import type { StrikeToken } from '../instrument/gestureSchema'
import {
  accumulatePhrasePunch,
  closePhraseAtTick,
  emptyPhraseState,
  PHRASE_WINDOW_TICKS,
} from '../instrument/techniquePhraseAccumulator'
import {
  compileAbstractMotif,
  endsOnStableTone,
  MAX_EXPLICIT_PHRASE_PUNCHES,
  MAX_MOTIF_STEPS,
  motifStaysInPool,
  resolveTechniqueMotif,
  type PhrasePunch,
} from '../instrument/techniqueMotif'

const punchesOf = (tokens: readonly StrikeToken[], velocity = 0.6): PhrasePunch[] =>
  tokens.map((token, i) => ({ eventId: `e${i}`, token, velocity01: velocity }))

const compile = (tokens: readonly StrikeToken[], cellId = 'L0R0', commitTick = 960) => {
  const abstract = compileAbstractMotif(punchesOf(tokens), commitTick)!
  return resolveTechniqueMotif(abstract, { cellId })
}

const DM9 = naturalPoolOf(DORIAN_CHORD_BANK.find((c) => c.name === 'Dm9')!)
const F69 = naturalPoolOf(DORIAN_CHORD_BANK.find((c) => c.name === 'F6/9')!)

describe('the primary golden: 1-2-3-2 (design §9)', () => {
  it('compiles to the illustrated contour F · C · 5 · U · 5 · C · 5 · F', () => {
    const motif = compile(['1', '2', '3', '2'])
    // F(root) C(third) 5(fifth) U(upper-anchor) 5 C(color) 5 F
    expect(motif.resolvedPoolIndices).toEqual([0, 1, 2, 5, 2, 3, 2, 0])
    expect(motif.resolvedPoolIndices).toHaveLength(MAX_MOTIF_STEPS)
    expect(motif.family).toBe('mixed')
    expect(motif.sourceTokens).toEqual(['1', '2', '3', '2'])
  })

  it('sounds the design’s actual Dm9 notes', () => {
    const motif = compile(['1', '2', '3', '2'])
    // D3 F3 A3 D5 A3 G4(color) A3 D3 — the setup, the power leap, the
    // curved hook movement, the firm cross landing.
    expect(motif.resolvedPoolIndices.map((i) => DM9[i])).toEqual([50, 53, 57, 74, 57, 60, 57, 50])
  })

  it('the SAME tokens give the SAME contour in a different chord (chord-independence)', () => {
    const onDm9 = compile(['1', '2', '3', '2'], 'L0R0')
    const onF69 = compile(['1', '2', '3', '2'], 'L2R0')
    expect(onF69.resolvedPoolIndices).toEqual(onDm9.resolvedPoolIndices)
    // …but the notes are the new pool's, every one legal.
    expect(onF69.resolvedPoolIndices.map((i) => F69[i])).toEqual([53, 57, 60, 77, 60, 62, 60, 53])
    expect(onF69.resolvedHarmonicCellId).toBe('L2R0')
  })

  it('1B-2-3-2 is the same phrase an octave lower — never a different world', () => {
    const head = compile(['1', '2', '3', '2'])
    const body = compile(['1B', '2', '3', '2'])
    expect(body.resolvedPoolIndices).toEqual(head.resolvedPoolIndices)
    // The body modifier drops the phrase register; pitch classes hold.
    expect(body.octaveOffsets.every((o) => o === -1)).toBe(true)
    expect(head.octaveOffsets.every((o) => o === 0)).toBe(true)
  })
})

describe('the eight motif rules (design §8)', () => {
  it('rule 1: punch order is preserved in the source tokens', () => {
    expect(compile(['5', '1', '4']).sourceTokens).toEqual(['5', '1', '4'])
  })

  it('rule 2: never more than eight steps, however many punches land', () => {
    for (const tokens of [
      ['1'],
      ['1', '2'],
      ['1', '1', '2'],
      ['5', '6', '3', '2'],
      ['1', '2', '3', '4', '5', '6'],
    ] as StrikeToken[][]) {
      const motif = compile(tokens)
      expect(motif.resolvedPoolIndices.length).toBeLessThanOrEqual(MAX_MOTIF_STEPS)
      expect(motif.resolvedPoolIndices.length).toBeGreaterThan(0)
    }
  })

  it('rules 3/5/10: every step stays inside the six-tone pool', () => {
    for (const tokens of [
      ['1', '2', '3', '2'],
      ['5', '5', '6'],
      ['3B', '4B'],
      ['6B', '6B', '6B', '6B'],
    ] as StrikeToken[][]) {
      expect(motifStaysInPool(compile(tokens))).toBe(true)
    }
  })

  it('rule 6: at most one octave jump per phrase', () => {
    const motif = compile(['5', '5'])
    const jumps = motif.octaveOffsets.filter((o, i) => i > 0 && o !== motif.octaveOffsets[i - 1]!)
    expect(jumps.length).toBeLessThanOrEqual(2) // up and back
    expect(motif.octaveOffsets.every((o) => Math.abs(o) <= 1)).toBe(true)
  })

  it('rule 8: a phrase ends on a stable tone (root / fifth / upper anchor)', () => {
    for (const tokens of [
      ['1', '2', '3', '2'],
      ['2'],
      ['6'],
      ['3', '4'],
      ['1', '1'],
    ] as StrikeToken[][]) {
      const motif = compile(tokens)
      expect(endsOnStableTone(motif)).toBe(true)
    }
  })

  it('rule 9: a hook reverses and pivots, never re-chords', () => {
    const hook = compile(['1', '3'])
    // The hook's first step re-sounds the tone the foundation group last
    // left (the pendulum pivot), rather than moving somewhere new.
    expect(hook.resolvedPoolIndices[0]).toBe(0)
    expect(hook.resolvedPoolIndices[2]).toBe(0) // pivot back onto it
    expect(motifStaysInPool(hook)).toBe(true)
  })

  it('rule 11: a fifth punch raises ENERGY, never the note count', () => {
    const four = compileAbstractMotif(punchesOf(['1', '2', '3', '2']), 960)!
    const seven = compileAbstractMotif(punchesOf(['1', '2', '3', '2', '1', '2', '3']), 960)!
    expect(seven.operations).toEqual(four.operations) // identical notes
    expect(seven.sourceTokens).toHaveLength(MAX_EXPLICIT_PHRASE_PUNCHES)
    expect(seven.energy.extraPunchCount).toBe(3)
    expect(seven.energy.totalImpact).toBeGreaterThan(four.energy.totalImpact)
    // Every punch is still remembered for provenance/replay.
    expect(seven.sourceStrikeEventIds).toHaveLength(7)
  })

  it('rule 12: same tokens + velocities → byte-identical motif, always', () => {
    const a = compile(['5', '6', '3', '2'])
    const b = compile(['5', '6', '3', '2'])
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('per-family contours', () => {
  it('a jab steps, a cross leaps and lands, a hook pivots, an uppercut rises', () => {
    // Rule 8 resolves the jab's second step from the third up to the fifth.
    expect(compile(['1']).resolvedPoolIndices).toEqual([0, 2]) // step up, stable
    expect(compile(['2']).resolvedPoolIndices).toEqual([2, 0]) // leap, land home
    expect(compile(['3']).resolvedPoolIndices).toEqual([0, 2]) // pivot, arc up
    const uppercut = compile(['5'])
    expect(uppercut.octaveOffsets.some((o) => o > 0)).toBe(true) // the lift
    // Rule 8 outranks the token's "settle extension" at a phrase END: the
    // lift resolves onto the upper anchor rather than trailing off on the
    // extension. Mid-phrase the extension settle stands (below).
    expect(uppercut.resolvedPoolIndices[uppercut.resolvedPoolIndices.length - 1]).toBe(5)
  })

  it('the lead uppercut’s extension settle stands MID-phrase (rule 8 only binds the end)', () => {
    const motif = compile(['5', '2'])
    // …5 rises and settles on the extension (4), then the cross lands home.
    expect(motif.resolvedPoolIndices).toEqual([2, 2, 4, 2, 0])
    expect(endsOnStableTone(motif)).toBe(true)
  })

  it('the rear uppercut lands on the fifth rather than drifting to the extension', () => {
    const rear = compile(['6'])
    expect(rear.resolvedPoolIndices[rear.resolvedPoolIndices.length - 1]).toBe(2)
    expect(rear.octaveOffsets.some((o) => o > 0)).toBe(true)
  })

  it('single-family phrases report their family; mixed ones report mixed', () => {
    expect(compile(['1', '2']).family).toBe('straight')
    expect(compile(['3', '4']).family).toBe('hook')
    expect(compile(['5', '6']).family).toBe('uppercut')
    expect(compile(['1', '3']).family).toBe('mixed')
  })

  it('gate + accent shape the phrase: landings sit longest, pulses shortest', () => {
    const motif = compile(['1', '2'])
    expect(Math.max(...motif.gateMultipliers)).toBeGreaterThan(1) // the landing
    const pulse = compile(['5'])
    expect(Math.min(...pulse.gateMultipliers)).toBeLessThan(1) // the octave pulse
  })
})

describe('amendment 5: abstract now, resolved at the commit', () => {
  it('the abstract motif holds OPERATIONS and no notes at all', () => {
    const abstract = compileAbstractMotif(punchesOf(['1', '2', '3', '2']), 960)!
    expect(abstract).not.toHaveProperty('resolvedPoolIndices')
    expect(abstract.operations.every((op) => typeof op.kind === 'string')).toBe(true)
    expect(JSON.stringify(abstract)).not.toMatch(/poolIndex|midi/i)
  })

  it('one abstract motif resolves DIFFERENTLY per cell — the commit decides', () => {
    const abstract = compileAbstractMotif(punchesOf(['1', '2', '3', '2']), 960)!
    const early = resolveTechniqueMotif(abstract, { cellId: 'L0R0' })
    const late = resolveTechniqueMotif(abstract, { cellId: 'L5R3' })
    expect(early.resolvedPoolIndices).toEqual(late.resolvedPoolIndices) // same contour
    expect(early.resolvedHarmonicCellId).not.toBe(late.resolvedHarmonicCellId)
    // The phrase that crossed a chord change carries the COMMIT's cell.
    expect(late.resolvedHarmonicCellId).toBe('L5R3')
  })

  it('the motif expires one pulse after its commit', () => {
    const motif = compile(['1', '2'], 'L0R0', 1920)
    expect(motif.commitTick).toBe(1920)
    expect(motif.expiresAtTick).toBe(1920 + PHRASE_WINDOW_TICKS)
  })
})

describe('the phrase accumulator (design §12)', () => {
  const punch = (token: StrikeToken, id: string): PhrasePunch => ({
    eventId: id,
    token,
    velocity01: 0.6,
  })

  it('collects a 960-tick window and closes it when the next window opens', () => {
    let state = emptyPhraseState()
    let closed = null
    for (const [i, token] of (['1', '2', '3', '2'] as StrikeToken[]).entries()) {
      const result = accumulatePhrasePunch(state, punch(token, `p${i}`), i * 200)
      state = result.state
      expect(result.closed).toBeNull() // all inside window 0
    }
    // A punch in the NEXT pulse closes the phrase and opens a new one.
    const next = accumulatePhrasePunch(state, punch('1', 'p9'), PHRASE_WINDOW_TICKS + 40)
    closed = next.closed
    expect(closed).not.toBeNull()
    expect(closed!.sourceTokens).toEqual(['1', '2', '3', '2'])
    expect(closed!.commitTick).toBe(PHRASE_WINDOW_TICKS)
    // The new phrase is already collecting — the closed one keeps playing.
    expect(next.state.punches).toHaveLength(1)
    expect(next.state.windowIndex).toBe(1)
  })

  it('closes on a tick crossing even when no punch arrives (the pulse path)', () => {
    let state = accumulatePhrasePunch(emptyPhraseState(), punch('5', 'p0'), 100).state
    expect(closePhraseAtTick(state, 500).closed).toBeNull() // same window
    const result = closePhraseAtTick(state, PHRASE_WINDOW_TICKS + 1)
    expect(result.closed!.sourceTokens).toEqual(['5'])
    expect(result.state.punches).toHaveLength(0)
  })

  it('an empty window closes to nothing', () => {
    expect(closePhraseAtTick(emptyPhraseState(), 5000).closed).toBeNull()
  })

  it('a ten-punch flurry in one window yields ONE motif: four notes, six energy', () => {
    let state = emptyPhraseState()
    for (let i = 0; i < 10; i += 1) {
      state = accumulatePhrasePunch(state, punch('2', `f${i}`), i * 90).state
    }
    const closed = closePhraseAtTick(state, PHRASE_WINDOW_TICKS + 1).closed!
    expect(closed.sourceTokens).toHaveLength(4)
    expect(closed.energy.extraPunchCount).toBe(6)
    expect(closed.sourceStrikeEventIds).toHaveLength(10)
    const resolved = resolveTechniqueMotif(closed, { cellId: 'L0R0' })
    expect(resolved.resolvedPoolIndices.length).toBeLessThanOrEqual(MAX_MOTIF_STEPS)
    expect(endsOnStableTone(resolved)).toBe(true)
  })
})

describe('worked examples (design §9 companions)', () => {
  it('1 · a lone jab is a two-tone setup that still resolves (rule 8)', () => {
    expect(compile(['1']).resolvedPoolIndices).toEqual([0, 2])
  })

  it('1-2 · setup then power landing', () => {
    expect(compile(['1', '2']).resolvedPoolIndices).toEqual([0, 1, 2, 0])
  })

  it('1-1-2 · a double jab walks the groups before the cross lands', () => {
    expect(compile(['1', '1', '2']).resolvedPoolIndices).toEqual([0, 1, 2, 3, 2, 0])
  })

  it('5-6-3-2 · rise, rise, arc, land — eight steps ending stable', () => {
    const motif = compile(['5', '6', '3', '2'])
    expect(motif.resolvedPoolIndices).toHaveLength(MAX_MOTIF_STEPS)
    expect(endsOnStableTone(motif)).toBe(true)
    expect(motif.octaveOffsets.some((o) => o > 0)).toBe(true)
  })
})
