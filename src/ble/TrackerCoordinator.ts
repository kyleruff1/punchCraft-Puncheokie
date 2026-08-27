/**
 * TrackerCoordinator — orchestrates the two tracker slots (left / right).
 *
 * Consumes ONLY the BleManagerFacade surface (§11.4, §15.1) and drives the
 * useTrackerStore in reaction to facade events. Owns per-slot cleanup for
 * the onConnectionChange subscriptions so disconnectSlot() leaves nothing
 * dangling.
 *
 * Terminology note (§0): if this coordinator ever surfaces a per-punch value
 * it is a "tracker-reported velocity" — never force / power / energy.
 */
import { getBleManager, type BleManagerFacade, type UnsubscribeFn } from './BleManagerFacade'
import { TrackerScanner, type TrackerScannerRunOptions } from './TrackerScanner'
import type { AdvertisementSnapshot, ConnectionStatus, Hand } from './bleTypes'
import {
  assignSlot,
  clearSlot,
  getTrackerSlots,
  setSlotConnected,
  setSlotConnecting,
} from '@/state/useTrackerStore'
import { deviceSensitive, logger, safe } from '@/diagnostics/logger'

export type TrackerAggregate = 'noneReady' | 'leftOnly' | 'rightOnly' | 'bothReady'
export type TrackerSlotHand = Exclude<Hand, 'unknown'>

interface SlotBinding {
  deviceId: string
  unsubscribe: UnsubscribeFn
}

export class TrackerCoordinator {
  private readonly scanner: TrackerScanner
  private readonly bindings: Record<TrackerSlotHand, SlotBinding | null> = {
    left: null,
    right: null,
  }

  constructor(private readonly facade: BleManagerFacade) {
    this.scanner = new TrackerScanner(facade)
  }

  async scan(options: TrackerScannerRunOptions = {}): Promise<AdvertisementSnapshot[]> {
    return this.scanner.run(options)
  }

  async connectSlot(hand: TrackerSlotHand, deviceId: string, name?: string): Promise<void> {
    // Tear down any previous binding for this slot first — reassigning a
    // slot to a new device must not leak the old change-listener.
    this.tearDownBinding(hand)

    assignSlot(hand, deviceId, name)
    setSlotConnecting(hand, true)

    const unsubscribe = this.facade.onConnectionChange(deviceId, (status: ConnectionStatus) => {
      const ready = status.state === 'ready' || status.state === 'streaming'
      setSlotConnected(hand, ready)
      if (status.state === 'error') {
        setSlotConnecting(hand, false, status.errorMessage)
      }
    })
    this.bindings[hand] = { deviceId, unsubscribe }

    try {
      const status = await this.facade.connect(deviceId)
      const ready = status.state === 'ready' || status.state === 'streaming'
      setSlotConnected(hand, ready)
      setSlotConnecting(hand, false)
      logger.info('ble.slot.connect.ok', 'Tracker slot connected', {
        hand: safe(hand),
        deviceId: deviceSensitive(deviceId),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSlotConnected(hand, false)
      setSlotConnecting(hand, false, message)
      logger.warn('ble.slot.connect.fail', 'Tracker slot connect failed', {
        hand: safe(hand),
        deviceId: deviceSensitive(deviceId),
        error: safe(message),
      })
      this.tearDownBinding(hand)
      throw err
    }
  }

  /**
   * Force-evict a slot down to the radio, even when no JS binding exists.
   *
   * `disconnectSlot` only touches the radio when it holds a binding — but
   * a FAILED connect tears its binding down while the OS may still hold a
   * half-open GATT attempt for the device. This always issues the
   * facade-level disconnect (which cancels any pending connection by id),
   * so a retry pass starts from a radio-clean slate.
   */
  async evictSlot(hand: TrackerSlotHand, deviceId: string): Promise<void> {
    this.tearDownBinding(hand)
    try {
      await this.facade.disconnect(deviceId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('ble.slot.evict.fail', 'Tracker slot evict failed', {
        hand: safe(hand),
        deviceId: deviceSensitive(deviceId),
        error: safe(message),
      })
    } finally {
      clearSlot(hand)
    }
  }

  async disconnectSlot(hand: TrackerSlotHand): Promise<void> {
    const binding = this.bindings[hand]
    this.tearDownBinding(hand)
    if (!binding) {
      clearSlot(hand)
      return
    }
    try {
      await this.facade.disconnect(binding.deviceId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.warn('ble.slot.disconnect.fail', 'Tracker slot disconnect failed', {
        hand: safe(hand),
        deviceId: deviceSensitive(binding.deviceId),
        error: safe(message),
      })
    } finally {
      clearSlot(hand)
    }
  }

  aggregate(): TrackerAggregate {
    const slots = getTrackerSlots()
    const isReady = (s: (typeof slots)['left']): boolean =>
      s?.state === 'ready' || s?.state === 'streaming'
    const leftReady = isReady(slots.left)
    const rightReady = isReady(slots.right)
    if (leftReady && rightReady) return 'bothReady'
    if (leftReady) return 'leftOnly'
    if (rightReady) return 'rightOnly'
    return 'noneReady'
  }

  private tearDownBinding(hand: TrackerSlotHand): void {
    const binding = this.bindings[hand]
    if (!binding) return
    try {
      binding.unsubscribe()
    } catch {
      // Idempotent; swallow.
    }
    this.bindings[hand] = null
  }
}

let cachedCoordinator: TrackerCoordinator | null = null

/**
 * Memoized singleton bound to the lazily-resolved BleManagerFacade. The
 * facade itself is only fetched on first call so importing this module
 * during app bootstrap (before registerBleManagerFactory) is safe.
 */
export function getTrackerCoordinator(): TrackerCoordinator {
  if (!cachedCoordinator) {
    cachedCoordinator = new TrackerCoordinator(getBleManager())
  }
  return cachedCoordinator
}

/** Test hook — drop the cached singleton so the next getTrackerCoordinator()
 * builds a fresh one against the current facade. */
export function resetTrackerCoordinatorSingleton(): void {
  cachedCoordinator = null
}
