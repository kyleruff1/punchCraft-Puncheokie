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

describe('avatarFrameAt — the last-in-chain sandwich', () => {
  // Kyle 2026-08-30: the final punch of every combination splits its
  // window into thirds — strike, retracted, strike — so the reader
  // always sees the identifying frame last and never notices the pair
  // was reversed under the hood.
  const windows = [180, 300, 450, 600, 900, 1500, 3000]

  it.each(windows)('window %sms starts on the strike', (windowMs) => {
    expect(avatarFrameAt(0, windowMs, true)).toBe('step1')
  })

  it.each(windows)('window %sms shows all three slots — strike, retracted, strike', (windowMs) => {
    const third = windowMs / 3
    expect(avatarFrameAt(third - 1, windowMs, true)).toBe('step1')
    expect(avatarFrameAt(third + 1, windowMs, true)).toBe('step2')
    expect(avatarFrameAt(2 * third - 1, windowMs, true)).toBe('step2')
    expect(avatarFrameAt(2 * third + 1, windowMs, true)).toBe('step1')
  })

  it.each(windows)('window %sms ends on the strike, not the retracted', (windowMs) => {
    // Walking the whole window at fine resolution, the last frame
    // sampled must be the strike; that is the only rule that makes the
    // sandwich hide the reversal.
    let last: string = 'step1'
    for (let t = 0; t <= windowMs; t += 5) last = avatarFrameAt(t, windowMs, true)
    expect(last).toBe('step1')
  })

  it('holds every one of the three frames long enough to see', () => {
    // At the tightest sensible window the sandwich still gives each
    // frame at least a MIN_FRAME_MS chunk (windowMs / 3 >= MIN_FRAME_MS
    // → windowMs >= 3 * MIN_FRAME_MS = 270).
    const windowMs = MIN_FRAME_MS * 3
    const seen = new Set<string>()
    for (let t = 0; t < windowMs; t += 5) seen.add(avatarFrameAt(t, windowMs, true))
    expect(seen.has('step1')).toBe(true)
    expect(seen.has('step2')).toBe(true)
  })

  it('does not affect an earlier punch in the same chain', () => {
    // Only the caller's isLast flag drives the sandwich; without it,
    // the flip is the classic two-frame call — no way for the last
    // punch's thirds to reach an earlier punch's timing.
    const windowMs = 600
    expect(avatarFrameAt(flipFrameMs(windowMs), windowMs)).toBe('step2')
    expect(avatarFrameAt(flipFrameMs(windowMs), windowMs, false)).toBe('step2')
  })

  it('gives the last punch a longer minimum hold than a middle punch', () => {
    // The sandwich has three frames to protect, so the card refuses
    // to be preempted before all three land.
    const windowMs = 600
    expect(minHoldMs(windowMs, true)).toBe(flipFrameMs(windowMs) * 3)
    expect(minHoldMs(windowMs, true)).toBeGreaterThan(minHoldMs(windowMs))
  })

  it('a solo punch is its own chain — it gets the sandwich', () => {
    // The card treats a one-punch cue as a chain of length one; that
    // punch is both first and last, so it plays the three-way split.
    expect(avatarFrameAt(0, 600, true)).toBe('step1')
    expect(avatarFrameAt(500, 600, true)).toBe('step1')
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
