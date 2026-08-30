/**
 * timelineHash + TimelineIdentity (M39-V2 Phase 3).
 *
 * Pins the four invariants downstream consumers rely on:
 *
 *  1. **Deterministic.** Same input → same fingerprint every call,
 *     regardless of object-key insertion order.
 *  2. **Different inputs differ.** Two timelines with any content
 *     divergence must produce different fingerprints; the point of
 *     the fingerprint is to catch drift, not to be reference
 *     equality's poor substitute.
 *  3. **Schema-versioned.** The `v2:` prefix identifies the hash
 *     schema so future breaking changes migrate cleanly.
 *  4. **`sameTimelineIdentity` compares all three fields.** Revision
 *     + cueId + hash all matter; a hash match with a mismatched
 *     revision (a re-compile of a superseded timeline) does not
 *     count as "same."
 */
import { hashTimelineContent, sameTimelineIdentity } from '../timelineHash'

describe('hashTimelineContent — deterministic content fingerprint', () => {
  it('is deterministic — same input, same output', () => {
    const content = { strikes: [{ id: 'a', tick: 0 }, { id: 'b', tick: 240 }] }
    const h1 = hashTimelineContent(content)
    const h2 = hashTimelineContent(content)
    expect(h1).toBe(h2)
  })

  it('is stable under object-key reordering', () => {
    const a = { strikes: [{ id: 'a', tick: 0 }] }
    const b = { strikes: [{ tick: 0, id: 'a' }] }
    expect(hashTimelineContent(a)).toBe(hashTimelineContent(b))
  })

  it('is prefixed `v2:` for schema-version identification', () => {
    const h = hashTimelineContent({ any: 'value' })
    expect(h.startsWith('v2:')).toBe(true)
  })

  it('detects a tick change (single-field divergence)', () => {
    const a = { strikes: [{ id: 'a', tick: 0 }, { id: 'b', tick: 240 }] }
    const b = { strikes: [{ id: 'a', tick: 0 }, { id: 'b', tick: 241 }] }
    expect(hashTimelineContent(a)).not.toBe(hashTimelineContent(b))
  })

  it('detects an id change', () => {
    const a = { strikes: [{ id: 'a', tick: 0 }] }
    const b = { strikes: [{ id: 'A', tick: 0 }] }
    expect(hashTimelineContent(a)).not.toBe(hashTimelineContent(b))
  })

  it('detects an array reordering — order is content', () => {
    const a = { strikes: [{ id: 'a' }, { id: 'b' }] }
    const b = { strikes: [{ id: 'b' }, { id: 'a' }] }
    expect(hashTimelineContent(a)).not.toBe(hashTimelineContent(b))
  })

  it('detects an added element', () => {
    const a = { strikes: [{ id: 'a' }] }
    const b = { strikes: [{ id: 'a' }, { id: 'b' }] }
    expect(hashTimelineContent(a)).not.toBe(hashTimelineContent(b))
  })

  it('handles nested arrays + objects', () => {
    const content = {
      strikes: [{ id: 'a', links: [{ eventId: 'coach-0', relation: 'precall' }] }],
      coachTracks: {
        numeric: { events: [{ id: 'coach-0', strikeIds: ['a'] }] },
        technique: { events: [{ id: 'coach-1', strikeIds: ['a'] }] },
      },
    }
    expect(hashTimelineContent(content)).toBe(hashTimelineContent(content))
  })

  it('handles primitive top-level values', () => {
    expect(hashTimelineContent('hello')).toMatch(/^v2:[0-9a-f]{8}$/)
    expect(hashTimelineContent(42)).toMatch(/^v2:[0-9a-f]{8}$/)
    expect(hashTimelineContent(null)).toMatch(/^v2:[0-9a-f]{8}$/)
  })
})

describe('sameTimelineIdentity', () => {
  it('returns true when all three fields match', () => {
    const a = { revision: 1, cueId: 'cue-A', timelineHash: 'v2:abc' }
    const b = { revision: 1, cueId: 'cue-A', timelineHash: 'v2:abc' }
    expect(sameTimelineIdentity(a, b)).toBe(true)
  })

  it('returns false when any single field differs', () => {
    const base = { revision: 1, cueId: 'cue-A', timelineHash: 'v2:abc' }
    expect(sameTimelineIdentity(base, { ...base, revision: 2 })).toBe(false)
    expect(sameTimelineIdentity(base, { ...base, cueId: 'cue-B' })).toBe(false)
    expect(sameTimelineIdentity(base, { ...base, timelineHash: 'v2:xyz' })).toBe(false)
  })
})
