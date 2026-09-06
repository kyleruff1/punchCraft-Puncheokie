/**
 * Body-shot kick policy (drum-kit-design §17).
 *
 * Every "B" token creates a kick intent, so a body combination — 2B-3B-6B
 * thrown fast — produces several kicks in rapid succession. Left alone they
 * flam into mud. Merging is not a performance optimisation: two kicks 20 ms
 * apart is one kick that should be HARDER, which is exactly what §17's
 * formula says.
 *
 * Priority matters as much as the arithmetic: "A direct body kick replaces
 * a generated kick close to the same tick rather than producing an
 * accidental double trigger." The boxer's punch always wins over the
 * groove's own low end.
 *
 * Pure and deterministic.
 */
import { TRANSPORT_TICKS_PER_BEAT } from '../transportGrid'
import { DRUM_PRIORITY, type DrumHitPriority } from './compileDrumGesture'

export interface KickIntent {
  sourceEventId: string
  desiredTick: number
  velocity: number
  priority: DrumHitPriority
}

/** §17: merge inside 35 ms… */
export const KICK_MERGE_WINDOW_MS = 35

/** …or inside the same 240-tick subdivision (a quarter pulse at 60 BPM). */
export const KICK_MERGE_SUBDIVISION_TICKS = TRANSPORT_TICKS_PER_BEAT / 4

/** §17, verbatim. */
export function mergeKickVelocity(velocities: readonly number[]): number {
  const strongest = Math.max(...velocities)
  const additionalEnergy = velocities
    .filter((value) => value !== strongest)
    .reduce((sum, value) => sum + value * 0.16, 0)
  return Math.min(127, Math.round(strongest + additionalEnergy))
}

function subdivisionOf(tick: number): number {
  return Math.floor(tick / KICK_MERGE_SUBDIVISION_TICKS)
}

/**
 * Whether two intents are close enough to be one kick. Either §17 clause
 * suffices — the tick test catches hits the ms test misses when the
 * transport is running slower than wall-clock.
 */
export function shouldMergeKicks(
  a: { desiredTick: number; atMs: number },
  b: { desiredTick: number; atMs: number },
): boolean {
  if (Math.abs(a.atMs - b.atMs) <= KICK_MERGE_WINDOW_MS) return true
  return subdivisionOf(a.desiredTick) === subdivisionOf(b.desiredTick)
}

export interface StampedKickIntent extends KickIntent {
  atMs: number
}

/**
 * Fold a run of kick intents into the kicks that should actually sound.
 *
 * Within a merged group the surviving intent takes the HIGHEST priority
 * present and the §17 merged velocity — so a direct body kick arriving
 * beside a generated one yields a single direct kick carrying both their
 * energy, never a double trigger.
 *
 * Input need not be sorted; output is ordered by tick.
 */
export function foldKickIntents(intents: readonly StampedKickIntent[]): readonly StampedKickIntent[] {
  const sorted = [...intents].sort((a, b) => a.atMs - b.atMs || a.desiredTick - b.desiredTick)
  const groups: StampedKickIntent[][] = []
  for (const intent of sorted) {
    const group = groups[groups.length - 1]
    const anchor = group?.[0]
    if (group && anchor && shouldMergeKicks(anchor, intent)) {
      group.push(intent)
      continue
    }
    groups.push([intent])
  }
  return groups
    .map((group) => {
      const winner = group.reduce((best, candidate) =>
        DRUM_PRIORITY[candidate.priority] > DRUM_PRIORITY[best.priority] ? candidate : best,
      )
      return {
        ...winner,
        velocity: mergeKickVelocity(group.map((intent) => intent.velocity)),
      }
    })
    .sort((a, b) => a.desiredTick - b.desiredTick)
}
