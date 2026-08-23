/**
 * Inline conflict notice (M31-06, doc §12).
 *
 * Rendered next to the control that caused the conflict and again inside
 * `RecipeSummaryCard`. Severity is carried by an icon glyph **and** the
 * words "Error"/"Warning" — colour is never the only signal (spec §19.4),
 * so the notice still reads correctly in greyscale or to an athlete who
 * cannot distinguish the two tints.
 *
 * Every conflict from `validateRecipe` carries a `resolution`, and this
 * component always shows it: telling someone what is wrong without telling
 * them what to change would make the screen a dead end.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { colors } from '@/theme/colors'
import type { RecipeConflict } from '@domain/workout/recipeValidation'

export function ConflictNotice({ conflict }: { conflict: RecipeConflict }): React.JSX.Element {
  const isError = conflict.severity === 'error'
  const tint = isError ? colors.danger : colors.warning

  return (
    <View
      accessibilityRole="alert"
      style={[styles.root, { borderColor: tint }]}
      testID={`conflict-${conflict.code}`}
    >
      <View style={styles.header}>
        <View style={[styles.iconBox, { borderColor: tint }]}>
          <Text style={[styles.icon, { color: tint }]}>!</Text>
        </View>
        <Text style={[styles.severity, { color: tint }]}>{isError ? 'Error' : 'Warning'}</Text>
      </View>
      <Text style={styles.message}>{conflict.message}</Text>
      <Text style={styles.resolution}>{conflict.resolution}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    gap: 4,
    backgroundColor: colors.surface,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBox: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 12, fontWeight: '700', lineHeight: 14 },
  severity: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  message: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  resolution: { fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
})
