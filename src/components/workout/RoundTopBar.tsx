/**
 * Round status bar — the top zone of the live layout (M32-07, doc §19).
 *
 * Round n/N, the countdown, the stance, and per-glove connection and
 * battery. Everything here is glanceable: the athlete reads it between
 * combinations, not during one.
 *
 * Degraded mode is text plus an icon, never a bare colour change
 * (spec §19.4) — a tracker dropping out is exactly the situation where a
 * colour-only signal gets missed.
 *
 * Presentational only — no store, engine or clock imports.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { colors, stateColors } from '@/theme/colors'
import type { ConnectionState } from '@ble/bleTypes'
import type { Stance } from '@domain/workout/WorkoutTokens'

/**
 * `'simulated'` is a first-class state, not a placeholder: since M33-01 the
 * live screen falls back to the simulator whenever both gloves are not
 * connected, and the chip has to say so.
 */
export type LiveConnectionState = ConnectionState | 'simulated'

export interface RoundTopBarProps {
  roundIndex: number
  roundCount: number
  roundRemainingMs: number
  stance: Stance
  connection: { left: LiveConnectionState; right: LiveConnectionState }
  batteryPct?: { left?: number; right?: number }
  degraded?: string
}

const STANCE_LABEL: Record<Stance, string> = {
  orthodox: 'Orthodox',
  southpaw: 'Southpaw',
}

/** Short, glanceable status word per connection state. */
const CONNECTION_LABEL: Record<LiveConnectionState, string> = {
  simulated: 'SIM',
  dormant: 'Off',
  scanning: 'Scan',
  discovered: 'Found',
  connecting: 'Conn',
  bonding: 'Bond',
  discovering: 'Disc',
  initializing: 'Init',
  ready: 'Ready',
  streaming: 'Live',
  recovering: 'Recon',
  error: 'Error',
}

function dotColorFor(state: LiveConnectionState): string {
  if (state === 'simulated') return colors.accent
  if (state === 'streaming' || state === 'ready') return stateColors.connected
  if (state === 'error') return stateColors.disconnected
  if (state === 'dormant') return stateColors.unassigned
  return stateColors.connecting
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function GloveChip(props: {
  hand: 'L' | 'R'
  state: LiveConnectionState
  batteryPct?: number
}): React.JSX.Element {
  const { hand, state, batteryPct } = props
  const tint = hand === 'L' ? colors.trackerLeft : colors.trackerRight

  return (
    <View
      accessibilityLabel={`${hand === 'L' ? 'Left' : 'Right'} glove ${CONNECTION_LABEL[state]}`}
      style={styles.chip}
      testID={`glove-chip-${hand}`}
    >
      {/* Letter first: the tracker tint matches the physical glove, but the
          letter is what carries the meaning (spec §19.4). */}
      <Text style={[styles.chipHand, { color: tint }]}>{hand}</Text>
      <View style={[styles.dot, { backgroundColor: dotColorFor(state) }]} />
      <Text style={styles.chipState}>{CONNECTION_LABEL[state]}</Text>
      {batteryPct === undefined ? null : (
        <Text style={styles.chipBattery} testID={`glove-battery-${hand}`}>
          {`${Math.round(batteryPct)}%`}
        </Text>
      )}
    </View>
  )
}

export function RoundTopBar(props: RoundTopBarProps): React.JSX.Element {
  const { roundIndex, roundCount, roundRemainingMs, stance, connection, batteryPct, degraded } =
    props

  return (
    <View style={styles.root} testID="round-top-bar">
      <View style={styles.row}>
        <Text style={styles.round} testID="round-counter">
          {`Round ${roundIndex + 1}/${roundCount}`}
        </Text>

        <Text style={styles.countdown} testID="round-countdown">
          {formatCountdown(roundRemainingMs)}
        </Text>

        <Text style={styles.stance} testID="stance-label">
          {STANCE_LABEL[stance]}
        </Text>

        <View style={styles.gloves}>
          <GloveChip
            hand="L"
            state={connection.left}
            {...(batteryPct?.left === undefined ? {} : { batteryPct: batteryPct.left })}
          />
          <GloveChip
            hand="R"
            state={connection.right}
            {...(batteryPct?.right === undefined ? {} : { batteryPct: batteryPct.right })}
          />
        </View>
      </View>

      {degraded ? (
        <View accessibilityRole="alert" style={styles.degraded} testID="degraded-warning">
          <View style={styles.degradedIcon}>
            <Text style={styles.degradedIconText}>!</Text>
          </View>
          <Text style={styles.degradedText}>{degraded}</Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  round: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  countdown: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  stance: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  gloves: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipHand: { fontSize: 14, fontWeight: '800' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipState: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  chipBattery: { fontSize: 12, color: colors.textMuted },
  degraded: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.surface,
  },
  degradedIcon: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  degradedIconText: { fontSize: 11, fontWeight: '800', color: colors.warning, lineHeight: 13 },
  degradedText: { fontSize: 13, color: colors.textPrimary, flex: 1 },
})
