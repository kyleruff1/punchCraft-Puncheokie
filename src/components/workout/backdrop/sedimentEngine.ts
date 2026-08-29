/**
 * The Kinetic Sediment engine — the UI-thread half of the persistent
 * backdrop.
 *
 * Owns four offscreen ping-pong surfaces (motion + memory pairs), a
 * fixed-timestep 30Hz stepper inside a `useFrameCallback` worklet, the
 * punch queue, the tray spring, and the activity envelopes. Every
 * pattern here was proven on-device by dev/shader-spike.tsx first:
 * `Skia.Surface.MakeOffscreen` on the UI thread, imperative
 * RuntimeEffect paints, snapshot-as-child-shader feedback, and
 * snapshots flowing through shared values into the JSX display pass.
 *
 * Sleep is the perf story (Kyle's design): when the queue is empty,
 * churn has decayed, and the tray is still, the stepper early-returns
 * — the pane's last arrangement simply persists (settled state NEVER
 * fades) at the cost of one no-op worklet call per frame. Any punch
 * wakes it.
 */
import { useEffect, useMemo } from 'react'
import { FilterMode, MipmapMode, Skia, TileMode } from '@shopify/react-native-skia'
import type { SkImage, SkRuntimeEffect, SkSurface } from '@shopify/react-native-skia'
import {
  runOnUI,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'

import {
  CHURN_TAU_S,
  GRID_H,
  GRID_W,
  IMPACT_TAU_S,
  MAX_PENDING,
  PRESSURE_LR_TAU_S,
  SESSION_TAU_S,
  SLEEP_AFTER_QUIET_S,
  SLEEP_CHURN_BELOW,
  SLEEP_TRAY_BELOW,
  SPLATS_PER_STEP,
  STEP_S,
  bumpEnv,
  convergenceSplat,
  decayedEnv,
  detectConvergence,
  kickTray,
  restingTray,
  splatFromPunch,
  stepTray,
  type SedimentSplat,
  type TrayState,
} from '@domain/effects/sedimentMath'
import {
  MEMORY_SKSL,
  MOTION_SKSL,
  SEED_SKSL,
  buildMemoryUniforms,
  buildMotionUniforms,
  buildSeedUniforms,
} from '@domain/effects/sedimentShaders'
import { logger, safe } from '@diagnostics/logger'

/** Envelope state: (value, stampSec) pairs — analytic decay read-side. */
export interface SedimentEnvelopes {
  impact: number
  impactStamp: number
  churn: number
  churnStamp: number
  session: number
  sessionStamp: number
  left: number
  leftStamp: number
  right: number
  rightStamp: number
  lastHand: number
  lastTSec: number
  lastStrength: number
  lastPunchSec: number
}

export function restingEnvelopes(): SedimentEnvelopes {
  return {
    impact: 0,
    impactStamp: 0,
    churn: 0,
    churnStamp: 0,
    session: 0,
    sessionStamp: 0,
    left: 0,
    leftStamp: 0,
    right: 0,
    rightStamp: 0,
    lastHand: 2,
    lastTSec: -1e4,
    lastStrength: 0,
    lastPunchSec: -1e4,
  }
}

interface SurfacePair {
  motionA: SkSurface
  motionB: SkSurface
  memoryA: SkSurface
  memoryB: SkSurface
  flip: boolean
}

export interface SedimentEngine {
  /** Snapshots for the display pass (never null after bootstrap). */
  motionImage: SharedValue<SkImage | null>
  memoryImage: SharedValue<SkImage | null>
  envelopes: SharedValue<SedimentEnvelopes>
  tray: SharedValue<TrayState>
  clockSec: SharedValue<number>
  /** Non-empty when the UI-thread stepper hit an error and stopped. */
  failure: SharedValue<string>
  /** Enqueue one punch (JS thread; hops to the UI thread itself). */
  enqueue(handCode: number, v01: number, seed: number): void
  /** Lab controls. */
  reset(seed: number): void
}

const effectCache = new Map<string, SkRuntimeEffect | null>()

/** Lazy, cached, throw-safe RuntimeEffect factory (Make throws jsi). */
export function compileSedimentEffect(source: string, label: string): SkRuntimeEffect | null {
  return compile(source, label)
}

function compile(source: string, label: string): SkRuntimeEffect | null {
  const cached = effectCache.get(source)
  if (cached !== undefined) return cached
  let effect: SkRuntimeEffect | null = null
  try {
    effect = Skia.RuntimeEffect.Make(source)
  } catch (err) {
    logger.warn('backdrop.shader.compile', 'sediment shader failed to compile', {
      label: safe(label),
      errorMessage: safe(err instanceof Error ? err.message : String(err)),
    })
  }
  effectCache.set(source, effect)
  return effect
}

/** JS-thread bootstrap image so the display's ImageShaders start non-null. */
function bootstrapImage(colorHex: string): SkImage | null {
  const surface = Skia.Surface.MakeOffscreen(GRID_W, GRID_H)
  if (!surface) return null
  const paint = Skia.Paint()
  paint.setColor(Skia.Color(colorHex))
  surface.getCanvas().drawPaint(paint)
  surface.flush()
  return surface.makeImageSnapshot()
}

export function useSedimentEngine(sessionSeed: number): SedimentEngine {
  const motionEffect = useMemo(() => compile(MOTION_SKSL, 'motion'), [])
  const memoryEffect = useMemo(() => compile(MEMORY_SKSL, 'memory'), [])
  const seedEffect = useMemo(() => compile(SEED_SKSL, 'seed'), [])

  // Neutral motion = 0.5-biased zero offsets/velocities.
  const motionImage = useSharedValue<SkImage | null>(useMemo(() => bootstrapImage('#808080'), []))
  const memoryImage = useSharedValue<SkImage | null>(useMemo(() => bootstrapImage('#808080'), []))
  const surfaces = useSharedValue<SurfacePair | null>(null)
  const pending = useSharedValue<SedimentSplat[]>([])
  const envelopes = useSharedValue<SedimentEnvelopes>(restingEnvelopes())
  const tray = useSharedValue<TrayState>(restingTray())
  const clockSec = useSharedValue(0)
  const acc = useSharedValue(0)
  const seedRequest = useSharedValue(sessionSeed)
  const seededFor = useSharedValue(Number.NaN)
  const failure = useSharedValue('')

  useFrameCallback((info) => {
    'worklet'
    if (!motionEffect || !memoryEffect || !seedEffect || failure.value !== '') return
    try {
      const dtMs = info.timeSincePreviousFrame ?? 16
      clockSec.value += dtMs / 1000
      const nowSec = clockSec.value

      // Sleep: nothing queued, churn decayed, tray still, quiet long
      // enough — the arrangement persists at ~zero cost.
      const env = envelopes.value
      const churnNow = decayedEnv(env.churn, env.churnStamp, nowSec, CHURN_TAU_S)
      const trayNow = tray.value
      const needsSeed = seededFor.value !== seedRequest.value
      if (
        !needsSeed &&
        pending.value.length === 0 &&
        nowSec - env.lastPunchSec > SLEEP_AFTER_QUIET_S &&
        churnNow < SLEEP_CHURN_BELOW &&
        Math.abs(trayNow.velX) + Math.abs(trayNow.velY) < SLEEP_TRAY_BELOW &&
        Math.abs(trayNow.offsetX) + Math.abs(trayNow.offsetY) < SLEEP_TRAY_BELOW
      ) {
        acc.value = 0
        return
      }

      if (surfaces.value === null) {
        const motionA = Skia.Surface.MakeOffscreen(GRID_W, GRID_H)
        const motionB = Skia.Surface.MakeOffscreen(GRID_W, GRID_H)
        const memoryA = Skia.Surface.MakeOffscreen(GRID_W, GRID_H)
        const memoryB = Skia.Surface.MakeOffscreen(GRID_W, GRID_H)
        if (!motionA || !motionB || !memoryA || !memoryB) {
          failure.value = 'MakeOffscreen returned null'
          return
        }
        surfaces.value = { motionA, motionB, memoryA, memoryB, flip: false }
      }

      if (needsSeed) {
        // Paint the virgin pane: seeded density into BOTH memory
        // surfaces, neutral gray into both motion surfaces.
        const pair = surfaces.value
        if (!pair) return
        const seedShader = seedEffect.makeShaderWithChildren(
          Object.values(buildSeedUniforms(seedRequest.value)).flat() as number[],
          [],
        )
        const seedPaint = Skia.Paint()
        seedPaint.setShader(seedShader)
        pair.memoryA.getCanvas().drawPaint(seedPaint)
        pair.memoryA.flush()
        pair.memoryB.getCanvas().drawPaint(seedPaint)
        pair.memoryB.flush()
        const grayPaint = Skia.Paint()
        grayPaint.setColor(Skia.Color('#808080'))
        pair.motionA.getCanvas().drawPaint(grayPaint)
        pair.motionA.flush()
        pair.motionB.getCanvas().drawPaint(grayPaint)
        pair.motionB.flush()
        memoryImage.value = pair.memoryA.makeImageSnapshot()
        motionImage.value = pair.motionA.makeImageSnapshot()
        seededFor.value = seedRequest.value
        envelopes.value = {
          ...envelopes.value,
          lastPunchSec: nowSec,
        }
      }

      acc.value = Math.min(0.1, acc.value + dtMs / 1000)
      while (acc.value >= STEP_S) {
        acc.value -= STEP_S
        const pair: SurfacePair | null = surfaces.value
        const motionPrev = motionImage.value
        const memoryPrev = memoryImage.value
        if (!pair || !motionPrev || !memoryPrev) return

        // Drain up to SPLATS_PER_STEP queued punches into this step.
        const queue = pending.value
        const stepSplats = queue.slice(0, SPLATS_PER_STEP)
        if (queue.length > 0) pending.value = queue.slice(SPLATS_PER_STEP)

        tray.value = stepTray(tray.value, STEP_S)
        const envNow = envelopes.value
        const churn = decayedEnv(envNow.churn, envNow.churnStamp, nowSec, CHURN_TAU_S)
        const damping = 6.2 - 4.0 * Math.min(1, churn)
        const trayForceX = -tray.value.velX * 2.2
        const trayForceY = -tray.value.velY * 2.2

        const sample = (img: SkImage) =>
          img.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Nearest, MipmapMode.None)

        // Motion pass.
        const motionDst = pair.flip ? pair.motionA : pair.motionB
        const motionUniforms = buildMotionUniforms(
          STEP_S,
          damping,
          churn,
          trayForceX,
          trayForceY,
          stepSplats,
        )
        const motionShader = motionEffect.makeShaderWithChildren(
          Object.values(motionUniforms).flat() as number[],
          [sample(motionPrev), sample(memoryPrev)],
        )
        const motionPaint = Skia.Paint()
        motionPaint.setShader(motionShader)
        motionDst.getCanvas().drawPaint(motionPaint)
        motionDst.flush()
        const motionNext = motionDst.makeImageSnapshot()

        // Memory pass.
        const memoryDst = pair.flip ? pair.memoryA : pair.memoryB
        const memoryUniforms = buildMemoryUniforms(STEP_S, churn, 0, stepSplats)
        const memoryShader = memoryEffect.makeShaderWithChildren(
          Object.values(memoryUniforms).flat() as number[],
          [sample(motionNext), sample(memoryPrev)],
        )
        const memoryPaint = Skia.Paint()
        memoryPaint.setShader(memoryShader)
        memoryDst.getCanvas().drawPaint(memoryPaint)
        memoryDst.flush()

        motionImage.value = motionNext
        memoryImage.value = memoryDst.makeImageSnapshot()
        surfaces.value = { ...pair, flip: !pair.flip }
      }
    } catch (err) {
      failure.value = err instanceof Error ? err.message : String(err)
    }
  })

  const failureLogged = useSharedValue(false)
  useEffect(() => {
    const timer = setInterval(() => {
      if (failure.value !== '' && !failureLogged.value) {
        failureLogged.value = true
        logger.warn('backdrop.sediment.stopped', 'sediment stepper hit an error and stopped', {
          errorMessage: safe(failure.value),
        })
      }
    }, 2000)
    return () => clearInterval(timer)
  }, [failure, failureLogged])

  return useMemo(
    () => ({
      motionImage,
      memoryImage,
      envelopes,
      tray,
      clockSec,
      failure,
      enqueue(handCode: number, v01: number, seed: number) {
        runOnUI(
          (code: number, strength01: number, s: number) => {
            'worklet'
            const nowSec = clockSec.value
            const splat = splatFromPunch(code, strength01, s)
            const env = envelopes.value
            const boost = detectConvergence(
              env.lastHand,
              env.lastTSec,
              env.lastStrength,
              code,
              nowSec,
              splat.strength,
            )
            const queue = [...pending.value, splat]
            if (boost > 0) queue.push(convergenceSplat(boost, s))
            pending.value = queue.slice(-MAX_PENDING)
            tray.value = kickTray(tray.value, code, splat.strength, s)
            envelopes.value = {
              impact: bumpEnv(env.impact, env.impactStamp, nowSec, IMPACT_TAU_S, 0.12 + strength01 * 0.28),
              impactStamp: nowSec,
              churn: bumpEnv(env.churn, env.churnStamp, nowSec, CHURN_TAU_S, 0.08 + strength01 * 0.22),
              churnStamp: nowSec,
              session: bumpEnv(env.session, env.sessionStamp, nowSec, SESSION_TAU_S, 0.025 + strength01 * 0.075),
              sessionStamp: nowSec,
              left:
                code === 0
                  ? bumpEnv(env.left, env.leftStamp, nowSec, PRESSURE_LR_TAU_S, splat.strength * 0.4)
                  : decayedEnv(env.left, env.leftStamp, nowSec, PRESSURE_LR_TAU_S),
              leftStamp: nowSec,
              right:
                code === 1
                  ? bumpEnv(env.right, env.rightStamp, nowSec, PRESSURE_LR_TAU_S, splat.strength * 0.4)
                  : decayedEnv(env.right, env.rightStamp, nowSec, PRESSURE_LR_TAU_S),
              rightStamp: nowSec,
              lastHand: code,
              lastTSec: nowSec,
              lastStrength: splat.strength,
              lastPunchSec: nowSec,
            }
          },
        )(handCode, v01, seed)
      },
      reset(seed: number) {
        runOnUI((s: number) => {
          'worklet'
          pending.value = []
          tray.value = restingTray()
          envelopes.value = restingEnvelopes()
          seedRequest.value = s
          seededFor.value = Number.NaN
        })(seed)
      },
    }),
    [clockSec, envelopes, failure, memoryImage, motionImage, pending, seedRequest, seededFor, tray],
  )
}
