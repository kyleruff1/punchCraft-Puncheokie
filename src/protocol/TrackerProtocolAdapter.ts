/**
 * Tracker protocol adapter contract (spec §12.3).
 *
 * An adapter is a pure, versioned decoder for one tracker protocol family
 * (e.g. FightCamp v1). It scores advertisements, inspects GATT, plans the
 * initialization writes, and decodes raw notification frames into
 * normalized punch events. Adapters MUST NOT perform I/O — the BLE facade
 * executes the GattOperation plans they return.
 *
 * Pure TypeScript. No RN / Expo / SQLite / BLE-library imports.
 * Type-only imports from '@ble/bleTypes' are permitted per §15.1.
 */

import type {
  AdvertisementSnapshot,
  GattSnapshot,
  RawBleFrame,
} from '@ble/bleTypes'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'

export interface ProtocolInspection {
  supported: boolean
  confidence: number
  notes?: string[]
}

export interface InitializationContext {
  deviceId: string
  snapshot: GattSnapshot
}

export interface SessionCommandContext {
  deviceId: string
}

export interface SyncContext {
  deviceId: string
  lastKnownSequence?: number
}

export interface CommandContext {
  deviceId: string
}

export interface GattOperation {
  kind: 'write' | 'read' | 'subscribe'
  serviceUuid: string
  characteristicUuid: string
  /** Payload for write operations — exactly one of base64 / hex. */
  base64?: string
  hex?: string
  /** For write operations: whether to use write-with-response (true, default) or write-without-response. */
  withResponse?: boolean
  /** For subscribe operations: whether the characteristic advertises notify vs indicate. */
  direction?: 'notification' | 'indication'
  /** Human-readable label for logs and the operation queue. */
  label?: string
}

export interface ProtocolState {
  firmwareVersion?: number
  connectionGeneration: number
  extras?: Record<string, unknown>
}

export interface DecodeResult {
  events: TrackerPunchEvent[]
  newState: ProtocolState
  unknown?: boolean
  malformed?: boolean
  notes?: string[]
}

export interface TrackerProtocolAdapter {
  readonly id: string
  readonly version: string
  scoreAdvertisement(ad: AdvertisementSnapshot): number
  inspectGatt(gatt: GattSnapshot): ProtocolInspection
  buildInitializationPlan(ctx: InitializationContext): GattOperation[]
  decodeFrame(frame: RawBleFrame, state: ProtocolState): DecodeResult
  buildStartSession?(ctx: SessionCommandContext): GattOperation[]
  buildStopSession?(ctx: SessionCommandContext): GattOperation[]
  buildOfflineSync?(ctx: SyncContext): GattOperation[]
  buildSleepCommand?(ctx: CommandContext): GattOperation[]
}
