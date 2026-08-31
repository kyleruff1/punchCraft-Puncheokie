/**
 * Beat-grid token offset lookup — the V1c fallback (M39-V2 Phase 5-ii).
 *
 * V1c had a THREE-source fallback chain
 * (`visualOffsetsMs ?? phraseTokenTimesMs ?? tokenOffsetsMs`). Phase
 * 5-ii retired the first two — engine authoring lives on
 * `SpineSchedule.compiled[cueId]` now. What survives here is just the
 * beat-grid path; the module is one step from being inlined.
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

describe('tokenOffsetsFor — beat-grid list', () => {
  it('returns tokenOffsetsMs by reference (no copy)', () => {
    const c = cue()
    expect(tokenOffsetsFor(c)).toBe(c.tokenOffsetsMs)
  })
})

describe('tokenOffsetFor — per-token beat-grid lookup', () => {
  it('returns the beat-grid offset at the given index', () => {
    const c = cue()
    expect(tokenOffsetFor(c, 0)).toBe(0)
    expect(tokenOffsetFor(c, 1)).toBe(500)
  })

  it('returns 0 for an index beyond the beat grid (defensive)', () => {
    const c = cue({ tokens: [{ kind: 'punch', number: 1, body: false, beatOffset: 0 }] })
    expect(tokenOffsetFor(c, 42)).toBe(0)
  })
})
