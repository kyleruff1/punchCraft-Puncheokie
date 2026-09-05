/**
 * Velocity zone quantizer with hysteresis (note-cube-design §2). A punch
 * landing near a zone boundary must cross it by ZONE_HYSTERESIS extra to
 * commit — otherwise repeated near-boundary punches would flicker between
 * two notes.
 *
 * Pure: state in, state out; no clocks.
 */

export interface ZoneState {
  currentZone: number
  /** The normalized reading that last committed this zone. */
  enteredAtVelocity: number
}

export const ZONE_HYSTERESIS = 0.04

/** Raw (hysteresis-free) zone for a normalized reading. */
export function rawZone(velocity01: number, zoneCount: number): number {
  const v = Math.max(0, Math.min(1, velocity01))
  return Math.min(zoneCount - 1, Math.floor(v * zoneCount))
}

/**
 * Advance the quantizer by one reading. A move to a different zone commits
 * only when the reading clears the boundary it crossed by the hysteresis
 * margin; otherwise the previous zone holds.
 */
export function quantizeZone(
  previous: ZoneState | null,
  velocity01: number,
  zoneCount: number,
  hysteresis: number = ZONE_HYSTERESIS,
): ZoneState {
  const v = Math.max(0, Math.min(1, velocity01))
  const target = rawZone(v, zoneCount)
  if (previous === null || target === previous.currentZone) {
    return { currentZone: previous?.currentZone ?? target, enteredAtVelocity: v }
  }
  if (target > previous.currentZone) {
    // Crossing upward: the boundary is the bottom edge of the target zone.
    const boundary = target / zoneCount
    if (v >= boundary + hysteresis) return { currentZone: target, enteredAtVelocity: v }
  } else {
    // Crossing downward: the boundary is the top edge of the target zone.
    const boundary = (target + 1) / zoneCount
    if (v <= boundary - hysteresis) return { currentZone: target, enteredAtVelocity: v }
  }
  return previous
}

/** Position within the current zone, 0..1 — the "velocity within zone" modulation source. */
export function positionInZone(velocity01: number, zone: number, zoneCount: number): number {
  const v = Math.max(0, Math.min(1, velocity01))
  const lo = zone / zoneCount
  const hi = (zone + 1) / zoneCount
  return Math.max(0, Math.min(1, (v - lo) / Math.max(1e-6, hi - lo)))
}
