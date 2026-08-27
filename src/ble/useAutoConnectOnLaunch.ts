/**
 * Fire one auto-connect pass shortly after the app starts.
 *
 * Mounted from the root layout so it runs once per launch regardless of which
 * screen the user lands on. The pass is fire-and-forget and never throws — if
 * Bluetooth is off, permissions have not been granted, or the trackers are
 * asleep, nothing happens and the "Connect both" button on Velocity Lab is the
 * manual path.
 *
 * The small delay lets the BLE adapter finish initialising after process
 * start; scanning in the same tick as launch tends to come back empty on the
 * tablet even when the trackers are advertising.
 */

import { useEffect } from 'react'

import { armAutoRetry } from '@ble/autoConnectTrackers'
import { logger, safe } from '@/diagnostics/logger'

const LAUNCH_DELAY_MS = 1_500

export function useAutoConnectOnLaunch(): void {
  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      void armAutoRetry({ timeoutMs: 10_000 })
        .then((result) => {
          if (result.scanError) {
            logger.info('autoconnect.launch.skipped', 'launch auto-connect could not scan', {
              errorMessage: safe(result.scanError),
            })
            return
          }
          logger.info('autoconnect.launch.done', 'launch auto-connect finished', {
            connectedCount: safe(result.connectedCount),
          })
        })
        .catch((err) => {
          // autoConnectKnownTrackers is contractually non-throwing; this is
          // belt-and-braces so a launch path can never surface an unhandled
          // rejection.
          logger.warn('autoconnect.launch.error', 'launch auto-connect threw', {
            errorMessage: safe(String(err)),
          })
        })
    }, LAUNCH_DELAY_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])
}
