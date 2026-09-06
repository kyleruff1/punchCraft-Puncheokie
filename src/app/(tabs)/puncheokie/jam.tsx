/**
 * The Jam — Puncheoke's live instrument surface (P4, note-cube-design §1).
 *
 * Six-row patch selector (KEY / PITCH SET / CUBE LAYOUT / HARMONY /
 * SPREAD / TRANSITION) over the shared launch patch; a brass-cube patch
 * (brass-cube-design) swaps those for PATTERN / RETRIGGER / BACKEND,
 * persisted via the instrument settings store. The effective patch
 * compiles ONCE into a CompiledCubeMap (plus the CompiledBrassCubeMap for
 * brass patches) whose patchHash rides every wire message. Live punches
 * from the app-wide keepalive source (subscribe only — never stop) run
 * scalers → zone quantizer → gesture compiler → PunchBridge, and the same
 * compiled gesture drives the on-screen readout. Patch changes apply
 * Next-Punch: held notes stay, each hand adopts the new map on its next
 * punch, and the client re-hellos the new hash (harmonic changes are
 * boundary-quantized bridge-side anyway). Panic and disconnect always
 * release every note (§23).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { router } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'
import { InstrumentVoiceOutput } from '@audio/InstrumentVoiceOutput'
import { INSTRUMENT_TEXTURE_IDS } from '@audio/voiceAssets/instrumentBankManifest'
import { BridgeClient, type BridgeStatus } from '@/instrument/bridgeClient'
import { compileBrassCube, type ArpPatternId } from '@domain/instrument/brassCube'
import { cellAt, compilePunchPatch, midiNoteName } from '@domain/instrument/cubeCompiler'
import type { ArpeggiatorBackend, RetriggerPolicy } from '@domain/instrument/gestureSchema'
import {
  compileGesture,
  emptySessionState,
  type InstrumentSessionState,
} from '@domain/instrument/gestureCompiler'
import { PITCH_SETS } from '@domain/instrument/pitchSets'
import {
  launchPatchById,
  type HarmonyMode,
  type PunchPatch,
  type TopologyId,
  type TransitionMode,
} from '@domain/instrument/punchPatch'
import {
  ACCELERATION_SCALE_DEFAULTS,
  createRollingScaler,
  HIGH_SENSITIVITY_ACCELERATION_DEFAULTS,
  HIGH_SENSITIVITY_VELOCITY_DEFAULTS,
  VELOCITY_SCALE_DEFAULTS,
} from '@domain/instrument/rollingScale'
import { getTrackerKeepaliveSource } from '@protocol/trackerKeepalive'
import {
  useInstrumentSettingsStore,
  type InstrumentOutputTarget,
} from '@state/useInstrumentSettingsStore'

const KEYS = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const
const TOPOLOGIES: readonly TopologyId[] = ['parallel', 'bass-lead', 'root-interval']
const HARMONIES: readonly HarmonyMode[] = ['free', 'soft-guard', 'interval-lock']
const TRANSITIONS: readonly TransitionMode[] = ['elastic', 'glide', 'retrigger']
const SPREADS = [
  { label: 'Wide (+2 oct)', octaves: 2 },
  { label: 'Close (+1 oct)', octaves: 1 },
] as const
const BRASS_PATTERNS: readonly ArpPatternId[] = ['punch-weave', 'up', 'down', 'fanfare', 'pendulum']
const BRASS_RETRIGGERS: readonly RetriggerPolicy[] = [
  'quantized-rotate',
  'hard-retrigger',
  'continuous-morph',
]
const BRASS_BACKENDS: readonly ArpeggiatorBackend[] = ['punchbridge-tick', 'studio-one-note-fx']
const OUTPUT_TARGETS: readonly InstrumentOutputTarget[] = ['bridge', 'tablet', 'both']

type Sensitivity = 'high' | 'standard'

interface BrassJamOptions {
  patternId: ArpPatternId
  retrigger: RetriggerPolicy
  arpBackend: ArpeggiatorBackend
}

interface JamOverrides {
  rootPitchClass?: number
  pitchSetId?: string
  topologyId?: TopologyId
  harmonyMode?: HarmonyMode
  spreadOctaves?: number
  transitionMode?: TransitionMode
}

function effectivePatch(base: PunchPatch, over: JamOverrides, brass: BrassJamOptions): PunchPatch {
  // A brass-cube patch: the legacy music rows do not apply — the chord
  // bank IS the harmony. Only the brass selections override the section.
  if (base.brassCube) {
    return {
      ...base,
      id: `${base.id}+jam`,
      brassCube: {
        ...base.brassCube,
        patternId: brass.patternId,
        retrigger: brass.retrigger,
        arpBackend: brass.arpBackend,
      },
    }
  }
  const rightOctave = base.leftVoice.baseOctave + (over.spreadOctaves ?? 2)
  return {
    ...base,
    id: `${base.id}+jam`,
    rootPitchClass: over.rootPitchClass ?? base.rootPitchClass,
    pitchSetId: over.pitchSetId ?? base.pitchSetId,
    topologyId: over.topologyId ?? base.topologyId,
    harmony:
      over.harmonyMode !== undefined ? { ...base.harmony, mode: over.harmonyMode } : base.harmony,
    rightVoice: { ...base.rightVoice, baseOctave: rightOctave },
    transition:
      over.transitionMode !== undefined
        ? { ...base.transition, mode: over.transitionMode }
        : base.transition,
  }
}

export default function JamScreen(): React.JSX.Element {
  const basePatchId = useInstrumentSettingsStore((s) => s.patchId)
  const bridgeUrl = useInstrumentSettingsStore((s) => s.bridgeUrl)
  const brassPatternId = useInstrumentSettingsStore((s) => s.brassPatternId)
  const brassRetrigger = useInstrumentSettingsStore((s) => s.brassRetrigger)
  const brassBackend = useInstrumentSettingsStore((s) => s.brassBackend)
  const setBrassOptions = useInstrumentSettingsStore((s) => s.setBrassOptions)
  const outputTarget = useInstrumentSettingsStore((s) => s.outputTarget)
  const textureId = useInstrumentSettingsStore((s) => s.textureId)
  const setOutputTarget = useInstrumentSettingsStore((s) => s.setOutputTarget)
  const setTextureId = useInstrumentSettingsStore((s) => s.setTextureId)
  const [overrides, setOverrides] = useState<JamOverrides>({})
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('idle')
  const [rttMs, setRttMs] = useState<number | null>(null)
  const [liveCount, setLiveCount] = useState(0)
  const [dyad, setDyad] = useState('— · —')
  const [coordinate, setCoordinate] = useState('(–, –, 0)')
  const [lastMove, setLastMove] = useState('')

  const base = useMemo(() => launchPatchById(basePatchId), [basePatchId])
  const patch = useMemo(
    () =>
      effectivePatch(base, overrides, {
        patternId: brassPatternId,
        retrigger: brassRetrigger,
        arpBackend: brassBackend,
      }),
    [base, overrides, brassPatternId, brassRetrigger, brassBackend],
  )
  const cubeMap = useMemo(() => compilePunchPatch(patch), [patch])
  const brassMap = useMemo(() => (patch.brassCube ? compileBrassCube(patch) : null), [patch])

  // High sensitivity by default: the boxer should hear soft play. The
  // firmware's own transmit floor (cmd-17 threshold) still gates the very
  // softest touches — tracked separately as a protocol spike.
  const [sensitivity, setSensitivity] = useState<Sensitivity>('high')
  const bridgeRef = useRef<BridgeClient | null>(null)
  const sessionRef = useRef<InstrumentSessionState>(emptySessionState())
  const scalersRef = useRef({
    velocity: createRollingScaler(HIGH_SENSITIVITY_VELOCITY_DEFAULTS),
    acceleration: createRollingScaler(HIGH_SENSITIVITY_ACCELERATION_DEFAULTS),
  })

  useEffect(() => {
    // Fresh windows on a sensitivity change — mixed-anchor history would
    // make the first few punches read inconsistently.
    scalersRef.current =
      sensitivity === 'high'
        ? {
            velocity: createRollingScaler(HIGH_SENSITIVITY_VELOCITY_DEFAULTS),
            acceleration: createRollingScaler(HIGH_SENSITIVITY_ACCELERATION_DEFAULTS),
          }
        : {
            velocity: createRollingScaler(VELOCITY_SCALE_DEFAULTS),
            acceleration: createRollingScaler(ACCELERATION_SCALE_DEFAULTS),
          }
  }, [sensitivity])
  // The punch handler closes over the LATEST patch/maps through this ref —
  // Next-Punch semantics fall out: the held latch survives, the next
  // punch compiles against the new map.
  const liveCtxRef = useRef({ patch, cubeMap, brassMap })
  liveCtxRef.current = { patch, cubeMap, brassMap }

  // Tablet instrument voice (M40-15). The engine is created lazily on the
  // first non-bridge OUTPUT selection and lives until unmount; the punch
  // handler reads the routing through a ref (the liveCtxRef pattern) so
  // the [] keepalive subscription sees every flip.
  const engineRef = useRef<InstrumentVoiceOutput | null>(null)
  const outputRef = useRef(outputTarget)
  outputRef.current = outputTarget

  useEffect(() => {
    if (outputTarget === 'bridge') {
      // Back to the PC rig: silence the tablet, keep the pools warm for
      // the next flip.
      engineRef.current?.panic()
      return
    }
    if (engineRef.current === null) {
      engineRef.current = new InstrumentVoiceOutput()
      void engineRef.current.preload(textureId)
    } else {
      // Same-id calls no-op inside; a real change re-preloads the pools
      // and rebuilds any sounding loops from the new texture's bank.
      engineRef.current.setTexture(textureId)
    }
  }, [outputTarget, textureId])

  useEffect(
    () => () => {
      engineRef.current?.release()
      engineRef.current = null
    },
    [],
  )

  useEffect(() => {
    const client = new BridgeClient({
      onStatus: (status) => setBridgeStatus(status),
      onRtt: (rtt) => setRttMs(Math.round(rtt)),
    })
    bridgeRef.current = client
    client.connect(bridgeUrl, `jam-${Math.floor(globalThis.performance.now())}`, cubeMap.patchHash)
    return () => client.disconnect()
    // Connect once per mount; URL edits happen on the landing/settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    bridgeRef.current?.setMapHash(cubeMap.patchHash)
  }, [cubeMap.patchHash])

  useEffect(() => {
    const shared = getTrackerKeepaliveSource()
    if (!shared) return
    return shared.subscribe((event) => {
      if (event.hand !== 'left' && event.hand !== 'right') return
      const { patch: livePatch, cubeMap: liveMap, brassMap: liveMap2 } = liveCtxRef.current
      const scalers = scalersRef.current
      const velocity01 = scalers.velocity.scale(event.hand, event.velocityRaw)
      const acceleration01 = scalers.acceleration.scale(event.hand, event.accelerationRaw)
      const result = compileGesture(
        {
          eventId: event.id,
          hand: event.hand,
          ...(event.trackerTimestampMs !== undefined
            ? { trackerTimestampMs: event.trackerTimestampMs }
            : {}),
          receivedMonotonicTimeMs: event.receivedMonotonicTimeMs,
          velocityRaw: event.velocityRaw ?? 0,
          ...(event.accelerationRaw !== undefined
            ? { accelerationRaw: event.accelerationRaw }
            : {}),
          recovered: event.recovered,
        },
        sessionRef.current,
        {
          sessionId: 'jam',
          patch: livePatch,
          cubeMap: liveMap,
          ...(liveMap2 ? { brassMap: liveMap2 } : {}),
          velocity01,
          acceleration01,
        },
      )
      if (!result) return
      sessionRef.current = result.state
      // Gesture tee (M40-15): default 'bridge' keeps today's path
      // byte-for-byte; 'tablet' mutes the wire; 'both' feeds both rigs.
      const out = outputRef.current
      if (out !== 'tablet') bridgeRef.current?.sendGesture(result.gesture)
      if (out !== 'bridge') engineRef.current?.handleGesture(result.gesture)
      const { leftZone, rightZone, activityLayer } = result.gesture.cube
      setLiveCount((n) => n + 1)
      const { accent, quantized } = result.gesture
      if (accent && quantized) {
        // Brass readout: the STAGED cell — the same numbers the bridge
        // will commit on its next step boundary (WHAT can never disagree,
        // only WHEN, by at most one step).
        setDyad(`${quantized.chordName} · ${midiNoteName(quantized.chordMidiNotes[0] ?? 0)}`)
        setCoordinate(`(${leftZone}, ${rightZone}, L${quantized.activityLayer})`)
        setLastMove(
          `accent ${midiNoteName(accent.midiNote)} · ${quantized.notesPerMinute}/min · cell ${quantized.cubeCellId}`,
        )
        return
      }
      const cell = cellAt(liveMap, leftZone, rightZone)
      const leftHeld = result.state.latch.left.note
      const rightHeld = result.state.latch.right.note
      setDyad(
        `${leftHeld == null ? '—' : midiNoteName(leftHeld)} · ${rightHeld == null ? '—' : midiNoteName(rightHeld)}`,
      )
      setCoordinate(`(${leftZone}, ${rightZone}, ${activityLayer})`)
      setLastMove(
        `${result.gesture.voice.voiceId} → ${midiNoteName(result.gesture.voice.targetNote)} · ${result.gesture.voice.transition}${result.gesture.voice.transitionDurationMs ? ` ${result.gesture.voice.transitionDurationMs}ms` : ''} · cell ${cell.label}`,
      )
    })
  }, [])

  const cycle = <T,>(list: readonly T[], current: T): T =>
    list[(list.indexOf(current) + 1) % list.length] as T

  const sensitivityRow = {
    label: 'SENSITIVITY',
    value: sensitivity,
    onPress: () => setSensitivity((s) => (s === 'high' ? 'standard' : 'high')),
  }

  // Tablet instrument voice (M40-15) — both patch families carry these: a
  // legacy patch on tablet output still plays drum one-shots (selection
  // returns nulls for bed/bass/stab, which is coherent).
  const outputRow = {
    label: 'OUTPUT',
    value: outputTarget.toUpperCase(),
    onPress: () => setOutputTarget(cycle(OUTPUT_TARGETS, outputTarget)),
  }
  const textureRow = {
    label: 'TEXTURE',
    value: textureId,
    onPress: () => setTextureId(cycle(INSTRUMENT_TEXTURE_IDS, textureId)),
  }

  // A brass-cube patch swaps the legacy music rows for the brass options
  // (persisted store-side); SENSITIVITY applies to both patch families.
  const brassRows: Array<{ label: string; value: string; onPress: () => void }> = patch.brassCube
    ? [
        {
          label: 'PATTERN',
          value: patch.brassCube.patternId,
          onPress: () => setBrassOptions({ patternId: cycle(BRASS_PATTERNS, brassPatternId) }),
        },
        {
          label: 'RETRIGGER',
          value: patch.brassCube.retrigger,
          onPress: () => setBrassOptions({ retrigger: cycle(BRASS_RETRIGGERS, brassRetrigger) }),
        },
        {
          label: 'BACKEND',
          value: patch.brassCube.arpBackend,
          onPress: () => setBrassOptions({ backend: cycle(BRASS_BACKENDS, brassBackend) }),
        },
        sensitivityRow,
        outputRow,
        textureRow,
      ]
    : []

  const legacyRows: Array<{ label: string; value: string; onPress: () => void }> = [
    {
      label: 'KEY',
      value: KEYS[patch.rootPitchClass] ?? 'D',
      onPress: () =>
        setOverrides((o) => ({ ...o, rootPitchClass: (patch.rootPitchClass + 1) % 12 })),
    },
    {
      label: 'PITCH SET',
      value: PITCH_SETS.find((s) => s.id === patch.pitchSetId)?.name ?? patch.pitchSetId,
      onPress: () =>
        setOverrides((o) => ({
          ...o,
          pitchSetId: cycle(
            PITCH_SETS.map((s) => s.id),
            patch.pitchSetId,
          ),
        })),
    },
    {
      label: 'CUBE LAYOUT',
      value: patch.topologyId,
      onPress: () => setOverrides((o) => ({ ...o, topologyId: cycle(TOPOLOGIES, patch.topologyId) })),
    },
    {
      label: 'HARMONY',
      value: patch.harmony.mode,
      onPress: () =>
        setOverrides((o) => ({ ...o, harmonyMode: cycle(HARMONIES, patch.harmony.mode) })),
    },
    {
      label: 'SPREAD',
      value:
        SPREADS.find((s) => s.octaves === (overrides.spreadOctaves ?? 2))?.label ?? 'Wide (+2 oct)',
      onPress: () =>
        setOverrides((o) => ({ ...o, spreadOctaves: (o.spreadOctaves ?? 2) === 2 ? 1 : 2 })),
    },
    {
      label: 'TRANSITION',
      value: patch.transition.mode,
      onPress: () =>
        setOverrides((o) => ({ ...o, transitionMode: cycle(TRANSITIONS, patch.transition.mode) })),
    },
    sensitivityRow,
    outputRow,
    textureRow,
  ]

  const selectorRows = patch.brassCube ? brassRows : legacyRows

  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="jam-back">
          <Text style={styles.backText}>←</Text>
        </Pressable>
        <Text style={styles.title}>{base.name}</Text>
        <Text style={styles.hash}>{`map ${cubeMap.patchHash}`}</Text>
      </View>
      <View style={styles.bridgeRow}>
        <Text style={styles.meta}>{`bridge ${bridgeStatus}`}</Text>
        <Text style={styles.meta}>{rttMs == null ? 'rtt —' : `rtt ${rttMs}ms`}</Text>
        <Text style={styles.meta}>{`punches ${liveCount}`}</Text>
        <Pressable
          onPress={() => {
            bridgeRef.current?.sendPanic()
            engineRef.current?.panic()
          }}
          style={styles.panicBtn}
          testID="jam-panic"
        >
          <Text style={styles.panicText}>PANIC</Text>
        </Pressable>
      </View>

      <View style={styles.stage} testID="jam-stage">
        <Text style={styles.dyad}>{dyad}</Text>
        <Text style={styles.coordinate}>{coordinate}</Text>
        <Text style={styles.lastMove}>{lastMove || 'throw to begin'}</Text>
      </View>

      <ScrollView style={styles.selector} contentContainerStyle={styles.selectorContent}>
        {selectorRows.map((row) => (
          <Pressable
            key={row.label}
            onPress={row.onPress}
            style={styles.selectorRow}
            testID={`jam-row-${row.label.toLowerCase().replace(/\s/g, '-')}`}
          >
            <Text style={styles.selectorLabel}>{row.label}</Text>
            <Text style={styles.selectorValue}>{row.value}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 12 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  backBtn: { paddingVertical: 4, paddingHorizontal: 10 },
  backText: { fontSize: sizes.title, color: colors.textPrimary },
  title: { flex: 1, fontSize: sizes.title, fontFamily: fonts.heading, color: colors.textPrimary },
  hash: { fontSize: sizes.label, fontFamily: fonts.label, color: colors.textSecondary },
  bridgeRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  meta: { fontSize: sizes.label, fontFamily: fonts.label, color: colors.textSecondary },
  panicBtn: {
    marginLeft: 'auto',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.trackerRight,
  },
  panicText: { fontSize: sizes.label, fontFamily: fonts.heading, color: colors.trackerRight },
  stage: {
    alignItems: 'center',
    paddingVertical: 28,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 6,
  },
  dyad: { fontSize: 44, fontFamily: fonts.heading, color: colors.textPrimary },
  coordinate: { fontSize: sizes.body, fontFamily: fonts.label, color: colors.textSecondary },
  lastMove: { fontSize: sizes.label, fontFamily: fonts.label, color: colors.textSecondary },
  selector: { flex: 1 },
  selectorContent: { gap: 8 },
  selectorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selectorLabel: { fontSize: sizes.label, fontFamily: fonts.label, color: colors.textSecondary },
  selectorValue: { fontSize: sizes.body, fontFamily: fonts.heading, color: colors.textPrimary },
})
