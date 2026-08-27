/**
 * Live punch-source selection (M33-01, doc §19, doc §27 step 6).
 *
 * The live screen is written against the `PunchEventSource` port and does
 * not care which implementation it gets. This hook is the one place that
 * decides, and the one place that turns the tracker slots into the two
 * things the top bar shows: per-glove connection state and the degraded
 * warning.
 *
 * Three decisions worth keeping:
 *
 * 1. **The choice is latched on entry, not re-evaluated.** `useWorkoutRunner`
 *    rebuilds its cue engine and session clock whenever the source identity
 *    changes, so swapping sources mid-workout would silently restart the
 *    workout. A tracker dropping out therefore changes the top bar, never
 *    the source (spec §19.3).
 * 2. **Both trackers or neither.** With one glove connected, half the
 *    combinations would be unmatchable and the counts would read as a
 *    performance problem rather than a connection one. The simulator is the
 *    honest fallback, and the top bar says `SIM` on both chips so nobody
 *    mistakes simulated counts for measured ones.
 * 3. **Degraded goes through the existing `degraded` string** on the live
 *    slice, which `RoundTopBar` already renders as text-plus-icon
 *    (spec §19.4). No second channel.
 */
import { useEffect, useMemo, useRef } from 'react'

import { getBleManager } from '@ble/BleManagerFacade'
import { armAutoRetry } from '@ble/autoConnectTrackers'
import { logger, safe } from '@diagnostics/logger'
import type { PunchEventSource } from '@domain/punch/PunchEventSource'
import type { MonotonicClock } from '@domain/time/MonotonicClock'
import { getProtocolRegistry } from '@protocol/ProtocolRegistry'
// Side-effect import — registers the FightCamp v1 adapter with the singleton
// registry (§16). Must run before the registry is queried below.
import '@protocol/fightcamp-v1'
import { TrackerPunchEventSource } from '@protocol/TrackerPunchEventSource'
import { SimulatedPunchSource } from '@simulation/SimulatedPunchSource'
import { noteSlotEvent, useLeftSlot, useRightSlot, type SlotState } from '@state/useTrackerStore'
import { setLive } from '@state/useWorkoutStore'
import type { LiveConnectionState } from '@components/workout/RoundTopBar'

const FIGHTCAMP_V1_ID = 'fightcamp-v1'

export type LivePunchSourceKind = 'tracker' | 'simulated'

export interface LivePunchSource {
  source: PunchEventSource
  kind: LivePunchSourceKind
  /** Non-null only on the simulated path — `SimControls` needs the sim API. */
  sim: SimulatedPunchSource | null
  connection: { left: LiveConnectionState; right: LiveConnectionState }
}

/** A slot is usable when it is connected and past initialization (§11.5). */
const isLive = (slot: SlotState | null): boolean =>
  slot?.state === 'ready' || slot?.state === 'streaming'

/** What is wrong with this slot, in the words the top bar uses. */
function slotIssue(slot: SlotState | null): string | null {
  if (isLive(slot)) return null
  if (!slot) return 'not connected'
  if (slot.state === 'recovering') return 'reconnecting'
  if (slot.state === 'error') return 'not responding'
  return 'not connected'
}

/**
 * Degraded warning text, or undefined when both gloves are fine.
 *
 * Says what is not being counted rather than naming a state, because the
 * athlete reads this between combinations and needs the consequence.
 */
export function degradedText(left: SlotState | null, right: SlotState | null): string | undefined {
  const l = slotIssue(left)
  const r = slotIssue(right)
  if (!l && !r) return undefined
  if (l && r) {
    return l === r
      ? `Both gloves ${l} — punches are not being counted`
      : `Left glove ${l}, right glove ${r} — punches are not being counted`
  }
  const hand = l ? 'Left' : 'Right'
  return `${hand} glove ${l ?? r} — those punches are not being counted`
}

interface ChosenSource {
  kind: LivePunchSourceKind
  source: PunchEventSource
  sim: SimulatedPunchSource | null
}

function simulated(clock: MonotonicClock): ChosenSource {
  const sim = new SimulatedPunchSource({ clock, seed: 'live-screen', velocity: true })
  return { kind: 'simulated', source: sim, sim }
}

/**
 * Real trackers when both slots are live, the simulator otherwise.
 *
 * Failure to build the tracker source falls back rather than throwing: an
 * unregistered adapter or an unavailable facade is a wiring problem, and
 * crashing the live screen would hide it behind a blank screen.
 */
function chooseSource(
  clock: MonotonicClock,
  left: SlotState | null,
  right: SlotState | null,
): ChosenSource {
  if (!(left && right && isLive(left) && isLive(right))) return simulated(clock)

  const adapter = getProtocolRegistry()
    .list()
    .find((a) => a.id === FIGHTCAMP_V1_ID)
  if (!adapter) {
    logger.warn('puncheokie.source.adapter.missing', 'no FightCamp v1 adapter registered', {})
    return simulated(clock)
  }

  try {
    const source = new TrackerPunchEventSource({
      facade: getBleManager(),
      adapter,
      // Hand is the slot, permanently: blue is left, red is right
      // (src/ble/knownTrackers.ts, H11). Never a payload byte.
      slots: { left: { deviceId: left.deviceId }, right: { deviceId: right.deviceId } },
    })
    return { kind: 'tracker', source, sim: null }
  } catch (err) {
    logger.warn('puncheokie.source.tracker.unavailable', 'falling back to the simulator', {
      errorMessage: safe(err instanceof Error ? err.message : String(err)),
    })
    return simulated(clock)
  }
}

export function useLivePunchSource(clock: MonotonicClock): LivePunchSource {
  const left = useLeftSlot()
  const right = useRightSlot()

  // Latched on first render — see decision 1 in the header. The slots are
  // read here and never again for the purpose of choosing.
  const chosenRef = useRef<ChosenSource | null>(null)
  if (chosenRef.current === null) chosenRef.current = chooseSource(clock, left, right)
  const chosen = chosenRef.current

  const connection = useMemo<LivePunchSource['connection']>(() => {
    if (chosen.kind !== 'tracker') return { left: 'simulated', right: 'simulated' }
    return { left: left?.state ?? 'dormant', right: right?.state ?? 'dormant' }
  }, [chosen.kind, left, right])

  // Only the tracker path can degrade: the simulator has no radio to lose,
  // and warning about gloves nobody is using would be noise.
  const degraded = chosen.kind === 'tracker' ? degradedText(left, right) : undefined

  useEffect(() => {
    setLive({ degraded })
  }, [degraded])

  // Fire an auto-connect pass when the live screen opens. `useAutoConnectOnLaunch`
  // runs once at process start, but if trackers went stale mid-workout (Metro
  // reload, a killed process, a tracker that slept) the athlete needs the
  // reclaim path to try again the moment they walk back onto the bag. The pass
  // is idempotent — if both slots are actually live and receiving events, the
  // probe skips them.
  useEffect(() => {
    void armAutoRetry({ timeoutMs: 10_000 })
      .then((result) => {
        if (result.scanError) {
          logger.info('autoconnect.live.skipped', 'live-screen auto-connect could not scan', {
            errorMessage: safe(result.scanError),
          })
        }
      })
      .catch((err) => {
        logger.warn('autoconnect.live.error', 'live-screen auto-connect threw', {
          errorMessage: safe(String(err)),
        })
      })
  }, [])

  // Stamp the slot as live whenever a punch arrives. This is what the
  // auto-connect probe reads: a `'ready'` state alone cannot tell a real
  // connection from a phantom left over from a killed process, so we require
  // proof-of-life. Only the tracker source produces meaningful liveness
  // signal; the simulator would falsely mark slots the tablet is not
  // physically connected to.
  useEffect(() => {
    if (chosen.kind !== 'tracker') return
    const off = chosen.source.subscribe((event) => {
      if (event.hand === 'left' || event.hand === 'right') {
        noteSlotEvent(event.hand, event.receivedMonotonicTimeMs)
      }
    })
    return () => {
      off()
    }
  }, [chosen])

  return useMemo(
    () => ({ source: chosen.source, kind: chosen.kind, sim: chosen.sim, connection }),
    [chosen, connection],
  )
}
