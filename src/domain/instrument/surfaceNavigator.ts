/**
 * Surface navigation — how freedom collapses six velocity zones into a
 * smaller surface, and how repeated punches move inside a band
 * (harmonic-field-v2 §§4,6,9, amended per Kyle's plan review). The 6-zone
 * quantizer and its hysteresis are untouched upstream: freedom is an
 * OVERLAY applied after zone commit, so band stability is always ≥ zone
 * stability, and full-6x6 (identity bands, single members) reproduces the
 * raw zones exactly.
 *
 * Review amendments honored here:
 * - ABSOLUTE navigation maps the raw zone's SUBINDEX within its band
 *   (zone 0 → first Home member, zone 1 → second Home member …) — more
 *   predictable than collapsing every selection to member 0.
 * - ORBIT advances AT MOST ONCE PER COMMIT WINDOW ('per-commit' policy):
 *   a same-band, same-window punch re-previews the same member, so a
 *   flurry's final chord can never depend on punch parity.
 * - Right-axis members come from the node's EXPLICIT tone-role groups,
 *   never inferred from array position.
 *
 * Pure fold, zoneQuantizer-style: orbit state lives in the session, never
 * in the module.
 */
import type { FreedomProfileId, HarmonicNode, NavigationMode } from './harmonicField'

/** v2 §4, verbatim. */
export const ZONE_TO_SURFACE_BAND: Readonly<Record<3 | 4 | 6, readonly number[]>> = {
  3: [0, 0, 1, 1, 2, 2],
  4: [0, 0, 1, 2, 3, 3],
  6: [0, 1, 2, 3, 4, 5],
}

export const BAND_COUNT_BY_FREEDOM: Readonly<Record<FreedomProfileId, 3 | 4 | 6>> = {
  'safe-3x3': 3,
  'guided-4x4': 4,
  'full-6x6': 6,
}

/** Zones belonging to `band`, ascending (the left axis and subindexing). */
export function bandZones(bandCount: 3 | 4 | 6, band: number): readonly number[] {
  const table = ZONE_TO_SURFACE_BAND[bandCount]
  const zones: number[] = []
  table.forEach((b, zone) => {
    if (b === band) zones.push(zone)
  })
  return zones.length > 0 ? zones : [0]
}

/**
 * Band membership per axis. LEFT bands group node indices by zone grouping
 * (tension-ordered bank ⇒ Home/Motion/Pressure). RIGHT bands read the
 * node's EXPLICIT toneRoleGroups (Foundation/Color/Air), validated at
 * field compile. guided-4x4 (not exposed this slice) uses the generic zone
 * grouping on both axes until its role semantics are designed.
 */
export function bandMembers(
  axis: 'left' | 'right',
  bandCount: 3 | 4 | 6,
  band: number,
  node: HarmonicNode | null,
): readonly number[] {
  if (bandCount === 6) return [Math.max(0, Math.min(5, band))]
  if (axis === 'right' && bandCount === 3 && node) {
    const group = node.toneRoleGroups[Math.max(0, Math.min(2, band))]
    return group ? group.poolIndices : [0]
  }
  return bandZones(bandCount, Math.max(0, Math.min(bandCount - 1, band)))
}

/** The zone's position within its band (absolute navigation's subindex). */
export function subindexInBand(bandCount: 3 | 4 | 6, zone: number): number {
  const table = ZONE_TO_SURFACE_BAND[bandCount]
  const band = table[zone] ?? 0
  const zones = bandZones(bandCount, band)
  const index = zones.indexOf(zone)
  return index >= 0 ? index : 0
}

/**
 * Per-hand navigation memory — sample-and-hold like the latch.
 * `commitWindowIndex` is floor(receivedMonotonicTimeMs / commitWindowMs):
 * the per-commit orbit gate (at most one advance per window per hand).
 */
export interface OrbitState {
  band: number
  memberIndex: number
  commitWindowIndex: number
}

/**
 * Fold one punch into the navigation state.
 *
 * absolute → the zone's subindex within its band (clamped to the member
 * list); repeatable by construction. orbit → band entry lands on member 0;
 * a same-band punch in a LATER window advances one member; a same-band
 * punch in the SAME window holds (per-commit policy — the extra punches
 * stay expressive, not harmonic).
 */
export function advanceOrbit(
  previous: OrbitState | null,
  band: number,
  memberCount: number,
  navigation: NavigationMode,
  commitWindowIndex: number,
  subindex: number,
): OrbitState {
  const cap = Math.max(1, memberCount)
  if (navigation === 'absolute') {
    return { band, memberIndex: Math.max(0, Math.min(cap - 1, subindex)), commitWindowIndex }
  }
  if (previous === null || previous.band !== band) {
    return { band, memberIndex: 0, commitWindowIndex }
  }
  if (previous.commitWindowIndex === commitWindowIndex) {
    return { band, memberIndex: previous.memberIndex % cap, commitWindowIndex }
  }
  return { band, memberIndex: (previous.memberIndex + 1) % cap, commitWindowIndex }
}
