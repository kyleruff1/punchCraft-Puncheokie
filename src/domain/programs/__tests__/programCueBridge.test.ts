/**
 * Bridge from V1c `CueInstance` to Phase 3b `ProgramCue`, and the
 * one-call convenience wrapper that compiles the result.
 *
 * The invariants pinned here are the ones the runtime relies on:
 *
 *  1. A punch-only cue produces a strike-per-punch compiled timeline;
 *     the two `1`s in `1-1-2` produce three unique eventIds (Kyle
 *     decisive test 1 — end-to-end from CueInstance shape).
 *  2. Defense / footwork / coach tokens are SKIPPED (a strike-only
 *     timeline).
 *  3. A CueInstance with zero punch tokens returns null (defense-only
 *     block, coast marker, etc.) — signals "fall back to V1c dispatch".
 *  4. `executeAtTick` matches the transport ticks at
 *     `cue.scheduledStartMs` (60 BPM × 960 PPQN = 960 ticks/s = 0.96
 *     ticks/ms).
 *  5. The cadence name maps to the correct `BeatDivision`
 *     (technical=1 / steady=2 / pressure=3 / sprint=4) and an unknown
 *     cadence falls back to steady (2).
 */
import type { CueInstance } from '../CueTimeline'
import { compileCueFromInstance, NULL_COACH_ASSET_RESOLVER, programCueFromInstance } from '../programCueBridge'
import type { WorkoutToken } from '../../workout/WorkoutTokens'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function punch(number: 1 | 2 | 3 | 4 | 5 | 6, body = false): WorkoutToken {
  return { kind: 'punch', number, body, beatOffset: 0 }
}

function cue(overrides: Partial<CueInstance> & { tokens: WorkoutToken[] }): CueInstance {
  const { tokens, ...rest } = overrides
  return {
    id: 'cue-1',
    blockId: 'block-1',
    repeatIndex: 0,
    scoring: 'sequence',
    tokens,
    tokenOffsetsMs: tokens.map((_, i) => i * 400),
    expectedPunches: tokens.map((_, tokenIndex) => ({
      tokenIndex,
      hand: 'left' as const,
    })),
    displayOnlyTokenIndexes: [],
    previewAt: 8_500,
    announceAt: 9_250,
    scheduledStartMs: 10_000,
    scheduledEndMs: 10_800,
    windowStartMs: 9_800,
    windowEndMs: 11_200,
    ...rest,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('programCueFromInstance — the CueInstance → ProgramCue bridge', () => {
  it('emits one AuthoredStrike per punch token, in order', () => {
    const c = cue({ tokens: [punch(1), punch(1), punch(2)] })
    const program = programCueFromInstance(c, {
      roundId: 'round-1',
      coachAssets: NULL_COACH_ASSET_RESOLVER,
    })
    expect(program).not.toBeNull()
    expect(program!.combo.strikes).toEqual([
      { token: '1', atStep: 0 },
      { token: '1', atStep: 1 },
      { token: '2', atStep: 2 },
    ])
    expect(program!.combo.totalSteps).toBe(3)
  })

  it('maps body tokens to uppercase-B strike ids (matching StrikeToken)', () => {
    const c = cue({ tokens: [punch(2, true), punch(3, true)] })
    const program = programCueFromInstance(c, {
      roundId: 'r1',
      coachAssets: NULL_COACH_ASSET_RESOLVER,
    })
    expect(program!.combo.strikes.map((s) => s.token)).toEqual(['2B', '3B'])
  })

  it('SKIPS defense / footwork / coach tokens', () => {
    const tokens: WorkoutToken[] = [
      { kind: 'defense', command: 'slip', beatOffset: 0 },
      punch(2),
      { kind: 'coach', command: 'hands-up', beatOffset: 0 },
      punch(3),
    ]
    const c = cue({ tokens })
    const program = programCueFromInstance(c, {
      roundId: 'r1',
      coachAssets: NULL_COACH_ASSET_RESOLVER,
    })
    // Only two strikes survive; step positions are per-punch ordinal.
    expect(program!.combo.strikes).toEqual([
      { token: '2', atStep: 0 },
      { token: '3', atStep: 1 },
    ])
    expect(program!.combo.totalSteps).toBe(2)
  })

  it('returns null for a cue with zero punch tokens', () => {
    const defenseOnly = cue({
      tokens: [{ kind: 'defense', command: 'slip', beatOffset: 0 }],
    })
    expect(
      programCueFromInstance(defenseOnly, {
        roundId: 'r1',
        coachAssets: NULL_COACH_ASSET_RESOLVER,
      }),
    ).toBeNull()

    const coastOnly = cue({
      tokens: [{ kind: 'coach', command: 'breathe', beatOffset: 0 }],
    })
    expect(
      programCueFromInstance(coastOnly, {
        roundId: 'r1',
        coachAssets: NULL_COACH_ASSET_RESOLVER,
      }),
    ).toBeNull()
  })

  it('sets executeAtTick from scheduledStartMs (60 BPM × 960 PPQN)', () => {
    // 60 BPM × 960 PPQN = 960 ticks/s = 0.96 ticks/ms.
    // 10_000 ms → 9600 ticks. Rounded from 9600.0.
    const c = cue({ tokens: [punch(1)], scheduledStartMs: 10_000 })
    const program = programCueFromInstance(c, {
      roundId: 'r1',
      coachAssets: NULL_COACH_ASSET_RESOLVER,
    })
    expect(program!.executeAtTick).toBe(9600)
  })

  it('maps cadence name to the right BeatDivision', () => {
    const cases: Array<[string | undefined, number]> = [
      ['technical', 1],
      ['steady', 2],
      ['pressure', 3],
      ['sprint', 4],
      [undefined, 2], // fallback
      ['unknown-cadence-string', 2], // fallback
    ]
    for (const [cadence, expected] of cases) {
      const c = cue({ tokens: [punch(1)] })
      const withCadence: CueInstance =
        cadence === undefined ? c : { ...c, cadence }
      const program = programCueFromInstance(withCadence, {
        roundId: 'r1',
        coachAssets: NULL_COACH_ASSET_RESOLVER,
      })
      expect(program!.executionDivision).toBe(expected)
    }
  })

  it('emits a single-rep repetition (CueInstance is already one rep)', () => {
    const c = cue({ tokens: [punch(1), punch(2)] })
    const program = programCueFromInstance(c, {
      roundId: 'r1',
      coachAssets: NULL_COACH_ASSET_RESOLVER,
    })
    expect(program!.repetition).toEqual({ count: 1, gapSteps: 0 })
  })

  it('forwards roundId and revision', () => {
    const c = cue({ tokens: [punch(1)] })
    const program = programCueFromInstance(c, {
      roundId: 'round-42',
      coachAssets: NULL_COACH_ASSET_RESOLVER,
      revision: 7,
    })
    expect(program!.roundId).toBe('round-42')
    expect(program!.revision).toBe(7)
  })

  it('forwards responseGapTicks when set', () => {
    const c = cue({ tokens: [punch(1)] })
    const withGap = programCueFromInstance(c, {
      roundId: 'r1',
      coachAssets: NULL_COACH_ASSET_RESOLVER,
      responseGapTicks: 90,
    })
    const withoutGap = programCueFromInstance(c, {
      roundId: 'r1',
      coachAssets: NULL_COACH_ASSET_RESOLVER,
    })
    expect(withGap!.responseGapTicks).toBe(90)
    expect(withoutGap!.responseGapTicks).toBeUndefined()
  })
})

describe('compileCueFromInstance — end-to-end (bridge → compileCue)', () => {
  it('produces a compiled timeline whose strikes match the CueInstance punch order (Kyle decisive test 1)', () => {
    // The `1-1-2` scenario end-to-end: the two `1`s must produce
    // three unique strike eventIds so the avatar/rings don't collapse.
    const c = cue({ tokens: [punch(1), punch(1), punch(2)] })
    const compiled = compileCueFromInstance(c, {
      roundId: 'r1',
      coachAssets: NULL_COACH_ASSET_RESOLVER,
    })
    expect(compiled).not.toBeNull()
    expect(compiled!.strikes).toHaveLength(3)
    const ids = compiled!.strikes.map((s) => s.eventId)
    expect(new Set(ids).size).toBe(3)
  })

  it('returns null for a defense-only cue (matches the bridge contract)', () => {
    const c = cue({
      tokens: [{ kind: 'defense', command: 'slip', beatOffset: 0 }],
    })
    expect(
      compileCueFromInstance(c, {
        roundId: 'r1',
        coachAssets: NULL_COACH_ASSET_RESOLVER,
      }),
    ).toBeNull()
  })

  it('produces empty coach tracks under the NULL resolver (silent coach)', () => {
    const c = cue({ tokens: [punch(1), punch(2)] })
    const compiled = compileCueFromInstance(c, {
      roundId: 'r1',
      coachAssets: NULL_COACH_ASSET_RESOLVER,
    })
    expect(compiled!.coachTracks.numeric.events).toHaveLength(0)
    expect(compiled!.coachTracks.technique.events).toHaveLength(0)
    // Strikes still there — the visual layer never depends on coach content.
    expect(compiled!.strikes).toHaveLength(2)
  })

  it('stamps a deterministic timeline identity (revision + cueId + hash)', () => {
    const c = cue({ tokens: [punch(1), punch(2)], id: 'cue-A' })
    const a = compileCueFromInstance(c, {
      roundId: 'r1',
      coachAssets: NULL_COACH_ASSET_RESOLVER,
      revision: 3,
    })
    const b = compileCueFromInstance(c, {
      roundId: 'r1',
      coachAssets: NULL_COACH_ASSET_RESOLVER,
      revision: 3,
    })
    expect(a!.identity).toEqual(b!.identity)
    expect(a!.identity.cueId).toBe('cue-A')
    expect(a!.identity.revision).toBe(3)
  })
})
