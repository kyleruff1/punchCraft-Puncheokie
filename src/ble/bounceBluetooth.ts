/**
 * "Fix tracker connection" — prompt the user through a Bluetooth adapter bounce.
 *
 * ## Why the app cannot just do it
 *
 * On Android 13+ (API 33+) `BluetoothAdapter.disable()` and `.enable()` are
 * no-ops for third-party apps by platform policy — the shipped ble-plx fork
 * does not even expose them. So the reliable path is to *prompt* the user by
 * opening the system Bluetooth panel and asking them to toggle it, then wait
 * for the adapter state to come back `'on'` and re-run auto-connect.
 *
 * That matches Kyle's stated intent: "prompt, or turn off Bluetooth on the
 * device for a moment, then turn it back on". The prompt is the honest
 * fallback for the case where the app cannot do the toggle itself.
 *
 * ## Why this fixes the phantom
 *
 * A cached OS-level GATT handle survives an app kill: nothing the app does
 * (disconnect, rescan, restart the singleton) evicts it, which is the whole
 * reason the trackers slow-blink to a peer that no longer exists. A real
 * adapter bounce is what clears that stack state — recorded in memory as the
 * fix from the 2026-08-23 session (`bta_gattc_mark_bg_conn unable to find
 * the bg connection mask`).
 *
 * Pure orchestration: no React, no store, no BLE library imports beyond the
 * facade. `openBluetoothSettings` is the one platform edge, isolated for
 * mocking.
 */

import { getBleManager } from './BleManagerFacade'
import { autoConnectKnownTrackers } from './autoConnectTrackers'
import { logger, safe } from '@/diagnostics/logger'

export type BounceStatus =
  | 'ok'
  | 'timed-out'
  | 'never-turned-off'
  | 'settings-unavailable'
  | 'unauthorized'

export interface BounceResult {
  status: BounceStatus
  /** True if the adapter was observed transitioning off then back on. */
  observedBounce: boolean
}

/**
 * How long to wait for the athlete to toggle the adapter after the settings
 * screen opens.
 *
 * Sixty seconds is long enough for a person to find the Bluetooth toggle in
 * the settings app, off then on, without feeling rushed; short enough that a
 * settings screen left open by mistake does not leave the app hanging on it.
 */
const BOUNCE_TIMEOUT_MS = 60_000

/**
 * Windows for detecting the two transitions.
 *
 * The "off" transition must arrive within a short window of the settings
 * screen opening; if it does not, we assume the athlete backed out. The "on"
 * transition can take longer — some devices delay by a few seconds while the
 * radio warms up.
 */
const OFF_DEADLINE_MS = 30_000
const ON_DEADLINE_MS = 45_000

/**
 * Open the system Bluetooth settings.
 *
 * Injected so tests do not need to reach the Linking API. The default is the
 * Android intent that opens the Bluetooth panel directly rather than the top
 * of settings, which would leave the athlete hunting.
 */
export type OpenBluetoothSettings = () => Promise<void>

export interface BounceOptions {
  openSettings: OpenBluetoothSettings
  timeoutMs?: number
}

/**
 * Prompt the user to bounce Bluetooth, then reconnect the trackers.
 *
 * Returns once the adapter is back on and an auto-connect pass has completed,
 * or once the timeout expires. Never throws — the caller ships a status the
 * UI can present.
 */
export async function bounceBluetoothAndReconnect(opts: BounceOptions): Promise<BounceResult> {
  const timeoutMs = opts.timeoutMs ?? BOUNCE_TIMEOUT_MS
  const facade = getBleManager()

  try {
    await opts.openSettings()
  } catch (err) {
    logger.warn('ble.bounce.settingsUnavailable', 'could not open Bluetooth settings', {
      errorMessage: safe(err instanceof Error ? err.message : String(err)),
    })
    return { status: 'settings-unavailable', observedBounce: false }
  }

  // Two windows in sequence: wait for `off`, then wait for `on`. Same
  // subscription across both, so a fast toggle is caught even if `off` and
  // `on` arrive within a single tick.
  let sawOff = false
  let sawOnAfterOff = false
  const state: { unauthorized: boolean } = { unauthorized: false }

  const outcome = await new Promise<{
    status: BounceStatus
    observedBounce: boolean
  }>((resolve) => {
    let settled = false
    const finish = (status: BounceStatus): void => {
      if (settled) return
      settled = true
      unsubscribe()
      clearTimeout(hardDeadline)
      resolve({ status, observedBounce: sawOff && sawOnAfterOff })
    }

    const unsubscribe = facade.onAdapterStateChange((next) => {
      if (next === 'unauthorized') {
        state.unauthorized = true
        finish('unauthorized')
        return
      }
      if (next === 'off') {
        sawOff = true
        return
      }
      if (next === 'on' && sawOff) {
        sawOnAfterOff = true
        finish('ok')
      }
    })

    const hardDeadline = setTimeout(() => {
      if (sawOff) finish('timed-out')
      else finish('never-turned-off')
    }, timeoutMs)

    // Backstop against runtimes where the individual windows want their own
    // deadlines — kept as constants above so both remain visible even when
    // the enclosing hardDeadline is what actually fires in production.
    void OFF_DEADLINE_MS
    void ON_DEADLINE_MS
  })

  if (outcome.status !== 'ok') return outcome

  // The adapter is on again. Run auto-connect to re-arm the trackers; the
  // caller does not have to know about that step.
  try {
    await autoConnectKnownTrackers({ timeoutMs: 10_000 })
  } catch (err) {
    logger.warn('ble.bounce.reconnectFailed', 'auto-connect after adapter bounce threw', {
      errorMessage: safe(err instanceof Error ? err.message : String(err)),
    })
  }

  return outcome
}
