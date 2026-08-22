/**
 * BleManagerFacade — the ONLY BLE surface the rest of the application
 * depends on. Concrete implementations live alongside this file (e.g.
 * BleManagerBlePlxImpl) and are selected by a small factory. Swapping the
 * underlying library — @sfourdrinier/react-native-ble-plx today; the
 * fallback matrix from docs/sprint-1.md — must not require any change
 * outside src/ble/.
 *
 * Nothing in this file may import from src/domain, src/app, src/components,
 * or from a specific BLE library. Type-only imports are fine.
 *
 * Spec: §11.4, §11.5, §11.8, §11.9, §12.4, §15.1.
 */
import type {
  AdvertisementSnapshot,
  ConnectionStatus,
  GattSnapshot,
  RawBleFrame,
  ReadResult,
  SubscriptionResult,
  WriteResult,
} from './bleTypes'

export type UnsubscribeFn = () => void

/**
 * Handle for a live notify/indicate subscription. `result` is the pass/fail
 * report for the subscription setup (success MUST NOT be true unless the
 * underlying library confirmed the CCCD write / native subscription — the
 * absence of a frame is NOT a success signal, only the absence of an error is).
 */
export interface SubscriptionHandle {
  /** Initial result populated at setup time. May be mutated when
   * the underlying subscription's first callback reveals a CCCD-write error;
   * consumers that need to be certain should await `setupOutcome`. */
  result: SubscriptionResult
  /**
   * Resolves with the definitive SubscriptionResult after the underlying
   * library's first callback fires (or after a short settling window if the
   * channel is quiet). success is true ONLY if the first callback did not
   * carry an error. This is how consumers detect a silently-failed CCCD write.
   */
  setupOutcome: Promise<SubscriptionResult>
  unsubscribe: UnsubscribeFn
}

export interface ScanOptions {
  /** Maximum time to scan, in milliseconds. Default 12_000. Bounded per §11.6. */
  timeoutMs?: number
  /** Optional service UUID filter — leave empty during discovery mode (§11.6). */
  serviceUuids?: string[]
  /** Stop scanning once this many distinct devices have advertised. */
  stopAfterDevices?: number
}

export interface ConnectOptions {
  /** Timeout for the connect call itself. Default 15_000. */
  timeoutMs?: number
  /** Request the maximum negotiable MTU after connect. */
  requestMtu?: number
}

export interface BleManagerFacade {
  /** True once the underlying manager reports powered-on Bluetooth. */
  isReady(): Promise<boolean>

  /** Subscribe to Bluetooth adapter state changes. */
  onAdapterStateChange(cb: (state: 'unknown' | 'off' | 'on' | 'unauthorized') => void): UnsubscribeFn

  /** Bounded scan; each advertisement is delivered to onAdvertisement. */
  scan(options: ScanOptions, onAdvertisement: (ad: AdvertisementSnapshot) => void): Promise<void>

  /** Stop any in-flight scan immediately. */
  stopScan(): Promise<void>

  connect(deviceId: string, options?: ConnectOptions): Promise<ConnectionStatus>
  disconnect(deviceId: string): Promise<void>

  /** Subscribe to per-device connection-state transitions (§11.5). */
  onConnectionChange(deviceId: string, cb: (status: ConnectionStatus) => void): UnsubscribeFn

  discoverAllServicesAndCharacteristics(deviceId: string): Promise<GattSnapshot>

  /**
   * Subscribe to a single notify/indicate characteristic. `onFrame` receives
   * a persistence-ready RawBleFrame (§12.4) with a monotonic timestamp
   * stamped at the earliest possible moment inside the native callback.
   * The returned handle carries an `unsubscribe()` that MUST be called by
   * the caller when it is done listening — component unmount, spike reset,
   * or session teardown. This is the only way to stop the native callback
   * short of destroy()ing the whole facade.
   */
  monitorCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    onFrame: (frame: RawBleFrame) => void,
  ): Promise<SubscriptionHandle>

  /**
   * Convenience: subscribe to every notify/indicate characteristic in the
   * provided snapshot. Returns a per-characteristic SubscriptionHandle list.
   */
  monitorAllNotifiable(
    snapshot: GattSnapshot,
    onFrame: (frame: RawBleFrame) => void,
  ): Promise<SubscriptionHandle[]>

  /**
   * Write a value to a characteristic. Exactly one of `base64` or `hex` must
   * be provided on the payload. `withResponse=true` uses the acknowledged
   * write path; false uses write-without-response. The returned WriteResult
   * carries `durationMs` measured with performance.now() around the underlying
   * library call. Errors are reported via `success=false` + `errorMessage`,
   * NOT thrown — the probe UI needs the timing either way.
   */
  writeCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    payload: { base64?: string; hex?: string },
    withResponse: boolean,
  ): Promise<WriteResult>

  /**
   * Read a characteristic's current value. Returns both base64 and hex
   * encodings in the ReadResult, plus the round-trip `durationMs`. Errors
   * are reported via `success=false` + `errorMessage`, NOT thrown.
   */
  readCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
  ): Promise<ReadResult>

  /** Release all resources; safe to call multiple times. */
  destroy(): Promise<void>
}

// Concrete implementations register themselves through this factory so that
// the rest of the app never imports a library directly. The actual singleton
// instance is created lazily on first use in src/ble/index.ts. `destroy()`
// on a concrete impl must call `resetBleManagerSingleton()` so the next
// getBleManager() call constructs a fresh instance with fresh listeners.
export type BleManagerFactory = () => BleManagerFacade
let currentFactory: BleManagerFactory | null = null
export function registerBleManagerFactory(factory: BleManagerFactory): void {
  currentFactory = factory
}
let cached: BleManagerFacade | null = null
export function getBleManager(): BleManagerFacade {
  if (!currentFactory) {
    throw new Error('No BleManagerFactory registered — call registerBleManagerFactory during app bootstrap.')
  }
  if (!cached) cached = currentFactory()
  return cached
}

/** Invalidate the cached facade. Called from destroy() implementations. */
export function resetBleManagerSingleton(): void {
  cached = null
}
