/**
 * Numbered punch token (M32-06, doc §13).
 *
 * A large circular token carrying the number. A body shot is the same
 * circle with a prominent uppercase **B** badge and a lower placement cue —
 * the badge is purely visual; authored notation keeps the lowercase `b`
 * (D10), and nothing here ever emits notation.
 *
 * The optional `handHint` ('L'/'R') is caller-supplied because the hand
 * depends on stance, which this component deliberately does not know
 * (doc §11).
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { ActiveRing } from './ActiveRing'
import {
  STATE_VISUALS,
  TOKEN_DIAMETER,
  TOKEN_FONT_SIZE,
  type TokenSize,
  type TokenVisualState,
} from './tokenVisuals'
import { colors } from '@/theme/colors'
import type { PunchNumber } from '@domain/workout/WorkoutTokens'

export interface PunchTokenProps {
  number: PunchNumber
  body: boolean
  state: TokenVisualState
  handHint?: 'L' | 'R'
  size?: TokenSize
  reducedMotion?: boolean
}

export function PunchToken(props: PunchTokenProps): React.JSX.Element {
  const { number, body, state, handHint, size = 'stage', reducedMotion = false } = props
  const visual = STATE_VISUALS[state]
  const diameter = TOKEN_DIAMETER[size]

  const accessibilityLabel = [
    `Punch ${number}`,
    body ? 'to the body' : null,
    handHint ? (handHint === 'L' ? 'left hand' : 'right hand') : null,
    visual.label,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="image"
      style={[styles.root, body && styles.bodyPlacement]}
      testID={`punch-token-${number}${body ? 'b' : ''}`}
    >
      {state === 'active' ? (
        <ActiveRing diameter={diameter} reducedMotion={reducedMotion} />
      ) : null}

      <View
        style={[
          styles.circle,
          {
            width: diameter,
            height: diameter,
            borderRadius: diameter / 2,
            borderWidth: visual.borderWidth,
            borderColor: visual.borderColor,
            backgroundColor: visual.backgroundColor,
          },
        ]}
      >
        <Text
          style={[styles.number, { fontSize: TOKEN_FONT_SIZE[size], color: visual.textColor }]}
        >
          {number}
        </Text>

        {body ? (
          <View style={styles.bodyBadge} testID="body-badge">
            {/* Uppercase B is the on-screen badge only; serialized notation
                stays lowercase `b` (D10). */}
            <Text style={styles.bodyBadgeText}>B</Text>
          </View>
        ) : null}
      </View>

      {visual.marker ? (
        <Text style={[styles.marker, { color: visual.textColor }]} testID="state-marker">
          {visual.marker}
        </Text>
      ) : null}

      {handHint ? (
        <Text style={styles.handHint} testID="hand-hint">
          {handHint}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', padding: 8 },
  /** Body shots sit lower on screen — the placement cue from doc §13. */
  bodyPlacement: { paddingTop: 24 },
  circle: { alignItems: 'center', justifyContent: 'center' },
  number: { fontWeight: '800' },
  bodyBadge: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.textPrimary,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyBadgeText: { fontSize: 15, fontWeight: '800', color: colors.textPrimary },
  marker: { marginTop: 4, fontSize: 14, fontWeight: '700' },
  handHint: { marginTop: 2, fontSize: 13, fontWeight: '700', color: colors.textMuted },
})
