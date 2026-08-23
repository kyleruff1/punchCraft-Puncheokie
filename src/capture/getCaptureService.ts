/**
 * Process-wide BleCaptureService, wired to the app database.
 *
 * Kept separate from BleCaptureService itself so the service stays
 * constructor-injected and unit-testable, while screens get a one-call
 * accessor instead of assembling repositories by hand.
 */

import { getBleManager } from '@ble/BleManagerFacade'
import { BleCaptureService } from '@capture/BleCaptureService'
import { logger, safe } from '@/diagnostics/logger'
import { openDatabase } from '@storage/database'
import { CaptureRepository } from '@storage/repositories/CaptureRepository'
import { DeviceRepository } from '@storage/repositories/DeviceRepository'
import { PunchEventRepository } from '@storage/repositories/PunchEventRepository'

let instance: BleCaptureService | null = null

/** Lazily construct the shared capture service. */
export function getCaptureService(): BleCaptureService {
  if (instance) return instance
  const db = openDatabase()
  instance = new BleCaptureService({
    captures: new CaptureRepository(db),
    punchEvents: new PunchEventRepository(db),
    devices: new DeviceRepository(db),
  })
  return instance
}

/**
 * Open a capture and point the BLE transport's frame-id provider at it, so
 * emitted `RawBleFrame.id`s are unique across app runs rather than restarting
 * at `ephemeral-0` and colliding with previously stored rows.
 */
export function startCapture(label?: string): BleCaptureService {
  const service = getCaptureService()
  const captureId = service.start(label != null ? { label } : {})
  try {
    getBleManager().setCaptureIdProvider(() => service.currentCaptureId() ?? 'ephemeral')
  } catch (err) {
    logger.warn('capture.provider.install.failed', 'could not install capture id provider', {
      error: safe(String(err)),
    })
  }
  logger.info('capture.start', 'capture started', { captureId: safe(captureId) })
  return service
}

/** Flush, close the capture, and revert the transport to ephemeral ids. */
export async function stopCapture(): Promise<void> {
  if (!instance) return
  await instance.stop()
  try {
    getBleManager().setCaptureIdProvider(() => 'ephemeral')
  } catch {
    /* transport already torn down */
  }
}

/** Reset the process-wide handle. Intended for tests. */
export function __resetCaptureServiceForTests(): void {
  instance = null
}
