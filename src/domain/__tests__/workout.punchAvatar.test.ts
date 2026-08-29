/**
 * The punch-avatar contract.
 *
 * The one behaviour that must never regress: BOTH frames of a punch play
 * every time that punch is shown, at any tempo. Everything else here pins
 * the identity mapping so the avatar and the punch nodes cannot drift apart.
 */
import {
  MAX_FRAME_MS,
  MIN_FRAME_MS,
  MIN_HOLD_MS,
  RESET_MS,
  minHoldMs,
  avatarFrameAt,
  avatarResetAtMs,
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

describe('avatarFrameAt — both frames always play', () => {
  // Sprint cadence through a long technical hold, plus the degenerate ends.
  const windows = [0, 50, 120, 180, 250, 400, 600, 900, 1500, 3000]

  it.each(windows)('window %sms shows step1 then step2', (windowMs) => {
    const seen = new Set<string>()
    const end = Math.max(windowMs, MIN_HOLD_MS) + RESET_MS
    for (let t = 0; t <= end; t += 5) seen.add(avatarFrameAt(t, windowMs))
    expect(seen.has('step1')).toBe(true)
    expect(seen.has('step2')).toBe(true)
  })

  it.each(windows)('window %sms strikes exactly when its frame ends', (windowMs) => {
    expect(avatarFrameAt(flipFrameMs(windowMs), windowMs)).toBe('step2')
  })

  it.each(windows)('window %sms plays the whole pair inside its hold', (windowMs) => {
    // The hold is what the card honours before adopting the next token, so
    // the strike must always land inside it.
    expect(minHoldMs(windowMs)).toBeGreaterThanOrEqual(MIN_HOLD_MS)
    expect(avatarFrameAt(minHoldMs(windowMs) - 1, windowMs)).toBe('step2')
  })

  it('clicks through both frames well under half a second when punches are quick', () => {
    // Kyle's bar: a fast pair still has to make sense.
    for (const windowMs of [120, 200, 300, 400]) {
      expect(minHoldMs(windowMs)).toBeLessThanOrEqual(500)
      expect(avatarFrameAt(0, windowMs)).toBe('step1')
      expect(avatarFrameAt(flipFrameMs(windowMs), windowMs)).toBe('step2')
    }
  })

  it('opens on the wind-up and gives the strike a full frame', () => {
    const windowMs = 600
    const frame = flipFrameMs(windowMs)
    expect(avatarFrameAt(0, windowMs)).toBe('step1')
    expect(avatarFrameAt(frame - 1, windowMs)).toBe('step1')
    expect(avatarFrameAt(frame, windowMs)).toBe('step2')
    expect(avatarFrameAt(frame * 2 - 1, windowMs)).toBe('step2')
  })

  it('holds the strike, then returns to guard before the next beat', () => {
    const windowMs = 1200
    expect(avatarResetAtMs(windowMs)).toBe(windowMs - RESET_MS)
    expect(avatarFrameAt(windowMs - RESET_MS - 1, windowMs)).toBe('step2')
    expect(avatarFrameAt(windowMs - RESET_MS, windowMs)).toBe('step1')
    expect(avatarFrameAt(windowMs + 5000, windowMs)).toBe('step1')
  })

  it('never lets the reset pre-empt the flip on a tight window', () => {
    // 150ms apart is faster than any cadence the generator emits; the pair
    // still plays in full rather than truncating to a wind-up.
    expect(avatarResetAtMs(150)).toBe(MIN_FRAME_MS * 2)
    expect(avatarFrameAt(MIN_FRAME_MS, 150)).toBe('step2')
  })

  it('treats negative elapsed as the start of the wind-up', () => {
    expect(avatarFrameAt(-100, 600)).toBe('step1')
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
