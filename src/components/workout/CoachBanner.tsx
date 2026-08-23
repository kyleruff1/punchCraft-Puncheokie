/**
 * Coaching reminder banner (M32-06, doc §13).
 *
 * Horizontal banner text, deliberately **subordinate** to the active
 * command: smaller type, no ring, no token silhouette. A coaching call is
 * something the athlete should absorb without it competing for the
 * attention the current combination needs.
 *
 * Coach calls are display-only and never scored (D4).
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { COACH_LABEL } from './tokenVisuals'
import { colors } from '@/theme/colors'
import type { CoachCommand } from '@domain/workout/WorkoutTokens'

export interface CoachBannerProps {
  command: CoachCommand
  visible: boolean
}

export function CoachBanner(props: CoachBannerProps): React.JSX.Element | null {
  if (!props.visible) return null

  return (
    <View
      accessibilityLabel={`Coach: ${COACH_LABEL[props.command]}`}
      accessibilityRole="text"
      style={styles.root}
      testID={`coach-banner-${props.command}`}
    >
      <Text style={styles.text}>{COACH_LABEL[props.command]}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    alignSelf: 'stretch',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
    backgroundColor: colors.surface,
    borderLeftWidth: 3,
    borderLeftColor: colors.borderStrong,
  },
  text: {
    // Subordinate by size and weight, not by dimming alone — a dimmed-only
    // treatment disappears entirely in bright gym light.
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: colors.textSecondary,
    textTransform: 'uppercase',
  },
})
