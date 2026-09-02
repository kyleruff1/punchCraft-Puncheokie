/**
 * The punch-avatar contract — ONE FLIP PER NODE (Kyle, on-glass 2026-08-31).
 *
 * "Start retracted, then flip to extended. Just one flip per node."
 * The fighter opens in guard, flips ONCE to the strike when the flip
 * frame elapses, and HOLDS the strike until the next adoption. No
 * wind-up return, no last-in-chain sandwich — those choreographies are
 * retired (their pins used to live here).
 *
 * Frame names are LEGACY-INVERTED in the manifest: 'step1' is the
 * STRIKE art, 'step2' is the RETRACTED/guard art (punchAvatarManifest).
 * So the one-flip cycle is step2 → step1.
 */
import {
  MAX_FRAME_MS,
  MIN_FRAME_MS,
  MIN_HOLD_MS,
  minHoldMs,
  avatarFrameAt,
  avatarWindowMs,
  flipFrameMs,
  punchAvatarKey,
} from '../workout/punchAvatar'
import type { PunchNumber } from '../workout/WorkoutTokens'

const NUMBERS: PunchNumber[] = [1, 2, 3, 4, 5, 6]

describe('punchAvatarKey', () => {
  it('is the punch notation, head and body', () => {
    expect(punchAvatarKey(1, false)).toBe('1')
    expect(punchAvatarKey(1, true)).toBe('1b')
    expect(punchAvatarKey(6, true)).toBe('6b')
  })

  it('is unique across the whole punch vocabulary', () => {
    const keys = NUMBERS.flatMap((n) => [punchAvatarKey(n, false), punchAvatarKey(n, true)])
    expect(new Set(keys).size).toBe(12)
  })
})

describe('flipFrameMs', () => {
  it('is a quarter of the window, fenced by the readability bounds', () => {
    expect(flipFrameMs(800)).toBe(200)
    expect(flipFrameMs(100)).toBe(MIN_FRAME_MS)
    expect(flipFrameMs(100_000)).toBe(MAX_FRAME_MS)
    expect(flipFrameMs(0)).toBe(MIN_FRAME_MS)
    expect(flipFrameMs(-50)).toBe(MIN_FRAME_MS)
  })
})

describe('avatarFrameAt — one flip per node', () => {
  // Sprint cadence through a long technical hold, plus the degenerate ends.
  const windows = [0, 50, 120, 180, 250, 400, 600, 900, 1500, 3000]

  it.each(windows)('window %sms opens in guard and strikes once', (windowMs) => {
    const frame = flipFrameMs(windowMs)
    expect(avatarFrameAt(0, windowMs)).toBe('step2')
    expect(avatarFrameAt(frame - 1, windowMs)).toBe('step2')
    expect(avatarFrameAt(frame, windowMs)).toBe('step1')
  })

  it.each(windows)('window %sms shows the strike through its window, then settles to guard', (windowMs) => {
    // Stillness rule (Kyle, 2026-09-02): guard -> strike -> SETTLE back
    // to guard, once. Mid-combo the settle is invisible (the next punch
    // adopts at window end); before rests, gaps and pauses it IS the
    // motionless retracted pose. The strike region is floored at
    // MIN_FRAME_MS so degenerate windows still show the throw.
    const frame = flipFrameMs(windowMs)
    const strikeEnd = Math.max(windowMs, frame + MIN_FRAME_MS)
    expect(avatarFrameAt(frame, windowMs)).toBe('step1')
    expect(avatarFrameAt(strikeEnd - 1, windowMs)).toBe('step1')
    for (const t of [strikeEnd, strikeEnd + 500, 60_000]) {
      expect(avatarFrameAt(t, windowMs)).toBe('step2')
    }
  })

  it.each(windows)('window %sms shows both frames across the cycle', (windowMs) => {
    const seen = new Set<string>()
    const end = Math.max(windowMs, MIN_HOLD_MS)
    for (let t = 0; t <= end; t += 5) seen.add(avatarFrameAt(t, windowMs))
    expect(seen.has('step1')).toBe(true)
    expect(seen.has('step2')).toBe(true)
  })

  it('clicks through the flip well under half a second when punches are quick', () => {
    // Kyle's bar: a fast pair still has to make sense.
    for (const windowMs of [120, 200, 300, 400]) {
      expect(minHoldMs(windowMs)).toBeLessThanOrEqual(500)
      expect(avatarFrameAt(0, windowMs)).toBe('step2')
      expect(avatarFrameAt(flipFrameMs(windowMs), windowMs)).toBe('step1')
    }
  })

  it('isLast changes nothing — every node plays the same single flip', () => {
    // The last-in-chain sandwich is retired; the flag survives in the
    // signature for call-site compatibility only.
    const windowMs = 600
    for (const t of [0, flipFrameMs(windowMs) - 1, flipFrameMs(windowMs), windowMs]) {
      expect(avatarFrameAt(t, windowMs, true)).toBe(avatarFrameAt(t, windowMs, false))
    }
  })

  it('treats negative elapsed as the start of the guard', () => {
    expect(avatarFrameAt(-100, 600)).toBe('step2')
  })
})

describe('avatarWindowMs', () => {
  const due = [0, 400, 900]

  it('spans to the next token', () => {
    expect(avatarWindowMs(due, 0, 1400)).toBe(400)
    expect(avatarWindowMs(due, 1, 1400)).toBe(500)
  })

  it('runs the last token to the end of the cue window', () => {
    expect(avatarWindowMs(due, 2, 1400)).toBe(500)
  })

  it('never returns a negative window', () => {
    expect(avatarWindowMs([0, 400], 1, 100)).toBe(0)
    expect(avatarWindowMs([], 3, 500)).toBe(500)
  })
})
