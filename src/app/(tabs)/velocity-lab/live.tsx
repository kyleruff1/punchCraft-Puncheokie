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
 * units". Never m/s / mph / g / force / power / energy as a label.
 *
 * Event rows show the RAW type byte ("TYPE 3"), never a technique name.
 * H12 showed the byte is not a device-portable classifier, so the decoder
 * reports punchType: 'unknown' and this screen must not invent a label
 * the data does not support.
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
import type { BleCaptureService } from '@capture/BleCaptureService'
import { getCaptureService } from '@capture/getCaptureService'
import { useCaptureSession } from '@capture/useCaptureSession'
import type { TrackerPunchEvent } from '@/domain/punch/PunchEvent'
import { useLeftSlot, useRightSlot } from '@/state/useTrackerStore'
import { colors } from '@/theme/colors'
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
  /** Durable capture sink; frames are persisted before the decoder runs. */
  capture: BleCaptureService | null
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
  const { facade, deviceId, adapter, hand, onEvent, onDecodeMeta, capture } = args
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
    // Raw frames are persisted by the TRANSPORT before they ever reach
    // PunchStream (BleManagerFacade.setFrameSink), so only decoded events are
    // this screen's concern. There is deliberately no `sink` option here —
    // PunchStreamOptions has none, and passing one inside a spread would
    // typecheck silently while doing nothing.
    ...(capture ? { onEventPersist: (e: TrackerPunchEvent) => capture.recordEvent(e) } : {}),
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

const ready = (s: SlotState | null): boolean =>
  !!s && (s.state === 'ready' || s.state === 'streaming')

/** What the screen is watching. 'both' is the default — with auto-connect
 * binding each tracker to a fixed hand, seeing the whole session interleaved
 * is the normal case; the single-hand modes are for isolating one glove. */
type ViewMode = 'both' | 'left' | 'right'

interface ActiveSlot {
  slot: SlotState
  hand: Hand
}

/** Every slot the current mode should stream, in L-then-R order. */
function activeSlotsFor(
  mode: ViewMode,
  left: SlotState | null,
  right: SlotState | null,
): ActiveSlot[] {
  const out: ActiveSlot[] = []
  if (mode !== 'right' && ready(left)) out.push({ slot: left as SlotState, hand: 'left' })
  if (mode !== 'left' && ready(right)) out.push({ slot: right as SlotState, hand: 'right' })
  return out
}

export default function LiveDecodeScreen(): React.ReactElement {
  const leftSlot = useLeftSlot()
  const rightSlot = useRightSlot()

  const [viewMode, setViewMode] = useState<ViewMode>('both')

  const activeSlots = useMemo(
    () => activeSlotsFor(viewMode, leftSlot, rightSlot),
    [viewMode, leftSlot, rightSlot],
  )

  // Stable identity for the set of streams, so the effect below re-runs when
  // a tracker joins or leaves but NOT on every unrelated store update.
  const activeKey = activeSlots.map((a) => `${a.hand}:${a.slot.deviceId}`).join('|')

  const [events, setEvents] = useState<DecodedEventRow[]>([])
  const [meta, setMeta] = useState<MetaEntry[]>([])
  const [streamState, setStreamState] = useState<StreamState>({ subscribedCount: 0, initErrorCount: 0 })

  const controllersRef = useRef<StreamController[]>([])
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
    // Poll aggregate state across every running stream; getState is cheap.
    const ctls = controllersRef.current
    if (ctls.length > 0) {
      setStreamState(
        ctls.reduce<StreamState>(
          (acc, c) => {
            const s = c.getState()
            return {
              subscribedCount: acc.subscribedCount + s.subscribedCount,
              initErrorCount: acc.initErrorCount + s.initErrorCount,
            }
          },
          { subscribedCount: 0, initErrorCount: 0 },
        ),
      )
    }
  }, [])

  // One capture per visit to this screen — see useCaptureSession for why it
  // must not depend on the selected tracker.
  const capture = useCaptureSession('live-decode')
  const captureReady = capture.ready
  useEffect(() => {
    if (capture.error) {
      onDecodeMeta({
        kind: 'init-error',
        text: `capture unavailable, frames will NOT be persisted: ${capture.error}`,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture.error])

  useEffect(() => {
    if (activeSlots.length === 0 || !adapter) return
    // Wait for the capture to exist before subscribing, so the very first
    // frame is already covered (§11.9, §12.4) rather than racing the open.
    if (!captureReady) return
    const facade = getBleManager()
    const captureService: BleCaptureService = getCaptureService()

    // One independent stream per tracker. They share the capture and the
    // event list; each stamps its own hand, so the merged view stays
    // attributable. Left and right are separate GATT connections, so
    // nothing is shared between the streams themselves.
    const controllers = activeSlots.map((a) =>
      startPunchStream({
        facade,
        deviceId: a.slot.deviceId,
        adapter,
        hand: a.hand,
        onEvent,
        onDecodeMeta,
        capture: captureService,
      }),
    )
    controllersRef.current = controllers
    return () => {
      for (const c of controllers) c.stop()
      controllersRef.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, adapter, captureReady])

  // When the user flips L/R, reset the log so red and blue events do not
  // interleave in the same view — the picker treats each side as its own
  // stream.
  // Switching mode changes which trackers are in view, so the existing rows
  // no longer describe what is on screen. Reset rather than mixing.
  useEffect(() => {
    setEvents([])
    setMeta([])
    seqRef.current = 0
    metaSeqRef.current = 0
    prevMonotonicRef.current = null
  }, [viewMode])

  const onClear = useCallback(() => {
    setEvents([])
    setMeta([])
    prevMonotonicRef.current = null
  }, [])

  const onCopyJson = useCallback(async () => {
    const payload = {
      exportedAtIso: new Date().toISOString(),
      viewMode,
      trackers: activeSlots.map((a) => ({ hand: a.hand, deviceId: a.slot.deviceId })),
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
  }, [viewMode, activeSlots, adapter, events, meta, streamState])

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

  const modeButton = (mode: ViewMode, label: string, a11y: string) => (
    <Pressable
      style={[styles.toggleBtn, viewMode === mode && styles.toggleBtnActive]}
      onPress={() => setViewMode(mode)}
      accessibilityRole='button'
      accessibilityLabel={a11y}
    >
      <Text style={[styles.toggleText, viewMode === mode && styles.toggleTextActive]}>{label}</Text>
    </Pressable>
  )

  const HandToggle = (
    <View style={styles.toggleRow}>
      {modeButton('both', 'Both', 'Show both trackers')}
      {modeButton('left', 'L (blue)', 'Show left tracker only')}
      {modeButton('right', 'R (red)', 'Show right tracker only')}
    </View>
  )

  if (activeSlots.length === 0) {
    const wanted =
      viewMode === 'both' ? 'Neither tracker is' :
      viewMode === 'left' ? 'The left (blue) tracker is not' :
      'The right (red) tracker is not'
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Live decoded events</Text>
        {HandToggle}
        <Text style={styles.subtitle}>{wanted} ready. Tap a tracker to wake it, then use Connect both on the Velocity Lab landing.</Text>
        <View style={styles.row}>
          <Link href='/(tabs)/velocity-lab' style={styles.linkBtn}>
            <Text style={styles.btnText}>Back to Velocity Lab</Text>
          </Link>
        </View>
      </ScrollView>
    )
  }

  const headerSuffix = activeSlots
    .map((a) => `${handInitial(a.hand)} ${a.slot.name ?? 'Tracker'} (${truncateDeviceId(a.slot.deviceId)})`)
    .join('  +  ')

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Live decoded events — {headerSuffix}</Text>
      {HandToggle}
      <Text style={styles.subtitle}>
        Subscribed to {streamState.subscribedCount} chars · {streamState.initErrorCount} init errors
      </Text>
      <Text style={styles.phase}>
        adapter {adapter.id}@{adapter.version} · {activeSlots.map((a) => `${a.hand}:${a.slot.state}`).join(' · ')}
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
          // Show the RAW type byte, not a technique name. H12 established the
          // byte is not a device-portable classifier, so punchType is always
          // 'unknown' and a label like "STRAIGHT" would be a fabrication.
          // Rows whose byte is 1 or 2 are tinted because those receive the
          // vendor's x1.7 velocity multiplier — an arithmetic fact about the
          // frame, not a claim about the technique.
          const isBoosted = e.punchTypeRaw === 1 || e.punchTypeRaw === 2
          // Colour the hand marker to match the physical tracker (blue left,
          // red right) so an interleaved two-tracker stream is readable at a
          // glance. The letter carries the meaning on its own — colour is
          // never the only signal (§19.4).
          const handLabel = e.hand === 'left' ? 'L' : e.hand === 'right' ? 'R' : '?'
          const handStyle =
            e.hand === 'left' ? styles.handLeft : e.hand === 'right' ? styles.handRight : styles.handText
          const typeLabel = e.punchTypeRaw != null ? `TYPE ${e.punchTypeRaw}` : 'TYPE ?'
          const vRaw = e.velocityRaw ?? 0
          const vCal = e.velocityCalibrated
          const vCalStr = typeof vCal === 'number' ? vCal.toFixed(1) : '—'
          const tStr = typeof e.trackerTimestampMs === 'number' ? `t+${e.trackerTimestampMs}ms` : ''
          return (
            <View
              key={row.seq}
              style={[styles.eventRow, isBoosted && styles.eventRowBoosted]}
            >
              <Text style={styles.eventLine} selectable>
                <Text style={styles.deltaText}>[{row.deltaMs.toString().padStart(4, ' ')}ms since prev]</Text>
                {'  '}
                <Text style={styles.typeText}>{typeLabel}</Text>
                {'  '}
                <Text style={handStyle}>{handLabel}</Text>
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

/**
 * Dev-screen-only tints. These carry no product meaning and have no theme
 * token: `boostedRow` marks frames whose type byte triggered the vendor's
 * x1.7 velocity multiplier (an arithmetic fact about the frame, not a claim
 * about the punch), and the rest are readability shades for a dense
 * monospace log. Everything with a semantic equivalent uses `colors`.
 */
const dev = {
  boostedRow: '#3A2A10',
  logText: colors.textPrimary,
  logDetail: colors.textMuted,
  typeLabel: colors.warning,
  velocityLabel: colors.trackerLeft,
  errorText: colors.danger,
} as const

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  content: { padding: 16, paddingBottom: 48 },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '600' },
  subtitle: { color: colors.textSecondary, marginTop: 4 },
  phase: { color: colors.textMuted, marginTop: 2, fontFamily: 'monospace', fontSize: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  section: { marginTop: 20 },
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: 8 },
  hint: { color: colors.textMuted, fontSize: 12, fontStyle: 'italic', marginBottom: 8 },
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
  smallBtnText: { color: colors.textOnAccent, fontSize: 12, fontWeight: '600' },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  toggleBtnActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  toggleText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  toggleTextActive: { color: colors.textPrimary },
  eventRow: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderBottomColor: colors.surface,
    borderBottomWidth: 1,
  },
  eventRowBoosted: { backgroundColor: dev.boostedRow },
  eventLine: { fontFamily: 'monospace', fontSize: 12, color: dev.logText },
  deltaText: { color: colors.textMuted },
  typeText: { color: dev.typeLabel, fontWeight: '700' },
  handText: { color: colors.success, fontWeight: '700' },
  // Match the physical trackers: blue is the left glove, red the right.
  handLeft: { color: colors.trackerLeft, fontWeight: '700' },
  handRight: { color: colors.trackerRight, fontWeight: '700' },
  velocityText: { color: dev.velocityLabel },
  trackerTs: { color: colors.textMuted },
  eventDetail: { fontFamily: 'monospace', fontSize: 10, color: dev.logDetail, marginTop: 2 },
  metaLine: { fontFamily: 'monospace', fontSize: 11, paddingVertical: 1 },
  metaInfo: { color: colors.textMuted },
  metaWarn: { color: colors.warning },
  metaError: { color: dev.errorText },
  errorText: { color: dev.errorText, fontSize: 13, marginTop: 8 },
  linkBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    color: colors.textOnAccent,
  },
  btnText: { color: colors.textOnAccent, fontWeight: '600' },
  footnote: { color: dev.logDetail, fontSize: 11, marginTop: 24, fontStyle: 'italic' },
})
