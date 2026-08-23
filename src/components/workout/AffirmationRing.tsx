/**
 * Form affirmation — the gold ring that bulges out of a punch token.
 *
 * Fires when a landed punch agreed with the technique the cue asked for on
 * that specific device (`typeConcordance`). It is a **reward only**: the
 * signal behind it is too device-local to accuse anyone with, so nothing
 * anywhere renders its absence.
 *
 * ## The shape of the animation
 *
 * The ring starts at the token's edge, overshoots outward, then settles
 * back and fades. The overshoot is the whole feeling — a ring that merely
 * expanded and faded reads as a ripple, while one that pushes past its
 * resting size and returns reads as something *popping*, which is what
 * "you nailed that" should feel like at arm's length.
 *
 * It runs once per punch and does not loop: an affirmation that kept
 * pulsing would stop marking the moment it was celebrating.
 *
 * ## Reduced motion (doc §25)
 *
 * With motion disabled the bulge is replaced by a static heavy gold ring.
 * The affirmation still lands — it simply does not move. Colour is never
 * the only signal either way: `PunchToken` renders a marker glyph beside
 * it (spec §19.4).
 */
import React, { useEffect, useRef } from 'react'
import { Animated, Easing, StyleSheet } from 'react-native'

import { colors } from '@/theme/colors'

export interface AffirmationRingProps {
  diameter: number
  /** Flip to true to fire; changing this value re-fires the animation. */
  active: boolean
  reducedMotion?: boolean
  /** Re-fires the burst when it changes, so repeat hits each get one. */
  fireKey?: string | number
}

/** How far past the resting size the ring pushes, as a scale factor. */
const OVERSHOOT_SCALE = 1.45
/** Where it settles back to before fading out. */
const SETTLE_SCALE = 1.2
const EXPAND_MS = 180
const SETTLE_MS = 220

export function AffirmationRing(props: AffirmationRingProps): React.JSX.Element | null {
  const { diameter, active, reducedMotion = false, fireKey } = props
  const progress = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!active || reducedMotion) return undefined

    progress.setValue(0)
    const burst = Animated.sequence([
      Animated.timing(progress, {
        toValue: 1,
        duration: EXPAND_MS,
        // Decelerate outward: fast off the mark, easing into the overshoot.
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(progress, {
        toValue: 2,
        duration: SETTLE_MS,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
    ])
    burst.start()
    return () => {
      burst.stop()
    }
  }, [active, fireKey, progress, reducedMotion])

  if (!active) return null

  const size = diameter + 20

  if (reducedMotion) {
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          styles.static,
          { width: size, height: size, borderRadius: size / 2 },
        ]}
        testID="affirmation-ring-static"
      />
    )
  }

  return (
    <Animated.View
      pointerEvents="none"
      testID="affirmation-ring"
      style={[
        styles.ring,
        { width: size, height: size, borderRadius: size / 2 },
        {
          opacity: progress.interpolate({
            inputRange: [0, 1, 2],
            outputRange: [0.9, 1, 0],
          }),
          transform: [
            {
              scale: progress.interpolate({
                inputRange: [0, 1, 2],
                outputRange: [1, OVERSHOOT_SCALE, SETTLE_SCALE],
              }),
            },
          ],
        },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    borderWidth: 4,
    borderColor: colors.gold,
  },
  /** Reduced motion: heavier and still, so it still reads as a reward. */
  static: { borderWidth: 6, opacity: 1 },
})
