/**
 * M11 — Live decoded events (Velocity Lab).
 *
 * Subscribes to the connected FightCamp v1 tracker, runs the adapter's
 * initialization plan through the BleManagerFacade, then routes every
 * incoming RawBleFrame through adapter.decodeFrame BEFORE anything else
 * touches the bytes (§11.9, §12.4). Emits a rolling list of the last 50
 * TrackerPunchEvents plus a small metadata trail for
 * malformed / unknown / notes messages.
 *
 * Terminology is strictly §4.3: "tracker-reported velocity" / "tracker
 * units". Never m/s / mph / g / force / power / energy as a label. The
 * literal 'power' appears ONLY as a punchType value from §12.5.
 */
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Link } from 'expo-router'

import { getBleManager } from '@ble/BleManagerFacade'
import type { BleManagerFacade } from '@ble/BleManagerFacade'
import { logger, safe } from '@/diagnostics/logger'
import { getProtocolRegistry } from '@protocol/ProtocolRegistry'
import type { TrackerProtocolAdapter } from '@protocol/TrackerProtocolAdapter'
// Side-effect import — registers the FightCamp v1 adapter with the singleton
// registry (§16). Must run before getProtocolRegistry().list() is queried.
import '@protocol/fightcamp-v1'
import {
  startPunchStream as startPunchStreamModule,
  type PunchStreamController,
} from '@protocol/PunchStream'
import type { TrackerPunchEvent } from '@/domain/punch/PunchEvent'
import { useLeftSlot, useRightSlot } from '@/state/useTrackerStore'
import type { SlotState } from '@/state/useTrackerStore'

const MAX_EVENTS = 50
const MAX_META = 50
const FIGHTCAMP_V1_ID = 'fightcamp-v1'

type Hand = 'left' | 'right'

interface DecodedEventRow {
  seq: number
  event: TrackerPunchEvent
  /** ms since previous decoded event; 0 for the first. */
  deltaMs: number
}

type MetaKind = 'malformed' | 'unknown' | 'note' | 'init-error' | 'info'

interface MetaEntry {
  seq: number
  monotonicTimeMs: number
  kind: MetaKind
  text: string
}

interface StreamState {
  subscribedCount: number
  initErrorCount: number
}

interface StreamController {
  stop: () => void
  getState: () => StreamState
}

interface StartPunchStreamArgs {
  facade: BleManagerFacade
  deviceId: string
  adapter: TrackerProtocolAdapter
  hand: Hand
  onEvent: (event: TrackerPunchEvent) => void
  onDecodeMeta: (meta: { kind: MetaKind; text: string }) => void
}

/**
 * Boot a live decode session for the given adapter.
 *
 * Thin adapter around @protocol/PunchStream. This component keeps a synchronous
 * StreamController shape so the useEffect cleanup can stay ordinary; the
 * async PunchStream module is spun up in the background and its controller
 * plugged in on resolve. If stop() fires before the module resolves, the
 * resolved controller is torn down immediately.
 *
 * PunchStream is the ONLY parse path: it stamps hand-at-capture BEFORE
 * decode (§11.9, §12.4) and it NEVER writes to a characteristic outside
 * adapter.buildInitializationPlan (§12.1).
 */
function startPunchStream(args: StartPunchStreamArgs): StreamController {
  const { facade, deviceId, adapter, hand, onEvent, onDecodeMeta } = args
  let real: PunchStreamController | null = null
  let stopped = false
  let lastReportedInitErrors = 0

  const drainInitErrorsFrom = (ctl: PunchStreamController): void => {
    const errors = ctl.getState().initErrors
    for (let i = lastReportedInitErrors; i < errors.length; i++) {
      const msg = errors[i]
      if (msg == null) continue
      onDecodeMeta({ kind: 'init-error', text: msg })
    }
    lastReportedInitErrors = errors.length
  }

  startPunchStreamModule({
    facade,
    deviceId,
    adapter,
    hand,
    onEvent,
    onDecodeMeta: (m) => {
      if (m.malformed) {
        const detail = m.notes && m.notes.length > 0 ? m.notes.join('; ') : 'malformed frame'
        onDecodeMeta({ kind: 'malformed', text: `frame ${m.frameId}: ${detail}` })
        return
      }
      if (m.unknown) {
        const detail = m.notes && m.notes.length > 0 ? m.notes.join('; ') : 'unknown frame'
        onDecodeMeta({ kind: 'unknown', text: `frame ${m.frameId}: ${detail}` })
        return
      }
      if (m.notes) {
        for (const n of m.notes) onDecodeMeta({ kind: 'note', text: `frame ${m.frameId}: ${n}` })
      }
    },
  })
    .then((ctl) => {
      if (stopped) {
        void ctl.stop()
        return
      }
      real = ctl
      drainInitErrorsFrom(ctl)
      const s = ctl.getState()
      onDecodeMeta({
        kind: 'info',
        text: `init plan complete: ${s.subscribedCount} subscribed, ${s.initErrors.length} error(s)`,
      })
      logger.info('live.init.done', 'live decode init plan finished', {
        subscribedCount: safe(s.subscribedCount),
        initErrorCount: safe(s.initErrors.length),
        adapterId: safe(adapter.id),
        adapterVersion: safe(adapter.version),
      })
    })
    .catch((err) => {
      onDecodeMeta({
        kind: 'init-error',
        text: `punchstream startup threw: ${(err as Error)?.message ?? String(err)}`,
      })
    })

  return {
    stop: () => {
      if (stopped) return
      stopped = true
      const ctl = real
      real = null
      if (ctl) void ctl.stop()
    },
    getState: () => {
      if (!real) return { subscribedCount: 0, initErrorCount: 0 }
      const s = real.getState()
      return { subscribedCount: s.subscribedCount, initErrorCount: s.initErrors.length }
    },
  }
}

function truncateDeviceId(id: string): string {
  if (id.length <= 8) return id
  return `${id.slice(0, 4)}…${id.slice(-4)}`
}

function handInitial(hand: Hand): 'L' | 'R' {
  return hand === 'left' ? 'L' : 'R'
}

function pickSlot(left: SlotState | null, right: SlotState | null): { slot: SlotState; hand: Hand } | null {
  const ready = (s: SlotState | null): boolean =>
    !!s && (s.state === 'ready' || s.state === 'streaming')
  if (ready(right)) return { slot: right as SlotState, hand: 'right' }
  if (ready(left)) return { slot: left as SlotState, hand: 'left' }
  return null
}

export default function LiveDecodeScreen(): React.ReactElement {
  const leftSlot = useLeftSlot()
  const rightSlot = useRightSlot()

  const active = useMemo(() => pickSlot(leftSlot, rightSlot), [leftSlot, rightSlot])

  const [events, setEvents] = useState<DecodedEventRow[]>([])
  const [meta, setMeta] = useState<MetaEntry[]>([])
  const [streamState, setStreamState] = useState<StreamState>({ subscribedCount: 0, initErrorCount: 0 })

  const controllerRef = useRef<StreamController | null>(null)
  const seqRef = useRef(0)
  const metaSeqRef = useRef(0)
  const prevMonotonicRef = useRef<number | null>(null)

  const adapter = useMemo(() => {
    return getProtocolRegistry().list().find((a) => a.id === FIGHTCAMP_V1_ID) ?? null
  }, [])

  const onEvent = useCallback((event: TrackerPunchEvent) => {
    const prev = prevMonotonicRef.current
    const deltaMs = prev == null ? 0 : Math.max(0, Math.round(event.receivedMonotonicTimeMs - prev))
    prevMonotonicRef.current = event.receivedMonotonicTimeMs
    const row: DecodedEventRow = { seq: seqRef.current++, event, deltaMs }
    setEvents((prevRows) => {
      const next = [row, ...prevRows]
      if (next.length > MAX_EVENTS) next.length = MAX_EVENTS
      return next
    })
  }, [])

  const onDecodeMeta = useCallback((m: { kind: MetaKind; text: string }) => {
    const entry: MetaEntry = {
      seq: metaSeqRef.current++,
      monotonicTimeMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      kind: m.kind,
      text: m.text,
    }
    setMeta((prev) => {
      const next = [entry, ...prev]
      if (next.length > MAX_META) next.length = MAX_META
      return next
    })
    // Poll state; getState is cheap.
    const ctl = controllerRef.current
    if (ctl) setStreamState(ctl.getState())
  }, [])

  useEffect(() => {
    if (!active || !adapter) return
    const facade = getBleManager()
    const controller = startPunchStream({
      facade,
      deviceId: active.slot.deviceId,
      adapter,
      hand: active.hand,
      onEvent,
      onDecodeMeta,
    })
    controllerRef.current = controller
    return () => {
      controller.stop()
      controllerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.slot.deviceId, active?.hand, adapter])

  const onClear = useCallback(() => {
    setEvents([])
    setMeta([])
    prevMonotonicRef.current = null
  }, [])

  const onCopyJson = useCallback(async () => {
    const payload = {
      exportedAtIso: new Date().toISOString(),
      deviceId: active?.slot.deviceId ?? null,
      hand: active?.hand ?? null,
      adapterId: adapter?.id ?? null,
      adapterVersion: adapter?.version ?? null,
      subscribedCount: streamState.subscribedCount,
      initErrorCount: streamState.initErrorCount,
      events: events.map((r) => ({
        seq: r.seq,
        deltaMs: r.deltaMs,
        event: r.event,
      })),
      meta: meta.map((m) => ({ seq: m.seq, kind: m.kind, text: m.text })),
    }
    try {
      await Clipboard.setStringAsync(JSON.stringify(payload, null, 2))
      logger.info('live.export', 'live decode log exported', { events: safe(events.length) })
    } catch (e) {
      logger.warn('live.export.error', 'clipboard export failed', {
        errorMessage: safe((e as Error)?.message ?? String(e)),
      })
    }
  }, [active, adapter, events, meta, streamState])

  if (!adapter) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Live decoded events</Text>
        <Text style={styles.errorText}>FightCamp v1 adapter not found in the protocol registry.</Text>
        <View style={styles.row}>
          <Link href='/(tabs)/velocity-lab' style={styles.linkBtn}>
            <Text style={styles.btnText}>Back to Velocity Lab</Text>
          </Link>
        </View>
      </ScrollView>
    )
  }

  if (!active) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Live decoded events</Text>
        <Text style={styles.subtitle}>No tracker is ready. Connect one on the Velocity Lab landing first.</Text>
        <View style={styles.row}>
          <Link href='/(tabs)/velocity-lab' style={styles.linkBtn}>
            <Text style={styles.btnText}>Back to Velocity Lab</Text>
          </Link>
        </View>
      </ScrollView>
    )
  }

  const initial = handInitial(active.hand)
  const shortId = truncateDeviceId(active.slot.deviceId)
  const slotName = active.slot.name ?? 'Tracker'

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>
        Live decoded events — {initial} {slotName} ({shortId})
      </Text>
      <Text style={styles.subtitle}>
        Subscribed to {streamState.subscribedCount} chars · {streamState.initErrorCount} init errors
      </Text>
      <Text style={styles.phase}>
        adapter {adapter.id}@{adapter.version} · slot {active.hand} · state {active.slot.state}
      </Text>

      <View style={styles.row}>
        <Pressable style={styles.smallBtnAlt} onPress={onClear}>
          <Text style={styles.smallBtnText}>Clear log</Text>
        </Pressable>
        <Pressable style={styles.smallBtn} onPress={() => { void onCopyJson() }}>
          <Text style={styles.smallBtnText}>Copy JSON</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Events ({events.length})</Text>
        {events.length === 0 ? (
          <Text style={styles.hint}>Throw a punch. Events appear here as the adapter decodes them.</Text>
        ) : null}
        {events.map((row) => {
          const e = row.event
          const isPower = e.punchType === 'power'
          const handLabel = e.hand === 'left' ? 'L' : e.hand === 'right' ? 'R' : '?'
          const typeLabel = (e.punchType ?? 'unknown').toUpperCase()
          const vRaw = e.velocityRaw ?? 0
          const vCal = e.velocityCalibrated
          const vCalStr = typeof vCal === 'number' ? vCal.toFixed(1) : '—'
          const tStr = typeof e.trackerTimestampMs === 'number' ? `t+${e.trackerTimestampMs}ms` : ''
          return (
            <View
              key={row.seq}
              style={[styles.eventRow, isPower && styles.eventRowPower]}
            >
              <Text style={styles.eventLine} selectable>
                <Text style={styles.deltaText}>[{row.deltaMs.toString().padStart(4, ' ')}ms since prev]</Text>
                {'  '}
                <Text style={styles.typeText}>{typeLabel}</Text>
                {'  '}
                <Text style={styles.handText}>{handLabel}</Text>
                {'  '}
                <Text style={styles.velocityText}>vRAW({vRaw}) v={vCalStr}</Text>
                {tStr ? <Text style={styles.trackerTs}>  {tStr}</Text> : null}
              </Text>
              <Text style={styles.eventDetail} selectable>
                frame {e.sourceFrameId} · type-byte {e.punchTypeRaw ?? '—'} · svc ca280069 · unit {e.velocityUnit}
              </Text>
            </View>
          )
        })}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Metadata ({meta.length})</Text>
        {meta.length === 0 ? (
          <Text style={styles.hint}>No decoder notes yet.</Text>
        ) : null}
        {meta.map((m) => {
          const style =
            m.kind === 'malformed' || m.kind === 'init-error'
              ? styles.metaError
              : m.kind === 'unknown'
                ? styles.metaWarn
                : styles.metaInfo
          return (
            <Text key={m.seq} style={[styles.metaLine, style]} selectable>
              [{m.kind}] {m.text}
            </Text>
          )
        })}
      </View>

      <Text style={styles.footnote}>
        Values shown are tracker-reported velocity in tracker units (§4.3).
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b0d' },
  content: { padding: 16, paddingBottom: 48 },
  title: { color: '#fff', fontSize: 20, fontWeight: '600' },
  subtitle: { color: '#c6c6c6', marginTop: 4 },
  phase: { color: '#8f8f8f', marginTop: 2, fontFamily: 'monospace', fontSize: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  section: { marginTop: 20 },
  sectionTitle: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 8 },
  hint: { color: '#8f8f8f', fontSize: 12, fontStyle: 'italic', marginBottom: 8 },
  smallBtn: {
    backgroundColor: '#2c6bed',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  smallBtnAlt: {
    backgroundColor: '#33333a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  smallBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  eventRow: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomColor: '#1f1f22',
    borderBottomWidth: 1,
  },
  eventRowPower: { backgroundColor: '#241a12' },
  eventLine: { fontFamily: 'monospace', fontSize: 12, color: '#e6e6e6' },
  deltaText: { color: '#8f8f8f' },
  typeText: { color: '#f0b76a', fontWeight: '700' },
  handText: { color: '#3ecf8e', fontWeight: '700' },
  velocityText: { color: '#8fbcff' },
  trackerTs: { color: '#8f8f8f' },
  eventDetail: { fontFamily: 'monospace', fontSize: 10, color: '#5a5a5f', marginTop: 2 },
  metaLine: { fontFamily: 'monospace', fontSize: 11, paddingVertical: 1 },
  metaInfo: { color: '#8f8f8f' },
  metaWarn: { color: '#f0b76a' },
  metaError: { color: '#ff9b9b' },
  errorText: { color: '#ff9b9b', fontSize: 13, marginTop: 8 },
  linkBtn: {
    backgroundColor: '#2c6bed',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    color: '#fff',
  },
  btnText: { color: '#fff', fontWeight: '600' },
  footnote: { color: '#5a5a5f', fontSize: 11, marginTop: 24, fontStyle: 'italic' },
})
