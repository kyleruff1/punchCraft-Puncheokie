/**
 * Recipe Summary card (M31-06, doc §8.2).
 *
 * Pinned at the bottom of the Recipe screen so the athlete can see what
 * they actually configured before starting, rather than discovering it
 * mid-round (R15). It re-renders on every control change because the store
 * recomputes `summary` alongside `recipe`.
 *
 * "Expected active pace" is always shown (doc §8) — it is the one number
 * that makes a punch goal concrete, since 1,200 punches means nothing until
 * it is expressed as a rate the athlete has to hold.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { ConflictNotice } from './ConflictNotice'
import { colors } from '@/theme/colors'
import type { RecipeSummary } from '@domain/workout/recipeSummary'
import type { RecipeConflict } from '@domain/workout/recipeValidation'

export function RecipeSummaryCard(props: {
  summary: RecipeSummary
  conflicts: RecipeConflict[]
}): React.JSX.Element {
  const { summary, conflicts } = props

  return (
    <View style={styles.root} testID="recipe-summary-card">
      <Text style={styles.title}>Recipe summary</Text>

      {summary.lines.map((line, index) => (
        <Text key={`${index}-${line}`} style={styles.line}>
          {line}
        </Text>
      ))}

      <Text style={styles.pace} testID="expected-active-pace">
        Expected active pace: {summary.expectedActivePace} punches/minute
      </Text>

      {conflicts.length > 0 ? (
        <View style={styles.conflicts}>
          {conflicts.map((conflict) => (
            <ConflictNotice key={conflict.code} conflict={conflict} />
          ))}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    backgroundColor: colors.surface,
    padding: 14,
    gap: 6,
  },
  title: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.textMuted,
    textTransform: 'uppercase',
  },
  line: { fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
  pace: { fontSize: 14, fontWeight: '700', color: colors.accent, marginTop: 4 },
  conflicts: { gap: 8, marginTop: 8 },
})
