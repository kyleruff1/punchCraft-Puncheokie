import React from 'react'
import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { ActionButton } from '@/components/branding/ActionButton'
import { PickerProvider } from '@/components/ui/PickerContext'
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

        {/* Designed workouts — the no-build path. An always-visible grid
            (no popout): tap a preset to select it, and the small chrome
            start button jumps STRAIGHT to the live screen running it —
            no recipe detour, no seed minting. */}
        <View style={styles.presetCard} testID="designed-workouts">
          <Text style={styles.presetLabel}>Designed workouts</Text>
          <View style={styles.presetGrid}>
            {samples.map((sample) => {
              const selected = sample.key === selectedSampleKey
              return (
                <Pressable
                  key={sample.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() =>
                    selectSample(selected ? undefined : (sample.key as SampleWorkoutKey))
                  }
                  style={[styles.presetTile, selected && styles.presetTileSelected]}
                  testID={`preset-${sample.key}`}
                >
                  <Text style={[styles.presetName, selected && styles.presetNameSelected]}>
                    {sample.name}
                  </Text>
                  <Text style={styles.presetDescription} numberOfLines={2}>
                    {sample.description}
                  </Text>
                </Pressable>
              )
            })}
          </View>
          <Link href="/(tabs)/punchcraft/live" asChild>
            <ActionButton
              action="startWorkout"
              fit="pill"
              height={40}
              disabled={selectedSampleKey === undefined}
              testID="quick-start"
              style={styles.quickStart}
            />
          </Link>
        </View>

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
  presetCard: {
    // Chrome-rim motif: lit top edge, dark bottom, pill-adjacent radius.
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.borderStrong,
    borderBottomColor: colors.background,
    borderRadius: 14,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 10,
  },
  presetLabel: {
    fontSize: sizes.body,
    fontFamily: fonts.heading,
    color: colors.textPrimary,
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  presetTile: {
    flexGrow: 1,
    flexBasis: 260,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderTopColor: colors.textMuted,
    borderBottomColor: colors.background,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
    paddingVertical: 8,
    paddingHorizontal: 14,
    gap: 2,
  },
  presetTileSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  presetName: {
    fontSize: sizes.body,
    fontFamily: fonts.heading,
    color: colors.textPrimary,
  },
  presetNameSelected: { color: colors.accent },
  presetDescription: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  quickStart: { alignSelf: 'center' },
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
