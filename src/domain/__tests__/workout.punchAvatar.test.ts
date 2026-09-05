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

  it.each(windows)('window %sms opens ON the strike — identity lands with the beat', (windowMs) => {
    // Strike-first (Kyle, 2026-09-02): "per punch should be extended,
    // then flip to retracted — reversed — but putting guard on all sides."
    expect(avatarFrameAt(0, windowMs)).toBe('step1')
  })

  it.each(windows)('window %sms strikes, retracts for a flip-frame, then parks on guard', (windowMs) => {
    // strike [0, strikeEnd) -> retract [strikeEnd, +flip) -> GUARD, once.
    // "Guard is designed to be parked on" (Kyle): every combo ends via
    // retract->guard with no last-punch special case; rests, breaths and
    // gaps inherit the parked guard for free.
    const flip = flipFrameMs(windowMs)
    const strikeEnd = Math.max(MIN_FRAME_MS, windowMs - flip)
    expect(avatarFrameAt(strikeEnd - 1, windowMs)).toBe('step1')
    expect(avatarFrameAt(strikeEnd, windowMs)).toBe('step2')
    expect(avatarFrameAt(strikeEnd + flip - 1, windowMs)).toBe('step2')
    for (const t of [strikeEnd + flip, strikeEnd + flip + 500, 60_000]) {
      expect(avatarFrameAt(t, windowMs)).toBe('guard')
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
    // Kyle's bar: a fast pair still has to make sense — strike on the
    // beat, retract visible before the next node.
    for (const windowMs of [120, 200, 300, 400]) {
      expect(minHoldMs(windowMs)).toBeLessThanOrEqual(500)
      expect(avatarFrameAt(0, windowMs)).toBe('step1')
      const strikeEnd = Math.max(MIN_FRAME_MS, windowMs - flipFrameMs(windowMs))
      expect(avatarFrameAt(strikeEnd, windowMs)).toBe('step2')
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

  it('treats negative elapsed as the start of the strike', () => {
    expect(avatarFrameAt(-100, 600)).toBe('step1')
  })
})

describe('avatarFrameAt — the pump lead (repeated same punch, Kyle 2026-09-04)', () => {
  // A pumping jab ("1-1") re-adopts the SAME art; without a visible
  // retract between the strikes the pair reads as one held extension.
  // `pump` leads the cycle with one flip-frame of the punch's own
  // RETRACTED card: retract → strike → retract → guard.
  const windows = [120, 200, 300, 400, 600, 900]

  it.each(windows)('window %sms opens on the RETRACT, then strikes', (windowMs) => {
    const flip = flipFrameMs(windowMs)
    expect(avatarFrameAt(0, windowMs, false, true)).toBe('step2')
    expect(avatarFrameAt(flip - 1, windowMs, false, true)).toBe('step2')
    expect(avatarFrameAt(flip, windowMs, false, true)).toBe('step1')
  })

  it.each(windows)('window %sms keeps the strike floored and retract-tails to guard', (windowMs) => {
    const flip = flipFrameMs(windowMs)
    const strikeEnd = Math.max(flip + MIN_FRAME_MS, windowMs - flip)
    expect(avatarFrameAt(strikeEnd - 1, windowMs, false, true)).toBe('step1')
    expect(avatarFrameAt(strikeEnd, windowMs, false, true)).toBe('step2')
    expect(avatarFrameAt(strikeEnd + flip, windowMs, false, true)).toBe('guard')
  })

  it('pump=false stays byte-identical to the plain cycle — every existing call site untouched', () => {
    for (const windowMs of [0, 50, 120, 300, 600, 1500]) {
      for (let t = -20; t <= windowMs + 400; t += 15) {
        expect(avatarFrameAt(t, windowMs, false, false)).toBe(avatarFrameAt(t, windowMs))
      }
    }
  })

  it('even a degenerate window shows retract AND strike on a pump', () => {
    for (const windowMs of [0, 40, 90]) {
      const seen = new Set<string>()
      for (let t = 0; t <= 3 * MIN_FRAME_MS + 40; t += 5)
        seen.add(avatarFrameAt(t, windowMs, false, true))
      expect(seen.has('step2')).toBe(true)
      expect(seen.has('step1')).toBe(true)
    }
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
