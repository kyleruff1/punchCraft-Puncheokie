/**
 * CollapsibleSection — generic collapse container.
 *
 * Same header/collapse pattern as `PickerRow` and `MultiPickerRow`, but
 * for sections whose body is not a list of options — the Advanced
 * enablement panel, dev sections, anything where the body is a
 * bespoke tree. The header row shows a label and a summary; tap
 * toggles the body. Coordinates with `PickerProvider` so only one
 * expandable section is open at a time app-wide.
 */

import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import { fonts, sizes, weights } from '@/theme/typography'
import { usePicker } from './PickerContext'

export interface CollapsibleSectionProps {
  id: string
  label: string
  /** Small right-side line summarising the section's state (`5 enabled`). */
  summary?: string
  caption?: string
  children: React.ReactNode
  testID?: string
}

export function CollapsibleSection({
  id,
  label,
  summary,
  caption,
  children,
  testID,
}: CollapsibleSectionProps): React.JSX.Element {
  const { isOpen, toggle } = usePicker(id)
  return (
    <View style={styles.wrap} testID={testID ?? `section-${id}`}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
        style={[styles.headerRow, isOpen && styles.headerRowOpen]}
        testID={`${testID ?? `section-${id}`}-toggle`}
      >
        <View style={styles.headerText}>
          <Text style={styles.label}>{label}</Text>
          {caption ? <Text style={styles.caption}>{caption}</Text> : null}
        </View>
        <View style={styles.headerValueGroup}>
          {summary ? <Text style={styles.summary}>{summary}</Text> : null}
          <Text style={[styles.chevron, isOpen && styles.chevronOpen]}>{isOpen ? '▴' : '▾'}</Text>
        </View>
      </Pressable>
      {isOpen ? <View style={styles.body}>{children}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
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
  summary: {
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
  body: { padding: 14, gap: 12 },
})
