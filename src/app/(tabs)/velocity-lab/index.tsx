import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { ForgedButton } from '@/components/branding/ForgedButton'
import { colors } from '@/theme/colors'
import { fonts, recipes, sizes } from '@/theme/typography'

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


      <Text style={styles.paragraph}>
        Raw tracker frames, timestamps, and velocity — no workout, no scoring.
      </Text>
      <Text style={styles.hint}>
        Trackers connect automatically. Tap a badge above to reconnect one that has gone quiet.
      </Text>

      <View style={styles.linkRow}>
        <Link href="/(tabs)/velocity-lab/spike" asChild>
          <ForgedButton variant="secondary">Run BLE spike</ForgedButton>
        </Link>
        <Link href="/(tabs)/velocity-lab/probe" asChild>
          <ForgedButton variant="secondary">Protocol probe (dev)</ForgedButton>
        </Link>
        <Link href="/(tabs)/velocity-lab/live" asChild>
          <ForgedButton variant="secondary">Live decoded events</ForgedButton>
        </Link>
        <Link href="/settings" asChild>
          <ForgedButton variant="subtle">Diagnostics</ForgedButton>
        </Link>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 16, backgroundColor: colors.background },
  paragraph: {
    fontSize: sizes.body,
    fontFamily: fonts.body,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  hint: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  linkRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  headerLink: { paddingHorizontal: 12 },
  headerLinkText: { ...recipes.buttonSubtle, color: colors.accent },
})
