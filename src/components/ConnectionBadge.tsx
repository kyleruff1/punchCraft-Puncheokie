import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { autoConnectKnownTrackers, isAutoConnectInFlight } from '@ble/autoConnectTrackers'
import type { SlotState } from '@/state/useTrackerStore'
import { colors, stateColors } from '@/theme/colors'

export interface ConnectionBadgeProps {
  hand: 'left' | 'right'
  slot: SlotState | null
  accessibilityLabel?: string
}

type Visual = {
  color: string
  label: string
}

function resolveVisual(slot: SlotState | null): Visual {
  if (!slot) {
    return { color: stateColors.unassigned, label: '(unassigned)' }
  }
  switch (slot.state) {
    case 'ready':
    case 'streaming':
      return { color: stateColors.connected, label: 'Connected' }
    case 'connecting':
    case 'bonding':
    case 'discovering':
    case 'initializing':
      return { color: stateColors.connecting, label: 'Connecting…' }
    case 'recovering':
      return { color: stateColors.connecting, label: 'Reconnecting…' }
    case 'error':
      return {
        color: stateColors.disconnected,
        label: slot.errorMessage ? `Error: ${slot.errorMessage}` : 'Error',
      }
    case 'dormant':
    case 'scanning':
    case 'discovered':
    default:
      // 'dormant' is the §11.5 terminal state after a graceful disconnect,
      // and also the initial state after assignSlot. Show it as
      // "Disconnected" — the user-facing meaning is the same.
      return { color: stateColors.disconnected, label: 'Disconnected' }
  }
}

/**
 * Small pill showing one tracker slot's connection state.
 *
 * Tapping it kicks an auto-connect pass — a manual reclaim for the case where
 * the trackers slow-blink because the app is holding a phantom handle. Safe on
 * a live slot too: the probe skips a slot with recent events. Under
 * `PRAGMA foreign_keys` disabled elsewhere, this button is the athlete's
 * back-onto-the-bag path.
 *
 * Accessibility: never color-only (§19.4) — the textual label always names
 * the state alongside the colored dot.
 */
export function ConnectionBadge(props: ConnectionBadgeProps): React.ReactElement {
  const { hand, slot, accessibilityLabel } = props
  const visual = resolveVisual(slot)
  const prefix = hand === 'left' ? 'L' : 'R'
  const text = `${prefix}: ${visual.label}`
  const onPress = (): void => {
    if (isAutoConnectInFlight()) return
    void autoConnectKnownTrackers({ timeoutMs: 10_000 })
  }
  return (
    <Pressable
      onPress={onPress}
      style={styles.pill}
      accessibilityRole="button"
      accessibilityLabel={`${accessibilityLabel ?? text} — tap to reconnect`}
      accessibilityHint="Rescans for the tracker and reconnects it"
    >
      <View style={[styles.dot, { backgroundColor: visual.color }]} />
      <Text style={styles.label} numberOfLines={1} ellipsizeMode="tail">
        {text}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  pill: {
    width: 120,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  label: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
  },
})
