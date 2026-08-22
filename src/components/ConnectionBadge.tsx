import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import type { SlotState } from '@/state/useTrackerStore'

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
    return { color: colors.gray, label: '(unassigned)' }
  }
  switch (slot.state) {
    case 'ready':
    case 'streaming':
      return { color: colors.green, label: 'Connected' }
    case 'connecting':
    case 'bonding':
    case 'discovering':
    case 'initializing':
      return { color: colors.amber, label: 'Connecting…' }
    case 'recovering':
      return { color: colors.amber, label: 'Reconnecting…' }
    case 'error':
      return {
        color: colors.red,
        label: slot.errorMessage ? `Error: ${slot.errorMessage}` : 'Error',
      }
    case 'dormant':
    case 'scanning':
    case 'discovered':
    default:
      // 'dormant' is the §11.5 terminal state after a graceful disconnect,
      // and also the initial state after assignSlot. Show it as
      // "Disconnected" — the user-facing meaning is the same.
      return { color: colors.red, label: 'Disconnected' }
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

const colors = {
  green: '#2E7D32',
  amber: '#ED6C02',
  red: '#C62828',
  gray: '#9E9E9E',
  bg: '#F5F5F5',
  border: '#E0E0E0',
  text: '#212121',
}

const styles = StyleSheet.create({
  pill: {
    width: 120,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: colors.bg,
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
    color: colors.text,
  },
})
