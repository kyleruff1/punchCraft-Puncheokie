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

  // Installing the sink on the TRANSPORT means every frame is persisted
  // before it reaches any subscriber, so the Live decode screen, the protocol
  // probe and the BLE spike are all covered without opting in.
  //
  // This THROWS on failure rather than warning. A capture whose sink was never
  // installed records nothing while still reporting itself as started — the
  // caller would believe it was capturing and it would not be. Better to fail
  // the open: callers already degrade gracefully and tell the user that frames
  // are not being persisted.
  try {
    const ble = getBleManager()
    ble.setCaptureIdProvider(() => service.currentCaptureId() ?? 'ephemeral')
    ble.setFrameSink(service)
  } catch (err) {
    logger.error('capture.sink.install.failed', 'transport sink not installed — capture would record nothing', {
      captureId: safe(captureId),
      error: safe(String(err)),
    })
    void stopCapture()
    throw err
  }

  logger.info('capture.start', 'capture started', { captureId: safe(captureId) })
  return service
}

/** Flush, close the capture, and revert the transport to ephemeral ids. */
export async function stopCapture(): Promise<void> {
  if (!instance) return
  await instance.stop()
  try {
    const ble = getBleManager()
    ble.setCaptureIdProvider(() => 'ephemeral')
    ble.setFrameSink(null)
  } catch {
    /* transport already torn down */
  }
}

/** Reset the process-wide handle. Intended for tests. */
export function __resetCaptureServiceForTests(): void {
  instance = null
}
