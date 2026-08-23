/**
 * knownTrackers — the permanent address→hand mapping.
 *
 * Small surface, but everything about auto-connect derives from it, and a
 * silent mismatch would bind the wrong glove to the wrong hand — which would
 * corrupt every capture taken afterwards without looking like an error.
 */

import {
  KNOWN_TRACKERS,
  findKnownTracker,
  isKnownTracker,
  knownTrackerForHand,
} from '../knownTrackers'

describe('knownTrackers', () => {
  it('maps blue to left and red to right', () => {
    expect(knownTrackerForHand('left')?.color).toBe('blue')
    expect(knownTrackerForHand('right')?.color).toBe('red')
  })

  it('assigns each hand exactly once', () => {
    const hands = KNOWN_TRACKERS.map((t) => t.hand)
    expect(new Set(hands).size).toBe(hands.length)
  })

  it('has no duplicate addresses', () => {
    const addrs = KNOWN_TRACKERS.map((t) => t.address.toUpperCase())
    expect(new Set(addrs).size).toBe(addrs.length)
  })

  it('matches addresses case-insensitively and ignores surrounding space', () => {
    const blue = knownTrackerForHand('left')!
    expect(findKnownTracker(blue.address.toLowerCase())?.hand).toBe('left')
    expect(findKnownTracker(`  ${blue.address}  `)?.hand).toBe('left')
  })

  it('does not claim unknown devices', () => {
    expect(isKnownTracker('00:11:22:33:44:55')).toBe(false)
    expect(findKnownTracker('00:11:22:33:44:55')).toBeUndefined()
  })

  it('uses well-formed BLE addresses', () => {
    for (const t of KNOWN_TRACKERS) {
      expect(t.address).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i)
    }
  })
})
