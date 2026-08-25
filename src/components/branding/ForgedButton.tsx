/**
 * ForgedButton — a Pressable with a forged-metal chrome.
 *
 * The buttons across the app used to be flat rectangles in
 * `colors.accent` or `colors.surfaceElevated`. Kyle asked for grit and
 * definition: raised edges, shaded texture, the sense that the button
 * is a piece of metal rather than a coloured swatch.
 *
 * The effect here is pure RN — no native module needed. Three stacked
 * bands (top-lit, mid, bottom-shadow) fake a vertical gradient; a
 * 1-pixel light strip on the very top inside edge sells the bevel;
 * the outer border-top is lighter and border-bottom is darker so the
 * button reads as raised. A companion shadow strip peeks out at the
 * bottom, faking the shadow a forged edge would cast on the ground.
 *
 * On press: the top highlight hides, the bands invert (dark on top),
 * and the shadow strip collapses — so the button reads as pressed-in
 * rather than merely inverted.
 *
 * A cleaner true-gradient variant can layer in after the next native
 * rebuild (see `expo-linear-gradient`); the visual API here is stable
 * so the swap will be internal.
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
  /** Faux-gradient stops top → mid → bottom (three horizontal bands). */
  fill: readonly [string, string, string]
  fillPressed: readonly [string, string, string]
  /** Bevel top edge (light) and bottom edge (shadow). */
  bevelTop: string
  bevelBottom: string
  /** Text colour and which typography recipe to use. */
  textColor: string
  textRecipe: TextStyle
}

const VARIANTS: Record<ForgedVariant, VariantVisual> = {
  primary: {
    fill: [punch.turquoiseBright, punch.turquoise, punch.turquoiseDeep],
    fillPressed: [punch.turquoiseDeep, punch.turquoise, punch.turquoiseBright],
    bevelTop: punch.aqua,
    bevelBottom: punch.tealBlack,
    textColor: colors.textOnAccent,
    textRecipe: recipes.buttonPrimary,
  },
  secondary: {
    fill: [punch.slate, punch.steel, punch.gunmetal],
    fillPressed: [punch.gunmetal, punch.steel, punch.slate],
    bevelTop: punch.silver,
    bevelBottom: punch.tealBlack,
    textColor: colors.textPrimary,
    textRecipe: recipes.buttonSecondary,
  },
  subtle: {
    fill: [punch.gunmetal, punch.charcoal, punch.tealBlack],
    fillPressed: [punch.tealBlack, punch.charcoal, punch.gunmetal],
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
  const fill = pressed ? v.fillPressed : v.fill
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
        style={[styles.body, { borderTopColor: v.bevelTop, borderBottomColor: v.bevelBottom }]}
      >
        {/* Faux-gradient: three stacked bands (top-lit / mid / bottom-shadow). */}
        <View style={[styles.band, styles.bandTop, { backgroundColor: fill[0] }]} pointerEvents="none" />
        <View style={[styles.band, styles.bandMid, { backgroundColor: fill[1] }]} pointerEvents="none" />
        <View style={[styles.band, styles.bandBottom, { backgroundColor: fill[2] }]} pointerEvents="none" />
        {/* Inner highlight — a 1px light line along the top inside edge,
            selling the bevel from the light side. Hidden on press. */}
        <View
          style={[styles.highlight, { backgroundColor: v.bevelTop }, pressed && styles.hidden]}
          pointerEvents="none"
        />
        <View style={styles.contentWrap}>{content}</View>
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
    opacity: 0.85,
  },
  shadowPressed: { bottom: 0, height: 2, opacity: 0.5 },
  body: {
    position: 'relative',
    borderRadius: 10,
    borderTopWidth: 1,
    borderBottomWidth: 2,
    paddingHorizontal: 20,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    minHeight: 48,
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  bandTop: { top: 0, height: '38%' },
  bandMid: { top: '30%', height: '40%' },
  bandBottom: { bottom: 0, height: '38%' },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    opacity: 0.7,
  },
  hidden: { opacity: 0 },
  disabled: { opacity: 0.4 },
  contentWrap: { zIndex: 1, alignItems: 'center', justifyContent: 'center' },
  text: { textAlign: 'center' },
})
