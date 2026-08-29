/**
 * FightCamp v1 protocol adapter.
 *
 * Plugs the pure {@link decodeFrame} decoder into the app-wide
 * {@link TrackerProtocolAdapter} contract (§12.3). All UUIDs, mode-command
 * bytes, and per-record decoding rules come from hypothesis H11
 * (`docs/protocol/hypotheses.md`), which was confirmed against the
 * decompiled Hykso Android app (v11.35+).
 *
 * Spec references: §4.3 (velocity labels), §11.4 (component boundaries),
 * §12 (protocol adapter + normalized event contract), §15.1 (dependency
 * direction), §16 (protocol registry), §17.1 (data types),
 * §18.2 (initialization plan), §21.1 / §21.2 (versioned adapters).
 *
 * Pure TypeScript. MUST NOT import RN / Expo / SQLite / a BLE library.
 * Only type-only imports from `@ble/bleTypes` and `@/domain/punch/*`
 * are allowed by §15.1.
 */

import type {
  AdvertisementSnapshot,
  GattSnapshot,
  RawBleFrame,
} from '@ble/bleTypes'
import type {
  CommandContext,
  DecodeResult,
  GattOperation,
  InitializationContext,
  ProtocolInspection,
  ProtocolState,
  SessionCommandContext,
  TrackerProtocolAdapter,
} from '@/protocol/TrackerProtocolAdapter'
import {
  CHAR,
  FIGHTCAMP_SERVICE_UUID,
  MODE_COMMAND_1_BYTES,
  MODE_COMMAND_2_BYTES,
  NORDIC_LEGACY_DFU_SERVICE_UUID,
  buildClockSyncBytes,
  bytesToHex,
} from './FightCampV1Commands'
import { DECODER_ID, DECODER_VERSION, decodeFrame } from './FightCampV1Decoder'
import type { FightCampV1State } from './FightCampV1State'

const DEFAULT_FIRMWARE_MAJOR_VERSION = 4

/** Case-insensitive UUID equality. */
const sameUuid = (a: string | undefined, b: string): boolean => {
  if (!a) return false
  return a.toLowerCase() === b.toLowerCase()
}

const findService = (gatt: GattSnapshot, uuid: string) =>
  gatt.services.find((s) => sameUuid(s.uuid, uuid))

const findChar = (gatt: GattSnapshot, charUuid: string) => {
  const svc = findService(gatt, FIGHTCAMP_SERVICE_UUID)
  if (!svc) return undefined
  return svc.characteristics.find((c) => sameUuid(c.uuid, charUuid))
}

/** Single byte → 2-char lowercase hex (no separator). */
const byteToHex = (b: number): string => (b & 0xff).toString(16).padStart(2, '0')

export class FightCampV1Adapter implements TrackerProtocolAdapter {
  readonly id = DECODER_ID
  readonly version = DECODER_VERSION

  scoreAdvertisement(ad: AdvertisementSnapshot): number {
    const uuids = ad.serviceUuids ?? []
    for (const u of uuids) {
      if (sameUuid(u, FIGHTCAMP_SERVICE_UUID)) return 100
    }
    // H01: local name is truncated to 8 chars ("FightCam").
    if (ad.name && ad.name.toLowerCase().startsWith('fightcam')) return 60
    return 0
  }

  inspectGatt(gatt: GattSnapshot): ProtocolInspection {
    const svc = findService(gatt, FIGHTCAMP_SERVICE_UUID)
    if (!svc) {
      return {
        supported: false,
        confidence: 0,
        notes: ['FightCamp custom service not present in GATT snapshot'],
      }
    }

    const notes: string[] = []
    const missing: string[] = []
    if (!findChar(gatt, CHAR.COMMAND1)) missing.push('ca281071 (command-1)')
    if (!findChar(gatt, CHAR.COMMAND2)) missing.push('ca281072 (command-2)')
    if (!findChar(gatt, CHAR.DATA_STREAM)) missing.push('ca281069 (data-stream)')
    if (missing.length > 0) {
      notes.push(`missing expected characteristics: ${missing.join(', ')}`)
    }

    if (findService(gatt, NORDIC_LEGACY_DFU_SERVICE_UUID)) {
      // H06: Nordic Legacy DFU service is exposed by the normal firmware.
      notes.push('Nordic Legacy DFU service present (H06)')
    }

    return {
      supported: true,
      // Deterministic UUID match — the vendor's own SDK uses the same value.
      confidence: 0.95,
      notes,
    }
  }

  buildInitializationPlan(ctx: InitializationContext): GattOperation[] {
    // Order matches Hykso's start-session sequence
    // (`sources/j1/e.java` :g()): clock sync FIRST, then notifications,
    // device-info read, mode-normal, hand assignment, command 17.
    // Without the clock-sync write the tracker stays connected but idle
    // and never emits punch frames (observed 2026-08-22: subscribe
    // count 2, init errors 0, zero notify traffic for the full
    // session). Without the LAST TWO writes the tracker hangs up
    // cleanly on a still glove within minutes, however much other
    // traffic flows (observed 2026-08-29: reads every 20s did not hold
    // it, mode-normal rewrites every 20s did not hold it) — Hykso sends
    // both every session, and its trackers hold indefinitely.
    return [
      {
        kind: 'write',
        serviceUuid: FIGHTCAMP_SERVICE_UUID,
        characteristicUuid: CHAR.CLOCK_SYNC,
        hex: bytesToHex(buildClockSyncBytes(Date.now())),
        withResponse: true,
        label: 'init-clockSync-ca281079',
      },
      {
        kind: 'subscribe',
        serviceUuid: FIGHTCAMP_SERVICE_UUID,
        characteristicUuid: CHAR.DATA_STREAM,
        direction: 'indication',
        label: 'subscribe-dataStream-ca281069',
      },
      {
        kind: 'subscribe',
        serviceUuid: FIGHTCAMP_SERVICE_UUID,
        characteristicUuid: CHAR.NOTIFY_STATUS,
        direction: 'notification',
        label: 'subscribe-notifyStatus-ca281073',
      },
      {
        kind: 'subscribe',
        serviceUuid: FIGHTCAMP_SERVICE_UUID,
        characteristicUuid: CHAR.COMMAND_ACK,
        direction: 'indication',
        label: 'subscribe-commandAck-ca281078',
      },
      {
        kind: 'read',
        serviceUuid: FIGHTCAMP_SERVICE_UUID,
        characteristicUuid: CHAR.DEVICE_INFO_READ,
        label: 'read-deviceInfo-ca281070',
      },
      {
        kind: 'write',
        serviceUuid: FIGHTCAMP_SERVICE_UUID,
        characteristicUuid: CHAR.COMMAND1,
        hex: byteToHex(MODE_COMMAND_1_BYTES.normal),
        withResponse: true,
        label: 'init-mode-normal-ca281071',
      },
      // Hand assignment (`j1/e.java` :g() → C0477c.b(position)):
      // position 1 = right → byte 1, position 2 = left → byte 2. Sent
      // every session by Hykso, right after mode-normal.
      ...(ctx.hand
        ? [
            {
              kind: 'write' as const,
              serviceUuid: FIGHTCAMP_SERVICE_UUID,
              characteristicUuid: CHAR.COMMAND2,
              hex: byteToHex(
                ctx.hand === 'right' ? MODE_COMMAND_2_BYTES.one : MODE_COMMAND_2_BYTES.two,
              ),
              withResponse: true,
              label: `init-handAssign-${ctx.hand}-ca281072`,
            },
          ]
        : []),
      // Command 17 (`this.f.a(17, …)`): unnamed even in Hykso's own
      // debug map, but sent every session immediately after the hand
      // byte — and their trackers hold a still connection indefinitely
      // where ours dropped in minutes.
      {
        kind: 'write',
        serviceUuid: FIGHTCAMP_SERVICE_UUID,
        characteristicUuid: CHAR.COMMAND1,
        hex: byteToHex(MODE_COMMAND_1_BYTES.unnamed17),
        withResponse: true,
        label: 'init-command17-ca281071',
      },
    ]
  }

  decodeFrame(frame: RawBleFrame, state: ProtocolState): DecodeResult {
    // ProtocolState carries firmwareVersion at the app-wide level; the
    // decoder uses firmwareMajorVersion internally. Translate at the
    // boundary so both directions stay consistent.
    const firmwareMajorVersion =
      typeof state.firmwareVersion === 'number'
        ? state.firmwareVersion
        : DEFAULT_FIRMWARE_MAJOR_VERSION
    const decoderState: FightCampV1State = {
      firmwareMajorVersion,
      connectionGeneration: state.connectionGeneration ?? frame.connectionGeneration,
    }

    const result = decodeFrame(frame, decoderState)

    const newState: ProtocolState = {
      ...state,
      firmwareVersion: firmwareMajorVersion,
      connectionGeneration: frame.connectionGeneration,
    }

    return {
      events: result.events,
      newState,
      malformed: result.malformed,
      unknown: result.unknown,
      notes: result.notes,
    }
  }

  buildStartSession(_ctx: SessionCommandContext): GattOperation[] {
    return [
      {
        kind: 'write',
        serviceUuid: FIGHTCAMP_SERVICE_UUID,
        characteristicUuid: CHAR.CLOCK_SYNC,
        hex: bytesToHex(buildClockSyncBytes(Date.now())),
        withResponse: true,
        label: 'startSession-clockSync',
      },
      {
        kind: 'write',
        serviceUuid: FIGHTCAMP_SERVICE_UUID,
        characteristicUuid: CHAR.COMMAND1,
        hex: byteToHex(MODE_COMMAND_1_BYTES.normal),
        withResponse: true,
        label: 'startSession-normal',
      },
    ]
  }

  buildStopSession(_ctx: SessionCommandContext): GattOperation[] {
    return [
      {
        kind: 'write',
        serviceUuid: FIGHTCAMP_SERVICE_UUID,
        characteristicUuid: CHAR.COMMAND1,
        hex: byteToHex(MODE_COMMAND_1_BYTES.idle),
        withResponse: true,
        label: 'stopSession-idle',
      },
    ]
  }

  /**
   * Offline sync is not part of the vendor protocol we've mapped so far
   * (H11 covers command channel + live stream only). Left undefined so the
   * registry can see the capability is absent.
   */
  buildOfflineSync?: undefined = undefined

  buildSleepCommand(_ctx: CommandContext): GattOperation[] {
    return [
      {
        kind: 'write',
        serviceUuid: FIGHTCAMP_SERVICE_UUID,
        characteristicUuid: CHAR.COMMAND1,
        hex: byteToHex(MODE_COMMAND_1_BYTES.shutdown),
        withResponse: true,
        label: 'sleep-shutdown',
      },
    ]
  }
}
