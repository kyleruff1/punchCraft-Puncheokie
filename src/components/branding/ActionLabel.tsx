/**
 * ActionLabel — a branded action phrase as its authored image.
 *
 * Sister to `Wordmark`: where Wordmark carries a mode's *name*, this
 * carries an *action* ("build a workout", "start workout") in the same
 * chiseled-metal treatment, so the two big affirmative buttons read as
 * part of the brand family rather than as typeset text sitting on
 * branded chrome.
 *
 * The `accessibilityLabel` carries the action phrase so a screen
 * reader hears exactly what the button does.
 *
 * Sizes fix the height and let width follow the authored ~3:1 aspect,
 * same as Wordmark. `sm` fits inside a standard ForgedButton
 * (minHeight 52 − vertical padding); `md` is for a hero placement.
 */

import React from 'react'
import { Image, StyleSheet, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'

/* eslint-disable @typescript-eslint/no-require-imports */
const SOURCES = {
  buildAWorkout: require('../../../assets/branding/builidAworkout_label.png') as number,
  startWorkout: require('../../../assets/branding/start_workout_label.png') as number,
} as const
/* eslint-enable @typescript-eslint/no-require-imports */

const ACCESSIBILITY_LABELS = {
  buildAWorkout: 'Build a workout',
  startWorkout: 'Start workout',
} as const

// Authored on the same 2172×724 canvas as the wordmarks.
const LABEL_ASPECT = 2172 / 724

/**
 * The lettering band occupies roughly 38% of the authored canvas height —
 * the rest is transparent padding baked into the PNG. Sizes below are the
 * *lettering* height (matching the text they replace: buttonPrimary text
 * was fontSize 22), and the rendered image is scaled up so the visible
 * letters land at that height. The canvas's transparent overflow is then
 * collapsed with negative vertical margins so the button doesn't grow.
 */
const GLYPH_FRACTION = 0.38

const SIZE_HEIGHTS = {
  /** Lettering ≈ the old buttonPrimary text (fontSize 22). */
  sm: 22,
  /** Hero placement. */
  md: 32,
} as const

export type ActionLabelAction = keyof typeof SOURCES
export type ActionLabelSize = keyof typeof SIZE_HEIGHTS

export interface ActionLabelProps {
  action: ActionLabelAction
  size?: ActionLabelSize
  style?: StyleProp<ViewStyle>
  testID?: string
}

export function ActionLabel({
  action,
  size = 'sm',
  style,
  testID,
}: ActionLabelProps): React.JSX.Element {
  const letteringHeight = SIZE_HEIGHTS[size]
  const imageHeight = letteringHeight / GLYPH_FRACTION
  const width = imageHeight * LABEL_ASPECT
  // Collapse the canvas's transparent padding so the layout box is the
  // lettering, not the full authored canvas.
  const overflow = (imageHeight - letteringHeight) / 2
  return (
    <View style={[styles.wrap, style]} testID={testID ?? `action-label-${action}`}>
      <Image
        source={SOURCES[action]}
        style={{ height: imageHeight, width, marginVertical: -overflow }}
        resizeMode="contain"
        accessibilityLabel={ACCESSIBILITY_LABELS[action]}
        accessibilityRole="image"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', maxWidth: '100%' },
})
