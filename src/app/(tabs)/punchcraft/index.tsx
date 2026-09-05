import React from 'react'
import { Link, Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { ActionButton } from '@/components/branding/ActionButton'
import { PickerProvider } from '@/components/ui/PickerContext'
import { colors, punch } from '@/theme/colors'
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

  // The middle button (Kyle 2026-09-04): roll a random designed workout.
  // Always lands on a DIFFERENT preset than the current selection, so every
  // tap visibly re-rolls the grid; quickstart then runs the pick.
  const selectRandom = (): void => {
    const keys = samples.map((s) => s.key as SampleWorkoutKey)
    const pool = keys.filter((k) => k !== selectedSampleKey)
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? keys[0]
    if (pick) selectSample(pick)
  }

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

        {/* Designed workouts LEAD the page (Kyle 2026-09-04) — the library
            is the menu; both action buttons sit in one row beneath it. An
            always-visible grid (no popout): tap a preset to select it. */}
        <View style={styles.presetCard} testID="designed-workouts">
          <Text style={styles.presetLabel}>Designed workouts</Text>
          <View style={styles.presetGrid}>
            {samples.map((sample, index) => {
              const selected = sample.key === selectedSampleKey
              // Checkered greyscale (Kyle 2026-08-29): three tones cycling
              // with a per-row offset, so the 3-wide grid reads diagonal,
              // never striped. Selection's accent fill wins over the shade.
              const shade = TILE_SHADES[(Math.floor(index / 3) + index) % TILE_SHADES.length]
              return (
                <Pressable
                  key={sample.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() =>
                    selectSample(selected ? undefined : (sample.key as SampleWorkoutKey))
                  }
                  style={[
                    styles.presetTile,
                    { backgroundColor: shade },
                    selected && styles.presetTileSelected,
                  ]}
                  testID={`preset-${sample.key}`}
                >
                  <Text style={[styles.presetName, selected && styles.presetNameSelected]}>
                    {sample.name}
                  </Text>
                  <Text style={styles.presetDescription} numberOfLines={1}>
                    {sample.description}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        {/* The action row (Kyle 2026-09-04): build-a-workout hard against the
            LEFT edge, quickstart hard against the RIGHT, equal pill sizes —
            the prominent-banner era is over. Between them, "random workout"
            is DELIBERATELY bare — just text on a transparent backdrop,
            distinctly different from the authored chrome. */}
        <View style={styles.actionsRow}>
          <Link href="/(tabs)/punchcraft/recipe" asChild>
            <ActionButton
              action="buildAWorkout"
              fit="pill"
              height={60}
              testID="setup-workout"
              // Mint a fresh seed and drop any library pick, so the recipe opens on
              // a new generated workout rather than the last one built or picked.
              onPress={() => startNewBuild()}
            />
          </Link>
          <Link href="/(tabs)/punchcraft/live" asChild>
            {/* Selects a random preset AND starts it — the label promises a
                SESSION, so a tap goes straight to the live screen running
                the roll (Kyle 2026-09-04: "it hasn't started yet"). */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start a random workout"
              onPress={selectRandom}
              style={({ pressed }) => [styles.randomAction, pressed && styles.randomActionPressed]}
              testID="random-workout"
            >
              <Text style={styles.randomActionText}>Randomized PunchCraft Session</Text>
            </Pressable>
          </Link>
          <Link href="/(tabs)/punchcraft/live" asChild>
            {/* Jumps STRAIGHT to the live screen running the selected preset —
                no recipe detour, no seed minting. */}
            <ActionButton
              action="quickstartWorkout"
              fit="pill"
              height={60}
              disabled={selectedSampleKey === undefined}
              testID="quick-start"
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

/** The checker palette — three close greyscale steps off the surface. */
const TILE_SHADES = [punch.gunmetal, punch.charcoalDeep, punch.steelSelected] as const

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 16 },
  paragraph: {
    fontSize: sizes.body,
    fontFamily: fonts.body,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  actionsRow: {
    // Build-a-workout hard against the LEFT edge, quickstart hard against
    // the RIGHT — "extreme justified" (Kyle 2026-09-04) — equal pills
    // under the library. Wraps rather than clips on a narrow window.
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
  },
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
    // Thinner tiles, three across (Kyle 2026-08-29) — the shade comes
    // per-tile from TILE_SHADES so the 3×3 reads checkered.
    flexGrow: 1,
    flexBasis: '31%',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderTopColor: colors.textMuted,
    borderBottomColor: colors.background,
    borderRadius: 12,
    paddingVertical: 5,
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
    lineHeight: 14,
    color: colors.textSecondary,
  },
  randomAction: {
    // Transparent backdrop, styled INTO the forged motif (Kyle 2026-09-04):
    // the sporty italic the authored art carries, chrome metal, a dark
    // under-shadow for bevel depth — now framed by a ROUNDED chrome rim
    // (lit top edge, dark bottom, same recipe as the preset card). No
    // fill, so it still never competes with the pills.
    height: 60,
    justifyContent: 'center',
    paddingHorizontal: 22,
    // Rounded silver ring, built on the SAME recipe as the spike button
    // below (the one border that provably renders on this tablet):
    // integer width, moderate radius, no explicit background — Android's
    // border drawable drops fractional widths + half-height radii over a
    // 'transparent' fill (two invisible attempts, Kyle 2026-09-04).
    borderWidth: 2,
    borderRadius: 16,
    borderColor: punch.silver,
  },
  randomActionPressed: { opacity: 0.7 },
  randomActionText: {
    fontFamily: fonts.heading,
    fontSize: 18,
    letterSpacing: 1.2,
    color: punch.chrome,
    textShadowColor: punch.black,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 3,
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
