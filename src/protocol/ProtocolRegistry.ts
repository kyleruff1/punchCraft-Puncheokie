/**
 * ProtocolRegistry — holds the set of TrackerProtocolAdapter implementations
 * available at runtime and picks the best match for an advertisement or a
 * discovered GATT snapshot.
 *
 * Pure TypeScript. No RN / Expo / SQLite / BLE-library imports.
 */

import type { AdvertisementSnapshot, GattSnapshot } from '@ble/bleTypes'
import type { TrackerProtocolAdapter } from './TrackerProtocolAdapter'

/**
 * Compare two dotted version strings (e.g. '1.10.0' vs '1.2.0'). Returns a
 * positive number if `a` is newer, negative if older, zero if equal. Missing
 * segments are treated as zero; non-numeric segments compare lexically.
 */
const compareVersions = (a: string, b: string): number => {
  const partsA = a.split('.')
  const partsB = b.split('.')
  const len = Math.max(partsA.length, partsB.length)
  for (let i = 0; i < len; i += 1) {
    const rawA = partsA[i] ?? '0'
    const rawB = partsB[i] ?? '0'
    const numA = Number(rawA)
    const numB = Number(rawB)
    if (Number.isFinite(numA) && Number.isFinite(numB)) {
      if (numA !== numB) return numA - numB
    } else {
      if (rawA < rawB) return -1
      if (rawA > rawB) return 1
    }
  }
  return 0
}

export class ProtocolRegistry {
  private readonly adapters: TrackerProtocolAdapter[] = []

  register(adapter: TrackerProtocolAdapter): void {
    const existingIndex = this.adapters.findIndex(
      (a) => a.id === adapter.id && a.version === adapter.version,
    )
    if (existingIndex >= 0) {
      this.adapters[existingIndex] = adapter
      return
    }
    this.adapters.push(adapter)
  }

  list(): readonly TrackerProtocolAdapter[] {
    return this.adapters
  }

  pickForAdvertisement(ad: AdvertisementSnapshot): TrackerProtocolAdapter | null {
    let best: TrackerProtocolAdapter | null = null
    let bestScore = 0
    for (const adapter of this.adapters) {
      const score = adapter.scoreAdvertisement(ad)
      if (score <= 0) continue
      if (best === null || score > bestScore) {
        best = adapter
        bestScore = score
        continue
      }
      if (score === bestScore && compareVersions(adapter.version, best.version) > 0) {
        best = adapter
      }
    }
    return best
  }

  pickForGatt(snapshot: GattSnapshot): TrackerProtocolAdapter | null {
    let best: TrackerProtocolAdapter | null = null
    let bestConfidence = -1
    for (const adapter of this.adapters) {
      const inspection = adapter.inspectGatt(snapshot)
      if (!inspection.supported) continue
      const confidence = inspection.confidence
      if (best === null || confidence > bestConfidence) {
        best = adapter
        bestConfidence = confidence
        continue
      }
      if (
        confidence === bestConfidence &&
        compareVersions(adapter.version, best.version) > 0
      ) {
        best = adapter
      }
    }
    return best
  }
}

let singleton: ProtocolRegistry | null = null

export const getProtocolRegistry = (): ProtocolRegistry => {
  if (singleton === null) {
    singleton = new ProtocolRegistry()
  }
  return singleton
}
