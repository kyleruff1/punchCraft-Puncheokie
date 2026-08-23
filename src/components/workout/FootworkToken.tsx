/**
 * Footwork token (M32-06, doc §13).
 *
 * Two forms, because the commands describe two different things:
 *
 * - `circle` and `cut-off-ring` are paths around the opponent, so they
 *   render as a ring diagram;
 * - the rest are single steps, so they render as an arrow-shaped token.
 *
 * Both carry the word. Footwork is display-only and never scored (D4).
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { ActiveRing } from './ActiveRing'
import {
  FOOTWORK_ICON,
  FOOTWORK_LABEL,
  STATE_VISUALS,
  TOKEN_DIAMETER,
  isRingFootwork,
  type TokenSize,
  type TokenVisualState,
} from './tokenVisuals'
import type { FootworkCommand } from '@domain/workout/WorkoutTokens'

export interface FootworkTokenProps {
  command: FootworkCommand
  state: TokenVisualState
  size?: TokenSize
  reducedMotion?: boolean
}

export function FootworkToken(props: FootworkTokenProps): React.JSX.Element {
  const { command, state, size = 'stage', reducedMotion = false } = props
  const visual = STATE_VISUALS[state]
  const diameter = TOKEN_DIAMETER[size] * 0.85
  const ringForm = isRingFootwork(command)
  const isStage = size === 'stage'

  return (
    <View
      accessibilityLabel={`${FOOTWORK_LABEL[command]}, ${visual.label}`}
      accessibilityRole="image"
      style={styles.root}
      testID={`footwork-token-${command}`}
    >
      {state === 'active' ? (
        <ActiveRing
          diameter={diameter}
          borderRadius={ringForm ? diameter / 2 : 10}
          reducedMotion={reducedMotion}
        />
      ) : null}

      <View
        testID={ringForm ? 'footwork-ring-form' : 'footwork-arrow-form'}
        style={[
          styles.shape,
          ringForm
            ? { borderRadius: diameter / 2, width: diameter, height: diameter }
            : styles.arrow,
          {
            minHeight: diameter,
            borderWidth: visual.borderWidth,
            borderColor: visual.borderColor,
            backgroundColor: visual.backgroundColor,
          },
        ]}
      >
        <Text style={[styles.icon, { fontSize: isStage ? 28 : 18, color: visual.textColor }]}>
          {FOOTWORK_ICON[command]}
        </Text>
        <Text style={[styles.word, { fontSize: isStage ? 15 : 11, color: visual.textColor }]}>
          {FOOTWORK_LABEL[command]}
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
  shape: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 2,
  },
  /**
   * Arrow silhouette: square on the entry side, pointed on the exit side.
   * A third distinct outline, so punch / defense / footwork are separable
   * by shape with colour removed.
   */
  arrow: {
    minWidth: 96,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
    borderTopRightRadius: 26,
    borderBottomRightRadius: 26,
  },
  icon: { fontWeight: '700' },
  word: { fontWeight: '700', textAlign: 'center' },
  marker: { marginTop: 4, fontSize: 14, fontWeight: '700' },
})
