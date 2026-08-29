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
  ConnectionPriority,
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
  RawFrameSink,
  ReadResult,
  SubscriptionResult,
  WriteResult,
} from './bleTypes'
import { deviceSensitive, logger, safe } from '@/diagnostics/logger'
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

export class HexDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HexDecodeError'
  }
}

/** Pure-JS hex → base64. Accepts optional whitespace/':' separators. Throws
 * HexDecodeError on odd length or any non-hex character. */
function hexToBase64(hex: string): string {
  if (typeof hex !== 'string') throw new HexDecodeError('hex input is not a string')
  const clean = hex.replace(/[\s:]/g, '')
  if (clean.length % 2 !== 0) throw new HexDecodeError('hex input has odd length')
  const bytes: number[] = []
  for (let i = 0; i < clean.length; i += 2) {
    const pair = clean.substring(i, i + 2)
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) {
      throw new HexDecodeError(`invalid hex pair at index ${i}`)
    }
    bytes.push(parseInt(pair, 16))
  }
  let out = ''
  let i = 0
  while (i < bytes.length) {
    // bytes[i] is safe because the while() guard; the two conditionals for
    // b2/b3 gate on i-vs-length before advancing. tsconfig has
    // noUncheckedIndexedAccess so we assert non-null explicitly here.
    const b1 = bytes[i++]!
    const b2 = i < bytes.length ? bytes[i++]! : -1
    const b3 = i < bytes.length ? bytes[i++]! : -1
    const c1 = b1 >> 2
    const c2 = ((b1 & 0x03) << 4) | (b2 === -1 ? 0 : (b2 >> 4))
    const c3 = b2 === -1 ? -1 : (((b2 & 0x0f) << 2) | (b3 === -1 ? 0 : (b3 >> 6)))
    const c4 = b3 === -1 ? -1 : (b3 & 0x3f)
    out += BASE64_ALPHABET.charAt(c1)
    out += BASE64_ALPHABET.charAt(c2)
    out += c3 === -1 ? '=' : BASE64_ALPHABET.charAt(c3)
    out += c4 === -1 ? '=' : BASE64_ALPHABET.charAt(c4)
  }
  return out
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

  setCaptureIdProvider(provider: () => string): void {
    this.getCaptureId = provider
  }

  /**
   * Durable sink for raw frames. Every frame is handed here BEFORE it is
   * delivered to the subscriber that asked for it, so persist-before-parse
   * holds for every consumer — Live decode, the protocol probe, the BLE
   * spike — without any of them opting in.
   */
  private frameSink: RawFrameSink | null = null

  setFrameSink(sink: RawFrameSink | null): void {
    this.frameSink = sink
  }

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
      // High priority (short connection interval) for every tracker link:
      // the tablet often streams A2DP audio at the same time, and at the
      // default balanced interval the weaker of two glove links loses the
      // radio-time contest — observed 2026-08-29 as init writes dying on
      // whichever glove came up second. Link-layer parameter request only;
      // no GATT write (rule 4). Best-effort, same posture as MTU.
      try {
        await manager.requestConnectionPriorityForDevice(deviceId, ConnectionPriority.High)
      } catch { /* ignore priority negotiation failures */ }
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
      // Best-effort cancel of the half-open attempt. Android (this
      // tablet's MediaTek stack in particular) keeps a pending GATT
      // handle after a failed direct connect — "Device was disconnected"
      // mid-handshake — and while that handle exists every later connect
      // to the same device fails too. Cancelling clears it; if there is
      // nothing to cancel this is a no-op.
      try {
        await manager.cancelDeviceConnection(deviceId)
      } catch {
        /* nothing pending — fine */
      }
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

  async isConnected(deviceId: string): Promise<boolean> {
    if (!this.manager) return false
    try {
      return await this.manager.isDeviceConnected(deviceId)
    } catch {
      return false
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
          // PERSIST BEFORE DELIVERY (CLAUDE.md §1, §11.9, §12.4). The frame
          // reaches durable storage before any subscriber — decoder, probe UI
          // or spike harness — is even aware of it. Doing this here rather
          // than at each call site is what makes the guarantee structural:
          // a new screen cannot forget to persist. The sink's contract is
          // that capture() is synchronous and never throws, but we guard
          // anyway because a storage fault must never break frame delivery.
          try {
            this.frameSink?.capture(frame)
          } catch {
            /* sink contract violation — never break the native callback */
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

  async writeCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
    payload: { base64?: string; hex?: string },
    withResponse: boolean,
  ): Promise<WriteResult> {
    const manager = this.ensure()
    const hasBase64 = typeof payload.base64 === 'string' && payload.base64.length > 0
    const hasHex = typeof payload.hex === 'string' && payload.hex.length > 0
    if (hasBase64 === hasHex) {
      const errorMessage = 'writeCharacteristic requires exactly one of base64 or hex'
      return { success: false, bytesWritten: 0, durationMs: 0, errorMessage }
    }
    let base64Payload: string
    let bytesWritten = 0
    try {
      if (hasBase64) {
        base64Payload = payload.base64 as string
        // Decode to count bytes accurately (accounts for padding).
        bytesWritten = base64ToHex(base64Payload).length / 2
      } else {
        base64Payload = hexToBase64(payload.hex as string)
        bytesWritten = (payload.hex as string).replace(/[\s:]/g, '').length / 2
      }
    } catch (e) {
      return {
        success: false,
        bytesWritten: 0,
        durationMs: 0,
        errorMessage: (e as Error)?.message ?? String(e),
      }
    }
    logger.info('ble.write.attempt', 'developer-mode write to characteristic', {
      deviceId: deviceSensitive(deviceId),
      serviceUuid: deviceSensitive(serviceUuid),
      characteristicUuid: deviceSensitive(characteristicUuid),
      valueBase64: deviceSensitive(base64Payload),
      byteCount: safe(bytesWritten),
      withResponse: safe(withResponse),
    })
    const start = performance.now()
    try {
      if (withResponse) {
        await manager.writeCharacteristicWithResponseForDevice(
          deviceId,
          serviceUuid,
          characteristicUuid,
          base64Payload,
        )
      } else {
        await manager.writeCharacteristicWithoutResponseForDevice(
          deviceId,
          serviceUuid,
          characteristicUuid,
          base64Payload,
        )
      }
      const durationMs = performance.now() - start
      logger.info('ble.write.ok', 'developer-mode write completed', {
        deviceId: deviceSensitive(deviceId),
        serviceUuid: deviceSensitive(serviceUuid),
        characteristicUuid: deviceSensitive(characteristicUuid),
        byteCount: safe(bytesWritten),
        durationMs: safe(durationMs),
        withResponse: safe(withResponse),
      })
      return { success: true, bytesWritten, durationMs }
    } catch (e) {
      const durationMs = performance.now() - start
      const errorMessage = (e as Error)?.message ?? String(e)
      logger.warn('ble.write.err', 'developer-mode write failed', {
        deviceId: deviceSensitive(deviceId),
        serviceUuid: deviceSensitive(serviceUuid),
        characteristicUuid: deviceSensitive(characteristicUuid),
        byteCount: safe(bytesWritten),
        durationMs: safe(durationMs),
        withResponse: safe(withResponse),
        errorMessage: safe(errorMessage),
      })
      return { success: false, bytesWritten, durationMs, errorMessage }
    }
  }

  async readCharacteristic(
    deviceId: string,
    serviceUuid: string,
    characteristicUuid: string,
  ): Promise<ReadResult> {
    const manager = this.ensure()
    logger.info('ble.read.attempt', 'developer-mode read of characteristic', {
      deviceId: deviceSensitive(deviceId),
      serviceUuid: deviceSensitive(serviceUuid),
      characteristicUuid: deviceSensitive(characteristicUuid),
    })
    const start = performance.now()
    try {
      const characteristic = await manager.readCharacteristicForDevice(
        deviceId,
        serviceUuid,
        characteristicUuid,
      )
      const durationMs = performance.now() - start
      const valueBase64 = characteristic.value ?? undefined
      let valueHex: string | undefined
      if (valueBase64 != null) {
        try { valueHex = base64ToHex(valueBase64) } catch { valueHex = undefined }
      }
      logger.info('ble.read.ok', 'developer-mode read completed', {
        deviceId: deviceSensitive(deviceId),
        serviceUuid: deviceSensitive(serviceUuid),
        characteristicUuid: deviceSensitive(characteristicUuid),
        byteCount: safe(valueHex ? valueHex.length / 2 : 0),
        durationMs: safe(durationMs),
      })
      return { success: true, valueBase64, valueHex, durationMs }
    } catch (e) {
      const durationMs = performance.now() - start
      const errorMessage = (e as Error)?.message ?? String(e)
      logger.warn('ble.read.err', 'developer-mode read failed', {
        deviceId: deviceSensitive(deviceId),
        serviceUuid: deviceSensitive(serviceUuid),
        characteristicUuid: deviceSensitive(characteristicUuid),
        durationMs: safe(durationMs),
        errorMessage: safe(errorMessage),
      })
      return { success: false, durationMs, errorMessage }
    }
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
