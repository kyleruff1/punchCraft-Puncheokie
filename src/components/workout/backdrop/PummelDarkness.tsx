/**
 * PummelDarkness — the Standard-tier backdrop overlay (WS?/A? Phase 1).
 *
 * Replaces the Skia membrane (HydroPulseScene) with a frugal, compositor-only
 * darkness that responds to punch velocity in real time. Two stages driven by
 * a single `charge` SharedValue (0..1):
 *
 *   - **Vignette (edges close in)** — a ring of four `expo-linear-gradient`
 *     strips (top, bottom, left, right) whose opacity ramps in through the
 *     first 40% of charge. Soft taps only nibble the edges.
 *   - **Center fill (blackout)** — an `absoluteFill` black View whose
 *     opacity ramps through the top 50% of charge. Sustained heavy pummel
 *     eats through the middle to full black.
 *
 * Both stages read the same charge. Recovery is a single per-vsync
 * exponential decay with time constant `TAU_S` — the darkness slides
 * smoothly back off the pane, uniform and even.
 *
 * ## Why this is cheap
 *
 * - No Skia canvas, no SkSL fragment shader, no per-vsync `useDerivedValue`
 *   packing uniforms for a per-pixel program.
 * - Reanimated `SharedValue` + `useAnimatedStyle` runs opacity diffs on the
 *   UI thread through the compositor — no per-pixel work, no JS bridge hop.
 * - One JS→UI hop per punch via `runOnUI` (the same pattern the retired
 *   membraneEngine used) — matches the bus's cadence.
 *
 * ## Tunables (all here so Kyle can iterate the feel without touching the pipeline)
 */
import React, { useEffect, useMemo } from 'react'
import { StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import Animated, {
  Extrapolation,
  interpolate,
  runOnUI,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated'

import type { BackdropBus } from './backdropBus'

/** How much a max-velocity haymaker adds to the charge in one hit
 *  (haymaker adds ~K_HIT · 1 · 2 = 2 · K_HIT). Quadratic-in-v01 so a
 *  jab (v01≈0.2) adds ~0.24·K_HIT — ~4× smaller than a haymaker. */
const K_HIT = 0.18
/** Seconds to decay by 1/e (~63%) — the "time will heal it slowly, evenly"
 *  constant. Land conservative; on-glass tune later. */
const TAU_S = 2.5
/** Spring params for the per-punch arrival — snappy but not brittle. */
const SPRING = { damping: 18, stiffness: 200, mass: 0.5 }
/** Charge breakpoint pairs for the two stages. First is the edge ring; second is the center fill. */
const VIGNETTE_RANGE: readonly [number, number] = [0, 0.4]
const CENTER_RANGE: readonly [number, number] = [0.5, 1.0]
/** How dark the vignette gets at full charge — never full 1.0 so the art still bleeds through the ring. */
const VIGNETTE_PEAK_OPACITY = 0.9
/** The vignette strip width, in DP. Wide enough to soften the edge, narrow enough to leave the middle alone. */
const EDGE_WIDTH = 180

export function PummelDarkness({
  bus,
  reducedMotion = false,
}: {
  bus: BackdropBus
  /** When true, hold a low static charge with no ramp or decay (§31.4). */
  reducedMotion?: boolean
}): React.JSX.Element {
  const charge = useSharedValue(reducedMotion ? 0.18 : 0)

  // Per-punch bump — one worklet running on the UI thread.
  const bumpOnUI = useMemo(
    () =>
      runOnUI((v01: number): void => {
        'worklet'
        const boost = K_HIT * v01 * (1 + v01)
        const target = Math.min(1, charge.value + boost)
        charge.value = withSpring(target, SPRING)
      }),
    [charge],
  )

  useEffect(() => {
    if (reducedMotion) return
    return bus.subscribe((impulse) => {
      bumpOnUI(impulse.v01)
    })
  }, [bus, bumpOnUI, reducedMotion])

  // Per-vsync exponential decay. `frameCallback.setActive(true)` is default;
  // it stays cheap because the worklet no-ops once charge is under the floor.
  useFrameCallback((info) => {
    'worklet'
    if (reducedMotion) return
    const dtMs = info.timeSincePreviousFrame ?? 16
    if (charge.value <= 0.001) return
    charge.value = charge.value * Math.exp(-dtMs / (TAU_S * 1000))
  }, true)

  const vignetteStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      charge.value,
      [VIGNETTE_RANGE[0], VIGNETTE_RANGE[1]],
      [0, VIGNETTE_PEAK_OPACITY],
      Extrapolation.CLAMP,
    ),
  }))

  const centerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      charge.value,
      [CENTER_RANGE[0], CENTER_RANGE[1]],
      [0, 1],
      Extrapolation.CLAMP,
    ),
  }))

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="pummel-darkness">
      {/* Stage 1: edge vignette (four linear gradients, one shared opacity). */}
      <Animated.View style={[StyleSheet.absoluteFill, vignetteStyle]} pointerEvents="none">
        <LinearGradient
          colors={[BLACK_SOLID, BLACK_CLEAR]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[styles.edge, styles.topEdge]}
        />
        <LinearGradient
          colors={[BLACK_SOLID, BLACK_CLEAR]}
          start={{ x: 0.5, y: 1 }}
          end={{ x: 0.5, y: 0 }}
          style={[styles.edge, styles.bottomEdge]}
        />
        <LinearGradient
          colors={[BLACK_SOLID, BLACK_CLEAR]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={[styles.edge, styles.leftEdge]}
        />
        <LinearGradient
          colors={[BLACK_SOLID, BLACK_CLEAR]}
          start={{ x: 1, y: 0.5 }}
          end={{ x: 0, y: 0.5 }}
          style={[styles.edge, styles.rightEdge]}
        />
      </Animated.View>
      {/* Stage 2: center blackout (solid black, ramps in once the ring is nearly closed). */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.centerFill, centerStyle]}
        pointerEvents="none"
      />
    </View>
  )
}

const BLACK_SOLID = '#000000FF'
const BLACK_CLEAR = '#00000000'

const styles = StyleSheet.create({
  edge: { position: 'absolute' },
  topEdge: { top: 0, left: 0, right: 0, height: EDGE_WIDTH },
  bottomEdge: { bottom: 0, left: 0, right: 0, height: EDGE_WIDTH },
  leftEdge: { top: 0, bottom: 0, left: 0, width: EDGE_WIDTH },
  rightEdge: { top: 0, bottom: 0, right: 0, width: EDGE_WIDTH },
  centerFill: { backgroundColor: '#000000' },
})
