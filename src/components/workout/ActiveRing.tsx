/**
 * The pulsing ring that marks the active token (M32-06, doc §13).
 *
 * Built on React Native's core `Animated` rather than reanimated. The issue
 * prefers reanimated on the grounds that it needs no new native module and
 * no dev-client rebuild — core `Animated` satisfies that same reason, needs
 * no babel plugin (none is configured in this repo yet) and renders in
 * jest-expo without a mock. Animation *timing against the cue clock* is
 * M32-08's job; this is a decorative loop, so the simpler dependency wins.
 *
 * With `reducedMotion` the loop is replaced by a static heavy outline
 * (doc §25) — the state still reads, it just does not move.
 */
import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet, type ViewStyle } from 'react-native'

import { colors } from '@/theme/colors'

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
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => {
      loop.stop()
    }
  }, [pulse, reducedMotion])

  const style: ViewStyle = {
    width: diameter + 16,
    height: diameter + 16,
    borderRadius: borderRadius + 8,
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
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
          transform: [
            { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) },
          ],
        },
      ]}
    />
  )
}

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    borderWidth: 3,
    borderColor: colors.accent,
  },
  /** Reduced motion: heavier, fully opaque, and still. */
  static: { borderWidth: 5, opacity: 1 },
})
