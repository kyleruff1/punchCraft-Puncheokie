/**
 * The shared token-offset authority chain (M39-V1c ring/avatar sync fix,
 * Kyle 2026-08-30). Pins the priority order every visual consumer must
 * follow — the ring engine and the avatar spine both walk this helper,
 * so they cannot disagree.
 */
import type { CueInstance } from '../CueTimeline'
import { tokenOffsetFor, tokenOffsetsFor } from '../tokenOffsets'

function cue(over: Partial<CueInstance> = {}): CueInstance {
  return {
    id: 'c1',
    blockId: 'b1',
    repeatIndex: 0,
    scoring: 'sequence',
    tokens: [
      { kind: 'punch', number: 1, body: false, beatOffset: 0 },
      { kind: 'punch', number: 2, body: false, beatOffset: 1 },
    ],
    tokenOffsetsMs: [0, 500],
    expectedPunches: [
      { tokenIndex: 0, hand: 'left' },
      { tokenIndex: 1, hand: 'right' },
    ],
    displayOnlyTokenIndexes: [],
    previewAt: 8_000,
    announceAt: 9_500,
    scheduledStartMs: 10_000,
    scheduledEndMs: 10_500,
    windowStartMs: 9_800,
    windowEndMs: 10_800,
    ...over,
  }
}

// ---------------------------------------------------------------------------

describe('tokenOffsetsFor — whole-array chain', () => {
  it('returns tokenOffsetsMs when nothing else is populated (pre-M39 default)', () => {
    const c = cue()
    expect(tokenOffsetsFor(c)).toBe(c.tokenOffsetsMs)
  })

  it('returns phraseTokenTimesMs when the rail is present, no engine', () => {
    const c = cue({ phraseTokenTimesMs: [50, 550] })
    expect(tokenOffsetsFor(c)).toEqual([50, 550])
  })

  it('returns visualOffsetsMs when the engine is present (wins over rail)', () => {
    const c = cue({
      visualOffsetsMs: [0, 250],
      phraseTokenTimesMs: [50, 550],
    })
    expect(tokenOffsetsFor(c)).toEqual([0, 250])
  })
})

describe('tokenOffsetFor — per-token chain (partial fills)', () => {
  it('falls to beat-grid per token when engine and rail are absent', () => {
    const c = cue()
    expect(tokenOffsetFor(c, 0)).toBe(0)
    expect(tokenOffsetFor(c, 1)).toBe(500)
  })

  it('rail wins per token when engine is absent', () => {
    const c = cue({ phraseTokenTimesMs: [50, 550] })
    expect(tokenOffsetFor(c, 0)).toBe(50)
    expect(tokenOffsetFor(c, 1)).toBe(550)
  })

  it('engine wins per token over rail and beat-grid', () => {
    const c = cue({
      visualOffsetsMs: [0, 250],
      phraseTokenTimesMs: [50, 550],
    })
    expect(tokenOffsetFor(c, 0)).toBe(0)
    expect(tokenOffsetFor(c, 1)).toBe(250)
  })

  it('per-token fallback — engine has token 0, rail has token 1, beat has both', () => {
    // Partial fill during migration: engine authored token 0 only,
    // rail authored token 1 only. Each token gets its highest source.
    const c = cue({
      visualOffsetsMs: [100], // only index 0 populated
      phraseTokenTimesMs: [50, 550],
    })
    expect(tokenOffsetFor(c, 0)).toBe(100) // engine wins for token 0
    expect(tokenOffsetFor(c, 1)).toBe(550) // rail wins for token 1 (engine absent)
  })

  it('returns 0 for an index beyond every array (defensive)', () => {
    const c = cue({ tokens: [{ kind: 'punch', number: 1, body: false, beatOffset: 0 }] })
    expect(tokenOffsetFor(c, 42)).toBe(0)
  })
})
