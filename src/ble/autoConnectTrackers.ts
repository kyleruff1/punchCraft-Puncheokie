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
 * - **Connects slots SERIALLY.** H04 (docs/protocol/hypotheses.md): the
 *   tablet's BLE stack wedges when connect attempts overlap — observed in
 *   the field as the left tracker failing "Device was disconnected"
 *   mid-handshake whenever the right's direct connect landed concurrently.
 *   An earlier revision connected concurrently on the theory that serial
 *   doubles the wait; the doubled wait is real and the wedge is worse.
 * - **Single-flight.** Launch and a button press can land together; a second
 *   call while one is in progress joins the first instead of starting a
 *   competing scan, since concurrent scans wedge the Android BLE stack (H04).
 * - **Auto-retry.** `armAutoRetry()` runs a pass and, while any hand is
 *   still unconnected, schedules follow-up passes every RETRY_DELAY_MS —
 *   up to AUTO_RETRY_BUDGET automatic attempts, then goes dormant until
 *   the athlete presses Connect trackers again (which re-arms the budget).
 *   Retry passes trust ready state so a working hand is never torn down
 *   while the other hand is being chased.
 */

import { getTrackerCoordinator, type TrackerSlotHand } from '@ble/TrackerCoordinator'
import { PermissionService } from '@ble/PermissionService'
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
function slotAlreadyUsable(
  hand: TrackerSlotHand,
  address: string,
  nowMs: number,
  trustReadyState: boolean,
): boolean {
  const slot = getTrackerSlots()[hand]
  if (!slot) return false
  if (slot.deviceId.toUpperCase() !== address.toUpperCase()) return false
  if (!READY_STATES.has(slot.state)) return false
  // Scheduler-triggered retry passes trust the state: `lastEventAtMs` is
  // only stamped on the live screen, so off-live a healthy connection has
  // no liveness proof and the strict probe would evict and rebuild it on
  // every retry — bouncing the good hand while the other is chased.
  if (trustReadyState) return true
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
export interface AutoConnectOptions {
  timeoutMs?: number
  /**
   * Treat ready/streaming slots as usable without the liveness probe.
   * Used by scheduler retry passes so a working hand is not torn down
   * while the other is chased. Manual passes keep the strict probe.
   */
  trustReadyState?: boolean
}

export async function autoConnectKnownTrackers(
  options: AutoConnectOptions = {},
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

async function runAutoConnect(options: AutoConnectOptions): Promise<AutoConnectResult> {
  const timeoutMs = options.timeoutMs ?? 10_000
  const trustReadyState = options.trustReadyState ?? false
  const nowMs = systemMonotonicClock().now()

  // Runtime permissions gate every scan. A fresh install (or reinstall —
  // `adb uninstall` wipes prior grants) has no BLE permissions, and a scan
  // without them silently finds nothing: the app looks like "trackers
  // won't connect" with no error anywhere. Ask the OS here, in the one
  // path every connect flow funnels through; once granted this resolves
  // without a prompt.
  const perm = await PermissionService.current()
  if (!perm.granted) {
    const requested = await PermissionService.request()
    if (!requested.granted) {
      logger.warn('autoconnect.permissions.denied', 'BLE permissions missing; scan skipped', {
        missing: deviceSensitive(requested.missing),
        permanentlyDenied: deviceSensitive(requested.permanentlyDenied),
      })
      return {
        outcomes: [],
        connectedCount: 0,
        scanError:
          requested.permanentlyDenied.length > 0
            ? 'Bluetooth permission denied — enable Nearby devices in system settings.'
            : 'Bluetooth permission needed to find the trackers.',
      }
    }
  }

  // Short-circuit before touching the radio if everything is genuinely up —
  // "genuinely" measured against `lastEventAtMs`, not just `state` (unless
  // this is a retry pass trusting ready state; see slotAlreadyUsable).
  const pending = KNOWN_TRACKERS.filter(
    (t) => !slotAlreadyUsable(t.hand, t.address, nowMs, trustReadyState),
  )
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

  // A pending slot that still carries connection state — phantom 'ready'
  // from a killed process, a wedged 'connecting', or an 'error' left by a
  // failed handshake — blocks a fresh connect: the OS keeps a cached or
  // half-open GATT handle that keeps the device off the air. Evict down to
  // the radio (`evictSlot` cancels by device id even with no JS binding)
  // so the tracker returns to advertising and the scan can find it. Safe
  // on a truly dormant slot too — cancelling nothing is a no-op.
  const EVICTABLE = new Set(['ready', 'streaming', 'connecting', 'error'])
  for (const tracker of pending) {
    const slot = getTrackerSlots()[tracker.hand]
    if (!slot) continue
    if (!EVICTABLE.has(slot.state)) continue
    try {
      await coordinator.evictSlot(tracker.hand, slot.deviceId || tracker.address)
      logger.info('autoconnect.reclaim.disconnected', 'evicted stale connection', {
        hand: safe(tracker.hand),
        deviceId: deviceSensitive(tracker.address),
        priorState: safe(slot.state),
      })
    } catch (err) {
      // Non-fatal — the scan may still find it, and if it doesn't the
      // per-slot outcome will already reflect that.
      logger.warn('autoconnect.reclaim.disconnectFailed', 'stale disconnect failed', {
        hand: safe(tracker.hand),
        errorMessage: safe(err instanceof Error ? err.message : String(err)),
      })
    }
  }

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

  // Connect SERIALLY (H04): a second direct connect landing while the
  // first handshake is in flight is exactly the observed left-tracker
  // failure mode on this tablet. Left is index 0 and connects first.
  const results: AutoConnectOutcome[] = []
  for (const tracker of KNOWN_TRACKERS) {
    if (slotAlreadyUsable(tracker.hand, tracker.address, nowMs, trustReadyState)) {
      results.push({ hand: tracker.hand, address: tracker.address, status: 'already-connected' })
      continue
    }
    const deviceId = seen.get(tracker.address.toUpperCase())
    if (!deviceId) {
      results.push({ hand: tracker.hand, address: tracker.address, status: 'not-found' })
      continue
    }
    try {
      await coordinator.connectSlot(tracker.hand, deviceId, tracker.displayName)
      logger.info('autoconnect.connected', 'auto-connected tracker', {
        hand: safe(tracker.hand),
        color: safe(tracker.color),
        deviceId: deviceSensitive(deviceId),
      })
      results.push({ hand: tracker.hand, address: tracker.address, status: 'connected' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('autoconnect.connect.failed', 'auto-connect could not bind slot', {
        hand: safe(tracker.hand),
        deviceId: deviceSensitive(deviceId),
        errorMessage: safe(message),
      })
      results.push({
        hand: tracker.hand,
        address: tracker.address,
        status: 'failed',
        errorMessage: message,
      })
    }
  }

  const connectedCount = results.filter((r) => r.status === 'connected').length
  logger.info('autoconnect.done', 'auto-connect pass finished', {
    connectedCount: safe(connectedCount),
    notFound: safe(results.filter((r) => r.status === 'not-found').length),
    failed: safe(results.filter((r) => r.status === 'failed').length),
  })
  return { outcomes: results, connectedCount }
}

// ---------------------------------------------------------------------------
// Persistent auto-retry (Kyle's rule): after an incomplete pass, keep trying
// automatically — up to AUTO_RETRY_BUDGET attempts spaced RETRY_DELAY_MS
// apart — then go dormant until Connect trackers is pressed again.
// ---------------------------------------------------------------------------

/** Automatic attempts allowed per arm before the scheduler goes dormant. */
export const AUTO_RETRY_BUDGET = 5
/** Spacing between automatic attempts — long enough to tap a tracker awake. */
export const RETRY_DELAY_MS = 5_000

export interface AutoRetryState {
  /** Automatic attempts left before the scheduler goes dormant. */
  attemptsLeft: number
  /** True while a follow-up pass is scheduled. */
  retrying: boolean
  /** True once the budget ran out with a hand still unconnected. */
  exhausted: boolean
}

let retryAttemptsLeft = 0
let retryExhausted = false
let retryTimer: ReturnType<typeof setTimeout> | null = null
const retryListeners = new Set<() => void>()

function notifyRetryListeners(): void {
  for (const listener of retryListeners) {
    try {
      listener()
    } catch {
      // Listener errors must not break the scheduler.
    }
  }
}

export function getAutoRetryState(): AutoRetryState {
  return {
    attemptsLeft: retryAttemptsLeft,
    retrying: retryTimer !== null,
    exhausted: retryExhausted,
  }
}

/** Subscribe to scheduler state changes (for the Connect button's note). */
export function subscribeAutoRetry(listener: () => void): () => void {
  retryListeners.add(listener)
  return () => {
    retryListeners.delete(listener)
  }
}

function clearRetryTimer(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

/** A pass is incomplete while any hand is unconnected or the scan failed. */
function passIncomplete(result: AutoConnectResult): boolean {
  if (result.scanError !== undefined) return true
  return result.outcomes.some((o) => o.status === 'failed' || o.status === 'not-found')
}

function scheduleRetryIfNeeded(result: AutoConnectResult): void {
  // A permission refusal must not loop: each retry would re-prompt the OS
  // dialog five times in a row. Stay dormant until a manual press.
  if (result.scanError !== undefined && /permission/i.test(result.scanError)) {
    clearRetryTimer()
    retryExhausted = true
    notifyRetryListeners()
    return
  }
  if (!passIncomplete(result)) {
    clearRetryTimer()
    retryExhausted = false
    notifyRetryListeners()
    return
  }
  if (retryAttemptsLeft <= 0) {
    clearRetryTimer()
    retryExhausted = true
    logger.info('autoconnect.retry.exhausted', 'auto-retry budget spent; going dormant', {
      budget: safe(AUTO_RETRY_BUDGET),
    })
    notifyRetryListeners()
    return
  }
  clearRetryTimer()
  retryTimer = setTimeout(() => {
    retryTimer = null
    retryAttemptsLeft -= 1
    logger.info('autoconnect.retry.attempt', 'auto-retry pass starting', {
      attemptsLeft: safe(retryAttemptsLeft),
    })
    notifyRetryListeners()
    // Retry passes trust ready state so a connected hand is never torn
    // down while the other hand is chased.
    void autoConnectKnownTrackers({ trustReadyState: true }).then(scheduleRetryIfNeeded)
  }, RETRY_DELAY_MS)
  notifyRetryListeners()
}

/**
 * Run a pass now and arm the retry scheduler with a fresh budget.
 *
 * Every user-visible connect trigger funnels through this: app launch,
 * live-screen open, the Connect trackers button, and the post-Bluetooth-
 * bounce reconnect. The returned result is the FIRST pass's outcome;
 * follow-up passes run in the background and surface through the tracker
 * badges and the button's subscription to `subscribeAutoRetry`.
 */
export async function armAutoRetry(options: AutoConnectOptions = {}): Promise<AutoConnectResult> {
  clearRetryTimer()
  retryAttemptsLeft = AUTO_RETRY_BUDGET
  retryExhausted = false
  notifyRetryListeners()
  const result = await autoConnectKnownTrackers(options)
  scheduleRetryIfNeeded(result)
  return result
}

/** Test hook — reset scheduler state between tests. */
export function resetAutoRetryForTest(): void {
  clearRetryTimer()
  retryAttemptsLeft = 0
  retryExhausted = false
  retryListeners.clear()
}
