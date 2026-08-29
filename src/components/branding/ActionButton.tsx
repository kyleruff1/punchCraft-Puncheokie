/**
 * ActionButton — a big action rendered as Kyle's authored button art.
 *
 * The art is a *complete* button: pill body, icon, lettering, chevron
 * and neon rim are all baked into the PNG. So unlike `Wordmark` (a name
 * placed on other chrome), this component IS the pressable — wrapping
 * the art in a ForgedButton would stack chrome on chrome.
 *
 * Press feedback is a dim + slight shrink, reading as the neon button
 * losing a little charge under the finger. The action phrase lives in
 * `accessibilityLabel`, so a screen reader hears exactly what the
 * button does even though no text is rendered.
 *
 * Sizing fixes the height and lets width follow each asset's authored
 * aspect (resolved at runtime, so differently-proportioned art drops
 * keep working); `maxWidth: '100%'` guards narrow portrait layouts.
 */

import React from 'react'
import { Image, Pressable, StyleSheet } from 'react-native'
import type { StyleProp, ViewStyle } from 'react-native'

/* eslint-disable @typescript-eslint/no-require-imports */
const SOURCES = {
  buildAWorkout: require('../../../assets/branding/builidAworkout_label.png') as number,
  startWorkout: require('../../../assets/branding/start_workout_label.png') as number,
  hitIt: require('../../../assets/branding/hit_it.png') as number,
  connectTrackers: require('../../../assets/branding/connect_trackers.png') as number,
  fixTrackers: require('../../../assets/branding/fix_trackers.png') as number,
} as const
/* eslint-enable @typescript-eslint/no-require-imports */

const ACCESSIBILITY_LABELS = {
  buildAWorkout: 'Build a workout',
  startWorkout: 'Start workout',
  hitIt: 'Hit it!',
  connectTrackers: 'Connect trackers',
  fixTrackers: 'Fix tracker connection',
} as const

/**
 * Transparent canvas margins around the visible pill, measured from each
 * asset's alpha bbox (fractions of canvas width/height). Collapsed into
 * negative margins so the LAYOUT box hugs the artwork — without this the
 * compact tracker buttons sat far apart and far from the screen edge,
 * spaced by invisible canvas. Zero for the hero buttons: their layouts
 * were tuned against the full canvas and the glow bleed is part of the
 * look.
 */
const TRIM: Partial<
  Record<keyof typeof SOURCES, { left: number; right: number; top: number; bottom: number }>
> = {
  // Measured from each asset's SOLID alpha (>220) after Kyle's
  // 2026-08-28 consistent-restyle exports. fix moved to a 2:1 canvas;
  // aspect resolves at runtime so only the trims live here.
  buildAWorkout: { left: 0.019, right: 0.016, top: 0.188, bottom: 0.233 },
  startWorkout: { left: 0.017, right: 0.015, top: 0.182, bottom: 0.229 },
  hitIt: { left: 0.016, right: 0.015, top: 0.18, bottom: 0.228 },
  connectTrackers: { left: 0.149, right: 0.14, top: 0.287, bottom: 0.316 },
  fixTrackers: { left: 0.047, right: 0.047, top: 0.273, bottom: 0.246 },
}

/**
 * Default rendered height. The art carries its own glow padding, so the
 * visible pill lands around 70–80% of this. Sized as a hero slab for
 * the tablet's full-width landing rows — dialed in on-device with Kyle
 * (112 read small, 336 overshot, 224 landed). `maxWidth: '100%'` +
 * contain keeps it from overflowing narrower layouts. Pass `height`
 * to override per placement.
 */
const DEFAULT_HEIGHT = 224

export type ActionButtonAction = keyof typeof SOURCES

export interface ActionButtonProps {
  action: ActionButtonAction
  onPress?: () => void
  disabled?: boolean
  height?: number
  /**
   * How `height` is interpreted. `'canvas'` (default) sizes the full
   * authored canvas — today's behavior for the hero buttons, glow bleed
   * included. `'pill'` sizes the VISIBLE pill using the action's TRIM
   * metadata and collapses the transparent canvas margins from layout —
   * for compact placements (tracker pair, quick-start) where invisible
   * canvas would space things apart. Falls back to canvas sizing when
   * the action has no TRIM measurements.
   */
  fit?: 'canvas' | 'pill'
  accessibilityHint?: string
  style?: StyleProp<ViewStyle>
  testID?: string
}

export function ActionButton({
  action,
  onPress,
  disabled = false,
  height = DEFAULT_HEIGHT,
  fit = 'canvas',
  accessibilityHint,
  style,
  testID,
}: ActionButtonProps): React.JSX.Element {
  const source = SOURCES[action]
  const resolved = Image.resolveAssetSource(source)
  const aspect = resolved.width / resolved.height
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={ACCESSIBILITY_LABELS[action]}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      testID={testID ?? `action-button-${action}`}
      style={({ pressed }) => [
        styles.root,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Image
        source={source}
        style={(() => {
          const trim = fit === 'pill' ? TRIM[action] : undefined
          if (!trim) return { height, width: height * aspect, maxWidth: '100%' as const }
          // Pill fit sizes by VISIBLE PILL height, not canvas height: the
          // arts carry different pill-to-canvas ratios, so equal canvas
          // heights rendered unequal buttons (the fix pill sat visibly
          // shorter than connect at the same `height` prop).
          const pillFraction = 1 - trim.top - trim.bottom
          const imageHeight = height / pillFraction
          const imageWidth = imageHeight * aspect
          return {
            height: imageHeight,
            width: imageWidth,
            maxWidth: '100%' as const,
            marginLeft: -imageWidth * trim.left,
            marginRight: -imageWidth * trim.right,
            marginTop: -imageHeight * trim.top,
            marginBottom: -imageHeight * trim.bottom,
          }
        })()}
        resizeMode="contain"
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.4 },
})
