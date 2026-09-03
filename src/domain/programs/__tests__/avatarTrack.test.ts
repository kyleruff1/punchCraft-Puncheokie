/**
 * The avatar lead track (Kyle, 2026-09-02): a pure time-shift of the
 * round's punch schedule — the figure demonstrates each form
 * AVATAR_LEAD_MS before its node lights, never accelerated, never ahead
 * of the authored lead, never lapping a rep.
 */
import { avatarTargetIndex, buildAvatarTrack } from '../avatarTrack'
import type { CueInstance } from '../CueTimeline'

function seqCue(id: string, startMs: number, offsets: number[]): CueInstance {
  return {
    id,
    blockId: 'b1',
    repeatIndex: 0,
    scoring: 'sequence',
    tokens: offsets.map(() => ({ kind: 'punch' as const, number: 1 as const, body: false, beatOffset: 0 })),
    tokenOffsetsMs: offsets,
    expectedPunches: offsets.map((_, tokenIndex) => ({ tokenIndex, hand: 'left' as const })),
    displayOnlyTokenIndexes: [],
    previewAt: 0,
    announceAt: 0,
    scheduledStartMs: startMs,
    scheduledEndMs: startMs + 2_000,
    windowStartMs: startMs,
    windowEndMs: startMs + 2_400,
  }
}

describe('buildAvatarTrack', () => {
  it('flattens sequence cues into chronological punch dues', () => {
    const track = buildAvatarTrack([
      seqCue('bar-0', 0, [0, 600, 1200]),
      seqCue('bar-1', 4_800, [0, 600]),
    ])
    expect(track.map((e) => e.dueMs)).toEqual([0, 600, 1200, 4_800, 5_400])
    expect(track[3]).toEqual({ cueId: 'bar-1', tokenIndex: 0, dueMs: 4_800 })
  })
})

describe('avatarTargetIndex — the 750ms lead', () => {
  const LEAD = 750
  const track = buildAvatarTrack([
    seqCue('bar-0', 0, [0, 600, 1200]),
    seqCue('bar-1', 4_800, [0, 600]),
  ])

  it('previews the next bar exactly LEAD before its first node', () => {
    // 749ms before bar-1's first due: still the previous punch.
    expect(avatarTargetIndex(track, 4_800 - LEAD - 1, LEAD, -1)).toBe(2)
    // At barStart − LEAD: the next bar's opener — the trainer showing form early.
    expect(avatarTargetIndex(track, 4_800 - LEAD, LEAD, 2)).toBe(3)
  })

  it('mid-breath, further than LEAD from the next due, holds the previous punch', () => {
    // 2s after bar-0's last punch, 2.85s before bar-1: still entry 2 —
    // whose cycle has long parked on guard in the card.
    expect(avatarTargetIndex(track, 3_200, LEAD, -1)).toBe(2)
  })

  it('targets nothing before the round leads into its first punch', () => {
    const later = buildAvatarTrack([seqCue('bar-0', 2_000, [0, 600])])
    expect(avatarTargetIndex(later, 0, LEAD, -1)).toBe(-1)
    expect(avatarTargetIndex(later, 2_000 - LEAD, LEAD, -1)).toBe(0)
  })

  it('is monotonic — a cursor never rewinds, so reps cannot lap', () => {
    let cursor = -1
    const samples = [0, 100, 600, 5_000, 4_000, 6_000] // includes a clock wobble
    const seen: number[] = []
    for (const t of samples) {
      cursor = avatarTargetIndex(track, t, LEAD, cursor)
      seen.push(cursor)
    }
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!)
    }
  })
})
