/**
 * HydroPulse — the Standard-tier Skia scene.
 *
 * ## How a punch becomes water without touching React
 *
 * The bus delivers each impulse on the JS thread; the subscription's
 * only work is a `runOnUI` append into a 12-slot ring buffer held in a
 * shared value, timestamped with the canvas clock on arrival. Every
 * visible property — ripple geometry, surge, meet-glow, every atlas
 * transform — is a `useDerivedValue` of `(clock, slots)` evaluating the
 * pure math in `@domain/effects/hydroPulse` on the UI thread each
 * frame. React renders this component once per mount and once per calm
 * change; punches and frames never reach it (spec §31.4: off the JS
 * thread, and the cue-latency budget never sees the water).
 *
 * Liquid-chrome palette (Kyle 2026-08-29): the ambient field is
 * greyscale mercury; the hand tints — the app's only colors — appear
 * solely on punch impulses.
 */
import React, { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import {
  Atlas,
  BlurMask,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  RadialGradient,
  Rect,
  useClock,
  useRSXformBuffer,
  useRectBuffer,
} from '@shopify/react-native-skia'
import {
  runOnUI,
  useDerivedValue,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'

import { colors, punch } from '@/theme/colors'
import {
  ATLAS_SLOTS,
  HAND_LEFT,
  HAND_NEUTRAL,
  HAND_RIGHT,
  PARTICLES_PER_IMPULSE,
  RIPPLE_POOL,
  ambientBlobAt,
  emptyPool,
  meetBoostAt,
  particleAt,
  rippleAt,
  surgeAt,
  type ImpulseSlot,
} from '@domain/effects/hydroPulse'
import { BUBBLE_SPRITE_SIZE, useBubbleTexture } from './bubbleTexture'
import type { BackdropBus, BackdropSinkImpulse } from './backdropBus'

const INERT_SLOT: ImpulseSlot = { t: -1e12, hand: HAND_NEUTRAL, v01: 0, seed: 0 }
const LEFT_TINT = colors.trackerLeft
const RIGHT_TINT = colors.trackerRight
const NEUTRAL_TINT = punch.silver
const AMBIENT_BLOBS = [0, 1, 2]
const RIPPLE_INDICES = Array.from({ length: RIPPLE_POOL }, (_, i) => i)

interface SceneShared {
  clock: SharedValue<number>
  slots: SharedValue<ImpulseSlot[]>
  size: SharedValue<{ w: number; h: number }>
}

/** One ripple slot: a soft disc plus a stroked crest, tinted per hand. */
function Ripple({ index, shared }: { index: number; shared: SceneShared }): React.JSX.Element {
  const { clock, slots, size } = shared
  const frame = useDerivedValue(() =>
    rippleAt(clock.value, slots.value[index] ?? INERT_SLOT, size.value.w, size.value.h),
  )
  const cx = useDerivedValue(() => frame.value.cx)
  const cy = useDerivedValue(() => frame.value.cy)
  const r = useDerivedValue(() => Math.max(0.01, frame.value.r))
  const fillOpacity = useDerivedValue(() => frame.value.fillOpacity)
  const crestOpacity = useDerivedValue(() => frame.value.crestOpacity)
  const tint = useDerivedValue(() => {
    const hand = (slots.value[index] ?? INERT_SLOT).hand
    return hand === HAND_LEFT ? LEFT_TINT : hand === HAND_RIGHT ? RIGHT_TINT : NEUTRAL_TINT
  })
  return (
    <Group>
      <Circle cx={cx} cy={cy} r={r} color={tint} opacity={fillOpacity}>
        <BlurMask blur={14} style="normal" />
      </Circle>
      <Circle
        cx={cx}
        cy={cy}
        r={r}
        color={tint}
        opacity={crestOpacity}
        style="stroke"
        strokeWidth={2.5}
      >
        <BlurMask blur={3} style="normal" />
      </Circle>
    </Group>
  )
}

/** One drifting mercury blob of the ambient field. */
function AmbientBlob({
  index,
  shared,
  sway,
}: {
  index: number
  shared: SceneShared
  sway: SharedValue<number>
}): React.JSX.Element {
  const { clock, size } = shared
  const frame = useDerivedValue(() =>
    ambientBlobAt(clock.value, index, size.value.w, size.value.h, sway.value),
  )
  const cx = useDerivedValue(() => frame.value.cx)
  const cy = useDerivedValue(() => frame.value.cy)
  const r = useDerivedValue(() => frame.value.r)
  const opacity = useDerivedValue(() => frame.value.opacity)
  const center = useDerivedValue(() => ({ x: frame.value.cx, y: frame.value.cy }))
  return (
    <Circle cx={cx} cy={cy} r={r} opacity={opacity}>
      <RadialGradient c={center} r={r} colors={[`${punch.chromeBright}E6`, `${punch.chromeBright}00`]} />
    </Circle>
  )
}

/** One hand's bubble batch — tint baked into the texture. */
function BubbleAtlas({
  batchHand,
  tint,
  shared,
}: {
  batchHand: number
  tint: string
  shared: SceneShared
}): React.JSX.Element {
  const { clock, slots, size } = shared
  const texture = useBubbleTexture(tint)
  const sprites = useRectBuffer(ATLAS_SLOTS, (rect) => {
    'worklet'
    rect.setXYWH(0, 0, BUBBLE_SPRITE_SIZE, BUBBLE_SPRITE_SIZE)
  })
  const transforms = useRSXformBuffer(ATLAS_SLOTS, (xform, i) => {
    'worklet'
    const slot = slots.value[Math.floor(i / PARTICLES_PER_IMPULSE)] ?? INERT_SLOT
    const p = particleAt(
      clock.value,
      slot,
      i % PARTICLES_PER_IMPULSE,
      batchHand,
      size.value.w,
      size.value.h,
    )
    xform.set(p.scos, p.ssin, p.x, p.y)
  })
  return <Atlas image={texture} sprites={sprites} transforms={transforms} />
}

export function HydroPulseScene({
  bus,
  calm,
}: {
  bus: BackdropBus
  /** Phase-driven damping target: work 1, rest ~0.35, idle ~0.15. */
  calm: number
}): React.JSX.Element {
  const clock = useClock()
  const slots = useSharedValue<ImpulseSlot[]>(emptyPool(RIPPLE_POOL))
  const head = useSharedValue(0)
  const size = useSharedValue({ w: 1, h: 1 })
  const calmSV = useSharedValue(calm)

  useEffect(() => {
    // Eased so a bell doesn't snap the water — it stills over a second.
    calmSV.value = withTiming(calm, { duration: 1200 })
  }, [calm, calmSV])

  useEffect(() => {
    return bus.subscribe((impulse: BackdropSinkImpulse) => {
      runOnUI((msg: BackdropSinkImpulse) => {
        'worklet'
        const pool = slots.value
        const slot = pool[head.value % RIPPLE_POOL]
        if (slot) {
          // Timestamped on arrival with the canvas clock — the decorative
          // layer's "now" is when the splash can first draw.
          slot.t = clock.value
          slot.hand = msg.handCode
          slot.v01 = msg.v01
          slot.seed = msg.seed
        }
        head.value += 1
      })(impulse)
    })
  }, [bus, clock, head, slots])

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout
    size.value = { w: Math.max(1, width), h: Math.max(1, height) }
  }

  const shared: SceneShared = { clock, slots, size }
  const sway = useDerivedValue(
    () => calmSV.value * (0.2 + 0.8 * surgeAt(clock.value, slots.value)),
  )

  // Meet-glow: a soft vertical band where alternating hands collide.
  const meetOpacity = useDerivedValue(
    () => meetBoostAt(clock.value, slots.value) * 0.45 * calmSV.value,
  )
  const meetX = useDerivedValue(() => size.value.w * 0.36)
  const meetWidth = useDerivedValue(() => size.value.w * 0.28)
  const meetHeight = useDerivedValue(() => size.value.h)
  const meetStart = useDerivedValue(() => ({ x: size.value.w * 0.36, y: 0 }))
  const meetEnd = useDerivedValue(() => ({ x: size.value.w * 0.64, y: 0 }))

  return (
    <Canvas style={StyleSheet.absoluteFill} onLayout={onLayout} testID="hydro-pulse-canvas">
      {AMBIENT_BLOBS.map((i) => (
        <AmbientBlob key={`blob-${i}`} index={i} shared={shared} sway={sway} />
      ))}
      <Rect x={meetX} y={0} width={meetWidth} height={meetHeight} opacity={meetOpacity}>
        <LinearGradient
          start={meetStart}
          end={meetEnd}
          colors={[`${punch.shine}00`, `${punch.shine}CC`, `${punch.shine}00`]}
        />
      </Rect>
      {RIPPLE_INDICES.map((i) => (
        <Ripple key={`ripple-${i}`} index={i} shared={shared} />
      ))}
      <BubbleAtlas batchHand={HAND_LEFT} tint={LEFT_TINT} shared={shared} />
      <BubbleAtlas batchHand={HAND_RIGHT} tint={RIGHT_TINT} shared={shared} />
      <BubbleAtlas batchHand={HAND_NEUTRAL} tint={NEUTRAL_TINT} shared={shared} />
    </Canvas>
  )
}
