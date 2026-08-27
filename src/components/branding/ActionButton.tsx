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
} as const
/* eslint-enable @typescript-eslint/no-require-imports */

const ACCESSIBILITY_LABELS = {
  buildAWorkout: 'Build a workout',
  startWorkout: 'Start workout',
} as const

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
  style?: StyleProp<ViewStyle>
  testID?: string
}

export function ActionButton({
  action,
  onPress,
  disabled = false,
  height = DEFAULT_HEIGHT,
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
        style={{ height, width: height * aspect, maxWidth: '100%' }}
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
