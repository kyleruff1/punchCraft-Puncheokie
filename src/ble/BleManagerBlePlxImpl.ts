/**
 * Concrete BleManagerFacade implementation on top of
 * @sfourdrinier/react-native-ble-plx (v3.9.3). Nothing outside src/ble/
 * may import from this file — consumers go through BleManagerFacade
 * (§11.4, §15.1).
 *
 * Every notification callback stamps performance.now() before any
 * parsing (§11.9, §12.4) and builds the RawBleFrame in place so the
 * capture sink can persist the raw bytes before any interpretation.
 */
import {
  BleManager as PlxBleManager,
  type Characteristic as PlxCharacteristic,
  type Device as PlxDevice,
  type State as PlxState,
  type Subscription as PlxSubscription,
} from '@sfourdrinier/react-native-ble-plx'

import type {
  AdvertisementSnapshot,
  ConnectionStatus,
  GattCharacteristicSnapshot,
  GattServiceSnapshot,
  GattSnapshot,
  RawBleFrame,
  SubscriptionResult,
} from './bleTypes'
import {
  resetBleManagerSingleton,
  type BleManagerFacade,
  type ConnectOptions,
  type ScanOptions,
  type SubscriptionHandle,
  type UnsubscribeFn,
} from '@/ble/BleManagerFacade'

const DEFAULT_SCAN_TIMEOUT_MS = 12_000
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP: Record<string, number> = (() => {
  const map: Record<string, number> = {}
  for (let i = 0; i < BASE64_ALPHABET.length; i++) map[BASE64_ALPHABET.charAt(i)] = i
  return map
})()

export class Base64DecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Base64DecodeError'
  }
}

/** Pure-JS base64 → hex. Ignores '=' padding. Throws Base64DecodeError on
 * any non-alphabet character so the caller can catch a typed error. */
function base64ToHex(b64: string): string {
  if (typeof b64 !== 'string') throw new Base64DecodeError('base64 input is not a string')
  let hex = ''
  let buffer = 0
  let bits = 0
  for (let i = 0; i < b64.length; i++) {
    const ch = b64.charAt(i)
    if (ch === '=') continue
    const val = BASE64_LOOKUP[ch]
    if (val === undefined) {
      throw new Base64DecodeError(`invalid base64 character at index ${i}`)
    }
    buffer = (buffer << 6) | val
    bits += 6
    if (bits >= 8) {
      bits -= 8
      const byte = (buffer >> bits) & 0xff
      hex += byte.toString(16).padStart(2, '0')
    }
  }
  return hex
}

function mapAdapterState(s: keyof typeof PlxState): 'unknown' | 'off' | 'on' | 'unauthorized' {
  switch (s) {
    case 'PoweredOn':
      return 'on'
    case 'PoweredOff':
    case 'Resetting':
      return 'off'
    case 'Unauthorized':
      return 'unauthorized'
    default:
      return 'unknown'
  }
}

function nowMonotonicMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

type SubKey = string
function subKey(deviceId: string, serviceUuid: string, characteristicUuid: string): SubKey {
  return `${deviceId}:${serviceUuid}:${characteristicUuid}`
}

/** Time to wait for the first monitor callback before treating a quiet
 * channel as "subscription is set up and just not delivering frames yet".
 * Longer than the CCCD-write round-trip on any tablet we care about, but
 * short enough to keep the spike responsive. */
const SETUP_OUTCOME_QUIET_MS = 800

export class BleManagerBlePlxImpl implements BleManagerFacade {
  private manager: PlxBleManager | null = null
  private scanTimeout: ReturnType<typeof setTimeout> | null = null
  private scanResolvers: Array<() => void> = []
  private seq = 0
  private readonly generations = new Map<string, number>()
  private readonly connectionListeners = new Map<string, Set<(s: ConnectionStatus) => void>>()
  private readonly disconnectSubs = new Map<string, PlxSubscription>()
  private readonly monitorSubs = new Map<SubKey, PlxSubscription>()

  /** Overridable getter — the capture pipeline swaps this in when a real
   * capture opens; until then frames are tagged 'ephemeral'. */
  getCaptureId: () => string = () => 'ephemeral'

  private ensure(): PlxBleManager {
    if (!this.manager) this.manager = new PlxBleManager()
    return this.manager
  }

  async isReady(): Promise<boolean> {
    const state = await this.ensure().state()
    return state === 'PoweredOn'
  }

  onAdapterStateChange(cb: (state: 'unknown' | 'off' | 'on' | 'unauthorized') => void): UnsubscribeFn {
    const sub = this.ensure().onStateChange((s) => cb(mapAdapterState(s)), true)
    return () => sub.remove()
  }

  async scan(options: ScanOptions, onAdvertisement: (ad: AdvertisementSnapshot) => void): Promise<void> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS
    const uuids = options.serviceUuids && options.serviceUuids.length > 0 ? options.serviceUuids : null
    const seen = new Set<string>()
    const stopAfter = options.stopAfterDevices ?? Infinity

    const manager = this.ensure()

    // ble-plx's startDeviceScan is fire-and-forget (returns void). Hold a
    // resolver here so scan() actually blocks its caller until the scan
    // window terminates via stopScan (called from stopAfter, the internal
    // timeout, or externally).
    let resolveScan: () => void = () => {}
    const scanPromise = new Promise<void>((resolve) => { resolveScan = resolve })
    this.scanResolvers.push(resolveScan)

    // Register the callback WITHOUT awaiting.
    manager.startDeviceScan(uuids, null, (err, device) => {
      // STAMP FIRST — before any error/null checks (§11.9).
      const monotonicTimeMs = performance.now()
      if (err || !device) return
      const wallTimeIso = new Date().toISOString()
      seen.add(device.id)
      const ad: AdvertisementSnapshot = {
        deviceId: device.id,
        name: device.name ?? device.localName ?? undefined,
        rssi: device.rssi ?? undefined,
        serviceUuids: device.serviceUUIDs ?? [],
        manufacturerDataBase64: device.manufacturerData ?? undefined,
        monotonicTimeMs,
        wallTimeIso,
      }
      onAdvertisement(ad)
      if (seen.size >= stopAfter) {
        void this.stopScan()
      }
    })

    if (this.scanTimeout) clearTimeout(this.scanTimeout)
    this.scanTimeout = setTimeout(() => { void this.stopScan() }, timeoutMs)

    return scanPromise
  }

  async stopScan(): Promise<void> {
    if (this.scanTimeout) {
      clearTimeout(this.scanTimeout)
      this.scanTimeout = null
    }
    if (this.manager) {
      try { await this.manager.stopDeviceScan() } catch { /* already stopped is fine */ }
    }
    const resolvers = this.scanResolvers
    this.scanResolvers = []
    for (const r of resolvers) r()
  }

  private bumpGeneration(deviceId: string): number {
    const next = (this.generations.get(deviceId) ?? 0) + 1
    this.generations.set(deviceId, next)
    return next
  }

  private currentGeneration(deviceId: string): number {
    return this.generations.get(deviceId) ?? 0
  }

  private emitStatus(status: ConnectionStatus): void {
    const set = this.connectionListeners.get(status.deviceId)
    if (!set) return
    for (const cb of set) {
      try { cb(status) } catch { /* listener errors must not break the facade */ }
    }
  }

  async connect(deviceId: string, options?: ConnectOptions): Promise<ConnectionStatus> {
    const manager = this.ensure()
    const timeoutMs = options?.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    this.emitStatus({
      deviceId,
      state: 'connecting',
      generation: this.currentGeneration(deviceId),
      lastChangeMonotonicMs: nowMonotonicMs(),
    })
    try {
      const device: PlxDevice = await manager.connectToDevice(deviceId, { timeout: timeoutMs })
      const generation = this.bumpGeneration(deviceId)
      if (options?.requestMtu) {
        try { await manager.requestMTUForDevice(deviceId, options.requestMtu) } catch { /* ignore MTU negotiation failures */ }
      }
      // Wire a disconnect subscription per device (replace any previous one).
      const prior = this.disconnectSubs.get(deviceId)
      if (prior) prior.remove()
      const sub = manager.onDeviceDisconnected(deviceId, (err, _d) => {
        this.emitStatus({
          deviceId,
          state: err ? 'error' : 'dormant',
          generation: this.currentGeneration(deviceId),
          errorMessage: err?.message,
          lastChangeMonotonicMs: nowMonotonicMs(),
        })
      })
      this.disconnectSubs.set(deviceId, sub)
      const status: ConnectionStatus = {
        deviceId: device.id,
        state: 'ready',
        generation,
        lastChangeMonotonicMs: nowMonotonicMs(),
      }
      this.emitStatus(status)
      return status
    } catch (e) {
      const status: ConnectionStatus = {
        deviceId,
        state: 'error',
        generation: this.currentGeneration(deviceId),
        errorMessage: (e as Error)?.message ?? String(e),
        lastChangeMonotonicMs: nowMonotonicMs(),
      }
      this.emitStatus(status)
      throw e
    }
  }

  async disconnect(deviceId: string): Promise<void> {
    const sub = this.disconnectSubs.get(deviceId)
    if (sub) { sub.remove(); this.disconnectSubs.delete(deviceId) }
    if (!this.manager) return
    try { await this.manager.cancelDeviceConnection(deviceId) } catch { /* already disconnected is fine */ }
    this.emitStatus({
      deviceId,
      state: 'dormant',
      generation: this.currentGeneration(deviceId),
      lastChangeMonotonicMs: nowMonotonicMs(),
    })
  }

  onConnectionChange(deviceId: string, cb: (status: ConnectionStatus) => void): UnsubscribeFn {
    let set = this.connectionListeners.get(deviceId)
    if (!set) { set = new Set(); this.connectionListeners.set(deviceId, set) }
    set.add(cb)
    return () => {
      const s = this.connectionListeners.get(deviceId)
      if (!s) return
      s.delete(cb)
      if (s.size === 0) this.connectionListeners.delete(deviceId)
    }
  }

  async discoverAllServicesAndCharacteristics(deviceId: string): Promise<GattSnapshot> {
    const manager = this.ensure()
    await manager.discoverAllServicesAndCharacteristicsForDevice(deviceId)
    const services = await manager.servicesForDevice(deviceId)
    const mappedServices: GattServiceSnapshot[] = []
    for (const svc of services) {
      const chars = await manager.characteristicsForDevice(deviceId, svc.uuid)
      const mappedChars: GattCharacteristicSnapshot[] = []
      for (const c of chars) {
        let descriptors: Array<{ uuid: string }> = []
        try {
          const ds = await manager.descriptorsForDevice(deviceId, svc.uuid, c.uuid)
          descriptors = ds.map((d) => ({ uuid: d.uuid }))
        } catch {
          // Descriptor enumeration is best-effort — some peripherals refuse it.
        }
        mappedChars.push({
          uuid: c.uuid,
          properties: {
            read: c.isReadable,
            write: c.isWritableWithResponse,
            writeWithoutResponse: c.isWritableWithoutResponse,
            notify: c.isNotifiable,
            indicate: c.isIndicatable,
          },
          descriptors,
        })
      }
      mappedServices.push({ uuid: svc.uuid, characteristics: mappedChars })
    }
    return {
      deviceId,
      services: mappedServices,
      discoveredAtMonotonicMs: nowMonotonicMs(),
    }
  }

  async monitorCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    onFrame: (frame: RawBleFrame) => void,
  ): Promise<SubscriptionHandle> {
    const manager = this.ensure()
    // Peek at the characteristic's properties to record the correct direction
    // in the SubscriptionResult, even if no frame ever arrives.
    let direction: 'notification' | 'indication' = 'notification'
    try {
      const chars = await manager.characteristicsForDevice(deviceId, serviceUuid)
      const match = chars.find((c) => c.uuid.toLowerCase() === characteristicUuid.toLowerCase())
      if (match) {
        direction = match.isNotifiable ? 'notification' : (match.isIndicatable ? 'indication' : 'notification')
      }
    } catch {
      // Non-fatal — direction defaults to 'notification'.
    }

    const key = subKey(deviceId, serviceUuid, characteristicUuid)
    // Drop any prior subscription for the same key before installing a new one.
    const prior = this.monitorSubs.get(key)
    if (prior) { try { prior.remove() } catch { /* ignore */ } this.monitorSubs.delete(key) }

    // Definitive setup outcome — resolves on the FIRST callback fired by
    // ble-plx. If that callback carries an error, we know the CCCD write
    // failed. If it carries data, the subscription is confirmed working.
    // If the channel is quiet for SETUP_OUTCOME_QUIET_MS, we settle
    // optimistically (subscription accepted, just no data yet).
    let setupObserved = false
    let resolveOutcome: (r: SubscriptionResult) => void = () => {}
    const setupOutcome = new Promise<SubscriptionResult>((resolve) => { resolveOutcome = resolve })

    try {
      const sub = manager.monitorCharacteristicForDevice(
        deviceId,
        serviceUuid,
        characteristicUuid,
        (err, characteristic: PlxCharacteristic | null) => {
          // STAMP FIRST — before touching payload, err, or anything else (§11.9).
          const monotonicTimeMs = performance.now()
          const wallTimeIso = new Date().toISOString()

          if (!setupObserved) {
            setupObserved = true
            if (err) {
              result.success = false
              result.errorMessage = err.message
              resolveOutcome(result)
              return
            }
            // First callback carries data → subscription confirmed.
            resolveOutcome(result)
          }

          if (err) return
          if (!characteristic || characteristic.value == null) return
          const valueBase64 = characteristic.value
          let valueHex: string
          try {
            valueHex = base64ToHex(valueBase64)
          } catch {
            // Corrupt payload — drop this frame rather than crashing the sub.
            return
          }
          const frameDirection: 'notification' | 'indication' =
            characteristic.isNotifiable
              ? 'notification'
              : (characteristic.isIndicatable ? 'indication' : direction)
          const frame: RawBleFrame = {
            id: `${this.getCaptureId()}-${this.seq++}`,
            captureId: this.getCaptureId(),
            deviceId,
            handAtCapture: 'unknown',
            monotonicTimeMs,
            wallTimeIso,
            direction: frameDirection,
            serviceUuid,
            characteristicUuid,
            valueBase64,
            valueHex,
            connectionGeneration: this.currentGeneration(deviceId),
          }
          onFrame(frame)
        },
      )
      this.monitorSubs.set(key, sub)
      const result: SubscriptionResult = {
        serviceUuid,
        characteristicUuid,
        direction,
        success: true,
      }
      // Settle optimistically after the quiet window if nothing else has.
      setTimeout(() => {
        if (!setupObserved) {
          setupObserved = true
          resolveOutcome(result)
        }
      }, SETUP_OUTCOME_QUIET_MS)
      return {
        result,
        setupOutcome,
        unsubscribe: () => {
          const s = this.monitorSubs.get(key)
          if (s) {
            try { s.remove() } catch { /* ignore */ }
            this.monitorSubs.delete(key)
          }
        },
      }
    } catch (e) {
      const result: SubscriptionResult = {
        serviceUuid,
        characteristicUuid,
        direction,
        success: false,
        errorMessage: (e as Error)?.message ?? String(e),
      }
      resolveOutcome(result)
      return { result, setupOutcome, unsubscribe: () => { /* no-op — nothing installed */ } }
    }
  }

  async monitorAllNotifiable(
    snapshot: GattSnapshot,
    onFrame: (frame: RawBleFrame) => void,
  ): Promise<SubscriptionHandle[]> {
    const handles: SubscriptionHandle[] = []
    for (const svc of snapshot.services) {
      for (const c of svc.characteristics) {
        if (!(c.properties.notify || c.properties.indicate)) continue
        try {
          const h = await this.monitorCharacteristic(snapshot.deviceId, svc.uuid, c.uuid, onFrame)
          handles.push(h)
        } catch (e) {
          const failed = {
            result: {
              serviceUuid: svc.uuid,
              characteristicUuid: c.uuid,
              direction: (c.properties.notify ? 'notification' : 'indication') as 'notification' | 'indication',
              success: false,
              errorMessage: (e as Error)?.message ?? String(e),
            },
            setupOutcome: Promise.resolve<SubscriptionResult>({
              serviceUuid: svc.uuid,
              characteristicUuid: c.uuid,
              direction: (c.properties.notify ? 'notification' : 'indication') as 'notification' | 'indication',
              success: false,
              errorMessage: (e as Error)?.message ?? String(e),
            }),
            unsubscribe: () => { /* no-op */ },
          }
          handles.push(failed)
        }
      }
    }
    return handles
  }

  async destroy(): Promise<void> {
    await this.stopScan().catch(() => {})
    for (const sub of this.monitorSubs.values()) {
      try { sub.remove() } catch { /* ignore */ }
    }
    this.monitorSubs.clear()
    for (const sub of this.disconnectSubs.values()) {
      try { sub.remove() } catch { /* ignore */ }
    }
    this.disconnectSubs.clear()
    this.connectionListeners.clear()
    if (this.manager) {
      try { this.manager.destroy() } catch { /* already destroyed */ }
      this.manager = null
    }
    resetBleManagerSingleton()
  }
}
