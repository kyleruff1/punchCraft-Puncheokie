/**
 * The Reduced tier: a still sheen, no Skia, no clock, no bus.
 *
 * Satisfies §31.4's "reduced motion forces still" literally — nothing
 * here can animate. A faint silver vignette plus the two hand tints as
 * static edge glows keeps the screen from feeling stripped next to the
 * Standard scene.
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

import { colors, punch } from '@/theme/colors'

export function StaticGlow(): React.JSX.Element {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="backdrop-static-glow">
      <LinearGradient
        colors={[`${punch.chromeBright}12`, `${punch.chromeBright}00`, `${punch.chromeBright}16`]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[`${colors.trackerLeft}22`, `${colors.trackerLeft}00`]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={[styles.edge, styles.leftEdge]}
      />
      <LinearGradient
        colors={[`${colors.trackerRight}22`, `${colors.trackerRight}00`]}
        start={{ x: 1, y: 0.5 }}
        end={{ x: 0, y: 0.5 }}
        style={[styles.edge, styles.rightEdge]}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', top: 0, bottom: 0, width: 140 },
  leftEdge: { left: 0 },
  rightEdge: { right: 0 },
})
