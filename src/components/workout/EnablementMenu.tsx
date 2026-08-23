/**
 * Advanced Recipe panel — enablement menus (M31-07, doc §12).
 *
 * The second half of the Recipe screen's progressive disclosure. Four
 * command groups (Punches / Defense / Footwork / Coaching and pace calls),
 * their frequency bands, the body-shot share, combination length, cadence
 * and the extra-punch policy.
 *
 * Two rules shape this component:
 *
 * - **A conflict is shown where it is caused.** Turning the jab off renders
 *   the conflict at the Jab switch, not only in the summary card, so the
 *   athlete does not have to hunt for what they just broke.
 * - **Nothing is held locally.** Every change goes out through `onChange`
 *   as a `Partial<WorkoutRecipe>`; there is no local copy of the recipe to
 *   drift out of sync with the store.
 */
import React from 'react'
import { StyleSheet, Switch, Text, View } from 'react-native'

import { ConflictNotice } from './ConflictNotice'
import { ControlGroup, SegmentedControl, Stepper, type SegmentOption } from './RecipeControls'
import { colors } from '@/theme/colors'
import type { RecipeConflict } from '@domain/workout/recipeValidation'
import type { ExtraPunchPolicy, Frequency, WorkoutRecipe } from '@domain/workout/WorkoutRecipe'
import type {
  CoachCommand,
  DefenseCommand,
  FootworkCommand,
  PunchNumber,
} from '@domain/workout/WorkoutTokens'

export interface EnablementMenuProps {
  recipe: WorkoutRecipe
  conflicts: RecipeConflict[]
  onChange: (patch: Partial<WorkoutRecipe>) => void
}

// ---------------------------------------------------------------------------
// Doc §12 vocabularies. Names here are the serialized command values, so
// they must match the token unions exactly — the label is what changes.
// ---------------------------------------------------------------------------

const PUNCHES: ReadonlyArray<{ value: PunchNumber; label: string }> = [
  { value: 1, label: 'Jab / 1' },
  { value: 2, label: 'Cross / 2' },
  { value: 3, label: 'Lead hook / 3' },
  { value: 4, label: 'Rear hook / 4' },
  { value: 5, label: 'Lead uppercut / 5' },
  { value: 6, label: 'Rear uppercut / 6' },
]

const DEFENSE: ReadonlyArray<{ value: DefenseCommand; label: string }> = [
  { value: 'duck', label: 'Duck' },
  { value: 'bob-weave', label: 'Bob and weave' },
  { value: 'slip', label: 'Slip' },
  { value: 'roll', label: 'Roll' },
  { value: 'pull', label: 'Pull' },
]

const FOOTWORK: ReadonlyArray<{ value: FootworkCommand; label: string }> = [
  { value: 'pivot', label: 'Pivot' },
  { value: 'step-off', label: 'Step off' },
  { value: 'circle', label: 'Circle' },
  { value: 'cut-off-ring', label: 'Cut off the ring' },
  { value: 'reset', label: 'Reset' },
]

const COACH_CALLS: ReadonlyArray<{ value: CoachCommand; label: string }> = [
  { value: 'double-up', label: 'Double up' },
  { value: 'put-it-on-em', label: 'Put it on em' },
  { value: 'touch-and-go', label: 'Touch and go' },
  { value: 'breathe', label: 'Breathe' },
  { value: 'hands-up', label: 'Hands up' },
]

/** Doc §12 frequency bands, with their calls-per-round ranges in the label. */
const FREQUENCY_OPTIONS: ReadonlyArray<SegmentOption<Frequency>> = [
  { value: 'off', label: 'Off' },
  { value: 'light', label: 'Light · 2-3 per round' },
  { value: 'moderate', label: 'Moderate · 5-8 per round' },
  { value: 'heavy', label: 'Heavy · 9-14 per round' },
]

const CADENCE_OPTIONS: ReadonlyArray<SegmentOption<WorkoutRecipe['cadenceProfile']>> = [
  { value: 'technical', label: 'Technical' },
  { value: 'steady', label: 'Steady' },
  { value: 'pressure', label: 'Pressure' },
  { value: 'sprint', label: 'Sprint' },
]

const EXTRA_PUNCH_OPTIONS: ReadonlyArray<SegmentOption<ExtraPunchPolicy>> = [
  { value: 'encouraged', label: 'Encouraged' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'discouraged', label: 'Discouraged' },
]

/** Restored share when Body variations is switched back on. */
const DEFAULT_BODY_SHOT_PERCENT = 20

// ---------------------------------------------------------------------------

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

function conflictsFor(
  conflicts: readonly RecipeConflict[],
  field: keyof WorkoutRecipe,
): RecipeConflict[] {
  return conflicts.filter((c) => c.fields.includes(field))
}

function SwitchRow(props: {
  label: string
  value: boolean
  onValueChange: (next: boolean) => void
  testID: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <View style={styles.switchBlock} testID={`${props.testID}-row`}>
      <View style={styles.switchRow}>
        <Text style={styles.switchLabel}>{props.label}</Text>
        <Switch
          accessibilityLabel={props.label}
          onValueChange={props.onValueChange}
          testID={props.testID}
          thumbColor={props.value ? colors.accent : colors.textMuted}
          trackColor={{ false: colors.border, true: colors.accentSurface }}
          value={props.value}
        />
      </View>
      {props.children}
    </View>
  )
}

export function EnablementMenu(props: EnablementMenuProps): React.JSX.Element {
  const { recipe, conflicts, onChange } = props
  const bodyVariationsOn = recipe.bodyShotPercent > 0

  // Shown at the Jab switch specifically — the doc §12 worked example.
  const punchConflicts = conflictsFor(conflicts, 'enabledPunches')
  const bodyConflicts = conflictsFor(conflicts, 'bodyShotPercent')
  const defenseConflicts = conflictsFor(conflicts, 'enabledDefense')
  const footworkConflicts = conflictsFor(conflicts, 'enabledFootwork')
  const comboConflicts = conflictsFor(conflicts, 'maximumComboPunches')

  return (
    <View style={styles.root} testID="enablement-menu">
      {/* Punches ---------------------------------------------------------- */}
      <ControlGroup label="Punches">
        {PUNCHES.map((punch) => {
          const enabled = recipe.enabledPunches.includes(punch.value)
          return (
            <SwitchRow
              key={punch.value}
              label={punch.label}
              value={enabled}
              onValueChange={() =>
                onChange({ enabledPunches: toggle(recipe.enabledPunches, punch.value) })
              }
              testID={`punch-${punch.value}`}
            >
              {/* The jab is where a punch-enablement conflict is caused, so
                  that is where it is reported (doc §12). */}
              {punch.value === 1
                ? punchConflicts.map((conflict) => (
                    <ConflictNotice key={conflict.code} conflict={conflict} />
                  ))
                : null}
            </SwitchRow>
          )
        })}

        <SwitchRow
          label="Body variations"
          value={bodyVariationsOn}
          onValueChange={(next) =>
            onChange({ bodyShotPercent: next ? DEFAULT_BODY_SHOT_PERCENT : 0 })
          }
          testID="body-variations"
        >
          {bodyVariationsOn ? (
            <View style={styles.nested}>
              <Text style={styles.nestedLabel}>Body-shot share</Text>
              <Stepper
                testID="body-shot-percent"
                value={recipe.bodyShotPercent}
                step={5}
                min={5}
                max={100}
                format={(v) => `${v}%`}
                onChange={(bodyShotPercent) => onChange({ bodyShotPercent })}
              />
              {/* Serialized notation keeps the lowercase `b` (D10); only the
                  on-screen badge is uppercase (doc §13). */}
              <Text style={styles.hint}>Body shots are shown on the cue as a B badge.</Text>
            </View>
          ) : null}
          {bodyConflicts.map((conflict) => (
            <ConflictNotice key={conflict.code} conflict={conflict} />
          ))}
        </SwitchRow>
      </ControlGroup>

      {/* Defense ---------------------------------------------------------- */}
      <ControlGroup label="Defense">
        <SegmentedControl
          testID="defense-frequency"
          options={FREQUENCY_OPTIONS}
          value={recipe.defenseFrequency}
          onChange={(defenseFrequency) => onChange({ defenseFrequency })}
        />
        {DEFENSE.map((command) => (
          <SwitchRow
            key={command.value}
            label={command.label}
            value={recipe.enabledDefense.includes(command.value)}
            onValueChange={() =>
              onChange({ enabledDefense: toggle(recipe.enabledDefense, command.value) })
            }
            testID={`defense-${command.value}`}
          />
        ))}
        {defenseConflicts.map((conflict) => (
          <ConflictNotice key={conflict.code} conflict={conflict} />
        ))}
      </ControlGroup>

      {/* Footwork --------------------------------------------------------- */}
      <ControlGroup label="Footwork">
        <SegmentedControl
          testID="footwork-frequency"
          options={FREQUENCY_OPTIONS}
          value={recipe.footworkFrequency}
          onChange={(footworkFrequency) => onChange({ footworkFrequency })}
        />
        {FOOTWORK.map((command) => (
          <SwitchRow
            key={command.value}
            label={command.label}
            value={recipe.enabledFootwork.includes(command.value)}
            onValueChange={() =>
              onChange({ enabledFootwork: toggle(recipe.enabledFootwork, command.value) })
            }
            testID={`footwork-${command.value}`}
          />
        ))}
        {footworkConflicts.map((conflict) => (
          <ConflictNotice key={conflict.code} conflict={conflict} />
        ))}
      </ControlGroup>

      {/* Coaching and pace calls ------------------------------------------ */}
      <ControlGroup label="Coaching and pace calls">
        {COACH_CALLS.map((command) => (
          <SwitchRow
            key={command.value}
            label={command.label}
            value={recipe.enabledCoachCalls.includes(command.value)}
            onValueChange={() =>
              onChange({ enabledCoachCalls: toggle(recipe.enabledCoachCalls, command.value) })
            }
            testID={`coach-${command.value}`}
          />
        ))}
      </ControlGroup>

      {/* Combination length ----------------------------------------------- */}
      <ControlGroup
        label="Longest combination"
        caption="Combinations run three to five punches; longer ones fatigue before they teach anything."
      >
        <Stepper
          testID="maximum-combo"
          value={recipe.maximumComboPunches}
          step={1}
          min={1}
          max={8}
          format={(v) => `${v} punches`}
          onChange={(maximumComboPunches) => onChange({ maximumComboPunches })}
        />
        {comboConflicts.map((conflict) => (
          <ConflictNotice key={conflict.code} conflict={conflict} />
        ))}
      </ControlGroup>

      {/* Cadence ----------------------------------------------------------- */}
      <ControlGroup label="Cadence" caption="How closely the cues are spaced.">
        <SegmentedControl
          testID="cadence"
          options={CADENCE_OPTIONS}
          value={recipe.cadenceProfile}
          onChange={(cadenceProfile) => onChange({ cadenceProfile })}
        />
      </ControlGroup>

      {/* Extra punches ------------------------------------------------------ */}
      <ControlGroup
        label="Extra punches"
        caption="Punches thrown beyond the called combination. Encouraged counts them toward the goal; discouraged flags them."
      >
        <SegmentedControl
          testID="extra-punch-policy"
          options={EXTRA_PUNCH_OPTIONS}
          value={recipe.extraPunchPolicy}
          onChange={(extraPunchPolicy) => onChange({ extraPunchPolicy })}
        />
      </ControlGroup>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: 24 },
  switchBlock: { gap: 8 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Glove-friendly target height (doc §25) even though this screen is
    // reached before the workout starts.
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  switchLabel: { flex: 1, fontSize: 15, color: colors.textPrimary },
  nested: { gap: 8, paddingLeft: 12, paddingTop: 4 },
  nestedLabel: { fontSize: 13, color: colors.textMuted },
  hint: { fontSize: 13, color: colors.textSecondary },
})
