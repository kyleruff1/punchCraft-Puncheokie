/**
 * Workout Recipe screen (M31-06, doc §8).
 *
 * Lives under punchCraft, which owns building and running a workout end to
 * end. (The design doc calls the workout engine "Puncheokie"; that is now a
 * separate punch-along mode that has not shipped.)
 *
 * The seven primary control
 * groups, live conflict feedback, the pinned Recipe Summary card, and
 * "Start with a sample". It replaces the retired free-form program editor
 * (plan C5) — recipe plus generator, never a hand-built program.
 *
 * Scoring language on this screen is always "hand-sequence match" (D4).
 * The tracker cannot confirm which technique landed, so no copy here
 * promises technique accuracy.
 */
import React, { useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Stack } from 'expo-router'

import { ConflictNotice } from '@components/workout/ConflictNotice'
import { EnablementMenu } from '@components/workout/EnablementMenu'
import { RecipeSummaryCard } from '@components/workout/RecipeSummaryCard'
import {
  ControlGroup,
  SegmentedControl,
  Stepper,
  type SegmentOption,
} from '@components/workout/RecipeControls'
import { colors } from '@/theme/colors'
import {
  conflictsForField,
  useAdvancedOpen,
  useConflicts,
  useRecipe,
  useRecipeSummary,
  useSelectedSampleKey,
  useWorkoutStore,
} from '@state/useWorkoutStore'
import {
  GOAL_TIERS,
  TIER_LABELS,
  intensityLabel,
  suggestGoal,
  type IntensityTier,
} from '@domain/workout/punchGoals'
import { listSampleWorkouts } from '@domain/workout/samples'
import type { WorkoutRecipe } from '@domain/workout/WorkoutRecipe'
import type { WorkoutDurationMinutes } from '@domain/workout/roundSchedule'

// ---------------------------------------------------------------------------
// Control option tables — kept as data so the screen body stays readable.
// ---------------------------------------------------------------------------

const DURATIONS: ReadonlyArray<SegmentOption<`${WorkoutDurationMinutes}`>> = [
  { value: '20', label: '20 min' },
  { value: '30', label: '30 min' },
  { value: '40', label: '40 min' },
  { value: '60', label: '60 min' },
]

const FOCUS_OPTIONS: ReadonlyArray<SegmentOption<WorkoutRecipe['focus']>> = [
  { value: 'hands', label: 'Hands' },
  { value: 'movement', label: 'Movement' },
  { value: 'balanced', label: 'Balanced' },
]

/**
 * Stance and switch mode are one control group in doc §8 even though they
 * are two recipe fields: picking Orthodox or Southpaw fixes the stance,
 * while the two switch options keep the chosen stance as the *starting*
 * stance and change only how it moves.
 */
type StanceChoice = 'orthodox' | 'southpaw' | 'switch-by-round' | 'switch-on-command'

const STANCE_OPTIONS: ReadonlyArray<SegmentOption<StanceChoice>> = [
  { value: 'orthodox', label: 'Orthodox' },
  { value: 'southpaw', label: 'Southpaw' },
  { value: 'switch-by-round', label: 'Switch by round' },
  { value: 'switch-on-command', label: 'Switch on command' },
]

const BIAS_OPTIONS: ReadonlyArray<SegmentOption<WorkoutRecipe['bias']>> = [
  { value: 'balanced', label: 'Balanced' },
  { value: 'lead', label: 'Lead hand' },
  { value: 'rear', label: 'Rear hand' },
  { value: 'left', label: 'Physical left' },
  { value: 'right', label: 'Physical right' },
]

const VOICE_MODE_OPTIONS: ReadonlyArray<SegmentOption<WorkoutRecipe['voiceMode']>> = [
  { value: 'off', label: 'Off' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'standard', label: 'Standard' },
  { value: 'full', label: 'Full' },
]

const VOICE_VOCABULARY_OPTIONS: ReadonlyArray<SegmentOption<WorkoutRecipe['voiceVocabulary']>> = [
  { value: 'numbers', label: 'Numbers' },
  { value: 'names', label: 'Names' },
]

const PLAN_OPTIONS: ReadonlyArray<SegmentOption<WorkoutRecipe['adaptationMode']>> = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'adaptive', label: 'Adaptive' },
  { value: 'goal-seeking', label: 'Goal-seeking' },
]

const TIER_ORDER: IntensityTier[] = ['technique', 'steady', 'hard', 'high-volume', 'extreme']

/** Goals are authored in multiples of 50, so the stepper moves the same way. */
const GOAL_STEP = 50

function stanceChoiceFor(recipe: WorkoutRecipe): StanceChoice {
  if (recipe.stanceMode === 'switch-by-round') return 'switch-by-round'
  if (recipe.stanceMode === 'switch-on-command') return 'switch-on-command'
  return recipe.defaultStance
}

function patchForStanceChoice(choice: StanceChoice): Partial<WorkoutRecipe> {
  if (choice === 'orthodox' || choice === 'southpaw') {
    return { defaultStance: choice, stanceMode: 'fixed' }
  }
  return { stanceMode: choice }
}

// ---------------------------------------------------------------------------

export default function RecipeScreen(): React.JSX.Element {
  const recipe = useRecipe()
  const conflicts = useConflicts()
  const summary = useRecipeSummary()
  const selectedSampleKey = useSelectedSampleKey()
  const advancedOpen = useAdvancedOpen()
  const setRecipe = useWorkoutStore((s) => s.setRecipe)
  const selectSample = useWorkoutStore((s) => s.selectSample)
  const setAdvancedOpen = useWorkoutStore((s) => s.setAdvancedOpen)
  const resetRecipe = useWorkoutStore((s) => s.resetRecipe)

  const samples = useMemo(() => listSampleWorkouts(), [])
  const intensity = intensityLabel(recipe.totalPunchGoal, recipe.durationMinutes)
  const suggested = suggestGoal(recipe.durationMinutes, 'steady', recipe.focus)

  // Conflicts already shown next to a control are not repeated in the card,
  // so the athlete reads each problem once, where they can act on it.
  const goalConflicts = conflictsForField(conflicts, 'totalPunchGoal')

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: 'Workout recipe' }} />

      <Text style={styles.intro}>
        Set the shape of the workout. punchCraft generates the combinations; scoring is a
        hand-sequence match against the cues it calls.
      </Text>

      {/* 1 — Duration */}
      <ControlGroup label="Duration">
        <SegmentedControl
          testID="duration"
          options={DURATIONS}
          value={`${recipe.durationMinutes}` as `${WorkoutDurationMinutes}`}
          onChange={(value) =>
            setRecipe({ durationMinutes: Number(value) as WorkoutDurationMinutes })
          }
        />
      </ControlGroup>

      {/* 2 — Punch goal */}
      <ControlGroup
        label="Punch goal"
        caption={`Suggested for this duration and focus: ${suggested.toLocaleString('en-US')}.`}
      >
        <SegmentedControl
          testID="tier"
          options={TIER_ORDER.map((tier) => ({
            value: tier,
            label: TIER_LABELS[tier],
          }))}
          value={intensity.tier}
          onChange={(tier) =>
            setRecipe({ totalPunchGoal: GOAL_TIERS[tier][recipe.durationMinutes] })
          }
        />
        <Stepper
          testID="goal"
          value={recipe.totalPunchGoal}
          step={GOAL_STEP}
          min={GOAL_STEP}
          max={20_000}
          format={(v) => v.toLocaleString('en-US')}
          onChange={(totalPunchGoal) => setRecipe({ totalPunchGoal })}
        />
        <Text style={styles.intensityLabel} testID="intensity-label">
          {intensity.label}
        </Text>
        {intensity.warning ? (
          <View style={styles.extremeWarning} testID="extreme-warning">
            <View style={styles.warningIconBox}>
              <Text style={styles.warningIcon}>!</Text>
            </View>
            <Text style={styles.extremeWarningText}>{intensity.warning}</Text>
          </View>
        ) : null}
        {goalConflicts.map((conflict) => (
          <ConflictNotice key={conflict.code} conflict={conflict} />
        ))}
      </ControlGroup>

      {/* 3 — Focus */}
      <ControlGroup
        label="Focus"
        caption="Movement lowers the punch target to leave room for footwork and defense."
      >
        <SegmentedControl
          testID="focus"
          options={FOCUS_OPTIONS}
          value={recipe.focus}
          onChange={(focus) => setRecipe({ focus })}
        />
      </ControlGroup>

      {/* 4 — Stance */}
      <ControlGroup
        label="Stance"
        caption={
          recipe.stanceMode === 'fixed'
            ? undefined
            : `Starts ${recipe.defaultStance}. Stance changes only at a round boundary, and the change is announced.`
        }
      >
        <SegmentedControl
          testID="stance"
          options={STANCE_OPTIONS}
          value={stanceChoiceFor(recipe)}
          onChange={(choice) => setRecipe(patchForStanceChoice(choice))}
        />
      </ControlGroup>

      {/* 5 — Bias */}
      <ControlGroup
        label="Hand bias"
        caption="Lead and rear follow the stance. Physical left and right stay fixed to one arm, for rehab and asymmetry work."
      >
        <SegmentedControl
          testID="bias"
          options={BIAS_OPTIONS}
          value={recipe.bias}
          onChange={(bias) => setRecipe({ bias })}
        />
      </ControlGroup>

      {/* 6 — Voice Coach */}
      <ControlGroup
        label="Voice coach"
        caption="Stored now, spoken later. The coach stays off while another app is playing audio until you switch it on."
      >
        <SegmentedControl
          testID="voice-mode"
          options={VOICE_MODE_OPTIONS}
          value={recipe.voiceMode}
          onChange={(voiceMode) => setRecipe({ voiceMode })}
        />
        <Text style={styles.subLabel}>Vocabulary</Text>
        <SegmentedControl
          testID="voice-vocabulary"
          options={VOICE_VOCABULARY_OPTIONS}
          value={recipe.voiceVocabulary}
          onChange={(voiceVocabulary) => setRecipe({ voiceVocabulary })}
        />
      </ControlGroup>

      {/* 7 — Plan behavior */}
      <ControlGroup
        label="Plan behavior"
        caption="Adaptive adjusts density at block boundaries. Goal-seeking also chases the punch target."
      >
        <SegmentedControl
          testID="plan"
          options={PLAN_OPTIONS}
          value={recipe.adaptationMode}
          onChange={(adaptationMode) => setRecipe({ adaptationMode })}
        />
      </ControlGroup>

      {/* Advanced — progressive disclosure (doc §8). Collapsed by default;
          expanding never mutates a value. */}
      <View style={styles.advanced}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: advancedOpen }}
          onPress={() => setAdvancedOpen(!advancedOpen)}
          style={styles.advancedHeader}
          testID="advanced-affordance"
        >
          <Text style={styles.advancedText}>Advanced</Text>
          <Text style={styles.advancedToggle}>{advancedOpen ? 'Hide' : 'Show'}</Text>
        </Pressable>
        <Text style={styles.advancedCaption}>
          Which punches, defense, footwork and coaching calls the workout may use.
        </Text>
        {advancedOpen ? (
          <View style={styles.advancedBody}>
            <EnablementMenu recipe={recipe} conflicts={conflicts} onChange={setRecipe} />
          </View>
        ) : null}
      </View>

      {/* Start with a sample */}
      <ControlGroup label="Start with a sample">
        {samples.map((sample) => {
          const selected = sample.key === selectedSampleKey
          return (
            <Pressable
              key={sample.key}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => selectSample(selected ? undefined : sample.key)}
              style={[styles.sample, selected && styles.sampleSelected]}
              testID={`sample-${sample.key}`}
            >
              <Text style={styles.sampleName}>
                {selected ? '✓ ' : ''}
                {sample.name}
              </Text>
              <Text style={styles.sampleDescription}>{sample.description}</Text>
              {selected ? (
                <Text style={styles.sampleSummary}>
                  {sample.workout.schedule.length} rounds ·{' '}
                  {sample.workout.recipe.totalPunchGoal.toLocaleString('en-US')} punches ·{' '}
                  {sample.workout.estimatedActivePunchesPerMinute} punches/minute
                </Text>
              ) : null}
            </Pressable>
          )
        })}
      </ControlGroup>

      <RecipeSummaryCard summary={summary} conflicts={conflicts} />

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: true }}
          disabled
          style={styles.startButton}
          testID="start-button"
        >
          <Text style={styles.startButtonText}>Start workout</Text>
        </Pressable>
        <Text style={styles.startCaption}>The live screen arrives in M32.</Text>

        <Pressable
          accessibilityRole="button"
          onPress={resetRecipe}
          style={styles.resetButton}
          testID="reset-button"
        >
          <Text style={styles.resetButtonText}>Reset to defaults</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, gap: 24, paddingBottom: 48 },
  intro: { fontSize: 15, lineHeight: 22, color: colors.textSecondary },

  subLabel: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  intensityLabel: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },

  extremeWarning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 10,
  },
  warningIconBox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  warningIcon: { fontSize: 12, fontWeight: '700', lineHeight: 14, color: colors.warning },
  extremeWarningText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.textPrimary },

  advanced: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 14,
    gap: 8,
  },
  advancedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  advancedText: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  advancedToggle: { fontSize: 14, fontWeight: '600', color: colors.accent },
  advancedCaption: { fontSize: 13, color: colors.textSecondary },
  advancedBody: { marginTop: 8 },

  sample: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 4,
  },
  sampleSelected: { borderColor: colors.accent, backgroundColor: colors.accentSurface },
  sampleName: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  sampleDescription: { fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  sampleSummary: { fontSize: 13, color: colors.accent, marginTop: 4 },

  actions: { gap: 8 },
  startButton: {
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    opacity: 0.6,
  },
  startButtonText: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  startCaption: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  resetButton: { paddingVertical: 12, alignItems: 'center' },
  resetButtonText: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
})
