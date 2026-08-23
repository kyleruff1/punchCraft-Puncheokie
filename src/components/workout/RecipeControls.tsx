/**
 * Recipe screen control primitives (M31-06).
 *
 * The repo has no shared button/segmented/stepper components yet, so these
 * live with the screen that needs them rather than being promoted to a
 * speculative design system. M31-07's advanced panel reuses them; if a
 * third consumer appears they move to `src/components/ui/`.
 *
 * Every selectable control carries `accessibilityState.selected` so the
 * selection is exposed to assistive technology, not conveyed by tint alone
 * (spec §19.4).
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'

export function ControlGroup(props: {
  label: string
  caption?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{props.label}</Text>
      {props.children}
      {props.caption ? <Text style={styles.caption}>{props.caption}</Text> : null}
    </View>
  )
}

export interface SegmentOption<T extends string> {
  value: T
  label: string
}

export function SegmentedControl<T extends string>(props: {
  options: ReadonlyArray<SegmentOption<T>>
  value: T
  onChange: (value: T) => void
  testID?: string
}): React.JSX.Element {
  return (
    <View style={styles.segmented} testID={props.testID}>
      {props.options.map((option) => {
        const selected = option.value === props.value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => props.onChange(option.value)}
            style={[styles.segment, selected && styles.segmentSelected]}
            testID={`${props.testID ?? 'segment'}-${option.value}`}
          >
            <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * Minus / value / plus stepper.
 *
 * Bounds are enforced here rather than left to the caller so the control
 * can never emit a value the recipe would reject.
 */
export function Stepper(props: {
  value: number
  step: number
  min: number
  max: number
  onChange: (value: number) => void
  format?: (value: number) => string
  testID?: string
}): React.JSX.Element {
  const { value, step, min, max, onChange } = props
  const canDecrease = value - step >= min
  const canIncrease = value + step <= max
  const format = props.format ?? ((v: number) => String(v))

  return (
    <View style={styles.stepper} testID={props.testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Decrease"
        disabled={!canDecrease}
        onPress={() => onChange(value - step)}
        style={[styles.stepperButton, !canDecrease && styles.stepperButtonDisabled]}
        testID={`${props.testID ?? 'stepper'}-minus`}
      >
        <Text style={styles.stepperButtonText}>–</Text>
      </Pressable>

      <Text style={styles.stepperValue} testID={`${props.testID ?? 'stepper'}-value`}>
        {format(value)}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Increase"
        disabled={!canIncrease}
        onPress={() => onChange(value + step)}
        style={[styles.stepperButton, !canIncrease && styles.stepperButtonDisabled]}
        testID={`${props.testID ?? 'stepper'}-plus`}
      >
        <Text style={styles.stepperButtonText}>+</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  groupLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  caption: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },

  segmented: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  segmentSelected: { borderColor: colors.accent, backgroundColor: colors.accentSurface },
  segmentText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  segmentTextSelected: { color: colors.textPrimary },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperButton: {
    width: 44,
    height: 44,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonDisabled: { opacity: 0.4 },
  stepperButtonText: { fontSize: 22, fontWeight: '700', color: colors.textPrimary },
  stepperValue: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    minWidth: 90,
    textAlign: 'center',
  },
})
