/**
 * M02-01 — BLE spike harness.
 *
 * Runs scan → connect → discover → subscribe(one notify characteristic) →
 * first-frame observation, reporting pass/fail per stage with millisecond
 * timings so the user can lock the stack for Story 1 (§11.4, §11.5, §11.9).
 *
 * This screen is intentionally chatty on the logger side: every stage
 * transition and every stage error is recorded with classified fields so a
 * support export tells the whole story (§20.4). Nothing here parses frame
 * payloads — the facade is responsible for handing back a persistence-ready
 * RawBleFrame with a monotonic timestamp stamped inside the native callback
 * (§11.9, §12.4).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'

import { getBleManager } from '@ble/BleManagerFacade'
import type { SubscriptionHandle } from '@ble/BleManagerFacade'
import { PermissionService } from '@ble/PermissionService'
import { TrackerScanner } from '@ble/TrackerScanner'
import type {
  AdvertisementSnapshot,
  GattSnapshot,
  RawBleFrame,
  SpikeReport,
  SubscriptionResult,
} from '@ble/bleTypes'
import { useCaptureSession } from '@capture/useCaptureSession'
import { getBuildInfo } from '@/diagnostics/buildInfo'
import { deviceSensitive, logger, safe } from '@/diagnostics/logger'
import { getTrackerSlots } from '@/state/useTrackerStore'
import { colors } from '@/theme/colors'

/** Pure-JS base64 → hex used to attach manufacturer-data hex to the report.
 * Duplicates the impl in BleManagerBlePlxImpl to keep the spike screen from
 * importing library-specific code. */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_LOOKUP: Record<string, number> = (() => {
  const map: Record<string, number> = {}
  for (let i = 0; i < BASE64_ALPHABET.length; i++) map[BASE64_ALPHABET.charAt(i)] = i
  return map
})()
function base64ToHex(b64: string): string {
  let hex = ''
  let buffer = 0
  let bits = 0
  for (let i = 0; i < b64.length; i++) {
    const ch = b64.charAt(i)
    if (ch === '=') continue
    const val = BASE64_LOOKUP[ch]
    if (val === undefined) return ''
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

const SCAN_TIMEOUT_MS = 12_000
const CONNECT_TIMEOUT_MS = 15_000
/** Longer than a single 10 s wait: gives the athlete real time to punch. */
const FIRST_FRAME_TIMEOUT_MS = 20_000
/** Cap frames captured in the report so the JSON stays copy-pasteable. */
const MAX_REPORT_FRAMES = 8
/** Devices whose advertised name matches this pattern are auto-picked.
 * The FightCamp v1 trackers advertise with the truncated name "FightCam"
 * (BLE 31-byte advertising limit), so `/fightcam/i` deliberately catches
 * both "FightCam" and "FightCamp". */
const CANDIDATE_NAME = /hykso|fightcam|punch/i
/** How many advertisements to attach to the report so a reviewer can see
 * what was in range even without a pick. */
const REPORT_TOP_DEVICES = 15

type Phase =
  | 'idle'
  | 'permissions'
  | 'adapter'
  | 'scanning'
  | 'awaiting-pick'
  | 'connecting'
  | 'discovering'
  | 'subscribing'
  | 'awaiting-frame'
  | 'done'

interface UiState {
  phase: Phase
  message: string
  candidates: AdvertisementSnapshot[]
  report: SpikeReport | null
  firstFrameHex?: string
}

function newRunId(): string {
  // Short random id — enough uniqueness for a single-session spike run.
  return `spike-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

function emptyReport(runId: string, stackLabel: string): SpikeReport {
  return {
    runId,
    stackLabel,
    scan: { ok: false, devicesFound: 0, durationMs: 0 },
    connect: { ok: false, durationMs: 0 },
    discover: { ok: false, serviceCount: 0, characteristicCount: 0, durationMs: 0 },
    subscribe: { ok: false, subscribed: 0, subscriptions: [] },
    startedAtIso: new Date().toISOString(),
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  try { return String(e) } catch { return 'unknown error' }
  }

export default function SpikeScreen() {
  // Opens a capture for this screen so the spike's notification frames are
  // persisted by the transport rather than living only in the run report.
  useCaptureSession('ble-spike')

  const info = useMemo(() => getBuildInfo(), [])
  const [state, setState] = useState<UiState>({
    phase: 'idle',
    message: 'Tap Run spike to begin.',
    candidates: [],
    report: null,
  })
  const cancelledRef = useRef(false)
  const subscriptionRef = useRef<SubscriptionHandle | null>(null)
  const allHandlesRef = useRef<SubscriptionHandle[]>([])
  const deviceIdRef = useRef<string | null>(null)
  const pickResolverRef = useRef<((ad: AdvertisementSnapshot | null) => void) | null>(null)

  useEffect(() => {
    return () => {
      cancelledRef.current = true
      const handles = allHandlesRef.current
      allHandlesRef.current = []
      subscriptionRef.current = null
      for (const h of handles) {
        try { h.unsubscribe() } catch { /* best-effort */ }
      }
    }
  }, [])

  const patchReport = useCallback((mut: (r: SpikeReport) => void) => {
    if (cancelledRef.current) return
    setState((prev) => {
      if (!prev.report) return prev
      const next = { ...prev.report }
      mut(next)
      return { ...prev, report: next }
    })
  }, [])

  const safeSetState = useCallback((updater: (s: UiState) => UiState) => {
    if (cancelledRef.current) return
    setState(updater)
  }, [])

  const runSpike = useCallback(async () => {
    // Tear down anything left over from a prior run BEFORE starting a new
    // one — otherwise every Run→Reset→Run cycle leaks native subscriptions
    // and eventually the tracker (or the tablet's BLE stack) drops the
    // whole connection under the pressure of stale CCCD writes.
    {
      const prev = allHandlesRef.current
      allHandlesRef.current = []
      for (const h of prev) { try { h.unsubscribe() } catch { /* best-effort */ } }
      const prevDeviceId = deviceIdRef.current
      if (prevDeviceId) {
        try { await getBleManager().disconnect(prevDeviceId) } catch { /* best-effort */ }
      }
    }
    cancelledRef.current = false
    subscriptionRef.current = null
    deviceIdRef.current = null
    const runId = newRunId()

    // Shared subscribe-stage runner used by both the normal flow
    // (scan→pick→connect→discover→subscribe) and the "coordinator already
    // has this device connected" shortcut. Populates report.subscribe and
    // the awaiting-frame UI; leaves handles live in allHandlesRef so
    // Reset can tear them down. Returns after the frame-wait window
    // closes or a frame arrives.
    const runSubscribeStage = async (snapshot: GattSnapshot, deviceId: string): Promise<void> => {
      safeSetState((s) => ({ ...s, phase: 'subscribing', message: 'Subscribing to every notify/indicate characteristic…' }))
      const notifiables: Array<{ serviceUuid: string; characteristicUuid: string }> = []
      for (const svc of snapshot.services) {
        for (const c of svc.characteristics) {
          if (c.properties.notify || c.properties.indicate) {
            notifiables.push({ serviceUuid: svc.uuid, characteristicUuid: c.uuid })
          }
        }
      }
      if (notifiables.length === 0) {
        const missing: SubscriptionResult = {
          serviceUuid: '', characteristicUuid: '', direction: 'notification',
          success: false, errorMessage: 'no notify characteristic on this device',
        }
        patchReport((r) => {
          r.subscribe = { ok: false, subscribed: 0, subscriptions: [missing], errorMessage: 'no notify characteristic on this device' }
          r.finishedAtIso = new Date().toISOString()
        })
        safeSetState((s) => ({ ...s, phase: 'done', message: 'Done — subscribe skipped (no notifiables).' }))
        return
      }

      let firstFrameAt: number | null = null
      let firstFrameHex: string | undefined
      const capturedFrames: Array<{ serviceUuid: string; characteristicUuid: string; monotonicTimeMs: number; valueHex: string }> = []
      const handles: SubscriptionHandle[] = []
      let subReady = false
      const onFrame = (frame: RawBleFrame) => {
        if (!subReady) return
        if (firstFrameAt === null) {
          firstFrameAt = performance.now()
          firstFrameHex = frame.valueHex
          logger.info('spike.frame.first', 'First frame received', {
            serviceUuid: safe(frame.serviceUuid),
            characteristicUuid: safe(frame.characteristicUuid),
            bytes: safe(frame.valueBase64.length),
          })
        }
        if (capturedFrames.length < MAX_REPORT_FRAMES) {
          capturedFrames.push({
            serviceUuid: frame.serviceUuid,
            characteristicUuid: frame.characteristicUuid,
            monotonicTimeMs: Math.round(frame.monotonicTimeMs),
            valueHex: frame.valueHex,
          })
        }
      }

      try {
        for (const target of notifiables) {
          if (cancelledRef.current) break
          try {
            const h = await facade.monitorCharacteristic(deviceId, target.serviceUuid, target.characteristicUuid, onFrame)
            handles.push(h)
          } catch (e) {
            handles.push({
              result: { serviceUuid: target.serviceUuid, characteristicUuid: target.characteristicUuid, direction: 'notification', success: false, errorMessage: errMessage(e) },
              setupOutcome: Promise.resolve({ serviceUuid: target.serviceUuid, characteristicUuid: target.characteristicUuid, direction: 'notification' as const, success: false, errorMessage: errMessage(e) }),
              unsubscribe: () => { /* no-op */ },
            })
          }
        }
      } catch (e) {
        logger.error('spike.subscribe.unexpected', 'Subscribe loop threw', { error: safe(errMessage(e)) })
      }

      if (cancelledRef.current) {
        for (const h of handles) { try { h.unsubscribe() } catch { /* best-effort */ } }
        return
      }
      const setupResults = await Promise.all(handles.map((h) => h.setupOutcome))
      if (cancelledRef.current) {
        for (const h of handles) { try { h.unsubscribe() } catch { /* best-effort */ } }
        return
      }
      const subscribedCount = setupResults.filter((r) => r.success).length
      if (subscribedCount === 0) {
        patchReport((r) => {
          r.subscribe = { ok: false, subscribed: 0, subscriptions: setupResults, errorMessage: 'every subscribe attempt failed' }
          r.finishedAtIso = new Date().toISOString()
        })
        safeSetState((s) => ({ ...s, phase: 'done', message: 'Done — every subscribe failed.' }))
        return
      }

      subscriptionRef.current = handles.length > 0 ? handles[0] ?? null : null
      allHandlesRef.current = handles
      safeSetState((s) => ({
        ...s,
        phase: 'awaiting-frame',
        message: `Subscribed to ${subscribedCount}/${handles.length} chars — throw a punch (up to ${FIRST_FRAME_TIMEOUT_MS / 1000}s)…`,
      }))
      const subStart = performance.now()
      subReady = true
      const deadline = subStart + FIRST_FRAME_TIMEOUT_MS
      while (firstFrameAt === null && performance.now() < deadline && !cancelledRef.current) {
        await new Promise((r) => setTimeout(r, 50))
      }
      if (cancelledRef.current) return
      const firstFrameWithinMs = firstFrameAt !== null ? Math.round(firstFrameAt - subStart) : undefined
      const gotFrame = firstFrameAt !== null
      patchReport((r) => {
        r.subscribe = {
          ok: gotFrame,
          subscribed: subscribedCount,
          firstFrameWithinMs,
          subscriptions: setupResults,
          frames: capturedFrames,
          errorMessage: gotFrame ? undefined : `no frame received within ${FIRST_FRAME_TIMEOUT_MS}ms across ${subscribedCount} channels`,
        }
        r.finishedAtIso = new Date().toISOString()
      })
      if (gotFrame) {
        logger.info('spike.done.ok', 'Spike completed with first frame', {
          firstFrameWithinMs: safe(firstFrameWithinMs ?? -1),
          totalFrames: safe(capturedFrames.length),
        })
        safeSetState((s) => ({
          ...s,
          phase: 'done',
          message: `Done — first frame within ${firstFrameWithinMs}ms across ${subscribedCount} channel(s); captured ${capturedFrames.length} frame(s).`,
          firstFrameHex,
        }))
      } else {
        safeSetState((s) => ({ ...s, phase: 'done', message: `Done — subscribed to ${subscribedCount} channel(s) but no frame observed. Try punching harder or waking the tracker.` }))
      }
    }

    const stackLabel = `${info.appVersion}@${info.gitSha}`
    const report = emptyReport(runId, stackLabel)
    setState({ phase: 'permissions', message: 'Requesting permissions…', candidates: [], report })
    logger.info('spike.start', 'Spike run started', { runId: safe(runId), stackLabel: safe(stackLabel) })

    const facade = getBleManager()

    // Stage 0 — permissions. PermissionService.request() returns a
    // PermissionOutcome object (not a boolean); destructure explicitly.
    try {
      const outcome = await PermissionService.request()
      if (cancelledRef.current) return
      if (!outcome.granted) {
        logger.warn('spike.permissions.denied', 'Permissions denied', {
          missing: safe(outcome.missing),
          permanentlyDenied: safe(outcome.permanentlyDenied),
        })
        const guidance = outcome.permanentlyDenied.length > 0
          ? 'Permissions permanently denied. Opening Settings…'
          : `Permissions denied (${outcome.missing.join(', ') || 'unknown'}). Grant them and retry.`
        safeSetState((s) => ({ ...s, phase: 'idle', message: guidance }))
        if (outcome.permanentlyDenied.length > 0) {
          void PermissionService.openSettings()
        }
        return
      }
    } catch (e) {
      if (cancelledRef.current) return
      logger.error('spike.permissions.error', 'Permission request threw', { error: safe(errMessage(e)) })
      safeSetState((s) => ({ ...s, phase: 'idle', message: `Permission request failed: ${errMessage(e)}` }))
      return
    }

    // Stage 1 — adapter powered on.
    safeSetState((s) => ({ ...s, phase: 'adapter', message: 'Checking Bluetooth adapter…' }))
    try {
      const ready = await facade.isReady()
      if (cancelledRef.current) return
      if (!ready) {
        logger.warn('spike.adapter.off', 'Bluetooth adapter not powered on')
        safeSetState((s) => ({ ...s, phase: 'idle', message: 'Bluetooth is off. Turn it on and retry.' }))
        return
      }
    } catch (e) {
      if (cancelledRef.current) return
      logger.error('spike.adapter.error', 'isReady threw', { error: safe(errMessage(e)) })
      safeSetState((s) => ({ ...s, phase: 'idle', message: `Adapter check failed: ${errMessage(e)}` }))
      return
    }

    // Short-circuit: if the coordinator already has a FightCam connected
    // (badges show green), the tracker is committed to that connection and
    // will NOT advertise anymore, so a scan cannot find it. Reuse the
    // existing connection: skip scan entirely and go straight to
    // discover + subscribe using that deviceId.
    {
      const slots = getTrackerSlots()
      const readyOf = (s: (typeof slots)['left']) =>
        s && (s.state === 'ready' || s.state === 'streaming') ? s : null
      const reused = readyOf(slots.right) ?? readyOf(slots.left)
      if (reused) {
        deviceIdRef.current = reused.deviceId
        patchReport((r) => {
          r.scan = { ok: true, devicesFound: 0, durationMs: 0, topDevices: [] }
          r.connect = { ok: true, deviceId: reused.deviceId, durationMs: 0 }
        })
        logger.info('spike.reuseCoordinator', 'Reusing coordinator connection; skipping scan+connect', {
          deviceId: deviceSensitive(reused.deviceId),
          slotName: safe(reused.name ?? null),
        })
        safeSetState((s) => ({
          ...s,
          phase: 'discovering',
          message: `Reusing existing connection to ${reused.name ?? reused.deviceId} — discovering services…`,
        }))
        try {
          const discoverStart = performance.now()
          const snapshot = await facade.discoverAllServicesAndCharacteristics(reused.deviceId)
          if (cancelledRef.current) return
          const durationMs = Math.round(performance.now() - discoverStart)
          const charCount = snapshot.services.reduce((n, s) => n + s.characteristics.length, 0)
          const services = snapshot.services.map((svc) => ({
            uuid: svc.uuid,
            characteristics: svc.characteristics.map((c) => ({ uuid: c.uuid, properties: c.properties })),
          }))
          patchReport((r) => {
            r.discover = { ok: true, serviceCount: snapshot.services.length, characteristicCount: charCount, durationMs, services }
          })
          await runSubscribeStage(snapshot, reused.deviceId)
        } catch (e) {
          if (cancelledRef.current) return
          patchReport((r) => {
            r.discover = { ok: false, serviceCount: 0, characteristicCount: 0, durationMs: 0, errorMessage: errMessage(e) }
            r.finishedAtIso = new Date().toISOString()
          })
          safeSetState((s) => ({ ...s, phase: 'done', message: `Discover failed on reused connection: ${errMessage(e)}` }))
        }
        return
      }
    }

    // Stage 2 — scan. Discovery mode: no service filter.
    // Ownership: TrackerScanner runs a bounded scan and calls stopScan itself.
    // The spike screen never calls facade.stopScan().
    safeSetState((s) => ({ ...s, phase: 'scanning', message: `Scanning for up to ${SCAN_TIMEOUT_MS / 1000}s…` }))
    const scanStart = performance.now()
    let discovered: AdvertisementSnapshot[] = []
    let sortedForUi: AdvertisementSnapshot[] = []
    try {
      const scanner = new TrackerScanner(facade)
      discovered = await scanner.run({ timeoutMs: SCAN_TIMEOUT_MS })
      if (cancelledRef.current) return
      const durationMs = Math.round(performance.now() - scanStart)
      // Sort: named devices first, then by strongest RSSI descending.
      sortedForUi = [...discovered].sort((a, b) => {
        const an = a.name ? 0 : 1
        const bn = b.name ? 0 : 1
        if (an !== bn) return an - bn
        return (b.rssi ?? -128) - (a.rssi ?? -128)
      })
      const topDevices = sortedForUi.slice(0, REPORT_TOP_DEVICES).map((d) => ({
        deviceId: d.deviceId,
        name: d.name,
        rssi: d.rssi,
        serviceUuids: d.serviceUuids,
        manufacturerDataHex: d.manufacturerDataBase64 ? base64ToHex(d.manufacturerDataBase64) : undefined,
      }))
      patchReport((r) => {
        r.scan = { ok: discovered.length > 0, devicesFound: discovered.length, durationMs, topDevices }
      })
      safeSetState((s) => ({ ...s, candidates: sortedForUi }))
      if (discovered.length === 0) {
        logger.warn('spike.scan.empty', 'No advertisements observed', { durationMs: safe(durationMs) })
        safeSetState((s) => ({ ...s, phase: 'idle', message: 'Scan finished with no devices.' }))
        return
      }
      logger.info('spike.scan.done', 'Scan finished', {
        durationMs: safe(durationMs),
        devicesFound: safe(discovered.length),
      })
    } catch (e) {
      if (cancelledRef.current) return
      const durationMs = Math.round(performance.now() - scanStart)
      patchReport((r) => {
        r.scan = { ok: false, devicesFound: discovered.length, durationMs, errorMessage: errMessage(e) }
      })
      logger.error('spike.scan.error', 'Scan failed', { error: safe(errMessage(e)) })
      safeSetState((s) => ({ ...s, phase: 'idle', message: `Scan failed: ${errMessage(e)}` }))
      return
    }

    // Stage 3 — user picks (or we auto-pick a strong name match).
    let picked: AdvertisementSnapshot | null =
      sortedForUi.find((ad) => ad.name != null && CANDIDATE_NAME.test(ad.name)) ?? null
    if (!picked) {
      safeSetState((s) => ({ ...s, phase: 'awaiting-pick', message: `Pick one of ${sortedForUi.length} devices (named first, then by RSSI).` }))
      picked = await new Promise<AdvertisementSnapshot | null>((resolve) => {
        pickResolverRef.current = resolve
      })
      pickResolverRef.current = null
      if (cancelledRef.current) return
      if (!picked) {
        safeSetState((s) => ({ ...s, phase: 'idle', message: 'Cancelled — copy the report to see the 15 nearest devices scanned.' }))
        return
      }
    }
    deviceIdRef.current = picked.deviceId
    logger.info('spike.picked', 'Device picked', {
      deviceId: deviceSensitive(picked.deviceId),
      name: deviceSensitive(picked.name ?? null),
      rssi: safe(picked.rssi ?? null),
    })

    // Stage 4 — connect. If the coordinator has already established a
    // connection on this device we treat that as a no-op success rather
    // than issuing a second connect (which the underlying stack may
    // reject with GATT_CONN_TERMINATE_LOCAL_HOST or, worse, silently
    // rewire and drop subscriptions).
    safeSetState((s) => ({ ...s, phase: 'connecting', message: `Connecting (timeout ${CONNECT_TIMEOUT_MS / 1000}s)…` }))
    const connectStart = performance.now()
    try {
      const slots = getTrackerSlots()
      const alreadyConnected =
        (slots.left?.deviceId === picked.deviceId && (slots.left.state === 'ready' || slots.left.state === 'streaming')) ||
        (slots.right?.deviceId === picked.deviceId && (slots.right.state === 'ready' || slots.right.state === 'streaming'))
      if (alreadyConnected) {
        const durationMs = Math.round(performance.now() - connectStart)
        patchReport((r) => {
          r.connect = { ok: true, deviceId: picked!.deviceId, durationMs }
        })
        logger.info('spike.connect.reused', 'Reused existing coordinator connection', {
          durationMs: safe(durationMs),
        })
      } else {
        await withTimeout(
          facade.connect(picked.deviceId, { timeoutMs: CONNECT_TIMEOUT_MS }),
          CONNECT_TIMEOUT_MS + 500,
          'connect',
        )
        if (cancelledRef.current) return
        const durationMs = Math.round(performance.now() - connectStart)
        patchReport((r) => {
          r.connect = { ok: true, deviceId: picked!.deviceId, durationMs }
        })
        logger.info('spike.connect.ok', 'Connected', { durationMs: safe(durationMs) })
      }
    } catch (e) {
      if (cancelledRef.current) return
      const durationMs = Math.round(performance.now() - connectStart)
      patchReport((r) => {
        r.connect = { ok: false, deviceId: picked!.deviceId, durationMs, errorMessage: errMessage(e) }
      })
      logger.error('spike.connect.error', 'Connect failed', { error: safe(errMessage(e)) })
      safeSetState((s) => ({ ...s, phase: 'idle', message: `Connect failed: ${errMessage(e)}` }))
      return
    }

    // Stage 5 — discover.
    safeSetState((s) => ({ ...s, phase: 'discovering', message: 'Discovering services & characteristics…' }))
    const discoverStart = performance.now()
    let snapshot: GattSnapshot
    try {
      snapshot = await facade.discoverAllServicesAndCharacteristics(picked.deviceId)
      if (cancelledRef.current) return
      const durationMs = Math.round(performance.now() - discoverStart)
      const charCount = snapshot.services.reduce((n, s) => n + s.characteristics.length, 0)
      const services = snapshot.services.map((svc) => ({
        uuid: svc.uuid,
        characteristics: svc.characteristics.map((c) => ({ uuid: c.uuid, properties: c.properties })),
      }))
      patchReport((r) => {
        r.discover = { ok: true, serviceCount: snapshot.services.length, characteristicCount: charCount, durationMs, services }
      })
      logger.info('spike.discover.ok', 'Discover finished', {
        durationMs: safe(durationMs),
        services: safe(snapshot.services.length),
        characteristics: safe(charCount),
      })
    } catch (e) {
      if (cancelledRef.current) return
      const durationMs = Math.round(performance.now() - discoverStart)
      patchReport((r) => {
        r.discover = { ok: false, serviceCount: 0, characteristicCount: 0, durationMs, errorMessage: errMessage(e) }
      })
      logger.error('spike.discover.error', 'Discover failed', { error: safe(errMessage(e)) })
      safeSetState((s) => ({ ...s, phase: 'idle', message: `Discover failed: ${errMessage(e)}` }))
      return
    }

    // Stage 6 + 7 — subscribe to every notify/indicate characteristic and
    // wait for the first frame. Extracted into runSubscribeStage so the
    // "coordinator already connected" shortcut above can reuse it.
    await runSubscribeStage(snapshot, picked.deviceId)
  }, [info.appVersion, info.gitSha, patchReport, safeSetState])

  const onPickDevice = useCallback((ad: AdvertisementSnapshot) => {
    if (pickResolverRef.current) {
      pickResolverRef.current(ad)
      pickResolverRef.current = null
    }
  }, [])

  const onCopyReport = useCallback(async () => {
    if (!state.report) return
    const json = JSON.stringify(state.report, null, 2)
    try {
      await Clipboard.setStringAsync(json)
      logger.info('spike.report.copied', 'Report copied to clipboard')
      setState((s) => ({ ...s, message: 'Report copied to clipboard.' }))
    } catch (e) {
      logger.warn('spike.report.copyFailed', 'Clipboard copy failed', { error: safe(errMessage(e)) })
      setState((s) => ({ ...s, message: 'Clipboard unavailable — report shown below.' }))
    }
  }, [state.report])

  const onReset = useCallback(() => {
    cancelledRef.current = true
    if (pickResolverRef.current) {
      pickResolverRef.current(null)
      pickResolverRef.current = null
    }
    const handles = allHandlesRef.current
    allHandlesRef.current = []
    subscriptionRef.current = null
    for (const h of handles) {
      try { h.unsubscribe() } catch { /* best-effort */ }
    }
    const deviceId = deviceIdRef.current
    deviceIdRef.current = null
    if (deviceId) {
      const facade = getBleManager()
      facade.disconnect(deviceId).catch(() => { /* best-effort */ })
    }
    setState({ phase: 'idle', message: 'Tap Run spike to begin.', candidates: [], report: null })
    logger.info('spike.reset', 'Spike state reset')
  }, [])

  const isRunning = state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'awaiting-pick'

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>BLE spike harness</Text>
      <Text style={styles.subtitle}>{state.message}</Text>
      <Text style={styles.phase}>Phase: {state.phase}</Text>

      <View style={styles.row}>
        <Pressable
          style={[styles.btn, isRunning && styles.btnDisabled]}
          disabled={isRunning}
          onPress={() => { void runSpike() }}
        >
          <Text style={styles.btnText}>Run spike</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={onReset}>
          <Text style={styles.btnText}>Reset</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, !state.report && styles.btnDisabled]}
          disabled={!state.report}
          onPress={() => { void onCopyReport() }}
        >
          <Text style={styles.btnText}>Copy report as JSON</Text>
        </Pressable>
      </View>

      {state.phase === 'awaiting-pick' ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Pick a device ({state.candidates.length})</Text>
          <Text style={styles.sectionHint}>Named devices are listed first, then by RSSI (strongest signal at top). If neither tracker appears, wake them (rub / tap them) — many BLE trackers only advertise briefly after motion.</Text>
          {state.candidates.map((ad) => (
            <Pressable key={ad.deviceId} style={styles.deviceRow} onPress={() => onPickDevice(ad)}>
              <Text style={[styles.deviceName, !ad.name && styles.deviceNameFaint]}>{ad.name ?? '(no name)'}</Text>
              <Text style={styles.deviceMeta}>
                {ad.deviceId} · rssi {ad.rssi ?? '?'}
                {ad.serviceUuids.length ? ` · ${ad.serviceUuids.length} svc` : ''}
                {ad.manufacturerDataBase64 ? ` · mfg ${base64ToHex(ad.manufacturerDataBase64).slice(0, 16)}` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {state.report ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Report</Text>
          <StageRow label='scan' ok={state.report.scan.ok} durationMs={state.report.scan.durationMs} note={`${state.report.scan.devicesFound} devices`} error={state.report.scan.errorMessage} />
          <StageRow label='connect' ok={state.report.connect.ok} durationMs={state.report.connect.durationMs} error={state.report.connect.errorMessage} />
          <StageRow label='discover' ok={state.report.discover.ok} durationMs={state.report.discover.durationMs} note={`${state.report.discover.serviceCount} svcs / ${state.report.discover.characteristicCount} chars`} error={state.report.discover.errorMessage} />
          <StageRow
            label='subscribe'
            ok={state.report.subscribe.ok}
            durationMs={state.report.subscribe.firstFrameWithinMs ?? 0}
            note={state.report.subscribe.firstFrameWithinMs !== undefined ? `first frame ${state.report.subscribe.firstFrameWithinMs}ms` : 'no frame'}
            error={state.report.subscribe.errorMessage}
          />
          {state.firstFrameHex ? (
            <Text style={styles.hex} numberOfLines={2}>frame: {state.firstFrameHex}</Text>
          ) : null}
          <Text style={styles.json} selectable>
            {JSON.stringify(state.report, null, 2)}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  )
}

function StageRow(props: { label: string; ok: boolean; durationMs: number; note?: string; error?: string }) {
  return (
    <View style={styles.stageRow}>
      <Text style={[styles.stageLabel, props.ok ? styles.pass : styles.fail]}>
        {props.ok ? 'PASS' : 'FAIL'} · {props.label}
      </Text>
      <Text style={styles.stageMeta}>
        {props.durationMs}ms{props.note ? ` · ${props.note}` : ''}
      </Text>
      {props.error ? <Text style={styles.errorText}>{props.error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 48 },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '600' },
  subtitle: { color: colors.textSecondary, marginTop: 4 },
  phase: { color: colors.textMuted, marginTop: 2, fontFamily: 'monospace' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  btn: { backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: colors.textPrimary, fontWeight: '600' },
  section: { marginTop: 20 },
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: 8 },
  sectionHint: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  deviceRow: { paddingVertical: 10, borderBottomColor: colors.surface, borderBottomWidth: 1 },
  deviceName: { color: colors.textPrimary, fontSize: 15 },
  deviceNameFaint: { color: colors.textMuted, fontStyle: 'italic' },
  deviceMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  stageRow: { paddingVertical: 6, borderBottomColor: colors.surface, borderBottomWidth: 1 },
  stageLabel: { fontWeight: '700', fontFamily: 'monospace' },
  stageMeta: { color: colors.textSecondary, fontFamily: 'monospace', fontSize: 12, marginTop: 2 },
  pass: { color: colors.success },
  fail: { color: colors.trackerRight },
  errorText: { color: colors.danger, fontSize: 12, marginTop: 2 },
  hex: { color: colors.textSecondary, fontFamily: 'monospace', fontSize: 11, marginTop: 8 },
  json: { color: colors.textMuted, fontFamily: 'monospace', fontSize: 10, marginTop: 12 },
})
