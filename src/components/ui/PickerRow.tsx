/**
 * PickerRow — a compact single-select picker.
 *
 * Kyle's collapse-first rule for preferences: the row shows the label,
 * the current value, and a chevron. Tap opens a popout below the row
 * with the options as a radio-style list; tapping an option picks it
 * and closes the popout. Only one PickerRow open at a time inside a
 * `PickerProvider` (see PickerContext) so the vertical budget stays
 * predictable.
 *
 * Generic over the value type so the caller keeps its enum types
 * intact — no string-y widening for the sake of the picker.
 */

import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import { fonts, sizes, weights } from '@/theme/typography'
import { usePicker } from './PickerContext'

export interface PickerOption<T> {
  value: T
  label: string
  /** Optional caption shown under the label in the popout list. */
  description?: string
}

export interface PickerRowProps<T> {
  /** Stable id — used to coordinate the "one open at a time" rule. */
  id: string
  label: string
  /** Optional line under the label on the collapsed row. */
  caption?: string
  value: T
  options: ReadonlyArray<PickerOption<T>>
  onChange: (value: T) => void
  /**
   * Override the value preview shown on the collapsed row. Defaults to
   * the matching option's `label`. Use when the display string wants
   * extra decoration (e.g. `500 — Steady`).
   */
  valuePreview?: string
  /** Extra content shown at the bottom of the popout (e.g. a Stepper). */
  extraBody?: React.ReactNode
  testID?: string
}

export function PickerRow<T>({
  id,
  label,
  caption,
  value,
  options,
  onChange,
  valuePreview,
  extraBody,
  testID,
}: PickerRowProps<T>): React.JSX.Element {
  const { isOpen, toggle, close } = usePicker(id)
  const currentOption = options.find((o) => Object.is(o.value, value))
  const preview = valuePreview ?? currentOption?.label ?? '—'

  return (
    <View style={styles.wrap} testID={testID ?? `picker-${id}`}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        style={[styles.headerRow, isOpen && styles.headerRowOpen]}
        testID={`${testID ?? `picker-${id}`}-toggle`}
      >
        <View style={styles.headerText}>
          <Text style={styles.label}>{label}</Text>
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        </View>
        <View style={styles.headerValueGroup}>
          <Text style={styles.value} testID={`${testID ?? `picker-${id}`}-value`}>{preview}</Text>
          <Text style={[styles.chevron, isOpen && styles.chevronOpen]}>{isOpen ? '▴' : '▾'}</Text>
        </View>
      </Pressable>
      {isOpen ? (
        <View style={styles.body} testID={`${testID ?? `picker-${id}`}-body`}>
          {options.map((opt) => {
            const selected = Object.is(opt.value, value)
            return (
              <Pressable
                key={String(opt.value)}
                onPress={() => {
                  onChange(opt.value)
                  close()
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={[styles.optionRow, selected && styles.optionRowSelected]}
                testID={`${testID ?? `picker-${id}`}-option-${String(opt.value)}`}
              >
                <View style={styles.optionText}>
                  <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                    {opt.label}
                  </Text>
                  {opt.description ? (
                    <Text style={styles.optionDescription}>{opt.description}</Text>
                  ) : null}
                </View>
                {selected ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            )
          })}
          {extraBody ? <View style={styles.extra}>{extraBody}</View> : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    // Chrome-rim motif: lit top edge, dark bottom — the same bevel
    // language as the forged button art (Kyle's chrome restyle).
    borderWidth: 1,
    borderColor: colors.border,
    borderTopColor: colors.borderStrong,
    borderBottomColor: colors.background,
    borderRadius: 14,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
  },
  headerRowOpen: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  headerText: { flex: 1, gap: 2 },
  label: {
    fontSize: sizes.body,
    fontFamily: fonts.heading,
    fontWeight: weights.semibold,
    color: colors.textPrimary,
  },
  caption: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    color: colors.textMuted,
  },
  headerValueGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: {
    fontSize: sizes.body,
    fontFamily: fonts.label,
    fontWeight: weights.medium,
    color: colors.accent,
  },
  chevron: {
    fontSize: sizes.body,
    color: colors.textSecondary,
    width: 16,
    textAlign: 'center',
  },
  chevronOpen: { color: colors.accent },
  body: { paddingVertical: 4 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 12,
  },
  optionRowSelected: { backgroundColor: colors.accentSurface },
  optionText: { flex: 1, gap: 2 },
  optionLabel: {
    fontSize: sizes.body,
    fontFamily: fonts.body,
    color: colors.textPrimary,
  },
  optionLabelSelected: {
    fontFamily: fonts.heading,
    fontWeight: weights.semibold,
    color: colors.accent,
  },
  optionDescription: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  check: { fontSize: sizes.body, color: colors.accent, width: 20, textAlign: 'center' },
  extra: {
    marginTop: 4,
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 12,
  },
})
