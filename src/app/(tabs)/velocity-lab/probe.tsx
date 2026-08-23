/**
 * M02-02 — Protocol probe.
 *
 * Developer-mode workbench (§7.2C) for reverse-engineering the FightCamp v1
 * custom service. Subscribes to every notify + indicate characteristic on
 * the currently-connected tracker and lets the operator send arbitrary
 * bytes to any writable characteristic while the interleaved event log
 * shows writes, reads, notifications and errors in receive order.
 *
 * Every write, read and notification is logged via logger.info with the
 * target uuid classified as device-sensitive. Nothing here interprets
 * frame payloads as impact / force / power / energy — the surface is
 * neutral bytes (§4.3, §7.2C, §12.1).
 */
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Link } from 'expo-router'

import { getBleManager } from '@ble/BleManagerFacade'
import type { SubscriptionHandle } from '@ble/BleManagerFacade'
import type {
  GattCharacteristicSnapshot,
  GattSnapshot,
  RawBleFrame,
} from '@ble/bleTypes'
import { deviceSensitive, logger, safe } from '@/diagnostics/logger'
import { useCaptureSession } from '@capture/useCaptureSession'
import { useLeftSlot, useRightSlot } from '@/state/useTrackerStore'
import { colors } from '@/theme/colors'

/** FightCamp v1 custom service (H05). */
const FIGHTCAMP_SERVICE_UUID = 'ca280069-5470-4e34-94dd-caf160200b29'
/** H07 candidate command channel — highlight in the writes table. */
const H07_COMMAND_UUID_PREFIX = 'ca281079'
/** H07 candidate punch-stream channel — highlight in the notify table. */
const H07_STREAM_UUID_PREFIX = 'ca281077'

const MAX_LOG_ENTRIES = 200

/** Pure-JS base64 → hex. Duplicates the impl in spike.tsx / BleManagerBlePlxImpl
 * so the probe does not import library-specific code. */
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

/** Normalize a user-typed hex string: strip whitespace + separators, lower-case.
 * Returns null if the result is empty or has an odd number of nibbles or
 * contains any non-hex character. */
function parseHexInput(raw: string): string | null {
  const cleaned = raw.replace(/[\s:,-]/g, '').toLowerCase()
  if (cleaned.length === 0) return null
  if (cleaned.length % 2 !== 0) return null
  if (!/^[0-9a-f]+$/.test(cleaned)) return null
  return cleaned
}

/** First 8 hex chars of a UUID for compact table rows. */
function shortUuid(uuid: string): string {
  return uuid.slice(0, 8).toLowerCase()
}

function startsWith(uuid: string, prefix: string): boolean {
  return uuid.slice(0, prefix.length).toLowerCase() === prefix.toLowerCase()
}

type CharProps = GattCharacteristicSnapshot['properties']
function propsSummary(c: { properties?: CharProps; props?: CharProps }): string {
  const p = c.properties ?? c.props
  if (!p) return '-'
  const parts: string[] = []
  if (p.read) parts.push('R')
  if (p.write) parts.push('W')
  if (p.writeWithoutResponse) parts.push('Wnr')
  if (p.notify) parts.push('N')
  if (p.indicate) parts.push('I')
  return parts.join(' ') || '-'
}

type LogKind = 'W' | 'R' | 'N' | 'E'

interface LogEntry {
  seq: number
  monotonicTimeMs: number
  kind: LogKind
  serviceUuid: string
  characteristicUuid: string
  hex: string
  error?: string
  /** For notifications: 'notification' | 'indication'. */
  direction?: string
}

type FilterId = 'all' | 'custom' | 'notify' | 'writes' | 'errors'

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'custom', label: 'Custom service only' },
  { id: 'notify', label: 'Notifications only' },
  { id: 'writes', label: 'Writes only' },
  { id: 'errors', label: 'Errors only' },
]

const PRESETS: Array<{ label: string; hex: string }> = [
  { label: '00', hex: '00' },
  { label: '01', hex: '01' },
  { label: 'ff', hex: 'ff' },
  { label: 'aa 55', hex: 'aa55' },
  { label: '02 00', hex: '0200' },
  { label: '01 01', hex: '0101' },
  { label: 'start (01)', hex: '01' },
  { label: 'stop (00)', hex: '00' },
]

interface WritableRow {
  serviceUuid: string
  characteristicUuid: string
  props: GattCharacteristicSnapshot['properties']
}

interface NotifiableRow {
  serviceUuid: string
  characteristicUuid: string
  props: GattCharacteristicSnapshot['properties']
}

interface ReadableRow {
  serviceUuid: string
  characteristicUuid: string
}

function collectWritable(snapshot: GattSnapshot | null): WritableRow[] {
  if (!snapshot) return []
  const out: WritableRow[] = []
  for (const svc of snapshot.services) {
    for (const c of svc.characteristics) {
      if (c.properties.write || c.properties.writeWithoutResponse) {
        out.push({ serviceUuid: svc.uuid, characteristicUuid: c.uuid, props: c.properties })
      }
    }
  }
  return out
}

function collectNotifiable(snapshot: GattSnapshot | null): NotifiableRow[] {
  if (!snapshot) return []
  const out: NotifiableRow[] = []
  for (const svc of snapshot.services) {
    for (const c of svc.characteristics) {
      if (c.properties.notify || c.properties.indicate) {
        out.push({ serviceUuid: svc.uuid, characteristicUuid: c.uuid, props: c.properties })
      }
    }
  }
  return out
}

function collectReadable(snapshot: GattSnapshot | null): ReadableRow[] {
  if (!snapshot) return []
  const out: ReadableRow[] = []
  for (const svc of snapshot.services) {
    for (const c of svc.characteristics) {
      if (c.properties.read) out.push({ serviceUuid: svc.uuid, characteristicUuid: c.uuid })
    }
  }
  return out
}

function truncateDeviceId(id: string): string {
  if (id.length <= 8) return id
  return `${id.slice(0, 4)}…${id.slice(-4)}`
}

export default function ProtocolProbeScreen(): React.ReactElement {
  // Opens a capture for this screen. The transport persists every frame into
  // it before delivering to the handler below, so probe traffic is retained
  // for later analysis instead of existing only in this screen's ring buffer.
  useCaptureSession('protocol-probe')

  const leftSlot = useLeftSlot()
  const rightSlot = useRightSlot()

  // Only probe a slot that is CURRENTLY connected (state ready | streaming).
  // Anything else — dormant / error / connecting / discovering / etc — means
  // the underlying GATT connection is not usable, and discoverAll will fail
  // with "Device X is not connected". Better to show a clear "connect a
  // tracker first" than to try and fail every time.
  const activeSlot = useMemo(() => {
    const ready = (s: typeof leftSlot) =>
      s && (s.state === 'ready' || s.state === 'streaming') ? s : null
    return ready(rightSlot) ?? ready(leftSlot) ?? null
  }, [leftSlot, rightSlot])

  const [snapshot, setSnapshot] = useState<GattSnapshot | null>(null)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [subscribedCount, setSubscribedCount] = useState(0)
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<FilterId>('all')
  const [hexInput, setHexInput] = useState('01')
  const [targetUuid, setTargetUuid] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('initializing…')

  const handlesRef = useRef<SubscriptionHandle[]>([])
  const seqRef = useRef(0)
  const firstMonotonicRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  const append = useCallback((partial: Omit<LogEntry, 'seq' | 'monotonicTimeMs'> & { monotonicTimeMs?: number }) => {
    const now = partial.monotonicTimeMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now())
    if (firstMonotonicRef.current == null) firstMonotonicRef.current = now
    const entry: LogEntry = {
      seq: seqRef.current++,
      monotonicTimeMs: now,
      kind: partial.kind,
      serviceUuid: partial.serviceUuid,
      characteristicUuid: partial.characteristicUuid,
      hex: partial.hex,
      error: partial.error,
      direction: partial.direction,
    }
    setEntries((prev) => {
      const next = [entry, ...prev]
      if (next.length > MAX_LOG_ENTRIES) next.length = MAX_LOG_ENTRIES
      return next
    })
  }, [])

  // Discover + subscribe on mount.
  useEffect(() => {
    mountedRef.current = true
    if (!activeSlot) {
      setStatus('No tracker connected.')
      return
    }
    const deviceId = activeSlot.deviceId
    const facade = getBleManager()
    let cancelled = false
    setStatus(`Discovering on ${truncateDeviceId(deviceId)}…`)

    const run = async (): Promise<void> => {
      try {
        const snap = await facade.discoverAllServicesAndCharacteristics(deviceId)
        if (cancelled || !mountedRef.current) return
        setSnapshot(snap)

        // Default the write target to the H07 command candidate if present,
        // else the first writable characteristic overall.
        const writable = collectWritable(snap)
        const h07 = writable.find((w) => startsWith(w.characteristicUuid, H07_COMMAND_UUID_PREFIX))
        setTargetUuid((prev) => prev ?? h07?.characteristicUuid ?? writable[0]?.characteristicUuid ?? null)

        setStatus(`Subscribing on ${truncateDeviceId(deviceId)}…`)
        const handles = await facade.monitorAllNotifiable(snap, (frame: RawBleFrame) => {
          logger.info('probe.notification', 'notify/indicate frame received', {
            characteristicUuid: deviceSensitive(frame.characteristicUuid),
            serviceUuid: deviceSensitive(frame.serviceUuid),
            byteCount: safe(Math.floor(frame.valueHex.length / 2)),
            direction: safe(frame.direction),
          })
          append({
            kind: 'N',
            serviceUuid: frame.serviceUuid,
            characteristicUuid: frame.characteristicUuid,
            hex: frame.valueHex,
            direction: frame.direction,
            monotonicTimeMs: frame.monotonicTimeMs,
          })
        })
        if (cancelled || !mountedRef.current) {
          for (const h of handles) {
            try { h.unsubscribe() } catch { /* ignore */ }
          }
          return
        }
        handlesRef.current = handles
        const okCount = handles.filter((h) => h.result.success).length
        setSubscribedCount(okCount)
        setStatus(`Subscribed to ${okCount} of ${handles.length} channels on ${truncateDeviceId(deviceId)}.`)
        for (const h of handles) {
          if (!h.result.success) {
            append({
              kind: 'E',
              serviceUuid: h.result.serviceUuid,
              characteristicUuid: h.result.characteristicUuid,
              hex: '',
              error: `subscribe: ${h.result.errorMessage ?? 'unknown error'}`,
            })
          }
        }
      } catch (e) {
        if (cancelled || !mountedRef.current) return
        const msg = (e as Error)?.message ?? String(e)
        setDiscoverError(msg)
        setStatus(`Discovery failed: ${msg}`)
      }
    }
    void run()

    return () => {
      cancelled = true
      mountedRef.current = false
      const handles = handlesRef.current
      handlesRef.current = []
      for (const h of handles) {
        try { h.unsubscribe() } catch { /* ignore */ }
      }
    }
    // Intentionally re-run only if the active device changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSlot?.deviceId])

  const writable = useMemo(() => collectWritable(snapshot), [snapshot])
  const notifiable = useMemo(() => collectNotifiable(snapshot), [snapshot])
  const readable = useMemo(() => collectReadable(snapshot), [snapshot])

  const readableMap = useMemo(() => {
    const set = new Set<string>()
    for (const r of readable) set.add(`${r.serviceUuid}:${r.characteristicUuid}`)
    return set
  }, [readable])

  const targetWritable = useMemo(
    () => writable.find((w) => w.characteristicUuid === targetUuid) ?? null,
    [writable, targetUuid],
  )

  const dispatchWrite = useCallback(
    async (serviceUuid: string, characteristicUuid: string, props: GattCharacteristicSnapshot['properties'], hex: string) => {
      if (!activeSlot) return
      const facade = getBleManager()
      const withResponse = props.write || !props.writeWithoutResponse
      logger.info('probe.write', 'characteristic write dispatched', {
        characteristicUuid: deviceSensitive(characteristicUuid),
        serviceUuid: deviceSensitive(serviceUuid),
        byteCount: safe(Math.floor(hex.length / 2)),
        withResponse: safe(withResponse),
      })
      append({ kind: 'W', serviceUuid, characteristicUuid, hex })
      try {
        const result = await facade.writeCharacteristic(
          activeSlot.deviceId,
          serviceUuid,
          characteristicUuid,
          { hex },
          withResponse,
        )
        if (!result.success) {
          logger.warn('probe.write.error', 'characteristic write failed', {
            characteristicUuid: deviceSensitive(characteristicUuid),
            serviceUuid: deviceSensitive(serviceUuid),
            errorMessage: safe(result.errorMessage ?? 'unknown'),
          })
          append({
            kind: 'E',
            serviceUuid,
            characteristicUuid,
            hex,
            error: `write: ${result.errorMessage ?? 'unknown error'}`,
          })
        }
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e)
        logger.error('probe.write.throw', 'characteristic write threw', {
          characteristicUuid: deviceSensitive(characteristicUuid),
          serviceUuid: deviceSensitive(serviceUuid),
          errorMessage: safe(msg),
        })
        append({ kind: 'E', serviceUuid, characteristicUuid, hex, error: `write: ${msg}` })
      }
    },
    [activeSlot, append],
  )

  const dispatchRead = useCallback(
    async (serviceUuid: string, characteristicUuid: string) => {
      if (!activeSlot) return
      const facade = getBleManager()
      logger.info('probe.read', 'characteristic read dispatched', {
        characteristicUuid: deviceSensitive(characteristicUuid),
        serviceUuid: deviceSensitive(serviceUuid),
      })
      try {
        const result = await facade.readCharacteristic(activeSlot.deviceId, serviceUuid, characteristicUuid)
        if (result.success) {
          const hex = result.valueHex ?? (result.valueBase64 ? base64ToHex(result.valueBase64) : '')
          logger.info('probe.read.ok', 'characteristic read succeeded', {
            characteristicUuid: deviceSensitive(characteristicUuid),
            byteCount: safe(Math.floor(hex.length / 2)),
          })
          append({ kind: 'R', serviceUuid, characteristicUuid, hex })
        } else {
          logger.warn('probe.read.error', 'characteristic read failed', {
            characteristicUuid: deviceSensitive(characteristicUuid),
            errorMessage: safe(result.errorMessage ?? 'unknown'),
          })
          append({
            kind: 'E',
            serviceUuid,
            characteristicUuid,
            hex: '',
            error: `read: ${result.errorMessage ?? 'unknown error'}`,
          })
        }
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e)
        logger.error('probe.read.throw', 'characteristic read threw', {
          characteristicUuid: deviceSensitive(characteristicUuid),
          errorMessage: safe(msg),
        })
        append({ kind: 'E', serviceUuid, characteristicUuid, hex: '', error: `read: ${msg}` })
      }
    },
    [activeSlot, append],
  )

  const onSend = useCallback(() => {
    if (!targetWritable) return
    const hex = parseHexInput(hexInput)
    if (!hex) {
      append({
        kind: 'E',
        serviceUuid: targetWritable.serviceUuid,
        characteristicUuid: targetWritable.characteristicUuid,
        hex: hexInput,
        error: 'invalid hex input (expected pairs of 0-9a-f, whitespace ok)',
      })
      return
    }
    void dispatchWrite(targetWritable.serviceUuid, targetWritable.characteristicUuid, targetWritable.props, hex)
  }, [append, dispatchWrite, hexInput, targetWritable])

  const onPreset = useCallback(
    (hex: string) => {
      if (!targetWritable) return
      void dispatchWrite(targetWritable.serviceUuid, targetWritable.characteristicUuid, targetWritable.props, hex)
    },
    [dispatchWrite, targetWritable],
  )

  const onUnsubscribe = useCallback(
    (serviceUuid: string, characteristicUuid: string) => {
      const handles = handlesRef.current
      let removed = 0
      const remaining: SubscriptionHandle[] = []
      for (const h of handles) {
        if (
          h.result.serviceUuid.toLowerCase() === serviceUuid.toLowerCase() &&
          h.result.characteristicUuid.toLowerCase() === characteristicUuid.toLowerCase()
        ) {
          try { h.unsubscribe() } catch { /* ignore */ }
          removed++
        } else {
          remaining.push(h)
        }
      }
      handlesRef.current = remaining
      if (removed > 0) {
        setSubscribedCount(remaining.filter((h) => h.result.success).length)
        logger.info('probe.unsubscribe', 'characteristic unsubscribed', {
          characteristicUuid: deviceSensitive(characteristicUuid),
          serviceUuid: deviceSensitive(serviceUuid),
        })
      }
    },
    [],
  )

  const onClearLog = useCallback(() => {
    setEntries([])
    firstMonotonicRef.current = null
  }, [])

  const onExport = useCallback(async () => {
    const payload = {
      exportedAtIso: new Date().toISOString(),
      deviceId: activeSlot?.deviceId ?? null,
      subscribedCount,
      entries: entries.map((e) => ({
        seq: e.seq,
        elapsedMs: firstMonotonicRef.current != null ? Math.round(e.monotonicTimeMs - firstMonotonicRef.current) : 0,
        kind: e.kind,
        serviceUuid: e.serviceUuid,
        characteristicUuid: e.characteristicUuid,
        hex: e.hex,
        error: e.error,
        direction: e.direction,
      })),
    }
    try {
      await Clipboard.setStringAsync(JSON.stringify(payload, null, 2))
      logger.info('probe.export', 'event log exported to clipboard', {
        entryCount: safe(entries.length),
      })
    } catch (e) {
      logger.warn('probe.export.error', 'clipboard export failed', {
        errorMessage: safe((e as Error)?.message ?? String(e)),
      })
    }
  }, [activeSlot?.deviceId, entries, subscribedCount])

  const filteredEntries = useMemo(() => {
    return entries.filter((e) => {
      switch (filter) {
        case 'all':
          return true
        case 'custom':
          return startsWith(e.serviceUuid, FIGHTCAMP_SERVICE_UUID.slice(0, 8))
        case 'notify':
          return e.kind === 'N'
        case 'writes':
          return e.kind === 'W'
        case 'errors':
          return e.kind === 'E'
        default:
          return true
      }
    })
  }, [entries, filter])

  if (!activeSlot) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Protocol Probe</Text>
        <Text style={styles.subtitle}>Connect a tracker on the Velocity Lab landing first.</Text>
        <View style={styles.row}>
          <Link href='/(tabs)/velocity-lab' style={styles.linkBtn}>
            <Text style={styles.btnText}>Back to Velocity Lab</Text>
          </Link>
        </View>
      </ScrollView>
    )
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Protocol Probe</Text>
      <Text style={styles.subtitle}>{status}</Text>
      <Text style={styles.phase}>
        device {truncateDeviceId(activeSlot.deviceId)} · state {activeSlot.state} · subscribed {subscribedCount}
      </Text>
      {discoverError ? <Text style={styles.errorText}>Discover error: {discoverError}</Text> : null}

      <View style={styles.chipRow}>
        {FILTERS.map((f) => {
          const active = f.id === filter
          return (
            <Pressable
              key={f.id}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setFilter(f.id)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label}</Text>
            </Pressable>
          )
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Writable characteristics ({writable.length})</Text>
        <Text style={styles.sectionHint}>
          Tapping Send or a preset is the confirmation for the write. All writes are logged (§7.2C).
        </Text>
        {writable.length === 0 ? <Text style={styles.mutedRow}>none discovered</Text> : null}
        {writable.map((w) => {
          const isTarget = w.characteristicUuid === targetUuid
          const isH07 = startsWith(w.characteristicUuid, H07_COMMAND_UUID_PREFIX)
          const canRead = readableMap.has(`${w.serviceUuid}:${w.characteristicUuid}`)
          return (
            <View
              key={`w-${w.serviceUuid}-${w.characteristicUuid}`}
              style={[styles.charRow, isTarget && styles.charRowSelected]}
            >
              <Pressable onPress={() => setTargetUuid(w.characteristicUuid)} style={styles.charInfo}>
                <View style={styles.charHeader}>
                  <Text style={styles.charUuid}>{shortUuid(w.characteristicUuid)}</Text>
                  <Text style={styles.charProps}>{propsSummary(w)}</Text>
                  {isH07 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>H07 candidate</Text>
                    </View>
                  ) : null}
                  {isTarget ? <Text style={styles.selectMark}>target</Text> : null}
                </View>
                <Text style={styles.svcHint}>svc {shortUuid(w.serviceUuid)}</Text>
              </Pressable>
              <View style={styles.rowBtns}>
                <Pressable
                  style={styles.smallBtn}
                  onPress={() => {
                    const hex = parseHexInput(hexInput)
                    if (!hex) {
                      append({
                        kind: 'E',
                        serviceUuid: w.serviceUuid,
                        characteristicUuid: w.characteristicUuid,
                        hex: hexInput,
                        error: 'invalid hex input',
                      })
                      return
                    }
                    void dispatchWrite(w.serviceUuid, w.characteristicUuid, w.props, hex)
                  }}
                >
                  <Text style={styles.smallBtnText}>Send: {parseHexInput(hexInput) ?? '--'}</Text>
                </Pressable>
                {canRead ? (
                  <Pressable style={styles.smallBtnAlt} onPress={() => void dispatchRead(w.serviceUuid, w.characteristicUuid)}>
                    <Text style={styles.smallBtnText}>Read</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          )
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notify / indicate channels ({notifiable.length})</Text>
        {notifiable.length === 0 ? <Text style={styles.mutedRow}>none discovered</Text> : null}
        {notifiable.map((n) => {
          const isH07 = startsWith(n.characteristicUuid, H07_STREAM_UUID_PREFIX)
          const canRead = readableMap.has(`${n.serviceUuid}:${n.characteristicUuid}`)
          return (
            <View key={`n-${n.serviceUuid}-${n.characteristicUuid}`} style={styles.charRow}>
              <View style={styles.charInfo}>
                <View style={styles.charHeader}>
                  <Text style={styles.charUuid}>{shortUuid(n.characteristicUuid)}</Text>
                  <Text style={styles.charProps}>{propsSummary(n)}</Text>
                  {isH07 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>H07 candidate</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.svcHint}>svc {shortUuid(n.serviceUuid)}</Text>
              </View>
              <View style={styles.rowBtns}>
                {canRead ? (
                  <Pressable style={styles.smallBtnAlt} onPress={() => void dispatchRead(n.serviceUuid, n.characteristicUuid)}>
                    <Text style={styles.smallBtnText}>Read</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  style={styles.smallBtnDanger}
                  onPress={() => onUnsubscribe(n.serviceUuid, n.characteristicUuid)}
                >
                  <Text style={styles.smallBtnText}>Unsubscribe</Text>
                </Pressable>
              </View>
            </View>
          )
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Send arbitrary bytes</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={hexInput}
            onChangeText={setHexInput}
            autoCapitalize='none'
            autoCorrect={false}
            placeholder='hex bytes e.g. 01 or aa 55 03'
            placeholderTextColor={colors.textMuted}
          />
          <Pressable
            style={[styles.btn, (!targetWritable || !parseHexInput(hexInput)) && styles.btnDisabled]}
            onPress={onSend}
            disabled={!targetWritable || !parseHexInput(hexInput)}
          >
            <Text style={styles.btnText}>Send</Text>
          </Pressable>
        </View>
        <Text style={styles.sectionHint}>
          Target: {targetWritable ? shortUuid(targetWritable.characteristicUuid) : '(none)'}
          {targetWritable ? ` · ${propsSummary({ properties: targetWritable.props })}` : ''}
        </Text>
        <View style={styles.presetRow}>
          {PRESETS.map((p) => (
            <Pressable
              key={p.label}
              style={[styles.presetBtn, !targetWritable && styles.btnDisabled]}
              onPress={() => onPreset(p.hex)}
              disabled={!targetWritable}
            >
              <Text style={styles.presetText}>{p.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.logHeader}>
          <Text style={styles.sectionTitle}>Event log ({filteredEntries.length}/{entries.length})</Text>
          <View style={styles.rowBtns}>
            <Pressable style={styles.smallBtnAlt} onPress={onClearLog}>
              <Text style={styles.smallBtnText}>Clear log</Text>
            </Pressable>
            <Pressable style={styles.smallBtn} onPress={() => void onExport()}>
              <Text style={styles.smallBtnText}>Export JSON</Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.sectionHint}>newest first · elapsed ms from first event</Text>
        {filteredEntries.length === 0 ? (
          <Text style={styles.mutedRow}>no entries</Text>
        ) : null}
        {filteredEntries.map((e) => {
          const elapsed = firstMonotonicRef.current != null
            ? Math.round(e.monotonicTimeMs - firstMonotonicRef.current)
            : 0
          const arrow = e.kind === 'W' ? '←' : e.kind === 'R' ? '=' : e.kind === 'N' ? '→' : '←'
          const prefix = `[${elapsed.toString().padStart(6, ' ')}ms] ${e.kind}  ${shortUuid(e.characteristicUuid)} ${arrow} ${e.hex || '--'}`
          const suffix = e.error ? `  ERR: ${e.error}` : ''
          const style =
            e.kind === 'E'
              ? styles.logRowError
              : e.kind === 'N'
                ? styles.logRowNotify
                : e.kind === 'W'
                  ? styles.logRowWrite
                  : styles.logRowRead
          return (
            <Text key={e.seq} style={[styles.logRow, style]} selectable>
              {prefix}{suffix}
            </Text>
          )
        })}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 48 },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '600' },
  subtitle: { color: colors.textSecondary, marginTop: 4 },
  phase: { color: colors.textMuted, marginTop: 2, fontFamily: 'monospace', fontSize: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: 12 },
  chipTextActive: { color: colors.textPrimary, fontWeight: '600' },
  section: { marginTop: 20 },
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: 6 },
  sectionHint: { color: colors.textMuted, fontSize: 12, marginBottom: 8 },
  charRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomColor: colors.surface,
    borderBottomWidth: 1,
    gap: 8,
  },
  charRowSelected: { backgroundColor: colors.accentSurface },
  charInfo: { flex: 1 },
  charHeader: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  charUuid: { color: colors.textPrimary, fontFamily: 'monospace', fontSize: 13 },
  charProps: { color: colors.textMuted, fontFamily: 'monospace', fontSize: 11 },
  svcHint: { color: colors.textMuted, fontFamily: 'monospace', fontSize: 10, marginTop: 2 },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.surfaceElevated,
  },
  badgeText: { color: colors.warning, fontSize: 10, fontWeight: '600' },
  selectMark: { color: colors.success, fontSize: 10, fontWeight: '600' },
  rowBtns: { flexDirection: 'row', gap: 6 },
  smallBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  smallBtnAlt: {
    backgroundColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  smallBtnDanger: {
    backgroundColor: colors.dangerSurface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  smallBtnText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  btn: { backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: colors.textPrimary, fontWeight: '600' },
  linkBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    color: colors.textPrimary,
  },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: 'monospace',
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    fontSize: 14,
  },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  presetBtn: {
    backgroundColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  presetText: { color: colors.textPrimary, fontFamily: 'monospace', fontSize: 12 },
  logHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  logRow: { fontFamily: 'monospace', fontSize: 11, paddingVertical: 1 },
  logRowWrite: { color: colors.trackerLeft },
  logRowRead: { color: colors.textSecondary },
  logRowNotify: { color: colors.success },
  logRowError: { color: colors.danger },
  mutedRow: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic' },
  errorText: { color: colors.danger, fontSize: 12, marginTop: 4 },
})
