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
import { systemMonotonicClock } from '@domain/time/MonotonicClock'

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

/**
 * How long a `'ready'` slot may go silent before we stop trusting the state.
 *
 * Chosen for the situation this whole function exists to survive: the app
 * process gets killed (or Metro reloads) mid-workout, so the store rehydrates
 * to `'ready'` from before the crash while the real GATT link is long gone.
 * The trackers themselves fall back to slow-blink advertising within seconds.
 * Ten seconds is long enough that a live tracker between throws will not be
 * mistaken for stale, and short enough that a phantom `'ready'` on launch is
 * caught before the athlete taps Start.
 */
const STALE_AFTER_MS = 10_000

/**
 * True when a slot already holds a usable connection to the expected device.
 *
 * "Usable" here means the store says ready **and** we have evidence — a punch
 * frame or an explicit liveness stamp — inside the freshness window. Without
 * the second half, a `'ready'` value left behind by a killed process short-
 * circuits auto-connect forever and there is no path back onto the bag. That
 * was the bug this reads as slow-blinking trackers with the app looking
 * connected but no punches landing.
 */
function slotAlreadyUsable(hand: TrackerSlotHand, address: string, nowMs: number): boolean {
  const slot = getTrackerSlots()[hand]
  if (!slot) return false
  if (slot.deviceId.toUpperCase() !== address.toUpperCase()) return false
  if (!READY_STATES.has(slot.state)) return false
  if (slot.lastEventAtMs === undefined) return false
  return nowMs - slot.lastEventAtMs <= STALE_AFTER_MS
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
  const nowMs = systemMonotonicClock().now()

  // Short-circuit before touching the radio if everything is genuinely up —
  // "genuinely" measured against `lastEventAtMs`, not just `state`.
  const pending = KNOWN_TRACKERS.filter((t) => !slotAlreadyUsable(t.hand, t.address, nowMs))
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

  // A pending slot that the store still thinks is `'ready'` is the phantom
  // case: the OS holds a cached handle, so a scan will not surface the device
  // and a fresh connect will fail. Force a disconnect first so the tracker
  // returns to advertising and the scan can find it. Safe on a truly dormant
  // slot too — `disconnect` on a non-existent connection is a no-op.
  await Promise.all(
    pending.map(async (tracker) => {
      const slot = getTrackerSlots()[tracker.hand]
      if (!slot) return
      if (!READY_STATES.has(slot.state)) return
      try {
        await coordinator.disconnectSlot(tracker.hand)
        logger.info('autoconnect.reclaim.disconnected', 'evicted stale connection', {
          hand: safe(tracker.hand),
          deviceId: deviceSensitive(tracker.address),
        })
      } catch (err) {
        // Non-fatal — the scan may still find it, and if it doesn't the
        // per-slot outcome will already reflect that.
        logger.warn('autoconnect.reclaim.disconnectFailed', 'stale disconnect failed', {
          hand: safe(tracker.hand),
          errorMessage: safe(err instanceof Error ? err.message : String(err)),
        })
      }
    }),
  )

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
      if (slotAlreadyUsable(tracker.hand, tracker.address, nowMs)) {
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
