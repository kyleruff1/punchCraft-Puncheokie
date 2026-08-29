/**
 * Backdrop settings — the §31.4 quality/off switch for the reactive
 * layer behind the live workout screen. Theme selection is a recipe
 * concern (§31.5) and deliberately not here.
 */
import React from 'react'
import { Stack } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'
import type { BackdropQuality } from '@domain/effects/backdropSettings'
import { useBackdropSettingsStore } from '@state/useBackdropSettingsStore'

const QUALITIES: Array<{ value: BackdropQuality; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'The static backdrop only — nothing moves' },
  { value: 'reduced', label: 'Reduced', hint: 'A still glow; no motion at all' },
  {
    value: 'standard',
    label: 'Standard',
    hint: 'The full water — ripples, bubbles and current that answer your punches',
  },
]

export default function BackdropSettingsScreen(): React.JSX.Element {
  const quality = useBackdropSettingsStore((s) => s.quality)
  const setQuality = useBackdropSettingsStore((s) => s.setQuality)

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.container}
      testID="backdrop-settings"
    >
      <Stack.Screen options={{ title: 'Workout backdrop' }} />

      <View style={styles.section} testID="backdrop-quality">
        <Text style={styles.sectionLabel}>How alive the water is</Text>
        {QUALITIES.map((option) => {
          const active = option.value === quality
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => setQuality(option.value)}
              style={[styles.option, active && styles.optionActive]}
              testID={`backdrop-quality-${option.value}`}
            >
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                  {option.label}
                </Text>
                <Text style={styles.optionHint}>{option.hint}</Text>
              </View>
              {/* Never colour alone (spec §19.4): the selected row is marked. */}
              {active ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          )
        })}
      </View>

      <Text style={styles.note}>
        The backdrop is decoration. It never carries a cue, and turning it off changes nothing
        about how a workout is scored.
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 16 },
  section: { gap: 8 },
  sectionLabel: {
    fontSize: sizes.subtitle,
    fontFamily: fonts.heading,
    color: colors.textPrimary,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.borderStrong,
    borderBottomColor: colors.background,
    borderRadius: 12,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  optionActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSurface,
  },
  optionText: { flex: 1, gap: 2 },
  optionLabel: {
    fontSize: sizes.body,
    fontFamily: fonts.heading,
    color: colors.textPrimary,
  },
  optionLabelActive: { color: colors.accent },
  optionHint: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  check: {
    fontSize: sizes.subtitle,
    fontFamily: fonts.display,
    color: colors.accent,
  },
  note: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    lineHeight: 18,
    color: colors.textMuted,
  },
})
