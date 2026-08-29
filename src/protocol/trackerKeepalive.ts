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
 * Heartbeat cadence. An armed stream alone was not enough: on-device
 * the right glove still hung up cleanly a couple of minutes after
 * connect+init while lying still — the firmware's idle timer counts
 * traffic, and a still glove sends none. Punches defer it during a
 * workout; between workouts this periodic READ of the device-info
 * characteristic (a read the init plan already performs; no write, so
 * rule 4 is untouched) is the app's pulse. 20s gives several beats per
 * observed timeout window.
 */
const HEARTBEAT_INTERVAL_MS = 20_000

let source: TrackerPunchEventSource | null = null
let heartbeat: ReturnType<typeof setInterval> | null = null

async function heartbeatTick(): Promise<void> {
  const facade = getBleManager()
  for (const tracker of KNOWN_TRACKERS) {
    try {
      if (!(await facade.isConnected(tracker.address))) continue
      const result = await facade.readCharacteristic(
        tracker.address,
        FIGHTCAMP_SERVICE_UUID,
        CHAR.DEVICE_INFO_READ,
      )
      if (!result.success) {
        logger.warn('keepalive.heartbeat.readFailed', 'heartbeat read reported failure', {
          deviceId: deviceSensitive(tracker.address),
          errorMessage: safe(result.errorMessage ?? 'unknown'),
        })
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
  source?.stop()
  source = null
}
