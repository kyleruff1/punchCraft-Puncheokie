import React from 'react'
import { StyleSheet, View } from 'react-native'

import { ConnectionBadge } from '@components/ConnectionBadge'
import { useTrackerStore } from '@/state/useTrackerStore'
import { colors } from '@/theme/colors'

/**
 * Top-of-screen banner showing both tracker slots (left + right).
 *
 * Uses selector subscriptions so unrelated store updates don't re-render.
 */
export function TrackerBadgesRow(): React.ReactElement {
  const left = useTrackerStore((s) => s.slots.left)
  const right = useTrackerStore((s) => s.slots.right)
  return (
    <View style={styles.banner}>
      <ConnectionBadge hand="left" slot={left} />
      <ConnectionBadge hand="right" slot={right} />
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
})
