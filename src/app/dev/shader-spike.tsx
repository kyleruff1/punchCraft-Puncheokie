/**
 * Dev route. The ping-pong feedback spike: punchcraft://dev/shader-spike
 *
 * Proves, on the tablet, every unknown the Kinetic Sediment engine
 * depends on — BEFORE any real engine code exists:
 *
 *  1. `Skia.Surface.MakeOffscreen` called from a `useFrameCallback`
 *     worklet (UI thread), drawn into with an imperative RuntimeEffect
 *     paint, snapshotted, and fed back as the NEXT step's child shader.
 *  2. The snapshot flowing through a SharedValue<SkImage> into the JSX
 *     display pass (`<ImageShader image={sharedValue}>`) — the exact
 *     recorder-ownership pattern the Skia source warns about. If this
 *     crashes Ganesh, the sediment engine pivots to expo-gl.
 *  3. A fixed-timestep 30Hz accumulator loop staying smooth.
 *  4. RGBA8 signed-channel encoding surviving the GPU roundtrip: the
 *     sim writes encode(-0.25) into G every step; the display paints
 *     the bottom probe band GREEN only if it decodes back within 2%.
 *
 * The sim itself is a toy (diffuse + decay + tap splats) — the point
 * is the plumbing, not the physics.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Stack } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import {
  Canvas,
  Fill,
  FilterMode,
  ImageShader,
  MipmapMode,
  Shader,
  Skia,
  TileMode,
} from '@shopify/react-native-skia'
import type { SkImage, SkRuntimeEffect } from '@shopify/react-native-skia'
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated'

import { colors, punch } from '@/theme/colors'
import { fonts, sizes } from '@/theme/typography'
import { logger, safe } from '@diagnostics/logger'

const GRID = 64
const STEP_S = 1 / 30

/** Toy sim pass: 4-tap diffuse + decay + one Gaussian splat per step. */
const SIM_SKSL = `
uniform shader prev;
uniform float4 uSplat; // x, y (texels), radius, strength

half4 main(float2 xy) {
  half4 c = prev.eval(xy);
  half4 n = (prev.eval(xy + float2(1.0, 0.0)) +
             prev.eval(xy - float2(1.0, 0.0)) +
             prev.eval(xy + float2(0.0, 1.0)) +
             prev.eval(xy - float2(0.0, 1.0))) * 0.25;
  half4 v = mix(c, n, 0.35);
  // R carries the toy field, decayed toward rest each step.
  v.r = half(0.02 + (float(v.r) - 0.02) * 0.985);
  float d = distance(xy, uSplat.xy);
  v.r += half(uSplat.w * exp(-(d * d) / max(uSplat.z * uSplat.z, 1.0)));
  // G carries the encode probe: signed -0.25 with the 0.5 bias, every
  // step, so the display can verify RGBA8 fidelity end to end.
  v.g = half(0.5 + (-0.25) * 0.5);
  v.a = 1.0;
  return clamp(v, 0.0, 1.0);
}
`

/** Display pass: upscale the state, tint the field, paint the probe. */
const DISPLAY_SKSL = `
uniform shader state;
uniform float2 uOut;
uniform float uGrid;

half4 main(float2 xy) {
  float2 uv = xy / uOut;
  half4 s = state.eval(uv * uGrid);
  float field = float(s.r);
  // Probe band along the bottom: decode G and compare to -0.25.
  if (uv.y > 0.92) {
    float decoded = (float(s.g) - 0.5) * 2.0;
    bool ok = abs(decoded - (-0.25)) < 0.02;
    return ok ? half4(0.1, 0.8, 0.3, 1.0) : half4(0.9, 0.1, 0.1, 1.0);
  }
  half3 tint = mix(
    half3(0.04, 0.05, 0.06),
    half3(0.12, 0.73, 0.77),
    half(field)
  );
  return half4(tint, 1.0);
}
`

function makeEffect(source: string, label: string): SkRuntimeEffect | null {
  try {
    return Skia.RuntimeEffect.Make(source)
  } catch (err) {
    logger.warn('spike.shader.compile', 'spike shader failed to compile', {
      label: safe(label),
      errorMessage: safe(err instanceof Error ? err.message : String(err)),
    })
    return null
  }
}

/** A 1×1 mid-gray bootstrap so the display's ImageShader is never null. */
function makeBootstrapImage(): SkImage | null {
  const surface = Skia.Surface.MakeOffscreen(GRID, GRID)
  if (!surface) return null
  const canvas = surface.getCanvas()
  const paintObj = Skia.Paint()
  paintObj.setColor(Skia.Color('#0B0D0E'))
  canvas.drawPaint(paintObj)
  surface.flush()
  return surface.makeImageSnapshot()
}

export default function ShaderSpikeScreen(): React.JSX.Element {
  const simEffect = useMemo(() => makeEffect(SIM_SKSL, 'sim'), [])
  const displayEffect = useMemo(() => makeEffect(DISPLAY_SKSL, 'display'), [])
  const bootstrap = useMemo(() => makeBootstrapImage(), [])

  const stateImage = useSharedValue<SkImage | null>(bootstrap)
  // The ping-pong surfaces live entirely on the UI thread; created on
  // the first frame callback, kept in a shared value.
  const surfaces = useSharedValue<{ a: unknown; b: unknown; flip: boolean } | null>(null)
  const splat = useSharedValue({ x: GRID / 2, y: GRID / 2, r: 6, s: 0 })
  const acc = useSharedValue(0)
  const steps = useSharedValue(0)
  const failure = useSharedValue('')

  const [size, setSize] = useState({ w: 0, h: 0 })
  const [status, setStatus] = useState('starting')
  const rapidRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useFrameCallback((info) => {
    'worklet'
    if (!simEffect || failure.value !== '') return
    try {
      if (surfaces.value === null) {
        const a = Skia.Surface.MakeOffscreen(GRID, GRID)
        const b = Skia.Surface.MakeOffscreen(GRID, GRID)
        if (!a || !b) {
          failure.value = 'MakeOffscreen returned null on the UI thread'
          return
        }
        surfaces.value = { a, b, flip: false }
      }
      const dtMs = info.timeSincePreviousFrame ?? 16
      acc.value = Math.min(0.1, acc.value + dtMs / 1000)
      while (acc.value >= STEP_S) {
        acc.value -= STEP_S
        const pair: { a: unknown; b: unknown; flip: boolean } | null = surfaces.value
        if (!pair || !stateImage.value) return
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dst = (pair.flip ? pair.a : pair.b) as any
        const child = stateImage.value.makeShaderOptions(
          TileMode.Clamp,
          TileMode.Clamp,
          FilterMode.Nearest,
          MipmapMode.None,
        )
        const s = splat.value
        const shader = simEffect.makeShaderWithChildren([s.x, s.y, s.r, s.s], [child])
        const paintObj = Skia.Paint()
        paintObj.setShader(shader)
        const canvas = dst.getCanvas()
        canvas.drawPaint(paintObj)
        dst.flush()
        stateImage.value = dst.makeImageSnapshot()
        surfaces.value = { a: pair.a, b: pair.b, flip: !pair.flip }
        splat.value = { ...s, s: 0 }
        steps.value += 1
      }
    } catch (err) {
      failure.value = err instanceof Error ? err.message : String(err)
    }
  })

  // Dev-only status poll — the spike needs human-readable numbers, and
  // a 500ms setState is irrelevant to what is being measured.
  useEffect(() => {
    const timer = setInterval(() => {
      setStatus(
        failure.value !== ''
          ? `FAILED: ${failure.value}`
          : `steps=${steps.value} (${(steps.value / 30).toFixed(0)}s simulated)`,
      )
    }, 500)
    return () => clearInterval(timer)
  }, [failure, steps])

  useEffect(() => {
    return () => {
      if (rapidRef.current) clearInterval(rapidRef.current)
    }
  }, [])

  const displayUniforms = useDerivedValue(() => ({
    uOut: [size.w || 1, size.h || 1],
    uGrid: GRID,
  }))

  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout
    setSize({ w: width, h: height })
  }

  const tap = (xFrac: number, yFrac: number, strength: number): void => {
    splat.value = { x: xFrac * GRID, y: yFrac * GRID, r: 6, s: strength }
  }

  const rapidFire = (): void => {
    if (rapidRef.current) clearInterval(rapidRef.current)
    let count = 0
    rapidRef.current = setInterval(() => {
      count += 1
      tap(0.2 + 0.6 * ((count * 7919) % 100) / 100, 0.3 + 0.4 * ((count * 104729) % 100) / 100, 0.9)
      if (count >= 20 && rapidRef.current) clearInterval(rapidRef.current)
    }, 80)
  }

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: 'Ping-pong spike' }} />
      <Pressable
        style={styles.stage}
        onLayout={onLayout}
        onPress={(e) => {
          if (size.w > 0 && size.h > 0) {
            tap(e.nativeEvent.locationX / size.w, e.nativeEvent.locationY / size.h, 1)
          }
        }}
      >
        {displayEffect && size.w > 0 && stateImage.value !== null ? (
          <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
            <Fill>
              <Shader source={displayEffect} uniforms={displayUniforms}>
                <ImageShader
                  image={stateImage}
                  fit="none"
                  width={GRID}
                  height={GRID}
                  tx="clamp"
                  ty="clamp"
                />
              </Shader>
            </Fill>
          </Canvas>
        ) : null}
      </Pressable>
      <Text style={styles.statusText}>{status}</Text>
      <Text style={styles.hint}>
        Tap the pane to splat. Bottom band green = RGBA8 signed roundtrip OK.
      </Text>
      <Pressable style={styles.button} onPress={rapidFire}>
        <Text style={styles.buttonText}>Rapid fire ×20</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, padding: 16, gap: 10 },
  stage: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: punch.charcoalDeep,
  },
  statusText: {
    fontSize: sizes.body,
    fontFamily: fonts.mono,
    color: colors.textPrimary,
  },
  hint: {
    fontSize: sizes.label,
    fontFamily: fonts.body,
    color: colors.textSecondary,
  },
  button: {
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    marginBottom: 84,
  },
  buttonText: { fontSize: sizes.body, fontFamily: fonts.heading, color: colors.textPrimary },
})
