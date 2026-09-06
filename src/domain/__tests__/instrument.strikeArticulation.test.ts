/**
 * Strike articulation catalog goldens (M40-20 #324).
 *
 * The three rules this suite exists to defend:
 *   1. punch type NEVER selects harmony (no cell/pool/bass anywhere),
 *   2. a body shot is the SAME idea lower and heavier — never a new scale
 *      (am. 11's companion: pitch classes are untouched), and
 *   3. free jam may not CLAIM a technique: without a guided token the
 *      identity is 'generic' and raw tracker type bytes are never read.
 */
import { readFileSync } from 'node:fs'

import {
  composeAllStrikeSignatures,
  composeStrikeSignature,
  HAND_MODIFIERS,
  physicalHandOf,
  resolveStrikeArticulation,
  resolveStrikeIdentity,
  STRIKE_FAMILY_PROFILES,
  STRIKE_TOKENS,
  strikeSignatureKeyOf,
  TARGET_MODIFIERS,
} from '../instrument/strikeArticulationCatalog'

// Repo-root relative under jest's cwd — the house pattern (see
// instrumentBankManifest.test.ts), not __dirname.
const CATALOG_SOURCE_PATH = 'src/domain/instrument/strikeArticulationCatalog.ts'

describe('the twelve signatures (design §4)', () => {
  it('decompose exactly per the design table: 1/2 straight, 3/4 hook, 5/6 uppercut, B = body', () => {
    expect(STRIKE_TOKENS).toEqual(['1', '1B', '2', '2B', '3', '3B', '4', '4B', '5', '5B', '6', '6B'])
    expect(STRIKE_TOKENS.map((t) => strikeSignatureKeyOf(t))).toEqual([
      { family: 'straight', hand: 'physical-left', target: 'head' },
      { family: 'straight', hand: 'physical-left', target: 'body' },
      { family: 'straight', hand: 'physical-right', target: 'head' },
      { family: 'straight', hand: 'physical-right', target: 'body' },
      { family: 'hook', hand: 'physical-left', target: 'head' },
      { family: 'hook', hand: 'physical-left', target: 'body' },
      { family: 'hook', hand: 'physical-right', target: 'head' },
      { family: 'hook', hand: 'physical-right', target: 'body' },
      { family: 'uppercut', hand: 'physical-left', target: 'head' },
      { family: 'uppercut', hand: 'physical-left', target: 'body' },
      { family: 'uppercut', hand: 'physical-right', target: 'head' },
      { family: 'uppercut', hand: 'physical-right', target: 'body' },
    ])
  })

  it('compose to twelve DISTINCT signatures, deterministically', () => {
    const all = composeAllStrikeSignatures()
    expect(all).toHaveLength(12)
    expect(new Set(all.map((s) => s.signatureId)).size).toBe(12)
    expect(JSON.stringify(composeAllStrikeSignatures())).toBe(JSON.stringify(all))
  })

  it('golden: the jab (1) — entry-tone stab, two adjacent steps, left rotation', () => {
    const jab = composeStrikeSignature(strikeSignatureKeyOf('1'), '1')
    expect(jab.emphasis).toBe('setup')
    expect(jab.immediate).toEqual({
      stabRole: 'entry-tone',
      baseGateMs: 110,
      velocityGain: 1,
      filterShape: 'snap',
      drumClass: 'light',
      octaveOffset: 0,
      stereoBias: -0.6,
    })
    expect(jab.microArp).toEqual({ operations: ['advance', 'advance'], maxSteps: 2, rotation: -1 })
  })

  it('golden: the cross (2) — SAME family as the jab, unmistakably different sound', () => {
    const jab = composeStrikeSignature(strikeSignatureKeyOf('1'), '1')
    const cross = composeStrikeSignature(strikeSignatureKeyOf('2'), '2')
    expect(cross.key.family).toBe('straight') // same family…
    expect(cross.emphasis).toBe('power')
    // …different stab, different contour, opposite rotation, harder accent.
    expect(cross.immediate.stabRole).toBe('fifth-or-anchor')
    expect(jab.immediate.stabRole).toBe('entry-tone')
    expect(cross.microArp.operations).toEqual(['skip', 'land-fifth'])
    expect(cross.microArp.rotation).toBe(1)
    expect(cross.immediate.velocityGain).toBeGreaterThan(jab.immediate.velocityGain)
    expect(cross.immediate.stereoBias).toBeGreaterThan(jab.immediate.stereoBias)
  })

  it('golden: hook (3/4) reverses and uppercut (5/6) lifts — four distinct contours', () => {
    const hookL = composeStrikeSignature(strikeSignatureKeyOf('3'), '3')
    const hookR = composeStrikeSignature(strikeSignatureKeyOf('4'), '4')
    const upL = composeStrikeSignature(strikeSignatureKeyOf('5'), '5')
    const upR = composeStrikeSignature(strikeSignatureKeyOf('6'), '6')
    expect(hookL.microArp.operations).toEqual(['reverse', 'advance'])
    expect(hookR.microArp.operations).toEqual(['reverse', 'advance', 'land-upper-anchor'])
    expect(hookR.microArp.rotation).toBe(1) // the mirrored pendulum
    expect(hookL.microArp.rotation).toBe(-1)
    expect(upL.microArp.operations).toEqual(['advance', 'octave-pulse-up', 'advance'])
    expect(upR.microArp.operations).toEqual(['advance', 'octave-pulse-up', 'land-fifth'])
    expect(upL.immediate.filterShape).toBe('rising-scoop')
    expect(hookL.immediate.filterShape).toBe('lateral-wah')
  })

  it('the M40 exit shape: jab / cross / hook / uppercut are four different sounds', () => {
    const four = (['1', '2', '3', '5'] as const).map((t) =>
      composeStrikeSignature(strikeSignatureKeyOf(t), t),
    )
    const fingerprints = four.map((s) =>
      JSON.stringify([s.immediate.stabRole, s.immediate.filterShape, s.immediate.drumClass, s.microArp.operations]),
    )
    expect(new Set(fingerprints).size).toBe(4)
  })
})

describe('family contours (design §3)', () => {
  it('straight steps, hook reverses, uppercut lifts — three different operation sets', () => {
    expect(STRIKE_FAMILY_PROFILES.straight.setup.operations).toEqual(['advance', 'advance'])
    expect(STRIKE_FAMILY_PROFILES.hook.setup.operations).toEqual(['reverse', 'advance'])
    expect(STRIKE_FAMILY_PROFILES.uppercut.setup.operations).toEqual([
      'advance',
      'octave-pulse-up',
      'advance',
    ])
    // Every family's power variant lands rather than drifting.
    for (const family of ['straight', 'hook', 'uppercut'] as const) {
      const ops = STRIKE_FAMILY_PROFILES[family].power.operations
      expect(ops[ops.length - 1]).toMatch(/^land-/)
    }
  })

  it('gate widens straight → hook → uppercut, and each family has its own filter shape + drum class', () => {
    const gates = (['straight', 'hook', 'uppercut'] as const).map(
      (f) => STRIKE_FAMILY_PROFILES[f].immediate.baseGateMs,
    )
    expect(gates[0]).toBeLessThan(gates[1]!)
    expect(gates[1]).toBeLessThan(gates[2]!)
    expect(
      (['straight', 'hook', 'uppercut'] as const).map(
        (f) => STRIKE_FAMILY_PROFILES[f].immediate.filterShape,
      ),
    ).toEqual(['snap', 'lateral-wah', 'rising-scoop'])
    // The drum piece is per-EMPHASIS (M40-25), so all four classes are
    // used and a jab and a cross never share a drum.
    const drums = (['straight', 'hook', 'uppercut'] as const).flatMap((f) => [
      STRIKE_FAMILY_PROFILES[f].setup.drumClass,
      STRIKE_FAMILY_PROFILES[f].power.drumClass,
    ])
    expect(new Set(drums)).toEqual(new Set(['light', 'power', 'sweep', 'lift']))
    expect(STRIKE_FAMILY_PROFILES.straight.setup.drumClass).not.toBe(
      STRIKE_FAMILY_PROFILES.straight.power.drumClass,
    )
  })

  it('each family asks for its OWN persistent pattern once it dominates', () => {
    expect(STRIKE_FAMILY_PROFILES.straight.persistentPattern.patternId).toBe('up')
    expect(STRIKE_FAMILY_PROFILES.hook.persistentPattern.patternId).toBe('pendulum')
    expect(STRIKE_FAMILY_PROFILES.uppercut.persistentPattern.patternId).toBe('fanfare')
    // ≥2 punches of one family before a pattern may commit (anti-chaos).
    for (const family of ['straight', 'hook', 'uppercut'] as const) {
      expect(STRIKE_FAMILY_PROFILES[family].persistentPattern.requiredEvidence).toBeGreaterThanOrEqual(2)
    }
  })
})

describe('the hand axis is PHYSICAL (amendment 11)', () => {
  it('names physical hands only — nothing in the module says lead or rear', () => {
    expect(Object.keys(HAND_MODIFIERS)).toEqual(['physical-left', 'physical-right'])
    const source = readFileSync(CATALOG_SOURCE_PATH, 'utf8')
    // The words appear only in the comments that EXPLAIN the deferral.
    const codeLines = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n')
    expect(codeLines).not.toMatch(/'lead'|"lead"|lead:/)
    expect(codeLines).not.toMatch(/'rear'|"rear"|rear:/)
  })

  it('the two hands are audibly opposite: rotation, stereo, and accent', () => {
    const left = HAND_MODIFIERS['physical-left']
    const right = HAND_MODIFIERS['physical-right']
    expect(left.rotation).toBe(-1)
    expect(right.rotation).toBe(1)
    expect(Math.sign(left.stereoBias)).toBe(-Math.sign(right.stereoBias))
    expect(right.accentMultiplier).toBeGreaterThan(left.accentMultiplier)
  })

  it('physicalHandOf maps the live punch hand without claiming a stance', () => {
    expect(physicalHandOf('left')).toBe('physical-left')
    expect(physicalHandOf('right')).toBe('physical-right')
  })
})

describe('the body modifier: same idea, lower and heavier (design §3)', () => {
  it('property: every B token is its head twin minus an octave, darker, longer, heavier', () => {
    for (const token of ['1', '2', '3', '4', '5', '6'] as const) {
      const head = composeStrikeSignature(strikeSignatureKeyOf(token), token)
      const body = composeStrikeSignature(strikeSignatureKeyOf(`${token}B` as never), null)
      expect(body.immediate.octaveOffset).toBe(head.immediate.octaveOffset - 1)
      expect(body.immediate.baseGateMs).toBeGreaterThan(head.immediate.baseGateMs)
      expect(body.brightnessMultiplier).toBeLessThan(head.brightnessMultiplier)
      expect(body.transientGain).toBeGreaterThan(head.transientGain)
      // Same family contour: the operations differ ONLY by the lower
      // inversion prefix — a body shot is never a different idea.
      expect(body.microArp.operations.slice(1)).toEqual(head.microArp.operations)
      expect(body.microArp.operations[0]).toBe('lower-inversion')
      expect(body.key.family).toBe(head.key.family)
      expect(body.key.hand).toBe(head.key.hand)
    }
  })

  it('the target modifier changes register and weight — never a pitch class', () => {
    // The catalog has no note/pool/chord vocabulary at all: the only pitch
    // lever it owns is an OCTAVE offset.
    expect(TARGET_MODIFIERS.body.octaveOffset).toBe(-1)
    expect(TARGET_MODIFIERS.head.octaveOffset).toBe(0)
    const source = readFileSync(CATALOG_SOURCE_PATH, 'utf8')
    expect(source).not.toMatch(/midiNote|chordMidiNotes|bassMidiNote|rotatedPool|cubeCellId/)
  })
})

describe('identity policy (design §2, this slice)', () => {
  it('a guided token yields the FULL signature at confidence 1', () => {
    const identity = resolveStrikeIdentity({ expectedStrikeToken: '4B', hand: 'right' })
    expect(identity).toEqual({
      source: 'guided-score',
      token: '4B',
      family: 'hook',
      level: 'body',
      confidence: 1,
    })
    const articulation = resolveStrikeArticulation(identity, 'right')
    expect(articulation.signatureId).toBe('hook:physical-right:body')
  })

  it('free jam is GENERIC: no token, no family claim, confidence 0', () => {
    const identity = resolveStrikeIdentity({ hand: 'left' })
    expect(identity).toEqual({ source: 'generic', confidence: 0 })
    expect(identity.family).toBeUndefined()
    expect(identity.token).toBeUndefined()
  })

  it('a generic punch still articulates per HAND — left and right differ audibly', () => {
    const generic = resolveStrikeIdentity({ hand: 'left' })
    const left = resolveStrikeArticulation(generic, 'left')
    const right = resolveStrikeArticulation(generic, 'right')
    expect(left.signatureId).toBe('straight:physical-left:head')
    expect(right.signatureId).toBe('straight:physical-right:head')
    expect(left.microArp.rotation).not.toBe(right.microArp.rotation)
    expect(left.immediate.stereoBias).not.toBe(right.immediate.stereoBias)
    // …but neither claims a technique.
    expect(left.token).toBeNull()
    expect(right.token).toBeNull()
  })

  it('raw tracker type bytes are NEVER consulted (H12) until M44-02 validates them', () => {
    const source = readFileSync(CATALOG_SOURCE_PATH, 'utf8')
    const codeLines = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n')
    expect(codeLines).not.toMatch(/punchTypeRaw/)
  })

  it('punch type never selects harmony: the catalog cannot even name a chord', () => {
    const source = readFileSync(CATALOG_SOURCE_PATH, 'utf8')
    expect(source).not.toMatch(/import .*(brassCube|harmonicField|cubeCompiler)/)
  })
})
