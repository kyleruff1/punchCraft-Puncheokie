/**
 * Combo notation — parse, format, and the round-trip law (M31-01, D10).
 *
 * Notation is the single place authored templates, the combo library, the
 * generator and the live screen all have to agree, so it is pinned hard.
 * The named combos in the "canonical" block below are the author-supplied
 * boxing presets that seed the library (M35-01).
 */

import {
  ComboParseError,
  formatCombo,
  parseCombo,
  punchTokens,
  type WorkoutToken,
} from '../WorkoutTokens'

describe('parseCombo', () => {
  it('parses the D10 reference combo with body only on the second punch', () => {
    const tokens = parseCombo('1-2b-3-2')

    expect(tokens).toHaveLength(4)
    expect(tokens.map((t) => t.kind)).toEqual(['punch', 'punch', 'punch', 'punch'])
    expect(tokens.map((t) => (t.kind === 'punch' ? t.number : null))).toEqual([1, 2, 3, 2])
    expect(tokens.map((t) => (t.kind === 'punch' ? t.body : null))).toEqual([false, true, false, false])
  })

  it('accepts an uppercase B and still records a body shot', () => {
    const [token] = parseCombo('2B')
    expect(token).toEqual({ kind: 'punch', number: 2, body: true, beatOffset: 0 })
  })

  it('assigns placeholder beat offsets 0,1,2,... in order', () => {
    // Real musical offsets come from templates (doc §17) or M31-02; these are
    // only a stable ordering, and the validator relies on them not decreasing.
    expect(parseCombo('1-2-3-2').map((t) => t.beatOffset)).toEqual([0, 1, 2, 3])
  })

  it.each([
    ['duck', 'defense', 'duck'],
    ['bob and weave', 'defense', 'bob-weave'],
    ['slip', 'defense', 'slip'],
    ['roll', 'defense', 'roll'],
    ['pull', 'defense', 'pull'],
    ['pivot', 'footwork', 'pivot'],
    ['step off', 'footwork', 'step-off'],
    ['circle', 'footwork', 'circle'],
    ['cut off the ring', 'footwork', 'cut-off-ring'],
    ['reset', 'footwork', 'reset'],
    ['double up', 'coach', 'double-up'],
    ['put it on em', 'coach', 'put-it-on-em'],
    ['touch and go', 'coach', 'touch-and-go'],
    ['breathe', 'coach', 'breathe'],
    ['hands up', 'coach', 'hands-up'],
  ])('parses the command word %p as %s/%s', (word, kind, command) => {
    const [token] = parseCombo(word)
    expect(token?.kind).toBe(kind)
    expect(token && 'command' in token ? token.command : null).toBe(command)
  })

  it('parses the doc §15 mixed examples', () => {
    expect(parseCombo('1-slip-2').map((t) => t.kind)).toEqual(['punch', 'defense', 'punch'])
    expect(parseCombo('1-2-roll-3-2').map((t) => t.kind)).toEqual(['punch', 'punch', 'defense', 'punch', 'punch'])
    expect(parseCombo('1-1-step off-2').map((t) => t.kind)).toEqual(['punch', 'punch', 'footwork', 'punch'])
  })

  it('is case-insensitive and tolerates surrounding whitespace on commands', () => {
    expect(parseCombo('1- SLIP -2').map((t) => t.kind)).toEqual(['punch', 'defense', 'punch'])
  })

  it("accepts put it on 'em with or without the apostrophe", () => {
    const withApostrophe = parseCombo("put it on 'em")[0]
    const without = parseCombo('put it on em')[0]
    expect(withApostrophe).toEqual(without)
  })

  // Note which code each malformed input gets. A segment that STARTS with a
  // digit is treated as a broken punch rather than an unknown command, which
  // is the more useful diagnosis: '2x' is a typo in a punch, not a word the
  // parser has never heard of.
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['1-2x', 'malformed-punch'],
    ['12b3', 'malformed-punch'],
    ['1b2', 'malformed-punch'],
    ['1--2', 'unknown-segment'],
    ['jab', 'unknown-segment'],
    ['7', 'punch-out-of-range'],
    ['0', 'punch-out-of-range'],
    ['9b', 'punch-out-of-range'],
  ])('rejects %p with a typed error (%s)', (input, code) => {
    expect(() => parseCombo(input)).toThrow(ComboParseError)
    try {
      parseCombo(input)
    } catch (err) {
      expect((err as ComboParseError).code).toBe(code)
    }
  })

  it('reports the offending segment and its index, not just that parsing failed', () => {
    try {
      parseCombo('1-2-nope-4')
      throw new Error('should have thrown')
    } catch (err) {
      const e = err as ComboParseError
      expect(e.segment).toBe('nope')
      expect(e.index).toBe(2)
    }
  })

  it('never returns a partial result — a bad segment fails the whole combo', () => {
    // Silently dropping a token would change the combination, so parseCombo
    // must not be salvage-oriented.
    expect(() => parseCombo('1-2-???-4')).toThrow(ComboParseError)
  })
})

describe('formatCombo', () => {
  it('always emits a lowercase b regardless of how it was authored', () => {
    expect(formatCombo(parseCombo('2B'))).toBe('2b')
  })

  it.each([
    '1-2',
    '1-1-2',
    '1-2-3',
    '1-2b-3',
    '2-3-6',
    '1-2b-3-2',
    '1-slip-2',
    '1-2-roll-3-2',
    '1-2-pivot-2',
    '1-1-step off-2',
    '3b-2-3-2',
    '1-6-3-2',
  ])('round-trips %p', (notation) => {
    expect(formatCombo(parseCombo(notation))).toBe(notation)
  })

  it('round-trips to the lowercase, whitespace-normalized form', () => {
    expect(formatCombo(parseCombo('1- SLIP -2B'))).toBe('1-slip-2b')
  })
})

describe('canonical named combos (author-supplied, seeds M35-01)', () => {
  // These are the coaching presets the library starts from. The hand column
  // is what the tracker can actually verify — note rows 3 and 4 are identical
  // there, which is exactly why scoring is labelled a hand-sequence match
  // (D4): the tracker cannot tell `1-2-3` from `1-2b-3`.
  const LEAD: Record<number, 'L' | 'R'> = { 1: 'L', 2: 'R', 3: 'L', 4: 'R', 5: 'L', 6: 'R' }
  const handsOrthodox = (notation: string): string =>
    punchTokens(parseCombo(notation))
      .map((t) => LEAD[t.number])
      .join('')

  it.each([
    ['The Basic', '1-2', 2, 'LR'],
    ['The Setup', '1-1-2', 3, 'LLR'],
    ['The Inside Hook', '1-2-3', 3, 'LRL'],
    ['The Body-Head Mix', '1-2b-3', 3, 'LRL'],
    ['The Uppercut Finish', '2-3-6', 3, 'RLR'],
  ])('%s (%s) is %i punches with orthodox hands %s', (_name, notation, count, hands) => {
    expect(punchTokens(parseCombo(notation))).toHaveLength(count)
    expect(handsOrthodox(notation)).toBe(hands)
  })

  it('cannot distinguish 1-2-3 from 1-2b-3 by hand sequence', () => {
    // Pinning the limitation deliberately: if this ever stops being true the
    // capability tier changed and D12 needs revisiting.
    expect(handsOrthodox('1-2-3')).toBe(handsOrthodox('1-2b-3'))
  })
})

describe('punchTokens', () => {
  it('keeps only punch tokens — defense, footwork and coach are unscored (D4)', () => {
    const tokens: WorkoutToken[] = parseCombo('1-slip-2-breathe-3')
    expect(tokens).toHaveLength(5)
    expect(punchTokens(tokens).map((t) => t.number)).toEqual([1, 2, 3])
  })
})
