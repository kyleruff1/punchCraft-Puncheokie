/**
 * PummelDarkness — the Standard-tier backdrop overlay.
 *
 * Replaces the Skia membrane (HydroPulseScene) with a frugal, compositor-only
 * darkness that responds to punch velocity in real time. Two stages driven by
 * a single `charge` Animated.Value (0..1):
 *
 *   - **Vignette (edges close in)** — a ring of four `expo-linear-gradient`
 *     strips (top, bottom, left, right) whose opacity ramps in through the
 *     first 40% of charge. Soft taps only nibble the edges.
 *   - **Center fill (blackout)** — an `absoluteFill` black View whose
 *     opacity ramps through the top 50% of charge. Sustained heavy pummel
 *     eats through the middle to full black.
 *
 * Both stages read the same charge. Recovery is a JS-side decay clock that
 * pulls the accumulator toward 0 at time constant `TAU_S` — the darkness
 * slides smoothly back off the pane, uniform and even.
 *
 * ## Threading model
 *
 * Uses RN's classic `Animated` API rather than Reanimated 4. Under
 * React 19 + Reanimated 4.5.1 the `useAnimatedStyle` → SharedValue
 * reactivity path did not repaint even after a proven bus-side charge
 * bump; the classic Animated path drives opacity with `useNativeDriver:
 * true`, so the animation still runs on the UI thread through the
 * compositor. Bus subscription + the decay interval are the only JS-
 * thread work, and both are trivial (one setState-equivalent per punch,
 * one 100ms interval).
 *
 * ## Tunables (all here so Kyle can iterate the feel without touching the pipeline)
 */
import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'

import type { BackdropBus } from './backdropBus'

/** How much a max-velocity haymaker adds to the charge in one hit
 *  (haymaker adds ~K_HIT · 1 · 2 = 2 · K_HIT). Quadratic-in-v01 so a
 *  jab (v01≈0.2) adds ~0.24·K_HIT — ~4× smaller than a haymaker.
 *  Tuned so a single Flurry (12 pumps ~120ms apart) lands around
 *  charge≈0.5 — vignette fully closed, center just beginning to fill.
 *  Only sustained heavy pummel across multiple Flurries reaches
 *  center-black. Bump this to make the pane react faster; lower to
 *  make even hard punches ramp gently. */
const K_HIT = 0.10
/** Seconds to decay by 1/e (~63%) — the "time will heal it slowly,
 *  evenly" constant. Land conservative; on-glass tune later. */
const TAU_S = 2.5
/** How often the decay clock ticks the accumulator toward zero. Higher
 *  cadence = smoother; ~30 Hz is compositor-fast without being wasteful. */
const DECAY_INTERVAL_MS = 32
/** Ease-in duration for a punch bump — how snappy the darkness arrives. */
const BUMP_DURATION_MS = 220
/** Ease-out duration for the per-tick decay — matches the tick cadence
 *  so the interpolation stays smooth. */
const DECAY_TIMING_MS = DECAY_INTERVAL_MS
/** Charge breakpoint pairs for the two stages. First is the edge ring;
 *  second is the center fill. Ring closes first, center fills only after. */
const VIGNETTE_RANGE: readonly [number, number] = [0, 0.4]
const CENTER_RANGE: readonly [number, number] = [0.5, 1.0]
/** How dark the vignette gets at full charge — never full 1.0 so the
 *  art still bleeds through the ring. */
const VIGNETTE_PEAK_OPACITY = 0.92
/** The vignette strip width, in DP. Wide enough to soften the edge,
 *  narrow enough to leave the middle alone. */
const EDGE_WIDTH = 220

export function PummelDarkness({
  bus,
  reducedMotion = false,
}: {
  bus: BackdropBus
  /** When true, hold a low static charge with no ramp or decay (§31.4). */
  reducedMotion?: boolean
}): React.JSX.Element {
  // Two mirrored state pieces: the JS-side accumulator (source of truth)
  // and the Animated.Value the compositor reads. Every mutation goes
  // through Animated.timing so the value moves smoothly, never in jumps.
  const targetRef = useRef(reducedMotion ? 0.18 : 0)
  const chargeRef = useRef(new Animated.Value(reducedMotion ? 0.18 : 0))
  const charge = chargeRef.current

  // Per-punch bump — increment the accumulator, animate charge toward it.
  useEffect(() => {
    if (reducedMotion) return
    return bus.subscribe((impulse) => {
      const boost = K_HIT * impulse.v01 * (1 + impulse.v01)
      targetRef.current = Math.min(1, targetRef.current + boost)
      Animated.timing(charge, {
        toValue: targetRef.current,
        duration: BUMP_DURATION_MS,
        useNativeDriver: true,
      }).start()
    })
  }, [bus, reducedMotion, charge])

  // Steady decay — one JS-side tick every DECAY_INTERVAL_MS pulls the
  // accumulator toward zero with time constant TAU_S. When the value
  // hits the floor the ticker stops updating so we don't schedule
  // pointless animations.
  useEffect(() => {
    if (reducedMotion) return
    const id = setInterval(() => {
      if (targetRef.current <= 0.001) return
      const factor = Math.exp(-DECAY_INTERVAL_MS / (TAU_S * 1000))
      targetRef.current = targetRef.current * factor
      Animated.timing(charge, {
        toValue: targetRef.current,
        duration: DECAY_TIMING_MS,
        useNativeDriver: true,
      }).start()
    }, DECAY_INTERVAL_MS)
    return () => clearInterval(id)
  }, [charge, reducedMotion])

  // Interpolations: two stages sharing one charge. The vignette climbs
  // first (edges close in), then the center fills once the ring is
  // nearly closed.
  const vignetteOpacity = charge.interpolate({
    inputRange: [VIGNETTE_RANGE[0], VIGNETTE_RANGE[1]],
    outputRange: [0, VIGNETTE_PEAK_OPACITY],
    extrapolate: 'clamp',
  })
  const centerOpacity = charge.interpolate({
    inputRange: [CENTER_RANGE[0], CENTER_RANGE[1]],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  })

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="pummel-darkness">
      {/* Stage 1: edge vignette (four linear gradients, one shared opacity). */}
      <Animated.View
        style={[StyleSheet.absoluteFill, { opacity: vignetteOpacity }]}
        pointerEvents="none"
      >
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
        style={[StyleSheet.absoluteFill, styles.centerFill, { opacity: centerOpacity }]}
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
