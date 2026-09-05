/**
 * Dev route. The Puncheoke instrument bench: punchcraft://dev/instrument-lab
 *
 * Phase 1 deliverable (instrument-design §24): shows, per live punch —
 * hand, raw tracker-reported velocity, normalized velocity01, raw
 * acceleration, normalized acceleration01, and the inter-punch gap —
 * straight off the app-wide keepalive punch source. Recovered
 * (buffer-drained) events are listed but flagged and excluded from the
 * gap/rate math, exactly as the instrument will exclude them from live
 * sound (§15).
 *
 * Synthetic punch buttons drive the same handler for desk work, so the
 * readout is testable without gloves. No stores — everything is local
 * state, like effects-lab.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'
import type { PunchHand, TrackerPunchEvent } from '@domain/punch/PunchEvent'
import {
  ACCELERATION_SCALE_DEFAULTS,
  createRollingScaler,
  VELOCITY_SCALE_DEFAULTS,
} from '@domain/instrument/rollingScale'
import { getTrackerKeepaliveSource } from '@protocol/trackerKeepalive'

interface LabRow {
  key: string
  hand: PunchHand
  velocityRaw: number | undefined
  velocity01: number
  accelerationRaw: number | undefined
  acceleration01: number
  /** Gap to the previous LIVE punch of any hand; undefined for the first. */
  gapMs: number | undefined
  recovered: boolean
}

const MAX_ROWS = 24

export default function InstrumentLabScreen(): React.JSX.Element {
  const [rows, setRows] = useState<readonly LabRow[]>([])
  const [liveCount, setLiveCount] = useState(0)
  const [recoveredCount, setRecoveredCount] = useState(0)
  const scalersRef = useRef({
    velocity: createRollingScaler(VELOCITY_SCALE_DEFAULTS),
    acceleration: createRollingScaler(ACCELERATION_SCALE_DEFAULTS),
  })
  const lastLiveAtRef = useRef<number | null>(null)
  const syntheticSeq = useRef(0)

  const onPunch = useRef((event: TrackerPunchEvent): void => {
    const scalers = scalersRef.current
    const recovered = event.recovered
    // Recovered events are history, not performance — they must not move
    // the scalers, the gap chain, or (later) the instrument's voices.
    const velocity01 = recovered ? 0 : scalers.velocity.scale(event.hand, event.velocityRaw)
    const acceleration01 = recovered
      ? 0
      : scalers.acceleration.scale(event.hand, event.accelerationRaw)
    let gapMs: number | undefined
    if (!recovered) {
      const prev = lastLiveAtRef.current
      gapMs = prev == null ? undefined : Math.round(event.receivedMonotonicTimeMs - prev)
      lastLiveAtRef.current = event.receivedMonotonicTimeMs
    }
    const row: LabRow = {
      key: event.id,
      hand: event.hand,
      velocityRaw: event.velocityRaw,
      velocity01,
      accelerationRaw: event.accelerationRaw,
      acceleration01,
      gapMs,
      recovered,
    }
    setRows((current) => [row, ...current].slice(0, MAX_ROWS))
    if (recovered) setRecoveredCount((n) => n + 1)
    else setLiveCount((n) => n + 1)
  })

  useEffect(() => {
    const shared = getTrackerKeepaliveSource()
    if (!shared) return
    // The keepalive owns the stream: subscribe only, never stop().
    return shared.subscribe((event) => onPunch.current(event))
  }, [])

  const synthetic = (hand: 'left' | 'right', velocityRaw: number, accelerationRaw: number): void => {
    syntheticSeq.current += 1
    const nowMonotonic = globalThis.performance.now()
    onPunch.current({
      id: `lab-${syntheticSeq.current}`,
      sourceFrameId: `lab-${syntheticSeq.current}`,
      deviceId: 'instrument-lab',
      hand,
      receivedMonotonicTimeMs: nowMonotonic,
      receivedWallTimeIso: new Date().toISOString(),
      velocityRaw,
      accelerationRaw,
      velocityUnit: 'tracker-unit',
      recovered: false,
      decoderId: 'instrument-lab',
      decoderVersion: '0',
      qualityFlags: [],
    })
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Instrument lab', headerShown: true }} />
      <View style={styles.summaryRow}>
        <Text style={styles.summary}>{`live ${liveCount}`}</Text>
        <Text style={styles.summary}>{`recovered ${recoveredCount}`}</Text>
      </View>
      <View style={styles.padRow}>
        <Pressable
          onPress={() => synthetic('left', 6, 180)}
          style={[styles.pad, styles.leftPad]}
          testID="lab-left-soft"
        >
          <Text style={styles.padText}>L soft</Text>
        </Pressable>
        <Pressable
          onPress={() => synthetic('left', 14, 520)}
          style={[styles.pad, styles.leftPad]}
          testID="lab-left-hard"
        >
          <Text style={styles.padText}>L hard</Text>
        </Pressable>
        <Pressable
          onPress={() => synthetic('right', 9, 300)}
          style={[styles.pad, styles.rightPad]}
          testID="lab-right-med"
        >
          <Text style={styles.padText}>R med</Text>
        </Pressable>
        <Pressable
          onPress={() => synthetic('right', 17, 610)}
          style={[styles.pad, styles.rightPad]}
          testID="lab-right-max"
        >
          <Text style={styles.padText}>R max</Text>
        </Pressable>
      </View>
      <View style={styles.headerRow}>
        <Text style={[styles.cell, styles.headerText]}>hand</Text>
        <Text style={[styles.cell, styles.headerText]}>vel</Text>
        <Text style={[styles.cell, styles.headerText]}>vel01</Text>
        <Text style={[styles.cell, styles.headerText]}>accel</Text>
        <Text style={[styles.cell, styles.headerText]}>acc01</Text>
        <Text style={[styles.cell, styles.headerText]}>gap ms</Text>
      </View>
      <ScrollView style={styles.list} testID="lab-rows">
        {rows.map((row) => (
          <View key={row.key} style={[styles.row, row.recovered && styles.recoveredRow]}>
            <Text style={[styles.cell, row.hand === 'left' ? styles.leftText : styles.rightText]}>
              {row.hand}
            </Text>
            <Text style={styles.cell}>{row.velocityRaw ?? '—'}</Text>
            <Text style={styles.cell}>{row.recovered ? 'hist' : row.velocity01.toFixed(2)}</Text>
            <Text style={styles.cell}>{row.accelerationRaw ?? '—'}</Text>
            <Text style={styles.cell}>{row.recovered ? 'hist' : row.acceleration01.toFixed(2)}</Text>
            <Text style={styles.cell}>{row.gapMs ?? '—'}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 10 },
  summaryRow: { flexDirection: 'row', gap: 16 },
  summary: { fontSize: sizes.label, fontFamily: fonts.label, color: colors.textSecondary },
  padRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pad: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceElevated,
  },
  leftPad: { borderColor: colors.trackerLeft },
  rightPad: { borderColor: colors.trackerRight },
  padText: { fontSize: sizes.body, fontFamily: fonts.heading, color: colors.textPrimary },
  headerRow: { flexDirection: 'row', paddingVertical: 4 },
  headerText: { color: colors.textSecondary },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  recoveredRow: { opacity: 0.45 },
  cell: {
    flex: 1,
    fontSize: sizes.label,
    fontFamily: fonts.label,
    color: colors.textPrimary,
  },
  leftText: { color: colors.trackerLeft },
  rightText: { color: colors.trackerRight },
})
