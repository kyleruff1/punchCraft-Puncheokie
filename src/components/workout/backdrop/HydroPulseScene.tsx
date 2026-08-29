/**
 * The Standard-tier scene: the reversible viscoelastic membrane.
 *
 * An elastic sheet over two immutable textures (the backdrop art and
 * the particulate grain). Punches spawn temporary impulses; the single
 * display shader evaluates them analytically — traveling waves with
 * real arrival delay, an underdamped whole-sheet gel, compression
 * banding in the grain — and every contribution decays to exactly
 * zero, so the composition always restores its original arrangement.
 *
 * React renders this once per mount and on layout/calm/preset changes;
 * punches and frames never reach it. The RN <Image> in live.tsx keeps
 * covering the pane while the backdrop image or shader is not ready.
 *
 * (The name and testID predate the membrane model; they are pinned by
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
  DEBRIS_TAU_S,
  DUST_TAU_S,
  IMPACT_TAU_S,
  MEMBRANE_PRESETS,
  SENSITIVITY_MULS,
  VEIL_TAU_S,
  decayedEnv,
  type PummelSensitivity,
} from '@domain/effects/membraneMath'
import {
  DEFAULT_TUNING,
  MEMBRANE_SKSL,
  buildMembraneUniforms,
  type MembraneTuning,
} from '@domain/effects/membraneShader'
import { compileMembraneEffect, useMembraneEngine, type MembraneFeel } from './membraneEngine'
import type { BackdropBus } from './backdropBus'

/* eslint-disable @typescript-eslint/no-require-imports */
const BACKDROP = require('../../../../assets/branding/backdrop-landscape.png') as number
const GRAIN = require('../../../../assets/effects/grain.png') as number
/* eslint-enable @typescript-eslint/no-require-imports */

export type MembranePresetName = keyof typeof MEMBRANE_PRESETS

export function HydroPulseScene({
  bus,
  calm,
  tuning,
  preset = 'reactive',
  sensitivity = 'standard',
}: {
  bus: BackdropBus
  /** Phase-driven damping target: work 1, rest ~0.35, idle ~0.15. */
  calm: number
  tuning?: Partial<MembraneTuning>
  preset?: MembranePresetName
  /** Pummel Sensitivity: how hard a full blackout is to reach. */
  sensitivity?: PummelSensitivity
}): React.JSX.Element {
  const image = useImage(BACKDROP)
  const grain = useImage(GRAIN)
  const displayEffect = useMemo(() => compileMembraneEffect(MEMBRANE_SKSL, 'membrane'), [])
  const engine = useMembraneEngine()

  const [size, setSize] = useState({ w: 0, h: 0 })
  const calmSV = useSharedValue(calm)
  const presetDef = MEMBRANE_PRESETS[preset]
  const resolvedTuning = useMemo<MembraneTuning>(
    () => ({
      ...DEFAULT_TUNING,
      refraction: presetDef.refraction,
      gelGain: presetDef.gelMul,
      ...tuning,
    }),
    [presetDef, tuning],
  )
  const feel = useMemo<MembraneFeel>(
    () => ({
      surgeMul: presetDef.surgeMul,
      lifeMul: presetDef.lifeMul,
      sensitivityMul: SENSITIVITY_MULS[sensitivity],
    }),
    [presetDef, sensitivity],
  )

  useEffect(() => {
    // Eased so a bell does not snap the pane — it stills over a second.
    calmSV.value = withTiming(calm, { duration: 1200 })
  }, [calm, calmSV])

  useEffect(() => {
    return bus.subscribe((impulse) => {
      engine.enqueue(impulse.handCode, impulse.v01, impulse.seed, feel)
    })
  }, [bus, engine, feel])

  const { clockSec, ring, env } = engine
  const displayUniforms = useDerivedValue(() => {
    const nowSec = clockSec.value
    const e = env.value
    return buildMembraneUniforms(
      nowSec,
      size.w,
      size.h,
      calmSV.value,
      decayedEnv(e.churn, e.churnStamp, nowSec, CHURN_TAU_S),
      {
        dust: decayedEnv(e.dust, e.dustStamp, nowSec, DUST_TAU_S),
        debris: decayedEnv(e.debris, e.debrisStamp, nowSec, DEBRIS_TAU_S),
        veil: decayedEnv(e.veil, e.veilStamp, nowSec, VEIL_TAU_S),
        impact: decayedEnv(e.impact, e.impactStamp, nowSec, IMPACT_TAU_S),
      },
      ring.value,
      resolvedTuning,
    )
  }, [size.w, size.h, resolvedTuning])

  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout
    setSize({ w: Math.max(0, width), h: Math.max(0, height) })
  }

  const ready = image !== null && grain !== null && displayEffect !== null && size.w > 0 && size.h > 0

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
                image={grain}
                fit="none"
                tx="repeat"
                ty="repeat"
                sampling={{ filter: FilterMode.Linear, mipmap: MipmapMode.None }}
              />
            </Shader>
          </Fill>
        </Canvas>
      ) : null}
    </View>
  )
}
