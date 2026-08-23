import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'
import { TrackerBadgesRow } from '../../../components/TrackerBadgesRow'
import { colors } from '@/theme/colors'

export default function PuncheokieLanding() {
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: 'Puncheokie',
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
      <Text style={styles.title}>Puncheokie</Text>
      <Text style={styles.paragraph}>
        Puncheokie is the punch-along workout mode. Numbered combinations run on an independent
        workout clock: every cue, rest, and round is scheduled by punchCraft on the tablet, never by
        a song. You can optionally connect Spotify to listen to your own playlist in the background
        while you train, and an optional Voice Coach can speak the cues; when music is playing it
        stays off until you switch it on. Scoring uses the same tracker frames Velocity Lab shows
        raw and is labeled as a hand-sequence match.
      </Text>
      <Link href="/(tabs)/puncheokie/recipe" asChild>
        <Pressable accessibilityRole="button" style={styles.primaryAction} testID="setup-workout">
          <Text style={styles.primaryActionText}>Set up a workout</Text>
        </Pressable>
      </Link>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 16 },
  title: { fontSize: 28, fontWeight: '700', color: colors.textPrimary },
  paragraph: { fontSize: 15, lineHeight: 22, color: colors.textPrimary },
  primaryAction: {
    marginTop: 12,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  primaryActionText: { fontSize: 16, fontWeight: '700', color: colors.textOnAccent },
  headerLink: { paddingHorizontal: 12 },
  headerLinkText: { fontSize: 15, fontWeight: '600', color: colors.accent },
})
