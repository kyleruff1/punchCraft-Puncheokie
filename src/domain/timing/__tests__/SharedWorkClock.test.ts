/**
 * SharedWorkClock — the UI-thread projection of the session work clock
 * (MVP v2, GH #305).
 *
 * The one semantic that must never regress: `workElapsedMs` is
 * ACCUMULATED-WITH-HOLES, not `now - start`. The projection runs only
 * from the last publish, and a non-running clock is FROZEN however far
 * the frame timestamp advances — that is what keeps the walk still
 * through pause and rest.
 */
import {
  SHARED_WORK_CLOCK_STOPPED,
  sharedWorkElapsedMs,
  type SharedWorkClock,
} from '../SharedWorkClock'

const running = (over: Partial<SharedWorkClock> = {}): SharedWorkClock => ({
  roundIndex: 0,
  workElapsedAtPublishMs: 10_000,
  publishFrameTimestampMs: 500_000,
  running: true,
  ...over,
})

describe('sharedWorkElapsedMs', () => {
  it('projects linearly from the publish moment while running', () => {
    expect(sharedWorkElapsedMs(running(), 500_000)).toBe(10_000)
    expect(sharedWorkElapsedMs(running(), 500_250)).toBe(10_250)
    expect(sharedWorkElapsedMs(running(), 501_000)).toBe(11_000)
  })

  it('FREEZES when not running — pause and rest advance nothing', () => {
    const paused = running({ running: false })
    expect(sharedWorkElapsedMs(paused, 500_000)).toBe(10_000)
    expect(sharedWorkElapsedMs(paused, 999_999)).toBe(10_000)
  })

  it('a resume publish re-anchors — the paused interval is a hole, not a jump', () => {
    // Pause at 10s; 30s of wall time passes; resume republishes the SAME
    // elapsed with a fresh frame timestamp. Projection continues from 10s.
    const resumed = running({ workElapsedAtPublishMs: 10_000, publishFrameTimestampMs: 530_000 })
    expect(sharedWorkElapsedMs(resumed, 530_100)).toBe(10_100)
  })

  it('the stopped baseline reads 0 forever', () => {
    expect(sharedWorkElapsedMs(SHARED_WORK_CLOCK_STOPPED, 123_456_789)).toBe(0)
  })

  it('carries the enterWork overflow — round start is not assumed zero', () => {
    const withOverflow = running({ workElapsedAtPublishMs: 137, publishFrameTimestampMs: 0 })
    expect(sharedWorkElapsedMs(withOverflow, 50)).toBe(187)
  })
})
