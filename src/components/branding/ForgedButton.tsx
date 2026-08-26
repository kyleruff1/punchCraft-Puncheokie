/**
 * ForgedButton — a Pressable with a forged-metal chrome.
 *
 * The buttons across the app used to be flat rectangles in
 * `colors.accent` or `colors.surfaceElevated`. Kyle asked for grit and
 * definition: raised edges, shaded texture, the sense that the button
 * is a piece of metal rather than a coloured swatch.
 *
 * The effect here is pure RN — no native module needed. The body is a
 * mid-tone fill with a light top border and a heavier dark bottom
 * border that together fake a bevel. A thin light highlight strip
 * along the top inside edge sharpens the raised read, and a shadow
 * strip peeking out under the bottom edge fakes the shadow a forged
 * edge would cast on the ground.
 *
 * On press: the top highlight hides, the fill shifts to a darker tone,
 * and the bottom shadow collapses — so the button reads as pressed-in
 * rather than merely inverted.
 *
 * A true-gradient upgrade (via expo-linear-gradient after a native
 * rebuild) is a one-file swap; the API here is stable.
 *
 * Three variants:
 * - `primary` — the turquoise brand pop for the one page-forward action.
 * - `secondary` — a steel body for header links and destination buttons.
 * - `subtle` — a low-contrast surface body for tertiary affordances.
 *
 * Text styling comes from the typography `recipes.button*` values so
 * every button reads at the same prominence Kyle set in that module.
 */

import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { AccessibilityRole, StyleProp, TextStyle, ViewStyle } from 'react-native'

import { colors, punch } from '@/theme/colors'
import { recipes } from '@/theme/typography'

export type ForgedVariant = 'primary' | 'secondary' | 'subtle'

interface VariantVisual {
  /** Main fill color of the body. */
  fill: string
  fillPressed: string
  /** Bevel top edge (light) and bottom edge (shadow). */
  bevelTop: string
  bevelBottom: string
  /** Text colour and which typography recipe to use. */
  textColor: string
  textRecipe: TextStyle
}

const VARIANTS: Record<ForgedVariant, VariantVisual> = {
  primary: {
    fill: punch.turquoise,
    fillPressed: punch.turquoiseDeep,
    bevelTop: punch.aqua,
    bevelBottom: punch.tealBlack,
    textColor: colors.textOnAccent,
    textRecipe: recipes.buttonPrimary,
  },
  secondary: {
    fill: punch.steel,
    fillPressed: punch.gunmetal,
    bevelTop: punch.silver,
    bevelBottom: punch.tealBlack,
    textColor: colors.textPrimary,
    textRecipe: recipes.buttonSecondary,
  },
  subtle: {
    fill: punch.gunmetal,
    fillPressed: punch.charcoal,
    bevelTop: punch.steel,
    bevelBottom: punch.tealBlack,
    textColor: colors.textPrimary,
    textRecipe: recipes.buttonSubtle,
  },
}

export interface ForgedButtonProps {
  onPress?: () => void
  variant?: ForgedVariant
  disabled?: boolean
  accessibilityLabel?: string
  accessibilityRole?: AccessibilityRole
  testID?: string
  style?: StyleProp<ViewStyle>
  children: React.ReactNode
}

export function ForgedButton({
  onPress,
  variant = 'secondary',
  disabled = false,
  accessibilityLabel,
  accessibilityRole = 'button',
  testID,
  style,
  children,
}: ForgedButtonProps): React.JSX.Element {
  const [pressed, setPressed] = useState(false)
  const v = VARIANTS[variant]
  const content =
    typeof children === 'string' ? (
      <Text style={[styles.text, v.textRecipe, { color: v.textColor }]}>{children}</Text>
    ) : (
      children
    )
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      testID={testID}
      style={[styles.root, disabled && styles.disabled, style]}
    >
      {/* Bottom shadow strip — sits under the body and peeks out at the
          bottom edge, faking the shadow a forged edge would cast. */}
      <View
        style={[styles.shadow, { backgroundColor: v.bevelBottom }, pressed && styles.shadowPressed]}
        pointerEvents="none"
      />
      <View
        style={[
          styles.body,
          {
            backgroundColor: pressed ? v.fillPressed : v.fill,
            borderTopColor: v.bevelTop,
            borderBottomColor: v.bevelBottom,
          },
        ]}
      >
        {/* Inner highlight — a 1px light line along the top inside edge,
            selling the bevel from the light side. Hidden on press. */}
        <View
          style={[styles.highlight, { backgroundColor: v.bevelTop }, pressed && styles.hidden]}
          pointerEvents="none"
        />
        {content}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    borderRadius: 10,
  },
  shadow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -2,
    height: 4,
    borderRadius: 10,
    opacity: 0.9,
  },
  shadowPressed: { bottom: 0, height: 2, opacity: 0.5 },
  body: {
    borderRadius: 10,
    borderTopWidth: 1,
    borderBottomWidth: 2,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 8,
    right: 8,
    height: 1,
    opacity: 0.7,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  hidden: { opacity: 0 },
  disabled: { opacity: 0.4 },
  text: { textAlign: 'center' },
})
