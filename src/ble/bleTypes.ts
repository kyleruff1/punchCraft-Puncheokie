/**
 * Transport-agnostic BLE types.
 *
 * The facade interface (BleManagerFacade) plus these types are the ONLY BLE
 * surface the rest of the app depends on. Swapping the underlying library
 * (@sfourdrinier/react-native-ble-plx today; react-native-ble-manager or
 * upstream react-native-ble-plx as fallbacks per the Story 1 spike) must be
 * possible without touching any file outside src/ble/.
 *
 * Spec references: §11.4 (component boundaries), §11.5 (state machine),
 * §11.7 (device identity), §12.4 (RawBleFrame), §15.1 (dependency direction).
 */

export type Hand = 'left' | 'right' | 'unknown'

export interface AdvertisementSnapshot {
  /** Library-visible device id (typically the Android address). */
  deviceId: string
  /** Advertised local name if present. */
  name?: string
  /** RSSI at receive time. */
  rssi?: number
  /** Advertised service UUIDs, lower-case, hyphenated form. */
  serviceUuids: string[]
  /** Manufacturer-specific data as base64. */
  manufacturerDataBase64?: string
  /** Monotonic timestamp at receive. */
  monotonicTimeMs: number
  /** Wall-clock timestamp at receive (ISO-8601). */
  wallTimeIso: string
}

export interface GattCharacteristicSnapshot {
  uuid: string
  properties: {
    read: boolean
    write: boolean
    writeWithoutResponse: boolean
    notify: boolean
    indicate: boolean
  }
  descriptors: Array<{ uuid: string }>
}

export interface GattServiceSnapshot {
  uuid: string
  characteristics: GattCharacteristicSnapshot[]
}

export interface GattSnapshot {
  deviceId: string
  services: GattServiceSnapshot[]
  discoveredAtMonotonicMs: number
}

export type ConnectionState =
  | 'dormant'
  | 'scanning'
  | 'discovered'
  | 'connecting'
  | 'bonding'
  | 'discovering'
  | 'initializing'
  | 'ready'
  | 'streaming'
  | 'recovering'
  | 'error'

export interface ConnectionStatus {
  deviceId: string
  state: ConnectionState
  /** Increments every time a connection is (re-)established (§11.5). */
  generation: number
  errorMessage?: string
  lastChangeMonotonicMs: number
}

export type BleDirection = 'notification' | 'indication' | 'read' | 'write'

export interface RawBleFrame {
  id: string
  captureId: string
  deviceId: string
  handAtCapture: Hand
  monotonicTimeMs: number
  wallTimeIso: string
  direction: BleDirection
  serviceUuid: string
  characteristicUuid: string
  valueBase64: string
  valueHex: string
  rssi?: number
  connectionGeneration: number
}

/** Result of subscribing to a single notify/indicate characteristic. */
export interface SubscriptionResult {
  serviceUuid: string
  characteristicUuid: string
  direction: 'notification' | 'indication'
  success: boolean
  errorMessage?: string
}

/** Aggregated pass/fail report for the Story 1 spike. */
export interface SpikeReport {
  runId: string
  stackLabel: string
  scan: { ok: boolean; devicesFound: number; durationMs: number; errorMessage?: string }
  connect: { ok: boolean; deviceId?: string; durationMs: number; errorMessage?: string }
  discover: { ok: boolean; serviceCount: number; characteristicCount: number; durationMs: number; errorMessage?: string }
  subscribe: {
    ok: boolean
    subscribed: number
    firstFrameWithinMs?: number
    subscriptions: SubscriptionResult[]
    errorMessage?: string
  }
  startedAtIso: string
  finishedAtIso?: string
}
