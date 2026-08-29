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
 * - **The precise probe.** A hand connected TO THE CURRENT SESSION (store
 *   ready AND the native stack confirms) is untouchable on every pass —
 *   a working hand is never torn down while the other is chased. The
 *   scheduler is also suspended entirely while a workout runs.
 */

import { getTrackerCoordinator, type TrackerSlotHand } from '@ble/TrackerCoordinator'
import { PermissionService } from '@ble/PermissionService'
import { KNOWN_TRACKERS } from '@ble/knownTrackers'
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

/**
 * States that mean THIS SESSION owns the link right now — settled
 * (ready/streaming) or actively bringing it up. Bring-up states matter:
 * the live screen arms a fresh pass on mount, and if that pass lands
 * while the landing's pass is still initializing a glove (clock sync,
 * mode write), treating 'initializing' as evictable cancels a healthy
 * connection mid-handshake — observed 2026-08-29 as the right glove
 * dying with "not connected" on its init writes whenever both gloves
 * tried to come up together. Native confirmation below still guards
 * against a phantom store state.
 */
const THIS_SESSION_STATES = new Set([
  'connecting',
  'bonding',
  'discovering',
  'initializing',
  'ready',
  'streaming',
  // The stream's own self-heal; evicting under it is the same bug.
  // If a recovery truly wedges while the radio stays attached, the Fix
  // button's Bluetooth bounce remains the escape hatch.
  'recovering',
])

/**
 * True when this hand is connected TO THE CURRENT SESSION — the precise
 * rule (Kyle's words) for "leave it alone".
 *
 * Two conditions, both required:
 * 1. The store's slot says ready/streaming for the expected device — the
 *    event-driven, this-session view.
 * 2. The NATIVE stack confirms the device is connected right now
 *    (`isDeviceConnected`) — ground truth from the radio.
 *
 * The pairing is what makes it precise. Store-only lies both ways: a GATT
 * link that died without a disconnect event leaves a phantom 'ready', and
 * a JS reload forgets slots whose native connections survived. The old
 * probe approximated truth with `lastEventAtMs` freshness, which off the
 * live screen no slot ever earns — so it bounced healthy connections at
 * every workout start. Asking the radio needs no approximation.
 */
async function slotConnectedThisSession(
  coordinator: { isDeviceConnected(deviceId: string): Promise<boolean> },
  hand: TrackerSlotHand,
  address: string,
): Promise<boolean> {
  const slot = getTrackerSlots()[hand]
  if (!slot) return false
  if (slot.deviceId.toUpperCase() !== address.toUpperCase()) return false
  if (!THIS_SESSION_STATES.has(slot.state)) return false
  try {
    return await coordinator.isDeviceConnected(slot.deviceId)
  } catch {
    return false
  }
}

let inFlight: Promise<AutoConnectResult> | null = null

/**
 * Scan once and connect every known tracker that is advertising.
 *
 * `timeoutMs` is retained for callers but no longer bounds anything —
 * passes connect directly by address (no scan; see the pass body) and
 * the facade's own connect timeout bounds each attempt. Kept so call
 * sites need no churn while the scan-free flow settles. Historical: it
 * trackers are usually already awake and advertising.
 */
export interface AutoConnectOptions {
  timeoutMs?: number
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
  void options.timeoutMs

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

  const coordinator = getTrackerCoordinator()

  // The precise rule: a hand connected TO THE CURRENT SESSION — store says
  // ready AND the native stack confirms — is untouchable. Everything else
  // is pending. One rule for every pass; no manual/retry modes.
  const usable: Record<TrackerSlotHand, boolean> = { left: false, right: false }
  for (const t of KNOWN_TRACKERS) {
    usable[t.hand] = await slotConnectedThisSession(coordinator, t.hand, t.address)
  }
  const pending = KNOWN_TRACKERS.filter((t) => !usable[t.hand])
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

  // Evict EVERY pending slot down to the radio before scanning — by
  // address, regardless of what the store believes. The store lies in two
  // directions: a phantom 'ready'/'error' left by a killed process hides a
  // cached or half-open GATT handle, and after a JS reload the store
  // forgets slots entirely while the NATIVE connection survives — a
  // connected tracker does not advertise, so scans come back empty and
  // the retry budget burns on a device that was attached all along.
  // Cancelling by address covers both; on a truly dormant device it is a
  // no-op.
  for (const tracker of pending) {
    const slot = getTrackerSlots()[tracker.hand]
    try {
      await coordinator.evictSlot(tracker.hand, slot?.deviceId || tracker.address)
      logger.info('autoconnect.reclaim.disconnected', 'evicted stale connection', {
        hand: safe(tracker.hand),
        deviceId: deviceSensitive(tracker.address),
        priorState: safe(slot?.state ?? 'absent'),
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

  // Connect DIRECTLY by address — no scan. The addresses are permanent
  // (knownTrackers); scanning only rediscovered what was already known,
  // and a 10-second scan window running beside a live glove is radio
  // pressure this tablet's chip pays for in dropped links. The Velocity
  // Lab era connected by address, held both gloves through whole
  // sessions, and had no scanning retry loop — the idle drops arrived
  // with the scan machinery (Kyle, 2026-08-29). A sleeping glove simply
  // times the direct connect out, which reports as not-found and keeps
  // the retry scheduler's semantics intact.
  //
  // Serial (H04): a second direct connect landing while the first
  // handshake is in flight is exactly the observed left-tracker failure
  // mode on this tablet. Left is index 0 and connects first.
  const results: AutoConnectOutcome[] = []
  for (const tracker of KNOWN_TRACKERS) {
    if (usable[tracker.hand]) {
      results.push({ hand: tracker.hand, address: tracker.address, status: 'already-connected' })
      continue
    }
    try {
      await coordinator.connectSlot(tracker.hand, tracker.address, tracker.displayName)
      logger.info('autoconnect.connected', 'auto-connected tracker', {
        hand: safe(tracker.hand),
        color: safe(tracker.color),
        deviceId: deviceSensitive(tracker.address),
      })
      results.push({ hand: tracker.hand, address: tracker.address, status: 'connected' })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // A timeout or cancellation is the direct-connect spelling of
      // "not advertising": the glove is asleep or out of range.
      if (/timed?\s?out|cancell?ed/i.test(message)) {
        logger.info('autoconnect.notReachable', 'tracker not reachable — likely asleep', {
          hand: safe(tracker.hand),
          errorMessage: safe(message),
        })
        results.push({ hand: tracker.hand, address: tracker.address, status: 'not-found' })
      } else {
        logger.warn('autoconnect.connect.failed', 'auto-connect could not bind slot', {
          hand: safe(tracker.hand),
          deviceId: deviceSensitive(tracker.address),
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
let retrySuspended = false
let retryResumePending = false
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

/**
 * Suspend or resume the retry scheduler.
 *
 * The live screen suspends while a workout is RUNNING: a retry pass scans
 * and evicts, and doing either mid-round churns the radios — observed as a
 * streaming hand's badge dropping to Off and the other hand's GATT dying
 * ("failed to snapshot") while the athlete was mid-combination. Spec §19.3
 * agrees: a tracker dropping mid-workout changes the top bar, never the
 * connection strategy. On resume, an interrupted chase picks back up with
 * whatever budget it had left.
 */
export function setAutoRetrySuspended(suspended: boolean): void {
  if (retrySuspended === suspended) return
  retrySuspended = suspended
  if (suspended) {
    if (retryTimer !== null) {
      clearRetryTimer()
      retryResumePending = true
    }
    notifyRetryListeners()
    return
  }
  if (retryResumePending && retryAttemptsLeft > 0) {
    retryResumePending = false
    // Re-evaluate immediately rather than waiting a full delay — the
    // workout just ended and the athlete is looking at the badges.
    void autoConnectKnownTrackers().then(scheduleRetryIfNeeded)
  }
  notifyRetryListeners()
}

function scheduleRetryIfNeeded(result: AutoConnectResult): void {
  // While suspended (mid-workout), never schedule; remember that a chase
  // was in progress so resume can pick it back up.
  if (retrySuspended) {
    clearRetryTimer()
    if (passIncomplete(result)) retryResumePending = true
    notifyRetryListeners()
    return
  }
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
    void autoConnectKnownTrackers().then(scheduleRetryIfNeeded)
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

/** Test hook — reset scheduler state between tests. Also drops a leaked
 * in-flight pass: a test whose pass never settles would otherwise occupy
 * the single-flight slot and time out every later test in the file. */
export function resetAutoRetryForTest(): void {
  clearRetryTimer()
  retryAttemptsLeft = 0
  retryExhausted = false
  retrySuspended = false
  retryResumePending = false
  retryListeners.clear()
  inFlight = null
}
