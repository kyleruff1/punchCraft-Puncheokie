/**
 * The twelve-strike drum mapping, pinned against drum-kit-design §5.1.
 *
 * `strikeDrumSignatures` COMPOSES its twelve rows from family × hand ×
 * target rather than transcribing the table. That is the right structure —
 * it cannot drift from the strike catalog — but it means the table itself
 * is never written down anywhere the design can be checked against. This
 * file is that check: the expectations below are read off Kyle's §5.1 by
 * hand, so a composition change that silently rewrites a row fails here.
 */
import type { StrikeToken } from '../instrument/gestureSchema'
import { strikeSignatureKeyOf } from '../instrument/strikeArticulationCatalog'
import {
  DRUM_GROUP_OF,
  GROOVE_ONLY,
  LOGICAL_DRUM_ARTICULATIONS,
  PUNCH_REACHABLE,
  type LogicalDrumArticulation,
} from '../instrument/drums/logicalDrumArticulations'
import {
  STRIKE_DRUM_SIGNATURES,
  drumFamilyOf,
  pieceForBand,
  strikeDrumSignatureOf,
  type ArpMutation,
  type DrumFamily,
  type GrooveRole,
} from '../instrument/drums/strikeDrumSignatures'

/** §5.1, transcribed by hand from the design document. */
interface Row {
  primary: LogicalDrumArticulation
  bodyLayer: LogicalDrumArticulation | null
  arp: ArpMutation
  groove: GrooveRole
  family: DrumFamily
}

const TABLE: Readonly<Record<StrikeToken, Row>> = {
  // "1" Lead jab | Ride bow | None | Advance one legal tone | Timekeeper
  '1': { primary: 'ride-bow', bodyLayer: null, arp: 'advance', groove: 'timekeeper', family: 'jab' },
  // "1B" Lead body jab | Ride bell | Kick | Lower entry, then advance
  '1B': {
    primary: 'ride-bell',
    bodyLayer: 'kick-main',
    arp: 'advance',
    groove: 'timekeeper',
    family: 'jab',
  },
  // "2" Rear cross | Snare center or rimshot | None | Skip and land on power anchor
  '2': {
    primary: 'snare-center',
    bodyLayer: null,
    arp: 'power-land',
    groove: 'backbeat',
    family: 'cross',
  },
  // "2B" Rear body cross | Lower/darker snare hit | Kick
  '2B': {
    primary: 'snare-body',
    bodyLayer: 'kick-main',
    arp: 'power-land',
    groove: 'backbeat',
    family: 'cross',
  },
  // "3" Lead hook | High rack tom | None | Reverse/arc left
  '3': {
    primary: 'rack-tom-high',
    bodyLayer: null,
    arp: 'reverse-left',
    groove: 'movement',
    family: 'hook',
  },
  '3B': {
    primary: 'rack-tom-high',
    bodyLayer: 'kick-main',
    arp: 'reverse-left',
    groove: 'movement',
    family: 'hook',
  },
  // "4" Rear hook | Mid rack tom | None | Rotate/arc right
  '4': {
    primary: 'rack-tom-mid',
    bodyLayer: null,
    arp: 'arc-right',
    groove: 'movement',
    family: 'hook',
  },
  '4B': {
    primary: 'rack-tom-mid',
    bodyLayer: 'kick-main',
    arp: 'arc-right',
    groove: 'movement',
    family: 'hook',
  },
  // "5" Lead uppercut | High floor tom | None | Rise two steps
  '5': {
    primary: 'floor-tom-high',
    bodyLayer: null,
    arp: 'rise-left',
    groove: 'fill',
    family: 'uppercut',
  },
  '5B': {
    primary: 'floor-tom-high',
    bodyLayer: 'kick-main',
    arp: 'rise-left',
    groove: 'fill',
    family: 'uppercut',
  },
  // "6" Rear uppercut | Low floor tom | None | Rise and land on upper anchor
  '6': {
    primary: 'floor-tom-low',
    bodyLayer: null,
    arp: 'rise-right',
    groove: 'fill',
    family: 'uppercut',
  },
  '6B': {
    primary: 'floor-tom-low',
    bodyLayer: 'kick-main',
    arp: 'rise-right',
    groove: 'fill',
    family: 'uppercut',
  },
}

const TOKENS = Object.keys(TABLE) as StrikeToken[]

describe('§5.1 twelve-strike mapping', () => {
  test.each(TOKENS)('%s composes its design row', (token) => {
    const row = TABLE[token]
    const signature = strikeDrumSignatureOf(token)
    expect(signature.primary.normal).toBe(row.primary)
    expect(signature.family).toBe(row.family)
    expect(signature.arpMutation).toBe(row.arp)
    expect(signature.grooveRole).toBe(row.groove)
  })

  test.each(TOKENS)('%s carries a kick layer iff it is a body shot (§5.2)', (token) => {
    const row = TABLE[token]
    const kick = strikeDrumSignatureOf(token).layers.find((l) => l.condition === 'body')
    if (row.bodyLayer === null) {
      expect(kick).toBeUndefined()
      return
    }
    expect(kick?.articulation).toBe(row.bodyLayer)
  })

  test('all twelve are present, in the design table order', () => {
    expect(STRIKE_DRUM_SIGNATURES).toHaveLength(12)
    expect(STRIKE_DRUM_SIGNATURES.map((s) => s.token)).toEqual([
      '1',
      '1B',
      '2',
      '2B',
      '3',
      '3B',
      '4',
      '4B',
      '5',
      '5B',
      '6',
      '6B',
    ])
  })

  test('no strike row reaches a groove-only piece', () => {
    // Hats, the tight ride, the sub kick and the rim click belong to the
    // generated layer. A punch reaching one would mean the boxer is playing
    // the backbone the groove is supposed to own.
    for (const signature of STRIKE_DRUM_SIGNATURES) {
      const pieces = [
        signature.primary.normal,
        signature.primary.accent,
        signature.primary.peak,
        ...signature.layers.map((l) => l.articulation),
      ].filter((p): p is LogicalDrumArticulation => p !== undefined)
      for (const piece of pieces) {
        expect(PUNCH_REACHABLE).toContain(piece)
        expect(GROOVE_ONLY).not.toContain(piece)
      }
    }
  })
})

describe('family taxonomy', () => {
  test('the catalog’s straight splits into jab (lead) and cross (rear)', () => {
    // This is the whole reason the two vocabularies can coexist: the drum
    // family is DERIVED from the same hand entry-bias that picks the stab's
    // setup/power emphasis, so they can never disagree.
    expect(drumFamilyOf(strikeSignatureKeyOf('1'))).toBe('jab')
    expect(drumFamilyOf(strikeSignatureKeyOf('2'))).toBe('cross')
    expect(drumFamilyOf(strikeSignatureKeyOf('3'))).toBe('hook')
    expect(drumFamilyOf(strikeSignatureKeyOf('6'))).toBe('uppercut')
  })

  test('every family strikes a distinct kit group — the ear test in miniature', () => {
    // §1's metaphor only works if the four families land on four different
    // parts of the kit. If two ever share a group they blur, which is the
    // exact failure that produced the stab-role rework.
    const groupOf = (token: StrikeToken): string =>
      DRUM_GROUP_OF[strikeDrumSignatureOf(token).primary.normal]
    const groups = new Set(['1', '2', '3', '5'].map((t) => groupOf(t as StrikeToken)))
    expect(groups.size).toBe(4)
  })

  test('lead and rear differ within the moving families, and match within jab/cross', () => {
    // Hooks and uppercuts travel ACROSS their pair of toms — that lateral
    // and vertical motion is their identity (§§15-16).
    expect(strikeDrumSignatureOf('3').primary.normal).not.toBe(
      strikeDrumSignatureOf('4').primary.normal,
    )
    expect(strikeDrumSignatureOf('5').primary.normal).not.toBe(
      strikeDrumSignatureOf('6').primary.normal,
    )
    // A jab is a jab with either hand; the ride does not move.
    expect(strikeDrumSignatureOf('1').primary.normal).toBe('ride-bow')
  })
})

describe('§9 accent ladder', () => {
  test('jab peaks to the bell, cross peaks to the rimshot', () => {
    expect(pieceForBand(strikeDrumSignatureOf('1'), 'normal')).toBe('ride-bow')
    expect(pieceForBand(strikeDrumSignatureOf('1'), 'peak')).toBe('ride-bell')
    expect(pieceForBand(strikeDrumSignatureOf('2'), 'normal')).toBe('snare-center')
    expect(pieceForBand(strikeDrumSignatureOf('2'), 'peak')).toBe('snare-rimshot')
  })

  test('an unset accent band falls back to the normal piece, not to silence', () => {
    // §9 says "accent → stronger ride bow": the same piece played harder.
    // The band still raises MIDI velocity; only the articulation is shared.
    for (const signature of STRIKE_DRUM_SIGNATURES) {
      expect(pieceForBand(signature, 'accent')).toBeTruthy()
      expect(pieceForBand(signature, 'peak')).toBeTruthy()
    }
    expect(pieceForBand(strikeDrumSignatureOf('1'), 'accent')).toBe('ride-bow')
  })

  test('hooks and uppercuts peak on their own tom (§9: played harder)', () => {
    expect(pieceForBand(strikeDrumSignatureOf('3'), 'peak')).toBe('rack-tom-high')
    expect(pieceForBand(strikeDrumSignatureOf('6'), 'peak')).toBe('floor-tom-low')
  })
})

describe('§4 crash reservation', () => {
  test('no token plays a crash as its ordinary primary', () => {
    // "The crash should not represent an ordinary punch family."
    for (const signature of STRIKE_DRUM_SIGNATURES) {
      expect(signature.primary.normal).not.toBe('crash-main')
      expect(signature.primary.accent).not.toBe('crash-main')
      expect(signature.primary.peak).not.toBe('crash-main')
    }
  })

  test('the crash is reachable only through a peak or phrase-ending condition', () => {
    for (const signature of STRIKE_DRUM_SIGNATURES) {
      for (const layer of signature.layers) {
        if (layer.articulation !== 'crash-main') continue
        expect(['new-peak', 'phrase-ending']).toContain(layer.condition)
      }
    }
  })

  test('the rear uppercut is the phrase-ending crash (§16)', () => {
    const conditions = strikeDrumSignatureOf('6')
      .layers.filter((l) => l.articulation === 'crash-main')
      .map((l) => l.condition)
    expect(conditions).toContain('phrase-ending')
    // An ordinary uppercut does not: "Ordinary uppercut: no crash."
    expect(
      strikeDrumSignatureOf('5').layers.some((l) => l.condition === 'phrase-ending'),
    ).toBe(false)
  })
})

describe('logical catalog integrity (§6)', () => {
  test('sixteen articulations, no duplicates', () => {
    expect(LOGICAL_DRUM_ARTICULATIONS).toHaveLength(16)
    expect(new Set(LOGICAL_DRUM_ARTICULATIONS).size).toBe(16)
  })

  test('every articulation has a kit group, and the two reach-sets partition it', () => {
    for (const articulation of LOGICAL_DRUM_ARTICULATIONS) {
      expect(DRUM_GROUP_OF[articulation]).toBeTruthy()
    }
    expect([...PUNCH_REACHABLE, ...GROOVE_ONLY].sort()).toEqual([...LOGICAL_DRUM_ARTICULATIONS].sort())
  })

  test('the catalog contains no MIDI note numbers or filenames (§2)', () => {
    // The rule this whole module exists to enforce. Anything numeric or
    // path-like here would mean a resolver's job leaked into the domain.
    for (const articulation of LOGICAL_DRUM_ARTICULATIONS) {
      expect(articulation).toMatch(/^[a-z][a-z-]*[a-z]$/)
    }
  })
})
