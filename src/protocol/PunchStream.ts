/**
 * PunchStream — orchestrates a single tracker's live decode pipeline.
 *
 * Given a BleManagerFacade, a deviceId, a TrackerProtocolAdapter, and the
 * caller's hand assignment, this module:
 *   1. Snapshots GATT via the facade (needed for the adapter's plan context).
 *   2. Walks adapter.buildInitializationPlan in order, executing
 *      reads / writes / subscribes through the facade.
 *   3. Every raw notify frame is stamped with the caller-supplied hand and
 *      fed to adapter.decodeFrame BEFORE anything else parses it (§11.9, §12.4).
 *      Emitted TrackerPunchEvents are forwarded to onEvent; malformed/unknown
 *      frames and decoder notes flow through onDecodeMeta.
 *
 * Pure TypeScript. No RN / Expo / SQLite / BLE-library imports. This module
 * lives under src/protocol/ and is covered by the terminology guard's DIR
 * allowlist — velocity here stays 'tracker-unit' (§4.3).
 */

import type { BleManagerFacade, SubscriptionHandle } from '@ble/BleManagerFacade'
import type { Hand, RawBleFrame } from '@ble/bleTypes'
import type {
  GattOperation,
  ProtocolState,
  TrackerProtocolAdapter,
} from '@protocol/TrackerProtocolAdapter'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'
import type { CaptureSink } from '@capture/CaptureSink'
import { deviceSensitive, logger, safe } from '@diagnostics/logger'

export interface PunchStreamOptions {
  facade: BleManagerFacade
  deviceId: string
  adapter: TrackerProtocolAdapter
  hand: 'left' | 'right'
  onEvent: (event: TrackerPunchEvent) => void
  onDecodeMeta?: (meta: {
    frameId: string
    malformed?: boolean
    unknown?: boolean
    notes?: string[]
  }) => void
  /**
   * Durable sink for raw frames. Every frame is handed to `sink.capture()`
   * BEFORE the adapter parses it, so a malformed payload is already stored
   * by the time the decoder rejects it (CLAUDE.md §1, §11.9, §12.4).
   *
   * Optional only so that unit tests and the replay harness can run without
   * a database; in the app this should always be a real BleCaptureService.
   * When omitted, frames are decoded but NOT retained.
   */
  sink?: CaptureSink
  /** Optional durable sink for decoded events. */
  onEventPersist?: (event: TrackerPunchEvent) => void
}

export interface PunchStreamController {
  stop(): Promise<void>
  getState(): {
    subscribedCount: number
    subscribedChars: string[]
    initErrors: string[]
    deviceInfo: Record<string, string>
  }
}

export async function startPunchStream(
  opts: PunchStreamOptions,
): Promise<PunchStreamController> {
  const { facade, deviceId, adapter, hand, onEvent, onDecodeMeta, sink, onEventPersist } = opts

  const handles: SubscriptionHandle[] = []
  const subscribedChars: string[] = []
  const initErrors: string[] = []
  const deviceInfo: Record<string, string> = {}

  let state: ProtocolState = { connectionGeneration: 0 }

  const onFrame = (frame: RawBleFrame): void => {
    const stampedFrame: RawBleFrame = { ...frame, handAtCapture: hand as Hand }

    // PERSIST BEFORE PARSE (CLAUDE.md §1, spec §11.9 / §12.4). This must stay
    // the first thing that touches the frame, and must stay outside the
    // try/catch below — a decoder throw can never be allowed to skip it, and
    // the sink's own contract is that it does not throw.
    sink?.capture(stampedFrame)

    try {
      const result = adapter.decodeFrame(stampedFrame, state)
      for (const ev of result.events) {
        onEventPersist?.(ev)
        onEvent(ev)
      }
      if (onDecodeMeta && (result.malformed || result.unknown || result.notes)) {
        onDecodeMeta({
          frameId: frame.id,
          malformed: result.malformed,
          unknown: result.unknown,
          notes: result.notes,
        })
      }
      state = result.newState
    } catch (err) {
      logger.error('punchstream.decode.error', 'adapter.decodeFrame threw', {
        deviceId: deviceSensitive(deviceId),
        adapterId: safe(adapter.id),
        characteristicUuid: safe(frame.characteristicUuid),
        errorMessage: safe(err instanceof Error ? err.message : String(err)),
      })
    }
  }

  // `stopped` is a shared flag between the plan loop and the returned
  // controller.stop(). After every await inside the plan loop we re-check
  // it; if stop() fired mid-await we tear down whatever we've built so
  // far and bail without leaking native subscriptions.
  let stopped = false
  const teardownHandles = (): void => {
    for (const h of handles) {
      try {
        h.unsubscribe()
      } catch (err) {
        logger.warn('punchstream.unsubscribe.error', 'unsubscribe threw', {
          deviceId: deviceSensitive(deviceId),
          errorMessage: safe(err instanceof Error ? err.message : String(err)),
        })
      }
    }
    handles.length = 0
  }

  let plan: GattOperation[] = []
  try {
    const snapshot = await facade.discoverAllServicesAndCharacteristics(deviceId)
    if (stopped) {
      return buildController()
    }
    plan = adapter.buildInitializationPlan({ deviceId, snapshot })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    initErrors.push(`discover: ${message}`)
    logger.error('punchstream.discover.error', 'failed to snapshot GATT', {
      deviceId: deviceSensitive(deviceId),
      errorMessage: safe(message),
    })
    return buildController()
  }

  for (const op of plan) {
    if (stopped) break
    try {
      if (op.kind === 'subscribe') {
        const handle = await facade.monitorCharacteristic(
          deviceId,
          op.serviceUuid,
          op.characteristicUuid,
          onFrame,
        )
        if (stopped) {
          // Cleanup race: stop() fired while the CCCD write was in flight.
          // Do NOT push into handles (teardown already ran or is about to).
          try { handle.unsubscribe() } catch { /* best-effort */ }
          break
        }
        handles.push(handle)
        subscribedChars.push(op.characteristicUuid)
        // Await the DEFINITIVE setup outcome (facade contract, BleManagerFacade.ts §32-44):
        // handle.result may be optimistically true; setupOutcome resolves
        // after the underlying library confirms the CCCD write (or a short
        // quiet window). Silent failures show up here, not on the sync result.
        try {
          const outcome = await handle.setupOutcome
          if (stopped) {
            try { handle.unsubscribe() } catch { /* best-effort */ }
            break
          }
          if (!outcome.success) {
            const msg = outcome.errorMessage ?? 'unknown subscribe error'
            initErrors.push(`subscribe ${op.characteristicUuid}: ${msg}`)
            logger.warn('punchstream.subscribe.failed', 'subscribe reported failure via setupOutcome', {
              deviceId: deviceSensitive(deviceId),
              characteristicUuid: safe(op.characteristicUuid),
              errorMessage: safe(msg),
            })
          }
        } catch (outcomeErr) {
          const msg = outcomeErr instanceof Error ? outcomeErr.message : String(outcomeErr)
          initErrors.push(`subscribe ${op.characteristicUuid}: setupOutcome ${msg}`)
        }
      } else if (op.kind === 'read') {
        const result = await facade.readCharacteristic(
          deviceId,
          op.serviceUuid,
          op.characteristicUuid,
        )
        if (stopped) break
        if (result.success && result.valueHex) {
          deviceInfo[op.characteristicUuid] = result.valueHex
        } else if (!result.success) {
          const msg = result.errorMessage ?? 'unknown read error'
          initErrors.push(`read ${op.characteristicUuid}: ${msg}`)
          logger.warn('punchstream.read.failed', 'read reported failure', {
            deviceId: deviceSensitive(deviceId),
            characteristicUuid: safe(op.characteristicUuid),
            errorMessage: safe(msg),
          })
        }
      } else if (op.kind === 'write') {
        const result = await facade.writeCharacteristic(
          deviceId,
          op.serviceUuid,
          op.characteristicUuid,
          { hex: op.hex, base64: op.base64 },
          op.withResponse ?? true,
        )
        if (stopped) break
        if (!result.success) {
          const msg = result.errorMessage ?? 'unknown write error'
          initErrors.push(`write ${op.characteristicUuid}: ${msg}`)
          logger.warn('punchstream.write.failed', 'write reported failure', {
            deviceId: deviceSensitive(deviceId),
            characteristicUuid: safe(op.characteristicUuid),
            label: safe(op.label),
            errorMessage: safe(msg),
          })
        } else {
          logger.info('punchstream.write.ok', 'init write completed', {
            deviceId: deviceSensitive(deviceId),
            characteristicUuid: safe(op.characteristicUuid),
            label: safe(op.label),
            durationMs: safe(result.durationMs),
          })
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      initErrors.push(`${op.kind} ${op.characteristicUuid}: ${message}`)
      logger.error('punchstream.op.error', 'plan operation threw', {
        deviceId: deviceSensitive(deviceId),
        kind: safe(op.kind),
        characteristicUuid: safe(op.characteristicUuid),
        errorMessage: safe(message),
      })
    }
  }

  return buildController()

  function buildController(): PunchStreamController {
    return {
      async stop(): Promise<void> {
        stopped = true
        teardownHandles()
      },
      getState() {
        return {
          subscribedCount: handles.length,
          subscribedChars: [...subscribedChars],
          initErrors: [...initErrors],
          deviceInfo: { ...deviceInfo },
        }
      },
    }
  }
}
