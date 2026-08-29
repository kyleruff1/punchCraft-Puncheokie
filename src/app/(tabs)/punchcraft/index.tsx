import React, { useMemo } from 'react'
import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native'

import { ActionButton } from '@/components/branding/ActionButton'
import { PickerProvider } from '@/components/ui/PickerContext'
import { PickerRow, type PickerOption } from '@/components/ui/PickerRow'
import { TrackerBadgesRow } from '../../../components/TrackerBadgesRow'
import { colors } from '@/theme/colors'
import { fonts, recipes, sizes } from '@/theme/typography'
import { listSampleWorkouts, type SampleWorkoutKey } from '@domain/workout/samples'
import { useSelectedSampleKey, useWorkoutStore } from '@state/useWorkoutStore'

/**
 * punchCraft — the workout home.
 *
 * This is where a workout is built or chosen and then run: recipe, the
 * designed-workout library, the live screen, and the summary all live under
 * this tab. Puncheokie is a separate mode and is not shipped yet.
 */
export default function PunchCraftLanding() {
  const samples = listSampleWorkouts()
  const selectedSampleKey = useSelectedSampleKey()
  const selectSample = useWorkoutStore((s) => s.selectSample)
  const startNewBuild = useWorkoutStore((s) => s.startNewBuild)

  const sampleOptions: ReadonlyArray<PickerOption<string | 'none'>> = useMemo(
    () => [
      { value: 'none' as const, label: 'None — build my own' },
      ...samples.map((s) => ({
        value: s.key,
        label: s.name,
        description: s.description,
      })),
    ],
    [samples],
  )

  return (
    <PickerProvider>
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

        <Link href="/(tabs)/punchcraft/recipe" asChild>
          {/* The authored art IS the button — pill, icon, chevron and neon
              rim are baked into the PNG, so no ForgedButton chrome here. */}
          <ActionButton
            action="buildAWorkout"
            testID="setup-workout"
            // Mint a fresh seed and drop any library pick, so the recipe opens on
            // a new generated workout rather than the last one built or picked.
            onPress={() => startNewBuild()}
            style={styles.primaryActionSpacing}
          />
        </Link>

        <PickerRow
          id="landing-sample"
          testID="landing-sample"
          label="Designed workouts"
          // Name the presets while collapsed — a bare "None — build my
          // own" preview read as "the presets are gone" on the bag.
          caption={samples.map((s) => s.name).join('  ·  ')}
          value={selectedSampleKey ?? 'none'}
          {...(selectedSampleKey ? {} : { valuePreview: `${samples.length} presets` })}
          options={sampleOptions}
          onChange={(key) => selectSample(key === 'none' ? undefined : (key as SampleWorkoutKey))}
        />

        {/* Throwaway M32-05 spike entry (#182); removed when the spike closes. */}
        <Link href="/(tabs)/punchcraft/orientation-spike" asChild>
          <Pressable accessibilityRole="button" style={styles.spikeAction} testID="open-spike">
            <Text style={styles.spikeActionText}>M32-05 spike: orientation / keep-awake / haptics</Text>
          </Pressable>
        </Link>
      </ScrollView>
    </PickerProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 16 },
  paragraph: {
    fontSize: sizes.body,
    fontFamily: fonts.body,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  primaryActionSpacing: { marginTop: 4 },
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
