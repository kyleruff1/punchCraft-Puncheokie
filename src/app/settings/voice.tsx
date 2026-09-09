/**
 * Voice Coach settings (M34-05, doc §18, §25, D1, D15).
 *
 * ## The overlay toggle is the whole point of this screen
 *
 * Everything else here is preference. That one row decides whether the app
 * speaks over the athlete's own music, so it is written to be understood
 * rather than skimmed: its label says what it does in plain words, it sits
 * apart from the rest, and it is off until someone turns it on.
 *
 * It is also the only control that calls `setOverlayOptIn`. Every other row
 * goes through `setPolicy`, which cannot reach the field at all.
 *
 * ## Voice off is not a degraded mode
 *
 * Turning the coach off leaves a complete workout — visuals and haptics carry
 * every cue (doc §18, §25). The copy says so, because a settings screen that
 * treats an option as a downgrade nudges people away from the one that suits
 * them.
 */
import React from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { Stack } from 'expo-router'

import { colors } from '@/theme/colors'
import {
  PLAYBACK_DETECTION_UNAVAILABLE_NOTICE,
  createPlaybackDetector,
} from '@audio/ThirdPartyPlaybackDetector'
import { useVoiceSettingsStore } from '@state/useVoiceSettingsStore'
import type { VoiceMode, VoiceStyle, VoiceVocabulary } from '@domain/coach/VoiceCoachPolicy'

/** Plain words, not a euphemism. The athlete should not have to guess (D1). */
export const OVERLAY_TOGGLE_LABEL = 'Speak over my music'
export const OVERLAY_TOGGLE_DESCRIPTION =
  'Lets the coach talk while Spotify or another app is playing. Your music dips, it does not stop.'

const MODES: Array<{ value: VoiceMode; label: string; hint: string }> = [
  { value: 'off', label: 'Off', hint: 'Visual and haptic cues only — the workout is unchanged' },
  { value: 'minimal', label: 'Minimal', hint: 'Stance changes, round events and summaries' },
  { value: 'standard', label: 'Standard', hint: 'Every command called' },
  { value: 'full', label: 'Full', hint: 'Adds coaching reminders' },
]

const STYLES: Array<{ value: VoiceStyle; label: string; hint: string }> = [
  { value: 'call-and-go', label: 'Call and Go', hint: 'The whole combination, called before you throw it' },
  { value: 'follow-the-call', label: 'Follow the Call', hint: 'Each punch called as it comes up' },
  { value: 'minimal', label: 'Minimal', hint: 'Round events only' },
]

const VOCABULARIES: Array<{ value: VoiceVocabulary; label: string; hint: string }> = [
  { value: 'numbers', label: 'Numbers', hint: '"one, two, three" — how a coach calls it' },
  { value: 'names', label: 'Names', hint: '"jab, cross, lead hook" — while you learn the numbers' },
]

const METRIC_OPTIONS = [
  { value: 'off' as const, label: 'Off' },
  { value: 'periodic' as const, label: 'During rounds' },
  { value: 'round-summary' as const, label: 'At the bell' },
]

function Choice<T extends string>(props: {
  label: string
  options: Array<{ value: T; label: string; hint?: string }>
  selected: T
  onSelect: (value: T) => void
  testID: string
}): React.JSX.Element {
  return (
    <View style={styles.section} testID={props.testID}>
      <Text style={styles.sectionLabel}>{props.label}</Text>
      {props.options.map((option) => {
        const active = option.value === props.selected
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => props.onSelect(option.value)}
            style={[styles.option, active && styles.optionActive]}
            testID={`${props.testID}-${option.value}`}
          >
            <View style={styles.optionText}>
              <Text style={[styles.optionLabel, active && styles.optionLabelActive]}>
                {option.label}
              </Text>
              {option.hint ? <Text style={styles.optionHint}>{option.hint}</Text> : null}
            </View>
            {/* Never colour alone (spec §19.4): the selected row is marked. */}
            {active ? <Text style={styles.check}>✓</Text> : null}
          </Pressable>
        )
      })}
    </View>
  )
}

export default function VoiceSettingsScreen(): React.JSX.Element {
  const policy = useVoiceSettingsStore((s) => s.policy)
  const volumes = useVoiceSettingsStore((s) => s.volumes)
  const setPolicy = useVoiceSettingsStore((s) => s.setPolicy)
  const setOverlayOptIn = useVoiceSettingsStore((s) => s.setOverlayOptIn)
  const setVolumes = useVoiceSettingsStore((s) => s.setVolumes)
  const clickEnabled = useVoiceSettingsStore((s) => s.clickEnabled)
  const setClickEnabled = useVoiceSettingsStore((s) => s.setClickEnabled)
  const legacyBreathFloor = useVoiceSettingsStore((s) => s.legacyBreathFloor)
  const setLegacyBreathFloor = useVoiceSettingsStore((s) => s.setLegacyBreathFloor)

  const detectionAvailable = React.useMemo(() => createPlaybackDetector().available, [])

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container} testID="voice-settings">
      <Stack.Screen options={{ title: 'Voice Coach' }} />

      <Choice
        testID="voice-mode"
        label="How much it speaks"
        options={MODES}
        selected={policy.mode}
        onSelect={(mode) => setPolicy({ mode })}
      />

      <Choice
        testID="voice-style"
        label="How it calls combinations"
        options={STYLES}
        selected={policy.style}
        onSelect={(style) => setPolicy({ style })}
      />

      <Choice
        testID="voice-vocabulary"
        label="Which words it uses"
        options={VOCABULARIES}
        selected={policy.vocabulary}
        onSelect={(vocabulary) => setPolicy({ vocabulary })}
      />

      <Choice
        testID="voice-metrics"
        label="Metric callouts"
        options={METRIC_OPTIONS}
        selected={policy.metricAnnouncements}
        onSelect={(metricAnnouncements) => setPolicy({ metricAnnouncements })}
      />

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Levels</Text>
        <View style={styles.switchRow}>
          <View style={styles.optionText}>
            <Text style={styles.optionLabel}>Final ten seconds</Text>
            <Text style={styles.optionHint}>A warning tone before the bell</Text>
          </View>
          <Switch
            accessibilityLabel="Final ten second warning"
            onValueChange={(finalTenSecondWarning) => setPolicy({ finalTenSecondWarning })}
            testID="voice-final-warning"
            value={policy.finalTenSecondWarning}
          />
        </View>

        {/* Music is absent on purpose: the app never sets the athlete's
            playback volume. Ducking is the platform's business (spec §14.6). */}
        <View style={styles.switchRow}>
          <View style={styles.optionText}>
            <Text style={styles.optionLabel}>Bells and tones</Text>
            <Text style={styles.optionHint}>{`${Math.round(volumes.bells * 100)}%`}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setVolumes({ ...volumes, bells: volumes.bells > 0 ? 0 : 1 })}
            style={styles.smallButton}
            testID="voice-bells-toggle"
          >
            <Text style={styles.smallButtonText}>{volumes.bells > 0 ? 'Mute' : 'Unmute'}</Text>
          </Pressable>
        </View>

        <View style={styles.switchRow}>
          <View style={styles.optionText}>
            <Text style={styles.optionLabel}>Haptics</Text>
            <Text style={styles.optionHint}>Per-strike confirmation you can feel</Text>
          </View>
          <Switch
            accessibilityLabel="Haptics"
            onValueChange={(on) => setVolumes({ ...volumes, haptics: on ? 1 : 0 })}
            testID="voice-haptics"
            value={volumes.haptics > 0}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={styles.optionText}>
            <Text style={styles.optionLabel}>Metronome click</Text>
            <Text style={styles.optionHint}>
              Development marker grid — an audible click on the beat. Off by default.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Metronome click"
            onValueChange={setClickEnabled}
            testID="voice-click"
            value={clickEnabled}
          />
        </View>

        <View style={styles.switchRow}>
          <View style={styles.optionText}>
            <Text style={styles.optionLabel}>Old call placement (A/B)</Text>
            <Text style={styles.optionHint}>
              Places calls the way the coach did before the delivered-breath fix. Takes effect on
              the next bar, so you can flip it mid-round. Off = the shipped placement.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Old call placement"
            onValueChange={setLegacyBreathFloor}
            testID="voice-legacy-breath-floor"
            value={legacyBreathFloor}
          />
        </View>
      </View>

      {/* The D1 row. Set apart because it is the one decision here that
          affects something outside the app. */}
      <View style={styles.overlayCard} testID="overlay-card">
        <View style={styles.switchRow}>
          <View style={styles.optionText}>
            <Text style={styles.overlayLabel}>{OVERLAY_TOGGLE_LABEL}</Text>
            <Text style={styles.optionHint}>{OVERLAY_TOGGLE_DESCRIPTION}</Text>
          </View>
          <Switch
            accessibilityLabel={OVERLAY_TOGGLE_LABEL}
            onValueChange={setOverlayOptIn}
            testID="overlay-opt-in"
            value={policy.overlayOptIn}
          />
        </View>

        {detectionAvailable ? null : (
          <Text style={styles.notice} testID="detection-unavailable">
            {PLAYBACK_DETECTION_UNAVAILABLE_NOTICE}
          </Text>
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 20, paddingBottom: 48 },
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionActive: { borderColor: colors.accent, backgroundColor: colors.surface },
  optionText: { flex: 1, gap: 2 },
  optionLabel: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  optionLabelActive: { color: colors.accent },
  optionHint: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  check: { fontSize: 16, fontWeight: '800', color: colors.accent },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  smallButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallButtonText: { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  overlayCard: {
    gap: 4,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  overlayLabel: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  notice: { fontSize: 12, lineHeight: 17, color: colors.textSecondary, fontStyle: 'italic' },
})
