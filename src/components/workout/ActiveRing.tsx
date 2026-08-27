/**
 * The heavy outline that marks the active token (M32-06, doc §13).
 *
 * Reads as a chunky forged outline standing off the circle rather than a
 * thin ripple. The whole visual point of "active" is that the ring lights
 * up thick and obvious — an athlete glancing at the stage should not have
 * to squint. A gentle pulse loop breathes the opacity so the ring feels
 * alive without changing size (so the symmetric space around it stays
 * symmetric across the whole cycle).
 *
 * Built on React Native's core `Animated` rather than reanimated. Timing
 * *against the cue clock* is M32-08's job; this is a decorative loop, so
 * the simpler dependency wins.
 *
 * With `reducedMotion` the pulse is replaced by a static full-opacity
 * outline (doc §25) — the state still reads, it just does not breathe.
 */
import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet, type ViewStyle } from 'react-native'

import { colors } from '@/theme/colors'

/**
 * How far the ring stands off the token's edge on each side. Exported so
 * a parent can size its slot to `diameter + ACTIVE_RING_INSET * 2` and
 * the ring sits fully within the slot with symmetric space around it.
 */
export const ACTIVE_RING_INSET = 10

/** Ring line weight when the token is active. Kyle: "really thick." */
export const ACTIVE_RING_WIDTH = 6

export function ActiveRing(props: {
  diameter: number
  reducedMotion?: boolean
  borderRadius?: number
}): React.JSX.Element {
  const { diameter, reducedMotion = false } = props
  const borderRadius = props.borderRadius ?? diameter / 2
  const pulse = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (reducedMotion) return undefined
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => {
      loop.stop()
    }
  }, [pulse, reducedMotion])

  const ringSize = diameter + ACTIVE_RING_INSET * 2
  const style: ViewStyle = {
    width: ringSize,
    height: ringSize,
    borderRadius: borderRadius + ACTIVE_RING_INSET,
  }

  if (reducedMotion) {
    return <Animated.View pointerEvents="none" style={[styles.ring, styles.static, style]} />
  }

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.ring,
        style,
        {
          // Opacity-only pulse. Size stays fixed so the symmetric space
          // around the ring never breathes in and out.
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }),
        },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    borderWidth: ACTIVE_RING_WIDTH,
    borderColor: colors.accent,
  },
  /** Reduced motion: same weight, fully opaque, no pulse. */
  static: { opacity: 1 },
})
