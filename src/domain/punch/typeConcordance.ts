/**
 * Type concordance — an additive-only form signal.
 *
 * H12 established that the FightCamp v1 punch-type byte is **not**
 * device-portable: hooks are byte `2` on the red tracker and byte `1` on
 * blue, and on blue the byte behaves as a velocity gate. That is why
 * `punchType` is always `'unknown'` and why the capability tier is
 * hand + timestamp + velocity (D12).
 *
 * But H12 also recorded the other half of the finding, and it is the half
 * this module uses: *within a single device the byte is not random*. Blue
 * separates uppercuts from everything else at 92%; red's hooks are 88%
 * byte `2`. Something real drives it — it is simply device-local.
 *
 * ## The rule that makes this safe
 *
 * **Agreement adds; disagreement never subtracts.** The signal is too
 * inconsistent to penalise anyone with, so it is wired so that it
 * *cannot*:
 *
 * - a false negative (right technique, byte disagrees) costs nothing;
 * - a false positive (wrong technique, byte agrees) gives a small
 *   undeserved reward.
 *
 * That asymmetry is the whole design. It is D11's "omitted, never zeroed"
 * turned around: a signal we cannot trust to accuse, we can still let
 * congratulate.
 *
 * ## Why the profiles are so sparse
 *
 * The obvious implementation — map each technique family to its modal byte
 * per device — would be worse than useless. On blue, jabs, crosses **and**
 * hooks are all modal byte `1`; awarding a bonus for byte `1` would
 * congratulate the athlete for throwing any of three different things, so
 * it would mean "you punched", not "good form". On red, byte `4` is modal
 * for both jabs and uppercuts.
 *
 * So a profile only records bytes that **discriminate**: values associated
 * with exactly one family on that device. Everything else resolves to
 * `unknown` and no bonus is given. The bonus therefore fires rarely and
 * means something when it does, which is the right trade for a reward.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import type { PunchType, TrackerPunchEvent } from './PunchEvent'

/** The three families a cue number implies (doc §2). */
export type PunchFamily = 'straight' | 'hook' | 'uppercut'

export type Concordance = 'agree' | 'disagree' | 'unknown'

/**
 * Bump when a profile's byte table changes, so a stored bonus can be
 * recomputed rather than silently meaning something new (D14).
 */
export const TYPE_PROFILE_VERSION = '1.0.0'

export interface DeviceTypeProfile {
  deviceAddress: string
  label: string
  /**
   * Byte → family, **only** where that byte maps to one family on this
   * device. Ambiguous bytes are deliberately absent.
   */
  discriminatingBytes: Readonly<Record<number, PunchFamily>>
  /** Events behind the table, so its weight is visible at the call site. */
  sampleSize: number
  capturedAt: string
  /**
   * Always true today. H12's own "next test" is whether the mapping is
   * stable across sessions and devices; until that runs, every profile is
   * one athlete, one sitting.
   */
  provisional: boolean
  notes: string
}

/**
 * Profiles derived from the H12 capture (2026-08-23, ~100 events, one
 * athlete, one sitting).
 *
 * Red keeps `2 → hook` (7/8 of its hook set) and `3 → straight` (6/12 of
 * crosses). Byte `4` is dropped: it is modal for both jabs and uppercuts,
 * so it discriminates nothing.
 *
 * Blue keeps only `3 → uppercut` (9/13). Byte `1` is modal for jabs,
 * crosses *and* hooks on that device, so it is dropped for the same
 * reason. Note also H12's observation that on blue a jab is physically
 * incapable of reaching the `{3,4}` band — which is what stops a jab from
 * ever falsely earning the uppercut bonus, and equally what means blue's
 * bonus is partly rewarding a big motion rather than a correct one.
 */
export const H12_DEVICE_PROFILES: readonly DeviceTypeProfile[] = [
  {
    deviceAddress: 'EA:69:2D:9C:FD:53',
    label: 'red / right',
    discriminatingBytes: { 2: 'hook', 3: 'straight' },
    sampleSize: 42,
    capturedAt: '2026-08-23',
    provisional: true,
    notes:
      'Byte 4 omitted: modal for both jabs and uppercuts on this device, so it discriminates nothing.',
  },
  {
    deviceAddress: 'D7:34:B4:27:D5:84',
    label: 'blue / left',
    discriminatingBytes: { 3: 'uppercut' },
    sampleSize: 47,
    capturedAt: '2026-08-23',
    provisional: true,
    notes:
      'Byte 1 omitted: modal for jabs, crosses and hooks alike. This device gates the byte on velocity (H12), so the surviving signal partly reflects motion size rather than technique.',
  },
]

/** The family a cue number implies. Prescription, never observation. */
export function familyOf(type: PunchType | undefined): PunchFamily | undefined {
  if (type === 'straight' || type === 'hook' || type === 'uppercut') return type
  return undefined
}

export function profileFor(
  deviceAddress: string,
  profiles: readonly DeviceTypeProfile[] = H12_DEVICE_PROFILES,
): DeviceTypeProfile | undefined {
  return profiles.find((p) => p.deviceAddress === deviceAddress)
}

/**
 * Does this event's raw type byte agree with the technique the cue asked
 * for, on this specific device?
 *
 * Returns `unknown` far more often than it returns anything else, and that
 * is intended — see the note on sparse profiles above. `disagree` is
 * returned for diagnostics only; **no caller may score it downward.**
 */
export function typeConcordance(
  event: Pick<TrackerPunchEvent, 'deviceId' | 'punchTypeRaw'>,
  expectedType: PunchType | undefined,
  profiles: readonly DeviceTypeProfile[] = H12_DEVICE_PROFILES,
): Concordance {
  const family = familyOf(expectedType)
  if (family === undefined) return 'unknown'
  if (typeof event.punchTypeRaw !== 'number') return 'unknown'

  const profile = profileFor(event.deviceId, profiles)
  if (!profile) return 'unknown'

  const observed = profile.discriminatingBytes[event.punchTypeRaw]
  if (observed === undefined) return 'unknown'

  return observed === family ? 'agree' : 'disagree'
}

/**
 * Points a single agreement is worth.
 *
 * Deliberately small. The bonus should feel like a flourish on a good
 * punch, not like the thing the athlete is playing for — a signal this
 * provisional should not be able to dominate a round's reading.
 */
export const FORM_BONUS_PER_AGREEMENT = 1

/**
 * Total form bonus for a set of events against their expected techniques.
 *
 * Only agreements contribute. There is no branch that subtracts, which is
 * the point: the shape of this function is what guarantees the signal can
 * never be used against the athlete.
 */
export function formBonus(
  pairs: ReadonlyArray<{
    event: Pick<TrackerPunchEvent, 'deviceId' | 'punchTypeRaw'>
    expectedType: PunchType | undefined
  }>,
  profiles: readonly DeviceTypeProfile[] = H12_DEVICE_PROFILES,
): number {
  let bonus = 0
  for (const pair of pairs) {
    if (typeConcordance(pair.event, pair.expectedType, profiles) === 'agree') {
      bonus += FORM_BONUS_PER_AGREEMENT
    }
  }
  return bonus
}
