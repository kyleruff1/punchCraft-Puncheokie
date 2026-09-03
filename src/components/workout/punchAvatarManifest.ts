/**
 * Punch-avatar stop-motion frames (generated).
 *
 * DO NOT EDIT — produced by
 * `F:/voice-tools/venv/Scripts/python.exe tools/avatar/make_punch_frames.py`.
 *
 * One entry per punch (1..6 x head/body). `step1` is the STRIKE
 * (the unique frame that gets first-half priority when windows are
 * tight, Kyle 2026-08-30), `step2` is the RETRACTED position (the
 * guard, which looks similar across punches so it works fine as the
 * second half). Lookup is by the token's own number + body flag,
 * so the punch nodes and the avatar card share one mapping.
 */
import type { PunchNumber } from '@domain/workout/WorkoutTokens'

export interface PunchAvatarFrames {
  /** Punch notation — '1', '1b', ... '6b'. */
  key: string
  number: PunchNumber
  body: boolean
  /** Metro module id for the STRIKE frame (shown first, Kyle 2026-08-30). */
  step1: number
  /** Metro module id for the RETRACTED/guard frame (shown second). */
  step2: number
}

/* eslint-disable @typescript-eslint/no-require-imports */
export const punchAvatarFrames: readonly PunchAvatarFrames[] = [
  {
    key: "1",
    number: 1,
    body: false,
    step1: require('../../../assets/avatar/punch/1-s2.png'),
    step2: require('../../../assets/avatar/punch/1-s1.png'),
  },
  {
    key: "1b",
    number: 1,
    body: true,
    step1: require('../../../assets/avatar/punch/1b-s2.png'),
    step2: require('../../../assets/avatar/punch/1b-s1.png'),
  },
  {
    key: "2",
    number: 2,
    body: false,
    step1: require('../../../assets/avatar/punch/2-s2.png'),
    step2: require('../../../assets/avatar/punch/2-s1.png'),
  },
  {
    key: "2b",
    number: 2,
    body: true,
    step1: require('../../../assets/avatar/punch/2b-s2.png'),
    step2: require('../../../assets/avatar/punch/2b-s1.png'),
  },
  {
    key: "3",
    number: 3,
    body: false,
    step1: require('../../../assets/avatar/punch/3-s2.png'),
    step2: require('../../../assets/avatar/punch/3-s1.png'),
  },
  {
    key: "3b",
    number: 3,
    body: true,
    step1: require('../../../assets/avatar/punch/3b-s2.png'),
    step2: require('../../../assets/avatar/punch/3b-s1.png'),
  },
  {
    key: "4",
    number: 4,
    body: false,
    step1: require('../../../assets/avatar/punch/4-s2.png'),
    step2: require('../../../assets/avatar/punch/4-s1.png'),
  },
  {
    key: "4b",
    number: 4,
    body: true,
    step1: require('../../../assets/avatar/punch/4b-s2.png'),
    step2: require('../../../assets/avatar/punch/4b-s1.png'),
  },
  {
    key: "5",
    number: 5,
    body: false,
    step1: require('../../../assets/avatar/punch/5-s2.png'),
    step2: require('../../../assets/avatar/punch/5-s1.png'),
  },
  {
    key: "5b",
    number: 5,
    body: true,
    step1: require('../../../assets/avatar/punch/5b-s2.png'),
    step2: require('../../../assets/avatar/punch/5b-s1.png'),
  },
  {
    key: "6",
    number: 6,
    body: false,
    step1: require('../../../assets/avatar/punch/6-s2.png'),
    step2: require('../../../assets/avatar/punch/6-s1.png'),
  },
  {
    key: "6b",
    number: 6,
    body: true,
    step1: require('../../../assets/avatar/punch/6b-s2.png'),
    step2: require('../../../assets/avatar/punch/6b-s1.png'),
  },
]
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * The universal GUARD stance (Kyle, on-glass 2026-09-02): a dedicated
 * neutral pose — not any punch's retracted frame — shown at round start,
 * through breaths at combo end, and across every pause or gap. Purely
 * visual: it "fills in awkward gaps with the avatar" and is never called
 * out by the coach.
 */
/* eslint-disable-next-line @typescript-eslint/no-require-imports */
export const GUARD_FRAME: number = require('../../../assets/avatar/punch/guard.png')

/** Frames for a punch token. Undefined only if a render is missing. */
export function findPunchAvatar(
  number: PunchNumber,
  body: boolean,
): PunchAvatarFrames | undefined {
  return punchAvatarFrames.find((f) => f.number === number && f.body === body)
}
