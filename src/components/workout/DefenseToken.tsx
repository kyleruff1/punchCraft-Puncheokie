/**
 * Defensive movement token (M32-06, doc §13).
 *
 * A rounded-rectangular token carrying the word plus a simple motion icon —
 * a different silhouette from the circular punch tokens, so the athlete can
 * tell "move" from "throw" peripherally without reading either.
 *
 * Defense is display-only and never scored (D4): nothing here shows a
 * result, and no state uses red.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { ActiveRing } from './ActiveRing'
import {
  DEFENSE_ICON,
  DEFENSE_LABEL,
  STATE_VISUALS,
  TOKEN_DIAMETER,
  type TokenSize,
  type TokenVisualState,
} from './tokenVisuals'
import type { DefenseCommand } from '@domain/workout/WorkoutTokens'

export interface DefenseTokenProps {
  command: DefenseCommand
  state: TokenVisualState
  size?: TokenSize
  reducedMotion?: boolean
}

export function DefenseToken(props: DefenseTokenProps): React.JSX.Element {
  const { command, state, size = 'stage', reducedMotion = false } = props
  const visual = STATE_VISUALS[state]
  const height = TOKEN_DIAMETER[size] * 0.75
  const isStage = size === 'stage'

  return (
    <View
      accessibilityLabel={`${DEFENSE_LABEL[command]}, ${visual.label}`}
      accessibilityRole="image"
      style={styles.root}
      testID={`defense-token-${command}`}
    >
      {state === 'active' ? (
        <ActiveRing diameter={height} borderRadius={16} reducedMotion={reducedMotion} />
      ) : null}

      <View
        style={[
          styles.plate,
          {
            minHeight: height,
            minWidth: height * 1.9,
            borderWidth: visual.borderWidth,
            borderColor: visual.borderColor,
            backgroundColor: visual.backgroundColor,
          },
        ]}
      >
        <Text style={[styles.icon, { fontSize: isStage ? 30 : 20, color: visual.textColor }]}>
          {DEFENSE_ICON[command]}
        </Text>
        <Text style={[styles.word, { fontSize: isStage ? 18 : 13, color: visual.textColor }]}>
          {DEFENSE_LABEL[command]}
        </Text>
      </View>

      {visual.marker ? (
        <Text style={[styles.marker, { color: visual.textColor }]} testID="state-marker">
          {visual.marker}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  plate: {
    // Rounded rectangle — deliberately not a circle, so shape alone
    // separates defense from punches (spec §19.4).
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  icon: { fontWeight: '700', lineHeight: 34 },
  word: { fontWeight: '700', textAlign: 'center' },
  marker: { marginTop: 4, fontSize: 14, fontWeight: '700' },
})
