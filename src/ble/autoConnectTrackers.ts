/**
 * Auto-connect the known trackers.
 *
 * One scan, then connect every known tracker that turned up and is not already
 * connected. Because the address→hand mapping is fixed (see knownTrackers.ts),
 * no user choice is involved: if both trackers are awake we bind both slots in
 * one pass.
 *
 * Design notes:
 *
 * - **Never throws.** Callers run this on launch and from a button; a failed
 *   scan (Bluetooth off, permissions not granted, nothing advertising) is an
 *   ordinary outcome, not an error the UI should crash on. The result record
 *   says what happened.
 * - **Skips slots that are already usable.** Reconnecting a live slot would
 *   tear down its subscriptions for no reason.
 * - **Connects slots concurrently.** They are independent GATT connections;
 *   serialising them doubles the wait for no benefit.
 * - **Single-flight.** Launch and a button press can land together; a second
 *   call while one is in progress joins the first instead of starting a
 *   competing scan, since concurrent scans wedge the Android BLE stack (H04).
 */

import { getTrackerCoordinator, type TrackerSlotHand } from '@ble/TrackerCoordinator'
import { findKnownTracker, KNOWN_TRACKERS } from '@ble/knownTrackers'
import { getTrackerSlots } from '@state/useTrackerStore'
import { deviceSensitive, logger, safe } from '@/diagnostics/logger'

export interface AutoConnectOutcome {
  hand: TrackerSlotHand
  address: string
  status: 'connected' | 'already-connected' | 'not-found' | 'failed'
  errorMessage?: string
}

export interface AutoConnectResult {
  outcomes: AutoConnectOutcome[]
  /** Slots newly connected by this run. */
  connectedCount: number
  /** Set when the scan itself failed; per-tracker outcomes will be empty. */
  scanError?: string
}

const READY_STATES = new Set(['ready', 'streaming'])

/** True when a slot already holds a usable connection to the expected device. */
function slotAlreadyUsable(hand: TrackerSlotHand, address: string): boolean {
  const slot = getTrackerSlots()[hand]
  if (!slot) return false
  if (slot.deviceId.toUpperCase() !== address.toUpperCase()) return false
  return READY_STATES.has(slot.state)
}

let inFlight: Promise<AutoConnectResult> | null = null

/**
 * Scan once and connect every known tracker that is advertising.
 *
 * `timeoutMs` bounds the scan (§11.6). Shorter is fine for launch, where the
 * trackers are usually already awake and advertising.
 */
export async function autoConnectKnownTrackers(
  options: { timeoutMs?: number } = {},
): Promise<AutoConnectResult> {
  if (inFlight) return inFlight
  inFlight = runAutoConnect(options).finally(() => {
    inFlight = null
  })
  return inFlight
}

/** True while a scan/connect pass is running. */
export function isAutoConnectInFlight(): boolean {
  return inFlight !== null
}

async function runAutoConnect(options: { timeoutMs?: number }): Promise<AutoConnectResult> {
  const timeoutMs = options.timeoutMs ?? 10_000

  // Short-circuit before touching the radio if everything is already up.
  const pending = KNOWN_TRACKERS.filter((t) => !slotAlreadyUsable(t.hand, t.address))
  if (pending.length === 0) {
    return {
      outcomes: KNOWN_TRACKERS.map((t) => ({
        hand: t.hand,
        address: t.address,
        status: 'already-connected' as const,
      })),
      connectedCount: 0,
    }
  }

  const coordinator = getTrackerCoordinator()

  let advertisements
  try {
    advertisements = await coordinator.scan({ timeoutMs })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn('autoconnect.scan.failed', 'auto-connect scan failed', {
      errorMessage: safe(message),
    })
    return { outcomes: [], connectedCount: 0, scanError: message }
  }

  // Latest advertisement wins per address; a device can advertise many times
  // inside one scan window.
  const seen = new Map<string, string>()
  for (const ad of advertisements) {
    if (findKnownTracker(ad.deviceId)) seen.set(ad.deviceId.toUpperCase(), ad.deviceId)
  }

  const results = await Promise.all(
    KNOWN_TRACKERS.map(async (tracker): Promise<AutoConnectOutcome> => {
      if (slotAlreadyUsable(tracker.hand, tracker.address)) {
        return { hand: tracker.hand, address: tracker.address, status: 'already-connected' }
      }
      const deviceId = seen.get(tracker.address.toUpperCase())
      if (!deviceId) {
        return { hand: tracker.hand, address: tracker.address, status: 'not-found' }
      }
      try {
        await coordinator.connectSlot(tracker.hand, deviceId, tracker.displayName)
        logger.info('autoconnect.connected', 'auto-connected tracker', {
          hand: safe(tracker.hand),
          color: safe(tracker.color),
          deviceId: deviceSensitive(deviceId),
        })
        return { hand: tracker.hand, address: tracker.address, status: 'connected' }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn('autoconnect.connect.failed', 'auto-connect could not bind slot', {
          hand: safe(tracker.hand),
          deviceId: deviceSensitive(deviceId),
          errorMessage: safe(message),
        })
        return {
          hand: tracker.hand,
          address: tracker.address,
          status: 'failed',
          errorMessage: message,
        }
      }
    }),
  )

  const connectedCount = results.filter((r) => r.status === 'connected').length
  logger.info('autoconnect.done', 'auto-connect pass finished', {
    connectedCount: safe(connectedCount),
    notFound: safe(results.filter((r) => r.status === 'not-found').length),
    failed: safe(results.filter((r) => r.status === 'failed').length),
  })
  return { outcomes: results, connectedCount }
}
