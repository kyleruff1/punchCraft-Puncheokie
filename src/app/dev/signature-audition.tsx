/**
 * Dev route. The Twelve-Signature Audition: punchcraft://dev/signature-audition
 *
 * Second-pass review amendment 2: during M40 the tracker cannot supply a
 * trustworthy technique identity in free jam — the live workout
 * InstrumentPort that carries expectedStrikeToken is M44-01, and the raw
 * type byte is not validated until M44-02. Without a synthetic canonical
 * source the M40 ear gate would have NOTHING on glass to assess the twelve
 * signatures with.
 *
 * So: twelve buttons (1, 1B, 2, 2B … 6, 6B) feed synthetic punches carrying
 * the chosen expectedStrikeToken through the REAL compiler path — the same
 * gestureCompiler, the same compiled patch/field, the same BridgeClient the
 * jam uses — plus sliders for velocity, acceleration, activity layer, and
 * the current harmonic cell. Nothing here fabricates MIDI; it fabricates a
 * PUNCH and lets the shipped pipeline decide what it sounds like.
 *
 * Dev-only surface, instrument-lab style: local state, no stores.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react'
import { Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'
import { BridgeClient, type BridgeStatus, type PatchIdentity } from '@/instrument/bridgeClient'
import { compileBrassCube } from '@domain/instrument/brassCube'
import { compilePunchPatch, midiNoteName } from '@domain/instrument/cubeCompiler'
import {
  compileGesture,
  emptySessionState,
  type InstrumentSessionState,
} from '@domain/instrument/gestureCompiler'
import type { StrikeToken } from '@domain/instrument/gestureSchema'
import { compileHarmonicField } from '@domain/instrument/harmonicField'
import { launchPatchById } from '@domain/instrument/punchPatch'
import {
  resolveStrikeArticulation,
  resolveStrikeIdentity,
  STRIKE_TOKENS,
  strikeSignatureKeyOf,
} from '@domain/instrument/strikeArticulationCatalog'

const DEFAULT_BRIDGE_URL = 'ws://192.168.86.35:8787'
/** Which hand physically throws each token in the orthodox default. */
const TOKEN_HAND: Readonly<Record<string, 'left' | 'right'>> = STRIKE_TOKENS.reduce(
  (acc, token) => ({
    ...acc,
    [token]: strikeSignatureKeyOf(token).hand === 'physical-left' ? 'left' : 'right',
  }),
  {},
)

const VELOCITIES = [0.15, 0.45, 0.75, 0.95] as const
const ACCELERATIONS = [0.2, 0.5, 0.8, 0.98] as const
/** Velocity that lands the OTHER hand in each cube zone, for cell control. */
const ZONE_VELOCITIES = [0.05, 0.22, 0.38, 0.55, 0.72, 0.92] as const

interface AuditionRow {
  key: string
  token: StrikeToken
  signatureId: string
  emphasis: string
  stab: string
  contour: string
  cell: string
  note: string
}

export default function SignatureAuditionScreen(): React.JSX.Element {
  const [patchId, setPatchId] = useState('dorian-brass-v2')
  const [velocityIndex, setVelocityIndex] = useState(1)
  const [accelerationIndex, setAccelerationIndex] = useState(1)
  const [leftZone, setLeftZone] = useState(0)
  const [rightZone, setRightZone] = useState(0)
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>('idle')
  const [rows, setRows] = useState<readonly AuditionRow[]>([])

  const patch = useMemo(() => launchPatchById(patchId), [patchId])
  const cubeMap = useMemo(() => compilePunchPatch(patch), [patch])
  const brassMap = useMemo(() => (patch.brassCube ? compileBrassCube(patch) : null), [patch])
  const field = useMemo(
    () =>
      patch.harmonicField && brassMap
        ? compileHarmonicField(patch.id, patch.harmonicField, brassMap)
        : null,
    [patch, brassMap],
  )

  const bridgeRef = useRef<BridgeClient | null>(null)
  const sessionRef = useRef<InstrumentSessionState>(emptySessionState())
  const clockRef = useRef(0)

  const connect = useCallback(() => {
    bridgeRef.current?.disconnect()
    const client = new BridgeClient({ onStatus: (status) => setBridgeStatus(status) })
    bridgeRef.current = client
    const identity: PatchIdentity = field
      ? {
          mapHash: cubeMap.patchHash,
          worldManifestHash: field.worldManifestHash,
          compiledFieldHash: field.compiledFieldHash,
          effectivePatchHash: cubeMap.patchHash,
          patchGeneration: 0,
        }
      : { mapHash: cubeMap.patchHash }
    const { mapHash, ...rest } = identity
    client.connect(DEFAULT_BRIDGE_URL, `audition-${Math.floor(globalThis.performance.now())}`, mapHash, rest)
  }, [cubeMap.patchHash, field])

  /**
   * Throw one synthetic punch carrying the token. The OTHER hand's latched
   * zone is pre-seeded by the cell selectors, so a token can be auditioned
   * against any harmonic cell without re-punching the other hand.
   */
  const throwToken = useCallback(
    (token: StrikeToken) => {
      const hand = TOKEN_HAND[token] ?? 'left'
      // Advance the synthetic clock past a commit window so each audition
      // punch lands in its own window (no coalescing during a listen).
      clockRef.current += 700
      const zoneVelocity = hand === 'left' ? ZONE_VELOCITIES[leftZone] : ZONE_VELOCITIES[rightZone]
      const result = compileGesture(
        {
          eventId: `audition-${token}-${clockRef.current}`,
          hand,
          receivedMonotonicTimeMs: clockRef.current,
          velocityRaw: Math.round(100 * (VELOCITIES[velocityIndex] ?? 0.5)),
          recovered: false,
          expectedStrikeToken: token,
        },
        sessionRef.current,
        {
          sessionId: 'audition',
          patch,
          cubeMap,
          ...(brassMap ? { brassMap } : {}),
          ...(field ? { field } : {}),
          // The cell selector drives the punching hand's zone; the other
          // hand keeps whatever it last latched.
          velocity01: zoneVelocity ?? VELOCITIES[velocityIndex] ?? 0.5,
          acceleration01: ACCELERATIONS[accelerationIndex] ?? 0.5,
        },
      )
      if (!result) return
      sessionRef.current = result.state
      bridgeRef.current?.sendGesture(result.gesture)

      const identity = resolveStrikeIdentity({ expectedStrikeToken: token, hand })
      const articulation = resolveStrikeArticulation(identity, hand)
      const q = result.gesture.quantized
      setRows((prev) =>
        [
          {
            key: `${token}-${clockRef.current}`,
            token,
            signatureId: articulation.signatureId,
            emphasis: articulation.emphasis,
            stab: `${articulation.immediate.stabRole} · ${articulation.immediate.baseGateMs}ms · ${articulation.immediate.filterShape}`,
            contour: `${articulation.microArp.operations.join(' → ')} (rot ${articulation.microArp.rotation})`,
            cell: q ? `${q.chordName} ${q.cubeCellId}` : '—',
            note: result.gesture.accent ? midiNoteName(result.gesture.accent.midiNote) : '—',
          },
          ...prev,
        ].slice(0, 14),
      )
    },
    [patch, cubeMap, brassMap, field, velocityIndex, accelerationIndex, leftZone, rightZone],
  )

  const cycleRow = (
    label: string,
    value: string,
    onPress: () => void,
    testID: string,
  ): React.JSX.Element => (
    <Pressable key={label} onPress={onPress} style={styles.controlRow} testID={testID}>
      <Text style={styles.controlLabel}>{label}</Text>
      <Text style={styles.controlValue}>{value}</Text>
    </Pressable>
  )

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Twelve-Signature Audition' }} />
      <View style={styles.header}>
        <Text style={styles.title}>Twelve-Signature Audition</Text>
        <Pressable onPress={connect} style={styles.connectBtn} testID="audition-connect">
          <Text style={styles.connectText}>{bridgeStatus === 'open' ? 'bridge open' : 'connect'}</Text>
        </Pressable>
      </View>
      <Text style={styles.subtitle}>
        Synthetic canonical tokens through the real compiler — the ear gate&apos;s identity source
        until the M44 classifier lands.
      </Text>

      <View style={styles.grid}>
        {STRIKE_TOKENS.map((token) => (
          <Pressable
            key={token}
            onPress={() => throwToken(token)}
            style={styles.tokenBtn}
            testID={`audition-token-${token}`}
          >
            <Text style={styles.tokenText}>{token}</Text>
            <Text style={styles.tokenHand}>{TOKEN_HAND[token]}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.controls}>
        {cycleRow(
          'PATCH',
          patchId,
          () => setPatchId((p) => (p === 'dorian-brass-v2' ? 'dorian-brass-cube' : 'dorian-brass-v2')),
          'audition-patch',
        )}
        {cycleRow(
          'VELOCITY',
          String(VELOCITIES[velocityIndex]),
          () => setVelocityIndex((i) => (i + 1) % VELOCITIES.length),
          'audition-velocity',
        )}
        {cycleRow(
          'ACCELERATION',
          String(ACCELERATIONS[accelerationIndex]),
          () => setAccelerationIndex((i) => (i + 1) % ACCELERATIONS.length),
          'audition-acceleration',
        )}
        {cycleRow(
          'CELL LEFT',
          `zone ${leftZone}`,
          () => setLeftZone((z) => (z + 1) % 6),
          'audition-cell-left',
        )}
        {cycleRow(
          'CELL RIGHT',
          `zone ${rightZone}`,
          () => setRightZone((z) => (z + 1) % 6),
          'audition-cell-right',
        )}
      </View>

      <ScrollView style={styles.log} contentContainerStyle={styles.logContent}>
        {rows.map((row) => (
          <View key={row.key} style={styles.logRow} testID={`audition-row-${row.token}`}>
            <Text style={styles.logToken}>{row.token}</Text>
            <View style={styles.logBody}>
              <Text style={styles.logLine}>{`${row.signatureId} · ${row.emphasis}`}</Text>
              <Text style={styles.logDim}>{row.stab}</Text>
              <Text style={styles.logDim}>{row.contour}</Text>
              <Text style={styles.logDim}>{`${row.cell} · stab ${row.note}`}</Text>
            </View>
          </View>
        ))}
        {rows.length === 0 ? <Text style={styles.logDim}>press a token to audition it</Text> : null}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, fontSize: sizes.title, fontFamily: fonts.heading, color: colors.textPrimary },
  subtitle: { fontSize: sizes.label, fontFamily: fonts.label, color: colors.textSecondary },
  connectBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  connectText: { fontSize: sizes.label, fontFamily: fonts.label, color: colors.textPrimary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tokenBtn: {
    minWidth: 68,
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tokenText: { fontSize: sizes.body, fontFamily: fonts.heading, color: colors.textPrimary },
  tokenHand: { fontSize: 10, fontFamily: fonts.label, color: colors.textSecondary },
  controls: { gap: 6 },
  controlRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  controlLabel: { fontSize: sizes.label, fontFamily: fonts.label, color: colors.textSecondary },
  controlValue: { fontSize: sizes.label, fontFamily: fonts.heading, color: colors.textPrimary },
  log: { flex: 1 },
  logContent: { gap: 8, paddingBottom: 24 },
  logRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  logToken: {
    width: 40,
    fontSize: sizes.body,
    fontFamily: fonts.heading,
    color: colors.trackerRight,
  },
  logBody: { flex: 1, gap: 2 },
  logLine: { fontSize: sizes.label, fontFamily: fonts.heading, color: colors.textPrimary },
  logDim: { fontSize: sizes.label, fontFamily: fonts.label, color: colors.textSecondary },
})
