/**
 * The app-wide tracker keepalive — one punch stream per known glove,
 * running for the app's whole life.
 *
 * ## Why this exists (2026-08-29, the "can't hold both gloves" night)
 *
 * A FightCamp v1 tracker hangs up cleanly on a central that connects
 * and then says nothing — observed on-device as both gloves dropping
 * ~60–90s after a landing-screen connect, "clean disconnect (no
 * error)", while the Hykso and FightCamp apps hold the same hardware
 * indefinitely. What those apps do, and the live screen already did,
 * is SPEAK: run the init plan and subscribe to the punch
 * characteristic. So the streams now start the moment a glove
 * connects, wherever in the app that happens, and the tracker always
 * has a talking central.
 *
 * ## One stream per device, ever
 *
 * The live screen ATTACHES to this source (see `useLivePunchSource`)
 * instead of building its own. Two monitors on one characteristic
 * would double-deliver frames into the facade's persistence sink and
 * re-run the init plan mid-session — the single shared source is what
 * makes the frame log trustworthy.
 *
 * The source's own connection watch does the lifecycle work: a slot
 * arms when its device comes live, disarms when it drops, and re-arms
 * on reconnect. This module only builds it and starts it once.
 */
import { getBleManager } from '@ble/BleManagerFacade'
import { KNOWN_TRACKERS } from '@ble/knownTrackers'
import { deviceSensitive, logger, safe } from '@diagnostics/logger'

// Side-effect import — registers the FightCamp v1 adapter with the
// singleton registry (§16) before it is queried below.
import './fightcamp-v1'
import { CHAR, FIGHTCAMP_SERVICE_UUID } from './fightcamp-v1/FightCampV1Commands'
import { getProtocolRegistry } from './ProtocolRegistry'
import { TrackerPunchEventSource, type TrackerSlotBinding } from './TrackerPunchEventSource'

const FIGHTCAMP_V1_ID = 'fightcamp-v1'

/**
 * Heartbeat cadence and payload. An armed stream alone was not enough
 * (the glove hung up ~2min after connect+init while still), and
 * neither were periodic device-info READS (it outlived the bare
 * timeout but still hung up ~3-5min in) — the firmware's idle timer
 * evidently wants inbound WRITES, the traffic a session actually
 * produces. So the pulse is a re-assertion of mode-normal: the same
 * single 0x01 byte to COMMAND1 the init plan sends, idempotent, with
 * no timestamp semantics (unlike a clock re-sync, which would skew
 * the stream's epoch mid-workout). A known characteristic our init
 * already writes — rule 4 intact. 20s gives several beats per
 * observed timeout window.
 */
const HEARTBEAT_INTERVAL_MS = 20_000
const MODE_NORMAL_BASE64 = 'AQ=='

/**
 * Standard BLE Battery Service, which the trackers expose — Hykso's
 * session reads and subscribes it for its battery display
 * (`j1/g.java`: 0x180F / 0x2A19, one byte = percent).
 */
const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb'
const BATTERY_LEVEL_UUID = '00002a19-0000-1000-8000-00805f9b34fb'

export type KeepaliveBatteryListener = (hand: 'left' | 'right', batteryPct: number) => void

let source: TrackerPunchEventSource | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null
const batteryListeners = new Set<KeepaliveBatteryListener>()
const lastBatteryPct = new Map<string, number>()

/**
 * Hear battery levels as the heartbeat reads them. App-side wiring
 * (the tracker store) subscribes here rather than this module writing
 * state directly — protocol stays below the app tier.
 */
export function onKeepaliveBattery(listener: KeepaliveBatteryListener): () => void {
  batteryListeners.add(listener)
  return () => {
    batteryListeners.delete(listener)
  }
}

async function heartbeatTick(): Promise<void> {
  const facade = getBleManager()
  for (const tracker of KNOWN_TRACKERS) {
    try {
      if (!(await facade.isConnected(tracker.address))) continue
      const result = await facade.writeCharacteristic(
        tracker.address,
        FIGHTCAMP_SERVICE_UUID,
        CHAR.COMMAND1,
        { base64: MODE_NORMAL_BASE64 },
        true,
      )
      if (!result.success) {
        logger.warn('keepalive.heartbeat.writeFailed', 'heartbeat write reported failure', {
          deviceId: deviceSensitive(tracker.address),
          errorMessage: safe(result.errorMessage ?? 'unknown'),
        })
      }
      // Battery rides the same beat: one 0x2A19 read per glove. Logged
      // only on change — the level moves far slower than the beat.
      const battery = await facade.readCharacteristic(
        tracker.address,
        BATTERY_SERVICE_UUID,
        BATTERY_LEVEL_UUID,
      )
      if (battery.success && battery.valueHex) {
        const pct = Number.parseInt(battery.valueHex.slice(0, 2), 16)
        if (Number.isFinite(pct) && pct >= 0 && pct <= 100) {
          if (lastBatteryPct.get(tracker.address) !== pct) {
            lastBatteryPct.set(tracker.address, pct)
            logger.info('keepalive.battery', 'glove battery level', {
              hand: safe(tracker.hand),
              pct: safe(pct),
            })
          }
          for (const listener of batteryListeners) {
            try {
              listener(tracker.hand, pct)
            } catch {
              // Listener errors must not break the beat.
            }
          }
        }
      }
    } catch (err) {
      logger.warn('keepalive.heartbeat.error', 'heartbeat tick threw', {
        deviceId: deviceSensitive(tracker.address),
        errorMessage: safe(err instanceof Error ? err.message : String(err)),
      })
    }
  }
}

/**
 * Build and start the keepalive source. Idempotent; called once at
 * launch. Failure is survivable — without a keepalive the app behaves
 * exactly as before this module existed (gloves drop when idle).
 */
export function startTrackerKeepalive(): void {
  if (source) return
  const adapter = getProtocolRegistry()
    .list()
    .find((a) => a.id === FIGHTCAMP_V1_ID)
  if (!adapter) {
    logger.warn('keepalive.adapter.missing', 'no FightCamp v1 adapter; keepalive not started', {})
    return
  }
  try {
    const slots: { left?: TrackerSlotBinding; right?: TrackerSlotBinding } = {}
    for (const tracker of KNOWN_TRACKERS) {
      slots[tracker.hand] = { deviceId: tracker.address }
    }
    const built = new TrackerPunchEventSource({ facade: getBleManager(), adapter, slots })
    built.start()
    source = built
    heartbeat = setInterval(() => {
      void heartbeatTick()
    }, HEARTBEAT_INTERVAL_MS)
    logger.info('keepalive.started', 'tracker keepalive armed for known gloves', {
      slots: safe(Object.keys(slots).length),
      heartbeatMs: safe(HEARTBEAT_INTERVAL_MS),
    })
  } catch (err) {
    logger.warn('keepalive.start.failed', 'tracker keepalive could not start', {
      errorMessage: safe(err instanceof Error ? err.message : String(err)),
    })
  }
}

/** The shared source, or null when keepalive never started (tests). */
export function getTrackerKeepaliveSource(): TrackerPunchEventSource | null {
  return source
}

/** Test seam — the singleton outlives a render. */
export function __resetTrackerKeepaliveForTests(): void {
  if (heartbeat !== null) {
    clearInterval(heartbeat)
    heartbeat = null
  }
  batteryListeners.clear()
  lastBatteryPct.clear()
  source?.stop()
  source = null
}
