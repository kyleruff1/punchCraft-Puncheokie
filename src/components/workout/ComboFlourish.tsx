/**
 * Combo flourish — the whole-combo reward.
 *
 * Fires once when the athlete completes a combination in sequence with the
 * correct hands (the engine's `cue-completed`). Where `AffirmationRing`
 * celebrates a single punch, this celebrates the whole row: a gold surround
 * that pulses out and fades, so finishing a combo feels like an event rather
 * than just the last token lighting up.
 *
 * Reward only — an incomplete combo shows nothing, never red (doc §13). With
 * reduced motion it is a static gold surround rather than a pulse (doc §25).
 */
import React, { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet } from 'react-native'

import { colors } from '@/theme/colors'

export interface ComboFlourishProps {
  /** Changing this fires the celebration; absent means nothing is shown. */
  fireKey?: string
  reducedMotion?: boolean
}

const EXPAND_MS = 200
const FADE_MS = 320

export function ComboFlourish(props: ComboFlourishProps): React.JSX.Element | null {
  const { fireKey, reducedMotion = false } = props
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (fireKey === undefined || reducedMotion) return undefined
    progress.setValue(0)
    const burst = Animated.sequence([
      Animated.timing(progress, {
        toValue: 1,
        duration: EXPAND_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(progress, {
        toValue: 2,
        duration: FADE_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ])
    burst.start()
    return () => {
      burst.stop()
    }
  }, [fireKey, progress, reducedMotion])

  if (fireKey === undefined) return null

  if (reducedMotion) {
    return <Animated.View pointerEvents="none" style={[styles.surround, styles.static]} testID="combo-flourish-static" />
  }

  return (
    <Animated.View
      pointerEvents="none"
      testID="combo-flourish"
      style={[
        styles.surround,
        {
          opacity: progress.interpolate({ inputRange: [0, 1, 2], outputRange: [0.85, 1, 0] }),
          transform: [
            { scale: progress.interpolate({ inputRange: [0, 1, 2], outputRange: [0.96, 1.06, 1.12] }) },
          ],
        },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  surround: {
    position: 'absolute',
    top: -16,
    left: -24,
    right: -24,
    bottom: -16,
    borderRadius: 24,
    borderWidth: 3,
    borderColor: colors.gold,
    backgroundColor: 'transparent',
  },
  static: { borderWidth: 5, opacity: 1 },
})
