/**
 * Capability tier resolution (M32-02, doc §3, doc §21).
 *
 * Puncheokie must never claim more than the connected tracker's data
 * supports. This module is the single place that decides how much may be
 * scored, and the single place that decides what a sequence score is
 * allowed to be called.
 *
 * ## FightCamp v1 resolves to `hand-timestamp`, not `hand-broad-type`
 *
 * The issue that specified this module (#179) was written against the H11
 * reading that the payload carries "a two-value vendor type flag (heavy
 * versus standard)", and on that basis fixed the tier at `hand-broad-type`.
 *
 * **H12 refuted that reading on hardware** and the design doc was corrected
 * to match (v0.4, D12). A controlled isolated-punch capture showed the type
 * byte carries no device-portable meaning: on one tracker it behaves as a
 * velocity gate with the *opposite* polarity to "1/2 = heavy", and on the
 * other it shows no threshold at all. The flag is not portable in either
 * direction, so there is no broad technique family to match on.
 *
 * This module therefore implements D12. That is not re-litigating D4 — it
 * is applying the doc's own rules R2 ("must not claim technique recognition
 * beyond the tracker data") and R12 ("shall score only what the connected
 * tracker data can support") to newer evidence than #179 had.
 *
 * The two type rungs stay in the ladder for future decoders. Nothing
 * hardcodes a tier: it is always resolved from what the source reports.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import type { PunchEventSourceCapability } from '../punch/PunchEventSource'
import type { TrackerPunchEvent } from '../punch/PunchEvent'

export type CapabilityTier =
  | 'hand-only'
  | 'hand-timestamp'
  | 'hand-broad-type'
  | 'hand-distinct-type'

export interface ResolvedCapability {
  tier: CapabilityTier
  /** Tracker-reported velocity, in tracker units, is available. */
  velocityAvailable: boolean
}

export type CapabilityInput =
  | { capability: PunchEventSourceCapability }
  | { observedEvents: readonly TrackerPunchEvent[] }

/**
 * Resolve the tier from either a declared capability or an observed sample.
 *
 * Both paths resolve **conservatively**: a capability is never inferred
 * upward from an absent field (spec §4.2). An empty sample tells you
 * nothing, so it resolves to `hand-only` rather than to whatever the last
 * connected tracker could do.
 */
export function resolveCapabilityTier(input: CapabilityInput): ResolvedCapability {
  if ('capability' in input) return fromCapability(input.capability)
  return fromObservedEvents(input.observedEvents)
}

function fromCapability(capability: PunchEventSourceCapability): ResolvedCapability {
  return {
    tier: tierFor({
      punchType: capability.punchType,
      timestamp: capability.timestamp,
    }),
    velocityAvailable: capability.velocity,
  }
}

/**
 * Resolve from real traffic (the M33-01 path).
 *
 * Only fields actually present on observed punches count. A single event
 * carrying a timestamp is enough to establish that the tracker reports one;
 * no event carrying a technique means no technique tier, regardless of what
 * a decoder might guess.
 */
function fromObservedEvents(events: readonly TrackerPunchEvent[]): ResolvedCapability {
  if (events.length === 0) {
    return { tier: 'hand-only', velocityAvailable: false }
  }

  const hasTimestamp = events.some((e) => typeof e.trackerTimestampMs === 'number')

  // `punchType` present on observed punches would promote the tier — but on
  // FightCamp v1 the decoder maps every type byte to 'unknown' (H12), so
  // this stays false and the tier stays at hand + timestamp. A decoder that
  // could genuinely classify would set it and promote honestly.
  const hasTechnique = events.some(
    (e) => typeof e.punchType === 'string' && e.punchType !== 'unknown',
  )

  const velocityAvailable = events.some(
    (e) => typeof e.velocityRaw === 'number' && e.velocityUnit !== 'unknown',
  )

  return {
    tier: tierFor({
      punchType: hasTechnique ? 'broad' : 'none',
      timestamp: hasTimestamp,
    }),
    velocityAvailable,
  }
}

function tierFor(signals: {
  punchType: PunchEventSourceCapability['punchType']
  timestamp: boolean
}): CapabilityTier {
  if (signals.punchType === 'distinct') return 'hand-distinct-type'
  if (signals.punchType === 'broad') return 'hand-broad-type'
  if (signals.timestamp) return 'hand-timestamp'
  return 'hand-only'
}

/**
 * What a sequence score may be called at this tier (D4, spec §13.3).
 *
 * Only `hand-distinct-type` — a tracker that can actually tell a jab from a
 * lead hook — earns "technique match". Everything else is a hand-sequence
 * match, because that is literally all that was verified: the expected hand
 * fired inside the expected window.
 *
 * `1-2-3` and `1-2b-3` are both left-right-left and are indistinguishable
 * to the tracker. The cue tells the athlete which to throw; the tracker only
 * confirms the hand.
 */
export function sequenceScoreLabel(
  tier: CapabilityTier,
): 'hand-sequence match' | 'technique match' {
  return tier === 'hand-distinct-type' ? 'technique match' : 'hand-sequence match'
}

/** True when the tier permits any technique claim at all. */
export function tierScoresTechnique(tier: CapabilityTier): boolean {
  return tier === 'hand-broad-type' || tier === 'hand-distinct-type'
}
