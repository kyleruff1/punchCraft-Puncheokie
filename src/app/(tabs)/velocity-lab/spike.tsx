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
import { getBuildInfo } from '@/diagnostics/buildInfo'
import { deviceSensitive, logger, safe } from '@/diagnostics/logger'

const SCAN_TIMEOUT_MS = 12_000
const CONNECT_TIMEOUT_MS = 15_000
const FIRST_FRAME_TIMEOUT_MS = 10_000
const CANDIDATE_NAME = /hykso|fightcamp/i

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
  const info = useMemo(() => getBuildInfo(), [])
  const [state, setState] = useState<UiState>({
    phase: 'idle',
    message: 'Tap Run spike to begin.',
    candidates: [],
    report: null,
  })
  const cancelledRef = useRef(false)
  const subscriptionRef = useRef<SubscriptionHandle | null>(null)
  const deviceIdRef = useRef<string | null>(null)
  const pickResolverRef = useRef<((ad: AdvertisementSnapshot | null) => void) | null>(null)

  useEffect(() => {
    return () => {
      cancelledRef.current = true
      const handle = subscriptionRef.current
      subscriptionRef.current = null
      if (handle) {
        try { handle.unsubscribe() } catch { /* best-effort */ }
      }
      // Fire-and-forget disconnect via facade destroy is intentionally not
      // called here — the facade is a shared singleton owned by app bootstrap.
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
    cancelledRef.current = false
    subscriptionRef.current = null
    deviceIdRef.current = null
    const runId = newRunId()
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

    // Stage 2 — scan. Discovery mode: no service filter.
    // Ownership: TrackerScanner runs a bounded scan and calls stopScan itself.
    // The spike screen never calls facade.stopScan().
    safeSetState((s) => ({ ...s, phase: 'scanning', message: `Scanning for up to ${SCAN_TIMEOUT_MS / 1000}s…` }))
    const scanStart = performance.now()
    let discovered: AdvertisementSnapshot[] = []
    try {
      const scanner = new TrackerScanner(facade)
      discovered = await scanner.run({ timeoutMs: SCAN_TIMEOUT_MS })
      if (cancelledRef.current) return
      const durationMs = Math.round(performance.now() - scanStart)
      patchReport((r) => {
        r.scan = { ok: discovered.length > 0, devicesFound: discovered.length, durationMs }
      })
      safeSetState((s) => ({ ...s, candidates: discovered }))
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
      discovered.find((ad) => ad.name != null && CANDIDATE_NAME.test(ad.name)) ?? null
    if (!picked) {
      safeSetState((s) => ({ ...s, phase: 'awaiting-pick', message: 'Pick a device to continue.' }))
      picked = await new Promise<AdvertisementSnapshot | null>((resolve) => {
        pickResolverRef.current = resolve
      })
      pickResolverRef.current = null
      if (cancelledRef.current) return
      if (!picked) {
        safeSetState((s) => ({ ...s, phase: 'idle', message: 'Cancelled.' }))
        return
      }
    }
    deviceIdRef.current = picked.deviceId
    logger.info('spike.picked', 'Device picked', {
      deviceId: deviceSensitive(picked.deviceId),
      name: deviceSensitive(picked.name ?? null),
      rssi: safe(picked.rssi ?? null),
    })

    // Stage 4 — connect.
    safeSetState((s) => ({ ...s, phase: 'connecting', message: `Connecting (timeout ${CONNECT_TIMEOUT_MS / 1000}s)…` }))
    const connectStart = performance.now()
    try {
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
      patchReport((r) => {
        r.discover = { ok: true, serviceCount: snapshot.services.length, characteristicCount: charCount, durationMs }
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

    // Stage 6 — pick FIRST notify/indicate characteristic and subscribe.
    safeSetState((s) => ({ ...s, phase: 'subscribing', message: 'Subscribing to first notify characteristic…' }))
    let firstNotify: { serviceUuid: string; characteristicUuid: string } | null = null
    for (const svc of snapshot.services) {
      for (const c of svc.characteristics) {
        if (c.properties.notify || c.properties.indicate) {
          firstNotify = { serviceUuid: svc.uuid, characteristicUuid: c.uuid }
          break
        }
      }
      if (firstNotify) break
    }

    if (!firstNotify) {
      const missing: SubscriptionResult = {
        serviceUuid: '',
        characteristicUuid: '',
        direction: 'notification',
        success: false,
        errorMessage: 'no notify characteristic on this device',
      }
      patchReport((r) => {
        r.subscribe = {
          ok: false,
          subscribed: 0,
          subscriptions: [missing],
          errorMessage: 'no notify characteristic on this device',
        }
        r.finishedAtIso = new Date().toISOString()
      })
      logger.warn('spike.subscribe.skipped', 'No notify characteristic present')
      safeSetState((s) => ({ ...s, phase: 'done', message: 'Done — subscribe skipped (no notifiables).' }))
      return
    }

    // Stage 7 — subscribe, then wait for first frame.
    // `subReady` gates onFrame so any frame that lands before we've
    // sampled subStart is dropped — otherwise firstFrameWithinMs would
    // be negative and misleading.
    let firstFrameAt: number | null = null
    let firstFrameHex: string | undefined
    let handle: SubscriptionHandle | null = null
    let subResult: SubscriptionResult
    let subReady = false
    try {
      handle = await facade.monitorCharacteristic(
        picked.deviceId,
        firstNotify.serviceUuid,
        firstNotify.characteristicUuid,
        (frame: RawBleFrame) => {
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
        },
      )
      // Wait for the definitive setup outcome — this is what tells us
      // whether the CCCD write succeeded, not just whether the library's
      // synchronous setup call threw.
      subResult = await handle.setupOutcome
    } catch (e) {
      subResult = {
        serviceUuid: firstNotify.serviceUuid,
        characteristicUuid: firstNotify.characteristicUuid,
        direction: 'notification',
        success: false,
        errorMessage: errMessage(e),
      }
    }

    if (cancelledRef.current) {
      if (handle) {
        try { handle.unsubscribe() } catch { /* best-effort */ }
      }
      return
    }

    if (!handle || !subResult.success) {
      patchReport((r) => {
        r.subscribe = {
          ok: false,
          subscribed: 0,
          subscriptions: [subResult],
          errorMessage: subResult.errorMessage ?? 'subscribe failed',
        }
        r.finishedAtIso = new Date().toISOString()
      })
      logger.error('spike.subscribe.error', 'Subscribe failed', { error: safe(subResult.errorMessage ?? 'unknown') })
      safeSetState((s) => ({ ...s, phase: 'done', message: `Subscribe failed: ${subResult.errorMessage ?? 'unknown'}` }))
      return
    }

    subscriptionRef.current = handle
    safeSetState((s) => ({ ...s, phase: 'awaiting-frame', message: `Awaiting first frame (up to ${FIRST_FRAME_TIMEOUT_MS / 1000}s)…` }))

    // subStart AFTER the CCCD-confirmed subscription — measures device→app
    // frame latency, not CCCD-write latency. Flip subReady so the onFrame
    // callback stops dropping frames.
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
        subscribed: 1,
        firstFrameWithinMs,
        subscriptions: [subResult],
        errorMessage: gotFrame ? undefined : `no frame received within ${FIRST_FRAME_TIMEOUT_MS}ms`,
      }
      r.finishedAtIso = new Date().toISOString()
    })
    if (gotFrame) {
      logger.info('spike.done.ok', 'Spike completed with first frame', {
        firstFrameWithinMs: safe(firstFrameWithinMs ?? -1),
      })
      safeSetState((s) => ({
        ...s,
        phase: 'done',
        message: `Done — first frame within ${firstFrameWithinMs}ms.`,
        firstFrameHex,
      }))
    } else {
      logger.warn('spike.done.noframe', 'Subscribed but no frame observed within timeout')
      safeSetState((s) => ({ ...s, phase: 'done', message: 'Done — subscribed but no frame observed.' }))
    }
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
    const handle = subscriptionRef.current
    subscriptionRef.current = null
    if (handle) {
      try { handle.unsubscribe() } catch { /* best-effort */ }
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
          {state.candidates.map((ad) => (
            <Pressable key={ad.deviceId} style={styles.deviceRow} onPress={() => onPickDevice(ad)}>
              <Text style={styles.deviceName}>{ad.name ?? '(no name)'}</Text>
              <Text style={styles.deviceMeta}>{ad.deviceId} · rssi {ad.rssi ?? '?'}</Text>
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
  root: { flex: 1, backgroundColor: '#0b0b0d' },
  content: { padding: 16, paddingBottom: 48 },
  title: { color: '#fff', fontSize: 22, fontWeight: '600' },
  subtitle: { color: '#c6c6c6', marginTop: 4 },
  phase: { color: '#8f8f8f', marginTop: 2, fontFamily: 'monospace' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  btn: { backgroundColor: '#2c6bed', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '600' },
  section: { marginTop: 20 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  deviceRow: { paddingVertical: 10, borderBottomColor: '#1f1f22', borderBottomWidth: 1 },
  deviceName: { color: '#fff', fontSize: 15 },
  deviceMeta: { color: '#8f8f8f', fontSize: 12, marginTop: 2 },
  stageRow: { paddingVertical: 6, borderBottomColor: '#1f1f22', borderBottomWidth: 1 },
  stageLabel: { fontWeight: '700', fontFamily: 'monospace' },
  stageMeta: { color: '#c6c6c6', fontFamily: 'monospace', fontSize: 12, marginTop: 2 },
  pass: { color: '#3ecf8e' },
  fail: { color: '#ff6b6b' },
  errorText: { color: '#ff9b9b', fontSize: 12, marginTop: 2 },
  hex: { color: '#c6c6c6', fontFamily: 'monospace', fontSize: 11, marginTop: 8 },
  json: { color: '#8f8f8f', fontFamily: 'monospace', fontSize: 10, marginTop: 12 },
})
