/**
 * TrackerScanner — bounded scan wrapper.
 *
 * Consumes only the BleManagerFacade surface (§11.4, §15.1). Accumulates
 * advertisements delivered during a bounded scan window and returns them
 * deduplicated by deviceId. On duplicates, keeps the LATEST rssi,
 * monotonicTimeMs, wallTimeIso, and serviceUuids, and merges manufacturer
 * data when the newer frame omits it.
 */
import type { BleManagerFacade, ScanOptions } from './BleManagerFacade'
import type { AdvertisementSnapshot } from './bleTypes'

export interface TrackerScannerRunOptions {
  timeoutMs?: number
  serviceUuids?: string[]
  stopAfterDevices?: number
}

const DEFAULT_TIMEOUT_MS = 12_000

export class TrackerScanner {
  constructor(private readonly facade: BleManagerFacade) {}

  async run(options: TrackerScannerRunOptions): Promise<AdvertisementSnapshot[]> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const stopAfterDevices = options.stopAfterDevices
    const byDevice = new Map<string, AdvertisementSnapshot>()

    let stopped = false
    const requestStop = (): void => {
      if (stopped) return
      stopped = true
      // Fire-and-forget: causes the in-flight scan() promise to resolve.
      void this.facade.stopScan().catch(() => {
        // Idempotent; swallow.
      })
    }

    const onAdvertisement = (ad: AdvertisementSnapshot): void => {
      const prev = byDevice.get(ad.deviceId)
      if (prev) {
        const merged: AdvertisementSnapshot = {
          deviceId: ad.deviceId,
          name: ad.name ?? prev.name,
          rssi: ad.rssi ?? prev.rssi,
          serviceUuids:
            ad.serviceUuids && ad.serviceUuids.length > 0 ? ad.serviceUuids : prev.serviceUuids,
          manufacturerDataBase64: ad.manufacturerDataBase64 ?? prev.manufacturerDataBase64,
          monotonicTimeMs: ad.monotonicTimeMs,
          wallTimeIso: ad.wallTimeIso,
        }
        byDevice.set(ad.deviceId, merged)
      } else {
        byDevice.set(ad.deviceId, ad)
      }
      if (stopAfterDevices !== undefined && byDevice.size >= stopAfterDevices) {
        requestStop()
      }
    }

    const scanOptions: ScanOptions = {
      timeoutMs,
      serviceUuids: options.serviceUuids,
      stopAfterDevices,
    }

    const timeoutHandle = setTimeout(requestStop, timeoutMs)

    // Kick off scan WITHOUT awaiting — it resolves when the scan actually
    // terminates (either on its own, or because we called stopScan()).
    const scanPromise = this.facade.scan(scanOptions, onAdvertisement)

    try {
      await scanPromise
    } catch {
      // A failed scan yields an empty result rather than propagating.
      clearTimeout(timeoutHandle)
      try {
        await this.facade.stopScan()
      } catch {
        // Idempotent; swallow.
      }
      return []
    }

    clearTimeout(timeoutHandle)
    try {
      await this.facade.stopScan()
    } catch {
      // Idempotent; swallow.
    }

    return Array.from(byDevice.values()).sort(
      (a, b) => b.monotonicTimeMs - a.monotonicTimeMs,
    )
  }
}
