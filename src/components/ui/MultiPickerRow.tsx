/**
 * MultiPickerRow — compact multi-select picker.
 *
 * Same collapse pattern as `PickerRow`, but the popout is a checkbox
 * list. The collapsed row shows a count summary (`5 of 12 enabled`)
 * so the athlete reads their setup without expanding. Selection
 * doesn't close the popout — a "Done" affordance does, since a
 * multi-select is a burst of choices, not a single pick.
 *
 * Generic over the value type so callers keep their union types
 * intact.
 */

import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import { fonts, sizes, weights } from '@/theme/typography'
import { usePicker } from './PickerContext'
import type { PickerOption } from './PickerRow'

export interface MultiPickerRowProps<T> {
  id: string
  label: string
  caption?: string
  values: ReadonlyArray<T>
  options: ReadonlyArray<PickerOption<T>>
  onChange: (values: T[]) => void
  /**
   * Override the value summary shown on the collapsed row. Defaults to
   * `${n} of ${total}`.
   */
  valuePreview?: string
  testID?: string
}

export function MultiPickerRow<T>({
  id,
  label,
  caption,
  values,
  options,
  onChange,
  valuePreview,
  testID,
}: MultiPickerRowProps<T>): React.JSX.Element {
  const { isOpen, toggle, close } = usePicker(id)
  const total = options.length
  const selectedCount = options.filter((o) => values.some((v) => Object.is(v, o.value))).length
  const preview = valuePreview ?? `${selectedCount} of ${total}`

  const togglePick = (val: T): void => {
    const next = values.some((v) => Object.is(v, val))
      ? values.filter((v) => !Object.is(v, val))
      : [...values, val]
    onChange([...next])
  }

  return (
    <View style={styles.wrap} testID={testID ?? `multi-picker-${id}`}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        style={[styles.headerRow, isOpen && styles.headerRowOpen]}
      >
        <View style={styles.headerText}>
          <Text style={styles.label}>{label}</Text>
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        </View>
        <View style={styles.headerValueGroup}>
          <Text style={styles.value}>{preview}</Text>
          <Text style={[styles.chevron, isOpen && styles.chevronOpen]}>{isOpen ? '▴' : '▾'}</Text>
        </View>
      </Pressable>
      {isOpen ? (
        <View style={styles.body}>
          {options.map((opt) => {
            const selected = values.some((v) => Object.is(v, opt.value))
            return (
              <Pressable
                key={String(opt.value)}
                onPress={() => togglePick(opt.value)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                style={styles.optionRow}
              >
                <View style={[styles.checkbox, selected && styles.checkboxOn]}>
                  {selected ? <Text style={styles.checkboxMark}>✓</Text> : null}
                </View>
                <View style={styles.optionText}>
                  <Text style={styles.optionLabel}>{opt.label}</Text>
                  {opt.description ? (
                    <Text style={styles.optionDescription}>{opt.description}</Text>
                  ) : null}
                </View>
              </Pressable>
            )
          })}
          <Pressable
            onPress={close}
            accessibilityRole="button"
            style={styles.doneRow}
            testID={`${testID ?? `multi-picker-${id}`}-done`}
          >
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    // Chrome-rim motif — see PickerRow.
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
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { borderColor: colors.accent, backgroundColor: colors.accentSurface },
  checkboxMark: { color: colors.accent, fontSize: sizes.body, lineHeight: 18 },
  optionText: { flex: 1, gap: 2 },
  optionLabel: {
    fontSize: sizes.body,
    fontFamily: fonts.body,
    color: colors.textPrimary,
  },
  optionDescription: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  doneRow: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    marginBottom: 8,
  },
  doneText: {
    fontSize: sizes.body,
    fontFamily: fonts.heading,
    fontWeight: weights.bold,
    color: colors.accent,
  },
})
