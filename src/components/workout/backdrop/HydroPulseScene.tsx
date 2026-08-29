/**
 * The Standard-tier scene: Kinetic Sediment Glass.
 *
 * A persistent elastoplastic sediment pane over the backdrop art. The
 * engine (sedimentEngine.ts) runs the ping-pong simulation on the UI
 * thread; this component wires the bus into it and hosts the display
 * pass — one full-screen RuntimeEffect that refracts the backdrop
 * through the settled+elastic displacement, draws deposits and
 * displacement-warped grain (granules genuinely hold position when
 * settled), tints crests by hand pressure, and masks the KPI zones.
 *
 * React renders this once per mount and on layout/calm changes;
 * punches and frames never reach it. The RN <Image> in live.tsx keeps
 * covering the pane while the backdrop image or shaders are not ready.
 *
 * (The name and testID predate the sediment model; they are pinned by
 * the renderer and the tier tests, and still describe a punch-driven
 * pane.)
 */
import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import {
  Canvas,
  Fill,
  FilterMode,
  ImageShader,
  MipmapMode,
  Shader,
  useImage,
} from '@shopify/react-native-skia'
import { useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated'

import {
  CHURN_TAU_S,
  PRESSURE_LR_TAU_S,
  decayedEnv,
} from '@domain/effects/sedimentMath'
import {
  DEFAULT_TUNING,
  DISPLAY_SKSL,
  buildDisplayUniforms,
  type SedimentTuning,
} from '@domain/effects/sedimentShaders'
import { compileSedimentEffect, useSedimentEngine } from './sedimentEngine'
import type { BackdropBus } from './backdropBus'

/* eslint-disable-next-line @typescript-eslint/no-require-imports */
const BACKDROP = require('../../../../assets/branding/backdrop-landscape.png') as number

let paneSeedCounter = 7

export function HydroPulseScene({
  bus,
  calm,
  tuning,
}: {
  bus: BackdropBus
  /** Phase-driven damping target: work 1, rest ~0.35, idle ~0.15. */
  calm: number
  tuning?: Partial<SedimentTuning>
}): React.JSX.Element {
  const image = useImage(BACKDROP)
  const displayEffect = useMemo(() => compileSedimentEffect(DISPLAY_SKSL, 'display'), [])
  const sessionSeed = useMemo(() => (paneSeedCounter += 1), [])
  const engine = useSedimentEngine(sessionSeed)

  const [size, setSize] = useState({ w: 0, h: 0 })
  const calmSV = useSharedValue(calm)
  const resolvedTuning = useMemo<SedimentTuning>(
    () => ({ ...DEFAULT_TUNING, ...tuning }),
    [tuning],
  )

  useEffect(() => {
    // Eased so a bell does not snap the pane — it stills over a second.
    calmSV.value = withTiming(calm, { duration: 1200 })
  }, [calm, calmSV])

  useEffect(() => {
    return bus.subscribe((impulse) => {
      engine.enqueue(impulse.handCode, impulse.v01, impulse.seed)
    })
  }, [bus, engine])

  const { clockSec, tray, envelopes } = engine
  const displayUniforms = useDerivedValue(() => {
    const env = envelopes.value
    const nowSec = clockSec.value
    // The pane calms with the phase AND with settling: fully quiet
    // sediment shows the art nearly undisturbed.
    const churn = decayedEnv(env.churn, env.churnStamp, nowSec, CHURN_TAU_S)
    const calmNow = calmSV.value * (0.55 + 0.45 * Math.min(1, churn * 2 + 0.6))
    return buildDisplayUniforms(
      nowSec,
      size.w,
      size.h,
      calmNow,
      tray.value,
      {
        leftV: decayedEnv(env.left, env.leftStamp, nowSec, PRESSURE_LR_TAU_S),
        leftStamp: nowSec,
        rightV: decayedEnv(env.right, env.rightStamp, nowSec, PRESSURE_LR_TAU_S),
        rightStamp: nowSec,
      },
      resolvedTuning,
    )
  }, [size.w, size.h, resolvedTuning])

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout
    setSize({ w: Math.max(0, width), h: Math.max(0, height) })
  }

  const ready = image !== null && displayEffect !== null && size.w > 0 && size.h > 0

  return (
    // Layout measured on a plain View: Fabric's Skia Canvas does not
    // support onLayout.
    <View
      style={StyleSheet.absoluteFill}
      onLayout={onLayout}
      pointerEvents="none"
      testID="hydro-pulse-canvas"
    >
      {ready ? (
        <Canvas style={StyleSheet.absoluteFill}>
          <Fill>
            <Shader source={displayEffect} uniforms={displayUniforms}>
              <ImageShader
                image={image}
                fit="cover"
                width={size.w}
                height={size.h}
                tx="clamp"
                ty="clamp"
              />
              <ImageShader
                image={engine.memoryImage}
                fit="none"
                tx="clamp"
                ty="clamp"
                sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }}
              />
              <ImageShader
                image={engine.motionImage}
                fit="none"
                tx="clamp"
                ty="clamp"
                sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }}
              />
            </Shader>
          </Fill>
        </Canvas>
      ) : null}
    </View>
  )
}
