/**
 * Punch-event source port (doc §27 step 2, spec §28).
 *
 * The seam that lets the whole Puncheokie live stack be built and tested
 * before the tracker stream exists. `SimulatedPunchSource` (M32-01) and
 * `TrackerPunchEventSource` (M33-01) implement this same contract, so
 * swapping sources changes no consumer code.
 *
 * The port deliberately says nothing about FightCamp, BLE, GATT or slots —
 * a replay source or a different tracker must be able to satisfy it without
 * the contract bending (spec §28).
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import type { TrackerPunchEvent } from './PunchEvent'

/**
 * What a source can actually tell you.
 *
 * This is a *declaration of capability*, not a wish: a source that sets
 * `velocity: true` must emit velocity fields on every event, and one that
 * sets `punchType: 'none'` must never let a consumer infer technique.
 * `resolveCapabilityTier` (M32-02) maps this onto the doc §3 tier, and the
 * tier is what limits scoring.
 *
 * `punchType` is graded rather than boolean because the doc §3 ladder
 * distinguishes broad technique families from distinct numbered techniques,
 * and those are different scoring rungs.
 */
export interface PunchEventSourceCapability {
  hand: boolean
  timestamp: boolean
  punchType: 'none' | 'broad' | 'distinct'
  velocity: boolean
}

export interface PunchEventSource {
  readonly id: string
  readonly capability: PunchEventSourceCapability
  /** Returns an unsubscribe function. */
  subscribe(listener: (event: TrackerPunchEvent) => void): () => void
  start(): void
  /** Stops delivery and cancels anything already scheduled. */
  stop(): void
}
