/**
 * ForgedButton — a Pressable with a forged-metal chrome.
 *
 * The buttons across the app used to be flat rectangles in
 * `colors.accent` or `colors.surfaceElevated`. Kyle asked for grit and
 * definition: raised edges, shaded texture, the sense that the button
 * is a piece of metal rather than a coloured swatch.
 *
 * The body is now a real vertical `expo-linear-gradient` (light top,
 * mid belly, dark bottom), read as a forged strip catching a top light.
 * A light 1px border along the top and a heavier dark border along the
 * bottom sharpen the bevel; a thin light highlight strip runs along
 * the top inside edge; a shadow strip peeks out under the bottom edge,
 * faking the shadow a forged edge would cast on the ground.
 *
 * On press: the top of the gradient drops to the mid tone (the button
 * loses its highlight), the belly darkens to the pressed variant, and
 * the shadow strip collapses — the button reads as pressed-in rather
 * than merely inverted.
 *
 * `expo-linear-gradient` is a native module: the app needs a dev-client
 * rebuild for this to render at all. Same rebuild covers the Chakra
 * Petch font load added in Piece 4.
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
import { LinearGradient } from 'expo-linear-gradient'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { AccessibilityRole, StyleProp, TextStyle, ViewStyle } from 'react-native'

import { colors, punch } from '@/theme/colors'
import { recipes } from '@/theme/typography'

export type ForgedVariant = 'primary' | 'hero' | 'secondary' | 'subtle'

interface VariantVisual {
  /** Three-stop vertical gradient top → mid → bottom. */
  gradient: readonly [string, string, string]
  gradientPressed: readonly [string, string, string]
  /** Bevel top edge (light) and bottom edge (shadow). */
  bevelTop: string
  bevelBottom: string
  /** Text colour and which typography recipe to use. */
  textColor: string
  textRecipe: TextStyle
}

const VARIANTS: Record<ForgedVariant, VariantVisual> = {
  // Gradients run inverted — dark at the top, lit at the bottom edge —
  // so every button reads as under-glowing, matching the neon under-glow
  // in the authored action-button art.
  primary: {
    gradient: [punch.tealDeep, punch.turquoise, punch.aqua],
    gradientPressed: [punch.tealDeep, punch.turquoiseDeep, punch.turquoise],
    bevelTop: punch.aqua,
    bevelBottom: punch.tealBlack,
    textColor: colors.textOnAccent,
    textRecipe: recipes.buttonPrimary,
  },
  /**
   * Dark forged body with a cyan bevel. For buttons carrying the
   * silver-metal ActionLabel art: that art was authored for a dark
   * ground (like the wordmarks) and drowns on the bright `primary`
   * fill, so the hero button provides the dark field and lets the
   * cyan bevel carry the "this is the big action" signal instead.
   */
  hero: {
    gradient: [punch.tealBlack, punch.charcoal, punch.gunmetal],
    gradientPressed: [punch.tealBlack, punch.tealBlack, punch.charcoal],
    bevelTop: punch.turquoise,
    bevelBottom: punch.tealDark,
    textColor: colors.textPrimary,
    textRecipe: recipes.buttonPrimary,
  },
  secondary: {
    gradient: [punch.tealBlack, punch.steel, punch.silver],
    gradientPressed: [punch.tealBlack, punch.gunmetal, punch.steel],
    bevelTop: punch.silver,
    bevelBottom: punch.tealBlack,
    textColor: colors.textPrimary,
    textRecipe: recipes.buttonSecondary,
  },
  subtle: {
    gradient: [punch.tealBlack, punch.gunmetal, punch.steel],
    gradientPressed: [punch.tealBlack, punch.charcoal, punch.gunmetal],
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
  const stops = pressed ? v.gradientPressed : v.gradient
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
      <LinearGradient
        colors={[...stops]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[
          styles.body,
          { borderTopColor: v.bevelTop, borderBottomColor: v.bevelBottom },
        ]}
      >
        {/* Inner highlight — a 1px light line along the top inside edge,
            selling the bevel from the light side. Hidden on press. */}
        <View
          style={[styles.highlight, { backgroundColor: v.bevelTop }, pressed && styles.hidden]}
          pointerEvents="none"
        />
        {content}
      </LinearGradient>
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
