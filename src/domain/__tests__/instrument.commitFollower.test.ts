/**
 * Tablet commit parity (M40-23 #327, second-pass am. 12).
 *
 * Two failure modes this suite exists to prevent: the tablet sounding a
 * DIFFERENT chord from the bridge (stable-chordId sample routing), and the
 * tablet evolving a SECOND SONG when confirmations stop arriving (the
 * follower's authority rules).
 */
import { selectInstrumentSamples } from '@audio/instrumentSelection'
import { compileBrassCube } from '@domain/instrument/brassCube'
import {
  applyLocalCommit,
  chordIdentityMatches,
  emptyFollowerState,
  followConfirmedCommit,
  markLinkLost,
  markLinkRestored,
  onsetParityWithinTolerance,
  reidentify,
  type ConfirmedCommit,
  type FollowerIdentity,
} from '@domain/instrument/commitFollower'
import { compilePunchPatch } from '@domain/instrument/cubeCompiler'
import {
  compileGesture,
  emptySessionState,
} from '@domain/instrument/gestureCompiler'
import type { CompiledPunchGesture } from '@domain/instrument/gestureSchema'
import type { CompiledHarmonicCommit } from '@domain/instrument/harmonicCommit'
import {
  compileHarmonicField,
  FOUNDATION_CAPABILITIES,
  TENSION_ORDERED_DORIAN_NODES,
} from '@domain/instrument/harmonicField'
import { launchPatchById } from '@domain/instrument/punchPatch'

const IDENTITY: FollowerIdentity = {
  sessionId: 'jam-1',
  compiledFieldHash: 'field-abc',
  patchGeneration: 2,
  transportGeneration: 5,
}

function commit(overrides: Partial<CompiledHarmonicCommit> = {}): CompiledHarmonicCommit {
  return {
    commitId: 'c480-L0R0',
    requestedCommitTick: 480,
    audibleCommitTick: 480,
    contributingPunchEventIds: ['e1'],
    previousCellId: null,
    resolvedCellId: 'L0R0',
    bassNote: 26,
    entryTone: 50,
    arpPool: [50, 53, 57, 60, 64, 74],
    patternRotation: 0,
    previousArpIntervalTicks: 480,
    nextArpIntervalTicks: 480,
    nextArpPhaseTick: 480,
    ...overrides,
  }
}

const confirmed = (
  c: CompiledHarmonicCommit,
  identity: Partial<FollowerIdentity> = {},
): ConfirmedCommit => ({ ...IDENTITY, ...identity, commit: c })

describe('BOTH mode — the bridge is the authority', () => {
  it('a fully matching confirmation applies', () => {
    const state = emptyFollowerState('bridge', IDENTITY)
    const result = followConfirmedCommit(state, confirmed(commit()))
    expect(result.rejected).toBeNull()
    expect(result.apply?.resolvedCellId).toBe('L0R0')
    expect(result.state.applied?.commitId).toBe('c480-L0R0')
  })

  it('rejects every identity mismatch BY NAME rather than ignoring it', () => {
    const state = emptyFollowerState('bridge', IDENTITY)
    expect(followConfirmedCommit(state, confirmed(commit(), { sessionId: 'other' })).rejected).toBe(
      'session-mismatch',
    )
    expect(
      followConfirmedCommit(state, confirmed(commit(), { patchGeneration: 1 })).rejected,
    ).toBe('stale-patch-generation')
    expect(
      followConfirmedCommit(state, confirmed(commit(), { transportGeneration: 4 })).rejected,
    ).toBe('stale-transport-generation')
    expect(
      followConfirmedCommit(state, confirmed(commit(), { compiledFieldHash: 'other' })).rejected,
    ).toBe('field-hash-mismatch')
    // …and nothing is applied in any of those cases.
    expect(
      followConfirmedCommit(state, confirmed(commit(), { sessionId: 'other' })).apply,
    ).toBeNull()
  })

  it('discards duplicates and late/out-of-order confirmations', () => {
    let state = emptyFollowerState('bridge', IDENTITY)
    state = followConfirmedCommit(state, confirmed(commit({ requestedCommitTick: 960 }))).state
    const duplicate = followConfirmedCommit(
      state,
      confirmed(commit({ requestedCommitTick: 960 })),
    )
    expect(duplicate.rejected).toBe('duplicate')
    const late = followConfirmedCommit(
      state,
      confirmed(commit({ commitId: 'c480-L1R0', requestedCommitTick: 480 })),
    )
    expect(late.rejected).toBe('out-of-order')
    expect(late.apply).toBeNull()
    // The harmony that already sounded is untouched by either.
    expect(late.state.applied?.requestedCommitTick).toBe(960)
  })

  it('a MISSING confirmation holds the last harmony — never a local commit', () => {
    let state = emptyFollowerState('bridge', IDENTITY)
    state = followConfirmedCommit(state, confirmed(commit())).state
    // The tablet tries to commit on its own while the bridge is silent.
    const local = applyLocalCommit(state, commit({ commitId: 'c960-L3R0', resolvedCellId: 'L3R0' }))
    expect(local.apply).toBeNull()
    expect(local.state.applied?.resolvedCellId).toBe('L0R0')
  })

  it('extended loss fades the bed and warns, keeping the last confirmed cell', () => {
    let state = emptyFollowerState('bridge', IDENTITY)
    state = followConfirmedCommit(state, confirmed(commit())).state
    state = markLinkLost(state)
    expect(state.linkLost).toBe(true)
    expect(state.applied?.resolvedCellId).toBe('L0R0') // retained for a fast resume
    state = markLinkRestored(state)
    expect(state.linkLost).toBe(false)
  })

  it('a settings/world change invalidates every pending confirmation', () => {
    let state = emptyFollowerState('bridge', IDENTITY)
    state = followConfirmedCommit(state, confirmed(commit())).state
    const next = reidentify(state, { ...IDENTITY, patchGeneration: 3 })
    expect(next.applied).toBeNull()
    // A confirmation stamped with the OLD generation is now stale.
    expect(followConfirmedCommit(next, confirmed(commit())).rejected).toBe(
      'stale-patch-generation',
    )
  })
})

describe('TABLET mode — the tablet is its own authority', () => {
  it('applies local commits directly', () => {
    const state = emptyFollowerState('tablet', IDENTITY)
    const result = applyLocalCommit(state, commit())
    expect(result.rejected).toBeNull()
    expect(result.apply?.resolvedCellId).toBe('L0R0')
  })

  it('link loss is meaningless without a bridge authority', () => {
    const state = markLinkLost(emptyFollowerState('tablet', IDENTITY))
    expect(state.linkLost).toBe(false)
  })
})

describe('parity is defined, not assumed', () => {
  it('chord identity is the MANDATORY half', () => {
    expect(chordIdentityMatches(commit(), commit())).toBe(true)
    expect(chordIdentityMatches(commit(), commit({ resolvedCellId: 'L4R2' }))).toBe(false)
    expect(chordIdentityMatches(null, null)).toBe(true)
    expect(chordIdentityMatches(commit(), null)).toBe(false)
  })

  it('onset parity is MEASURED against a tolerance, never promised exact', () => {
    expect(onsetParityWithinTolerance(1000, 1080)).toBe(true)
    expect(onsetParityWithinTolerance(1000, 1400)).toBe(false)
    expect(onsetParityWithinTolerance(1000, 1010, 5)).toBe(false)
  })
})

describe('stable-chordId sample routing (amendment 6)', () => {
  const v2Gesture = (leftVelocity: number): CompiledPunchGesture => {
    const patch = launchPatchById('dorian-brass-v2')
    const cubeMap = compilePunchPatch(patch)
    const brassMap = compileBrassCube(patch)
    const field = compileHarmonicField(patch.id, patch.harmonicField!, brassMap)
    const result = compileGesture(
      {
        eventId: 'e1',
        hand: 'left',
        receivedMonotonicTimeMs: 0,
        velocityRaw: 40,
        recovered: false,
      },
      emptySessionState(),
      {
        sessionId: 's',
        patch,
        cubeMap,
        brassMap,
        field,
        velocity01: leftVelocity,
        acceleration01: 0.6,
      },
    )
    return result!.gesture
  }

  it('a v2 gesture names its STABLE chord id and rendered bank slot', () => {
    const gesture = v2Gesture(0.9)
    expect(gesture.quantized?.chordId).toBeDefined()
    expect(gesture.quantized?.sampleBankSlot).toBeDefined()
    const node = TENSION_ORDERED_DORIAN_NODES.find((n) => n.chordId === gesture.quantized!.chordId)!
    expect(gesture.quantized!.sampleBankSlot).toBe(node.legacySampleBankSlot)
    expect(gesture.quantized!.chordName).toBe(node.displayName)
  })

  it('the tablet routes by the SLOT, so tension ordering cannot mis-sound a chord', () => {
    const gesture = v2Gesture(0.9)
    const selection = selectInstrumentSamples(gesture, 'brass', 'arp')
    const slot = gesture.quantized!.sampleBankSlot!
    expect(selection.bass).toContain(String(slot))
    // The cell's LEFT ZONE is the v2 tension index; when it differs from
    // the rendered slot, routing by zone would have sounded another chord.
    const leftZone = Number(/^L(\d)R(\d)$/.exec(gesture.quantized!.cubeCellId)![1])
    if (leftZone !== slot) {
      expect(selection.bass).not.toContain(String(leftZone))
    }
  })

  it('a v1 gesture has no slot and still routes by zone, byte-unchanged', () => {
    const patch = launchPatchById('dorian-brass-cube')
    const cubeMap = compilePunchPatch(patch)
    const brassMap = compileBrassCube(patch)
    const result = compileGesture(
      { eventId: 'e1', hand: 'left', receivedMonotonicTimeMs: 0, velocityRaw: 40, recovered: false },
      emptySessionState(),
      { sessionId: 's', patch, cubeMap, brassMap, velocity01: 0.9, acceleration01: 0.6 },
    )!
    expect(result.gesture.quantized?.chordId).toBeUndefined()
    expect(result.gesture.quantized?.sampleBankSlot).toBeUndefined()
    const selection = selectInstrumentSamples(result.gesture, 'brass', 'arp')
    const leftZone = Number(/^L(\d)R(\d)$/.exec(result.gesture.quantized!.cubeCellId)![1])
    expect(selection.bass).toContain(String(leftZone))
  })
})

describe('the capability envelope after M40-23', () => {
  it('all three outputs are reachable; guided-4x4 still is not', () => {
    expect(FOUNDATION_CAPABILITIES.supportedOutputs).toEqual(['bridge', 'tablet', 'both'])
    expect(FOUNDATION_CAPABILITIES.supportedFreedomModes).not.toContain('guided-4x4')
  })
})
