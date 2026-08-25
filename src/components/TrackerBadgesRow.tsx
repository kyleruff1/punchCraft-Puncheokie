import React from 'react'
import { StyleSheet, View } from 'react-native'

import { ConnectionBadge } from '@components/ConnectionBadge'
import { FixTrackerButton } from '@components/FixTrackerButton'
import { useTrackerStore } from '@/state/useTrackerStore'
import { colors } from '@/theme/colors'

/**
 * Top-of-screen banner showing both tracker slots (left + right).
 *
 * The badges themselves are reconnect buttons for the ordinary stale case;
 * `FixTrackerButton` sits alongside them for the harder case where the OS
 * cache is holding a phantom handle and only a real Bluetooth bounce clears
 * it. Kept beside the badges deliberately — the athlete finds the fix
 * exactly where the problem is showing.
 *
 * Uses selector subscriptions so unrelated store updates don't re-render.
 */
export function TrackerBadgesRow(): React.ReactElement {
  const left = useTrackerStore((s) => s.slots.left)
  const right = useTrackerStore((s) => s.slots.right)
  return (
    <View style={styles.banner}>
      <View style={styles.badges}>
        <ConnectionBadge hand="left" slot={left} />
        <ConnectionBadge hand="right" slot={right} />
      </View>
      <FixTrackerButton />
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
})
