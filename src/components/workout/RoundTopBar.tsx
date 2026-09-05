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
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors, stateColors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'
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
  /**
   * When provided, the glove chips become a pressable reconnect
   * affordance. The live screen passes it only in the idle phase: the
   * auto-retry budget can go dormant while the athlete is still waking
   * trackers up, and without this the only re-arm was leaving the screen.
   * Tapping the chips is the "manual push" that re-arms the chase.
   */
  onReconnectPress?: () => void
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

/**
 * Tracker lamp (Kyle 2026-08-29): a pure light — no letter, no state
 * word. The hue mirrors the physical glove (turquoise left, Ferrari red
 * right); lit means a tracker is genuinely bound, dim-almost-black with
 * a hint of the hue means not, like an unlit LED. A simulated session
 * therefore shows dim lamps — the SIM tag lives under the header pair,
 * not on the lamp. Assistive tech still hears hand + connection state.
 */
export function TrackerLamp(props: {
  hand: 'L' | 'R'
  state: LiveConnectionState
  /** Lamp diameter; the glow halo derives from it (size × 2 − 4). */
  size?: number
  /** When present, the percent renders in block figures under the lamp
   * (Kyle 2026-08-29) — fed by the keepalive's battery heartbeat. */
  batteryPct?: number
}): React.JSX.Element {
  const { hand, state, size = 30, batteryPct } = props
  const lit = state === 'ready' || state === 'streaming'
  const lamp =
    hand === 'L'
      ? { lit: colors.ledLeftLit, dim: colors.ledLeftDim }
      : { lit: colors.ledRightLit, dim: colors.ledRightDim }
  // The box is still halo-SIZED — the header's tuck math leans on this
  // invisible padding — but it never paints: the bright inner fill is
  // the whole indicator (Kyle 2026-08-29, "no outer ring casting light").
  const haloSize = size * 2 - 4
  return (
    <View
      accessibilityLabel={`${hand === 'L' ? 'Left' : 'Right'} tracker ${
        lit ? 'connected' : 'not connected'
      }${batteryPct === undefined ? '' : `, battery ${Math.round(batteryPct)} percent`}`}
      style={[
        styles.lampHalo,
        { width: haloSize, borderRadius: haloSize / 2 },
      ]}
      testID={`tracker-lamp-${hand}`}
    >
      <View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: lit ? lamp.lit : lamp.dim,
          },
          !lit && styles.lampUnlit,
        ]}
      />
      {/* Always rendered (Kyle 2026-09-05): a lamp with no reading shows
          a static "--%" so the pair stays level — one missing percent was
          re-flowing the whole header cluster. */}
      <Text style={styles.lampBattery} testID={`tracker-battery-${hand}`}>
        {batteryPct === undefined ? '--%' : `${Math.round(batteryPct)}%`}
      </Text>
    </View>
  )
}

export function GloveChip(props: {
  hand: 'L' | 'R'
  state: LiveConnectionState
  batteryPct?: number
  /** Header variant: transparent fill so the chrome buttons stay the
   * loudest thing in the cluster. */
  quiet?: boolean
}): React.JSX.Element {
  const { hand, state, batteryPct, quiet = false } = props
  const tint = hand === 'L' ? colors.trackerLeft : colors.trackerRight

  return (
    <View
      accessibilityLabel={`${hand === 'L' ? 'Left' : 'Right'} glove ${CONNECTION_LABEL[state]}`}
      style={[styles.chip, quiet && styles.chipQuiet]}
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
  // roundIndex / roundCount / roundRemainingMs / connection stay in the
  // props interface (the header reads the same slice) but this bar no
  // longer renders them.
  const { stance, degraded, onReconnectPress } = props

  return (
    <View style={styles.root} testID="round-top-bar">
      {/* Round + countdown live in the tabs header's 75% line (Kyle
          2026-08-28); the tracker lamps live ONLY in the header's led
          zone, SIM tag included (Kyle 2026-08-29: "the second set of
          lamps is not necessary"). This bar keeps stance, the idle
          reconnect affordance and the degraded notice. */}
      <View style={styles.row}>
        <Text style={styles.stance} testID="stance-label">
          {STANCE_LABEL[stance]}
        </Text>

        {onReconnectPress ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reconnect trackers"
            onPress={onReconnectPress}
            style={styles.reconnect}
            testID="glove-reconnect"
          >
            <Text style={styles.reconnectText}>reconnect trackers</Text>
          </Pressable>
        ) : null}
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
  stance: {
    fontSize: sizes.body,
    fontFamily: fonts.heading,
    color: colors.textSecondary,
  },
  reconnect: {
    marginLeft: 'auto',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reconnectText: {
    fontSize: sizes.label,
    fontFamily: fonts.label,
    color: colors.textSecondary,
  },
  lampHalo: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The unlit lamp keeps a faint rim so it reads as a lamp that is off,
  // not a stray dot.
  lampUnlit: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  // Block figures under the lamp — the display face, tabular so 9% and
  // 99% hold the same width.
  lampBattery: {
    marginTop: 2,
    fontSize: sizes.label,
    fontFamily: fonts.display,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
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
  chipQuiet: { backgroundColor: 'transparent', borderColor: colors.border },
  chipHand: { fontSize: sizes.body, fontFamily: fonts.display },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipState: { fontSize: sizes.label, fontFamily: fonts.label, color: colors.textSecondary },
  chipBattery: { fontSize: sizes.label, fontFamily: fonts.body, color: colors.textMuted },
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
  degradedIconText: {
    fontSize: sizes.micro,
    fontFamily: fonts.display,
    color: colors.warning,
    lineHeight: 13,
  },
  degradedText: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    color: colors.textPrimary,
    flex: 1,
  },
})
