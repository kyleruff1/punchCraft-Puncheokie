import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { TrackerBadgesRow } from '@/components/TrackerBadgesRow'
import { colors } from '@/theme/colors'

/**
 * Velocity Lab landing.
 *
 * The connect controls used to live here: a "Connect both" button, and a
 * per-hand picker that let the athlete pick a device from a scan. All three
 * are gone. Blue is always the left tracker and red is always the right one
 * (`src/ble/knownTrackers.ts`), so there is no choice to make; auto-connect
 * runs at process launch and again when the live workout screen opens, and
 * the tracker badges at the top of the screen double as manual reconnect
 * buttons for the case where something went stale.
 *
 * What remains here is the diagnostic surface — the spike, the protocol probe
 * and the live-events view — behind the same shared badges row, so the athlete
 * can see and reclaim tracker state from any tab.
 */
export default function VelocityLabLanding() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: 'Velocity Lab',
          headerRight: () => (
            <Link href="/settings" asChild>
              <Pressable style={styles.headerLink}>
                <Text style={styles.headerLinkText}>Settings</Text>
              </Pressable>
            </Link>
          ),
        }}
      />

      <TrackerBadgesRow />

      <Text style={styles.title}>Velocity Lab</Text>
      <Text style={styles.paragraph}>
        Raw tracker frames, timestamps, and velocity — no workout, no scoring.
      </Text>
      <Text style={styles.hint}>
        Trackers connect automatically. Tap a badge above to reconnect one that has gone quiet.
      </Text>

      <View style={styles.linkRow}>
        <Link href="/(tabs)/velocity-lab/spike" asChild>
          <Pressable style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Run BLE spike</Text>
          </Pressable>
        </Link>
        <Link href="/(tabs)/velocity-lab/probe" asChild>
          <Pressable style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Protocol probe (dev)</Text>
          </Pressable>
        </Link>
        <Link href="/(tabs)/velocity-lab/live" asChild>
          <Pressable style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Live decoded events</Text>
          </Pressable>
        </Link>
        <Link href="/settings" asChild>
          <Pressable style={styles.linkButton}>
            <Text style={styles.linkButtonText}>Diagnostics</Text>
          </Pressable>
        </Link>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16, backgroundColor: colors.background },
  title: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
  paragraph: { fontSize: 15, lineHeight: 22, color: colors.textPrimary },
  hint: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic' },
  linkRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  linkButton: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.surfaceElevated,
  },
  linkButtonText: { fontSize: 14, fontWeight: '600', color: colors.textPrimary },
  headerLink: { paddingHorizontal: 12 },
  headerLinkText: { fontSize: 15, fontWeight: '600', color: colors.accent },
})
