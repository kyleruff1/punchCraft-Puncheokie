import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

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
 * Accessibility: never color-only (§19.4) — the textual label always names
 * the state alongside the colored dot.
 */
export function ConnectionBadge(props: ConnectionBadgeProps): React.ReactElement {
  const { hand, slot, accessibilityLabel } = props
  const visual = resolveVisual(slot)
  const prefix = hand === 'left' ? 'L' : 'R'
  const text = `${prefix}: ${visual.label}`
  return (
    <View
      style={styles.pill}
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? text}
    >
      <View style={[styles.dot, { backgroundColor: visual.color }]} />
      <Text style={styles.label} numberOfLines={1} ellipsizeMode="tail">
        {text}
      </Text>
    </View>
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
