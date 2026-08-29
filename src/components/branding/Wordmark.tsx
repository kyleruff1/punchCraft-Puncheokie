/**
 * Wordmark — a mode's brand name, always as its isolated wordmark image
 * (silver-metallic chiseled type on transparent).
 *
 * Every place the app draws a mode's name — the tab bar, screen titles,
 * home-screen H1s, the +not-found button — uses this component rather
 * than rendering the name as text. The wordmarks read on any surface in
 * the palette because they carry no coloured background of their own,
 * and the metallic silver does not fight the electric-turquoise accent
 * that dominates the rest of the UI.
 *
 * The `accessibilityLabel` is fixed per app so a screen reader still
 * hears the name where a sighted user sees the image. The `puncheokie`
 * asset visually reads "PunchEoke" as a design flourish, but the a11y
 * label keeps the code-consistent "Puncheokie" so screen-reader users
 * hear the same name the rest of the app uses.
 *
 * Four sizes cover every current site: `sm` for headers, `tab` for the
 * tab-bar label (bigger than `sm` so it fills the tab-row height cleanly),
 * `md` for landing-page H1s, `lg` reserved for a future hero placement.
 * The wordmark PNGs' authored aspect ratio is ~3:1; each size fixes the
 * height and lets width follow, so nothing distorts.
 */

import React from 'react'
import { Image, StyleSheet, View } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'

/* eslint-disable @typescript-eslint/no-require-imports */
const SOURCES = {
  punchCraft: require('../../../assets/branding/wordmark.png') as number,
  velocityLab: require('../../../assets/branding/VelocityLab.png') as number,
  puncheokie: require('../../../assets/branding/PunchEoke.png') as number,
} as const
/**
 * The all-silver punchCraft wordmark. Kyle's policy: the COLOR wordmark
 * (silver + cyan, with the fist) is the app's name everywhere — the
 * isolated silver version has exactly one job, the bottom tab link,
 * where it sits beside the other two silver tab wordmarks.
 */
const PUNCHCRAFT_ISOLATED = require('../../../assets/branding/isolated-wordmark.png') as number
/* eslint-enable @typescript-eslint/no-require-imports */

const ACCESSIBILITY_LABELS = {
  punchCraft: 'punchCraft',
  velocityLab: 'Velocity Lab',
  puncheokie: 'Puncheokie',
} as const

// Every wordmark PNG is authored at the same 2172×724 canvas, so the
// aspect is uniform across variants.
const WORDMARK_ASPECT = 2172 / 724

const SIZE_HEIGHTS = {
  sm: 26,
  tab: 40,
  /** Header wordmark — 2× the tab step (Kyle 2026-08-28). */
  hdr: 80,
  md: 64,
  lg: 96,
} as const

export type WordmarkApp = keyof typeof SOURCES
export type WordmarkSize = keyof typeof SIZE_HEIGHTS

export interface WordmarkProps {
  app: WordmarkApp
  size?: WordmarkSize
  /**
   * `brand` (default) is the authored wordmark — for punchCraft that is
   * the COLOR art. `isolated` swaps punchCraft to the all-silver
   * version; the bottom tab bar is its only intended caller.
   */
  variant?: 'brand' | 'isolated'
  style?: StyleProp<ViewStyle>
  testID?: string
}

export function Wordmark({
  app,
  size = 'md',
  variant = 'brand',
  style,
  testID,
}: WordmarkProps): React.JSX.Element {
  const height = SIZE_HEIGHTS[size]
  const width = height * WORDMARK_ASPECT
  const source =
    app === 'punchCraft' && variant === 'isolated' ? PUNCHCRAFT_ISOLATED : SOURCES[app]
  return (
    <View style={[styles.wrap, style]} testID={testID ?? `wordmark-${app}`}>
      <Image
        source={source}
        style={{ height, width }}
        resizeMode="contain"
        accessibilityLabel={ACCESSIBILITY_LABELS[app]}
        accessibilityRole="image"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
})
