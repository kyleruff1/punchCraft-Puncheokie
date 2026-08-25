import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { ForgedButton } from '@/components/branding/ForgedButton'
import { Wordmark } from '@/components/branding/Wordmark'
import { TrackerBadgesRow } from '../../../components/TrackerBadgesRow'
import { colors } from '@/theme/colors'
import { fonts, recipes, sizes, weights } from '@/theme/typography'
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
  const startNewBuild = useWorkoutStore((s) => s.startNewBuild)

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen
        options={{
          title: 'punchCraft',
          headerTitle: () => <Wordmark app="punchCraft" size="sm" />,
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
      <Wordmark app="punchCraft" size="md" style={styles.brand} />
      <Text style={styles.paragraph}>
        Build or run cued combinations on the tablet&apos;s own clock, tracked by punch count.
      </Text>

      <Link href="/(tabs)/punchcraft/recipe" asChild>
        <ForgedButton
          variant="primary"
          testID="setup-workout"
          // Mint a fresh seed and drop any library pick, so the recipe opens on
          // a new generated workout rather than the last one built or picked.
          onPress={() => startNewBuild()}
          style={styles.primaryActionSpacing}
        >
          Build a workout
        </ForgedButton>
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
          These three are hand-authored; Build a workout generates a fresh one from your recipe.
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
  brand: { alignSelf: 'flex-start', marginVertical: 4 },
  paragraph: {
    fontSize: sizes.body,
    fontFamily: fonts.body,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  primaryActionSpacing: { marginTop: 4 },
  section: { gap: 8, marginTop: 8 },
  sectionLabel: {
    fontSize: sizes.label,
    fontFamily: fonts.label,
    fontWeight: weights.bold,
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
  libraryName: {
    fontSize: sizes.body,
    fontFamily: fonts.heading,
    fontWeight: weights.bold,
    color: colors.textPrimary,
  },
  libraryDescription: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  sectionNote: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  spikeAction: {
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
  },
  spikeActionText: { ...recipes.buttonSubtle, color: colors.textSecondary },
  headerLink: { paddingHorizontal: 12 },
  headerLinkText: { ...recipes.buttonSubtle, color: colors.accent },
})
