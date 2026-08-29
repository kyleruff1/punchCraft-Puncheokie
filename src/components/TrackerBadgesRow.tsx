import React from 'react'
import { StyleSheet, View } from 'react-native'

import { ConnectionBadge } from '@components/ConnectionBadge'
import { ConnectTrackersButton } from '@components/ConnectTrackersButton'
import { FixTrackerButton } from '@components/FixTrackerButton'
import { useTrackerStore } from '@/state/useTrackerStore'
import { colors } from '@/theme/colors'

/**
 * Top-of-screen banner showing both tracker slots (left + right) with the
 * two recovery affordances beside them.
 *
 * Two buttons, deliberately different in weight:
 * - **Connect trackers** is the primary. It runs a fresh scan-and-connect,
 *   which is what the ordinary case needs — trackers advertising, app not
 *   looking. Prominent when the athlete does not have both slots live.
 * - **Fix tracker connection** is the escalation. It prompts a real Bluetooth
 *   adapter bounce for the case where the OS is holding a phantom handle
 *   nothing app-side can evict.
 *
 * The tracker badges themselves are also tap-to-reconnect, per slot — kept
 * for muscle memory, but the visible buttons are what the athlete finds
 * first.
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
      <View style={styles.actions}>
        <ConnectTrackersButton />
        <FixTrackerButton />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    // Tight chrome: the action pair sits at the extreme top-right of the
    // page (Kyle), so the banner carries almost no padding of its own.
    paddingTop: 2,
    paddingBottom: 4,
    paddingLeft: 12,
    paddingRight: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    flexWrap: 'wrap',
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 8,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 2,
    flexShrink: 1,
    marginLeft: 'auto',
  },
})
