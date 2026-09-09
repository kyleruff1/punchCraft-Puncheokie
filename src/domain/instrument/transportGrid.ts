/**
 * The ONE transport's grid math (harmonic-field-v2 review amendment 1 +
 * second-pass am. 3): every grid the instrument runs — harmonic commits AND
 * arp steps — is a projection of a single absolute tick position. 80 ticks
 * is the common lattice UNIT of all supported intervals, never an assumed-
 * precise timer period: schedulers derive CROSSED boundaries from absolute
 * tick observations, so a stalled wakeup loses nothing silently.
 *
 * Pure and dependency-free (domainPurity): shared verbatim by the bridge's
 * transport driver today and the M40-23 tablet commit follower later.
 */

/** 60 BPM master pulse → 960 ticks/beat; at 60 BPM ticks/beat = ticks/sec. */
export const TRANSPORT_TICKS_PER_BEAT = 960

export const TRANSPORT_TICKS_PER_SECOND = TRANSPORT_TICKS_PER_BEAT

/**
 * GCD of every supported interval — arp steps (960/480/320/240 ticks for
 * 60/120/180/240 notes-min) and commit windows (240/480/960 ticks) — so
 * every boundary of either grid lands exactly on a lattice tick.
 */
export const TRANSPORT_GCD_TICKS = 80

/** The canonical harmonic commit windows, in transport ticks (am. 3). */
export type CommitIntervalTicks = 240 | 480 | 960

/** Ticks → milliseconds on the fixed 60 BPM pulse. */
export function msForTicks(ticks: number): number {
  return (ticks / TRANSPORT_TICKS_PER_SECOND) * 1000
}

/** Milliseconds → (fractional) ticks on the fixed pulse. */
export function ticksForMs(ms: number): number {
  return (ms / 1000) * TRANSPORT_TICKS_PER_SECOND
}

/** Arp step interval in ticks: 60→960 · 120→480 · 180→320 · 240→240. */
export function arpIntervalTicksFor(notesPerMinute: number): number {
  return Math.round((TRANSPORT_TICKS_PER_SECOND * 60) / notesPerMinute)
}

/**
 * One quantization grid: boundaries at phaseTick + k·intervalTicks, k ≥ 0.
 * Re-anchoring (a rate change, a window change) makes a NEW grid — the
 * transport tick position itself never resets.
 */
export interface QuantizationGrid {
  phaseTick: number
  intervalTicks: number
}

/** Absolute tick of a grid's k-th boundary. */
export function boundaryTickOf(index: number, grid: QuantizationGrid): number {
  return grid.phaseTick + index * grid.intervalTicks
}

/** Which boundary interval (floor) `currentTick` sits in. */
export function boundaryIndexAt(currentTick: number, grid: QuantizationGrid): number {
  return Math.floor((currentTick - grid.phaseTick) / grid.intervalTicks)
}

/**
 * Every boundary index crossed moving previousTick → currentTick
 * (exclusive of previousTick, inclusive of currentTick). A stalled
 * scheduler that jumps many ticks reports every boundary it slept
 * through; what to DO with them (coalesce commits, skip stale steps) is
 * the caller's missed-boundary policy, never this function's.
 */
export function crossedBoundaryIndices(
  previousTick: number,
  currentTick: number,
  grid: QuantizationGrid,
): readonly number[] {
  const first = Math.floor((previousTick - grid.phaseTick) / grid.intervalTicks) + 1
  const last = Math.floor((currentTick - grid.phaseTick) / grid.intervalTicks)
  if (last < first) return []
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset)
}

/**
 * First boundary tick at or after `tick` — the audible-commit rule's core
 * (second-pass am. 4): a requested harmonic commit becomes audible on the
 * CURRENTLY SOUNDING arp grid's next boundary, never on a boundary that
 * exists only under the incoming rate.
 */
export function nextBoundaryTickAtOrAfter(tick: number, grid: QuantizationGrid): number {
  const k = Math.max(0, Math.ceil((tick - grid.phaseTick) / grid.intervalTicks))
  return boundaryTickOf(k, grid)
}
