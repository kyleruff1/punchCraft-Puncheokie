/**
 * Strike catalog + strikeId (M39-V2 Phase 2).
 *
 * Pins the invariants downstream V2 stages depend on:
 *
 *  - The 12 canonical strikes exist, each with a stable, unique
 *    `nodeId`, `family`, `relativeHand`, `target`, and both spoken
 *    label forms.
 *  - `strikeIdFor` produces distinct ids for repeated tokens in a
 *    combo (the `1-1-2` case that today collapses on `tokenIndex`
 *    alone at every consumer).
 */
import {
  DEFAULT_REP_ID,
  STRIKE_CATALOG,
  STRIKE_TOKENS,
  strikeFor,
  strikeIdFor,
  type StrikeToken,
} from '../strikeCatalog'

describe('STRIKE_CATALOG', () => {
  it('contains all 12 canonical strikes', () => {
    expect(STRIKE_TOKENS).toHaveLength(12)
    for (const token of STRIKE_TOKENS) {
      expect(STRIKE_CATALOG[token]).toBeDefined()
      expect(STRIKE_CATALOG[token].token).toBe(token)
    }
  })

  it('each strike has a unique nodeId', () => {
    const ids = new Set(STRIKE_TOKENS.map((t) => STRIKE_CATALOG[t].nodeId))
    expect(ids.size).toBe(12)
  })

  it('body strikes have a distinct nodeId from their head counterpart', () => {
    for (const number of [1, 2, 3, 4, 5, 6] as const) {
      const head = STRIKE_CATALOG[String(number) as StrikeToken]
      const body = STRIKE_CATALOG[`${number}B` as StrikeToken]
      expect(head.nodeId).not.toBe(body.nodeId)
    }
  })

  it('family / hand / target derivations are correct for every token', () => {
    const expected: Array<[StrikeToken, string, 'lead' | 'rear', 'head' | 'body']> = [
      ['1',  'jab',      'lead', 'head'],
      ['1B', 'jab',      'lead', 'body'],
      ['2',  'cross',    'rear', 'head'],
      ['2B', 'cross',    'rear', 'body'],
      ['3',  'hook',     'lead', 'head'],
      ['3B', 'hook',     'lead', 'body'],
      ['4',  'hook',     'rear', 'head'],
      ['4B', 'hook',     'rear', 'body'],
      ['5',  'uppercut', 'lead', 'head'],
      ['5B', 'uppercut', 'lead', 'body'],
      ['6',  'uppercut', 'rear', 'head'],
      ['6B', 'uppercut', 'rear', 'body'],
    ]
    for (const [token, family, hand, target] of expected) {
      const s = STRIKE_CATALOG[token]
      expect(s.family).toBe(family)
      expect(s.relativeHand).toBe(hand)
      expect(s.target).toBe(target)
    }
  })

  it('spoken labels match the render pipeline conventions', () => {
    expect(STRIKE_CATALOG['1'].spoken.numberCall).toBe('One')
    expect(STRIKE_CATALOG['1B'].spoken.numberCall).toBe('One-bee')
    expect(STRIKE_CATALOG['3'].spoken.techniqueCall).toBe('Lead hook')
    expect(STRIKE_CATALOG['3B'].spoken.techniqueCall).toBe('Body lead hook')
    expect(STRIKE_CATALOG['6'].spoken.techniqueCompact).toBe('Rear upper')
    expect(STRIKE_CATALOG['6B'].spoken.techniqueCompact).toBe('Body rear upper')
  })

  it('avatarFrameKey references the (number, body) shape punchAvatarManifest uses', () => {
    expect(STRIKE_CATALOG['1'].avatarFrameKey).toEqual({ number: 1, body: false })
    expect(STRIKE_CATALOG['1B'].avatarFrameKey).toEqual({ number: 1, body: true })
    expect(STRIKE_CATALOG['6B'].avatarFrameKey).toEqual({ number: 6, body: true })
  })
})

describe('strikeFor', () => {
  it('resolves (number, body) to the correct catalog entry', () => {
    expect(strikeFor(1, false)?.token).toBe('1')
    expect(strikeFor(1, true)?.token).toBe('1B')
    expect(strikeFor(6, true)?.token).toBe('6B')
  })
})

describe('strikeIdFor — the fix for repeated tokens in a combo', () => {
  it('produces distinct ids for the three positions in `1-1-2` under one rep', () => {
    const cueId = 'sp1-b2#0'
    const ids = [
      strikeIdFor(cueId, DEFAULT_REP_ID, 0),
      strikeIdFor(cueId, DEFAULT_REP_ID, 1),
      strikeIdFor(cueId, DEFAULT_REP_ID, 2),
    ]
    expect(new Set(ids).size).toBe(3)
    expect(ids[0]).toBe('sp1-b2#0:rep-0:0')
    expect(ids[1]).toBe('sp1-b2#0:rep-0:1')
    expect(ids[2]).toBe('sp1-b2#0:rep-0:2')
  })

  it('the same tokenIndex under different cues produces distinct ids', () => {
    expect(strikeIdFor('cue-a', DEFAULT_REP_ID, 0)).not.toBe(
      strikeIdFor('cue-b', DEFAULT_REP_ID, 0),
    )
  })

  it('the three-level id keeps `1-1-2 × 3` at nine unique occurrences (Phase 3 preview)', () => {
    const cueId = 'sp1-b2#0'
    const strikesPerRep = 3
    const reps = ['rep-0', 'rep-1', 'rep-2']
    const ids: string[] = []
    for (const repId of reps) {
      for (let i = 0; i < strikesPerRep; i += 1) {
        ids.push(strikeIdFor(cueId, repId, i))
      }
    }
    expect(ids).toHaveLength(9)
    expect(new Set(ids).size).toBe(9)
    // Format exhaustively pinned so downstream consumers can rely on the shape.
    expect(ids[0]).toBe('sp1-b2#0:rep-0:0')
    expect(ids[8]).toBe('sp1-b2#0:rep-2:2')
  })
})
