import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { TrackerBadgesRow } from '../../../components/TrackerBadgesRow'
import { colors } from '@/theme/colors'
import { listSampleWorkouts } from '@domain/workout/samples'
import { useWorkoutStore } from '@state/useWorkoutStore'

/**
 * punchCraft — the workout home.
 *
 * This is where a workout is built or chosen and then run: recipe, the
 * designed-workout library, the live screen, and the summary all live under
 * this tab. Puncheokie is a separate mode and is not shipped yet.
 */
export default function PunchCraftLanding() {
  const samples = listSampleWorkouts()
  const selectSample = useWorkoutStore((s) => s.selectSample)

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: 'punchCraft',
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
      <Text style={styles.title}>punchCraft</Text>
      <Text style={styles.paragraph}>
        Build or run cued combinations on the tablet&apos;s own clock, tracked by punch count.
      </Text>

      <Link href="/(tabs)/punchcraft/recipe" asChild>
        <Pressable accessibilityRole="button" style={styles.primaryAction} testID="setup-workout">
          <Text style={styles.primaryActionText}>Build a workout</Text>
        </Pressable>
      </Link>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Designed workouts</Text>
        {samples.map((sample) => (
          <Link
            key={sample.key}
            href="/(tabs)/punchcraft/recipe"
            asChild
          >
            <Pressable
              accessibilityRole="button"
              style={styles.libraryRow}
              testID={`library-${sample.key}`}
              // Pick the workout before the recipe screen opens, so both the
              // recipe and the live run use it rather than the default.
              onPress={() => selectSample(sample.key)}
            >
              <Text style={styles.libraryName}>{sample.name}</Text>
              <Text style={styles.libraryDescription}>{sample.description}</Text>
            </Pressable>
          </Link>
        ))}
        <Text style={styles.sectionNote}>
          More designed workouts arrive with the generator; these three are hand-authored.
        </Text>
      </View>

      {/* Throwaway M32-05 spike entry (#182); removed when the spike closes. */}
      <Link href="/(tabs)/punchcraft/orientation-spike" asChild>
        <Pressable accessibilityRole="button" style={styles.spikeAction} testID="open-spike">
          <Text style={styles.spikeActionText}>M32-05 spike: orientation / keep-awake / haptics</Text>
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
    marginTop: 4,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: colors.accent,
  },
  primaryActionText: { fontSize: 16, fontWeight: '700', color: colors.textOnAccent },
  section: { gap: 8, marginTop: 8 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  libraryRow: {
    padding: 14,
    gap: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  libraryName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  libraryDescription: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  sectionNote: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  spikeAction: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
  },
  spikeActionText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  headerLink: { paddingHorizontal: 12 },
  headerLinkText: { fontSize: 15, fontWeight: '600', color: colors.accent },
})
