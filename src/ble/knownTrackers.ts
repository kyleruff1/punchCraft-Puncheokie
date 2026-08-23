/**
 * Known FightCamp v1 trackers and their permanent slot assignment.
 *
 * These two units are the project's hardware (docs/hardware-baseline.md): the
 * blue tracker is always the left hand, the red one always the right. The
 * mapping is fixed rather than user-assigned because the physical trackers are
 * colour-coded and live in dedicated wraps — asking which is which on every
 * connect is friction with no upside.
 *
 * On Android, `AdvertisementSnapshot.deviceId` is the BLE MAC address, which
 * is stable for these devices (they do not use resolvable private addresses —
 * confirmed across every session since 2026-08-22). That is what makes a
 * static map viable here; it would NOT be on iOS, where the identifier is a
 * per-installation UUID.
 *
 * Adding a tracker: append an entry. Nothing else needs to change — scanning,
 * auto-connect and the "Connect both" affordance all derive from this list.
 */

import type { TrackerSlotHand } from '@ble/TrackerCoordinator'

export interface KnownTracker {
  /** BLE address as advertised on Android. Compared case-insensitively. */
  address: string
  hand: TrackerSlotHand
  /** Physical colour, for user-facing copy and diagnostics. */
  color: 'blue' | 'red'
  /** Friendly name shown in badges and buttons. */
  displayName: string
}

export const KNOWN_TRACKERS: readonly KnownTracker[] = [
  { address: 'D7:34:B4:27:D5:84', hand: 'left', color: 'blue', displayName: 'L Punch' },
  { address: 'EA:69:2D:9C:FD:53', hand: 'right', color: 'red', displayName: 'R Punch' },
]

const normalize = (address: string): string => address.trim().toUpperCase()

/** Look up a known tracker by advertised address. */
export function findKnownTracker(address: string): KnownTracker | undefined {
  const key = normalize(address)
  return KNOWN_TRACKERS.find((t) => normalize(t.address) === key)
}

/** The tracker permanently assigned to a slot, if one is configured. */
export function knownTrackerForHand(hand: TrackerSlotHand): KnownTracker | undefined {
  return KNOWN_TRACKERS.find((t) => t.hand === hand)
}

/** True when the address belongs to a tracker we already know how to place. */
export function isKnownTracker(address: string): boolean {
  return findKnownTracker(address) !== undefined
}
