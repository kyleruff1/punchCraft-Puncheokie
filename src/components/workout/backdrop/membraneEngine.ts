/**
 * The membrane engine — the tiny stateful half of the reversible
 * backdrop.
 *
 * All physics is closed form in domain (membraneMath): the only state
 * here is the bounded impulse ring, the churn envelope, and a paused-
 * while-asleep clock. No offscreen surfaces, no simulation passes, no
 * snapshots — the display shader evaluates the ring analytically every
 * frame, and when the last impulse expires the clock freezes, so the
 * recorder redraws a constant, exactly-baseline frame.
 *
 * The clock counts AWAKE seconds (not wall time): while asleep it
 * holds, and a new punch starts its impulse at the held value, so the
 * wave begins the instant the pane wakes.
 */
import { useMemo } from 'react'
import { Skia, type SkRuntimeEffect } from '@shopify/react-native-skia'
import {
  runOnUI,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated'

import {
  CHURN_TAU_S,
  DARKNESS_TAU_S,
  SLEEP_GRACE_S,
  bumpEnv,
  churnGainOf,
  convergenceImpulse,
  darknessGainOf,
  darknessWakeOf,
  detectConvergence,
  lastExpiry,
  pushImpulse,
  spawnImpulse,
  type MembraneImpulse,
} from '@domain/effects/membraneMath'
import { logger, safe } from '@diagnostics/logger'

/** Spawn-time preset multipliers (uniform knobs travel via tuning). */
export interface MembraneFeel {
  surgeMul: number
  lifeMul: number
}

export interface MembraneEnv {
  churn: number
  churnStamp: number
  /** Blackout saturation, 0..1 — see darknessGainOf. */
  dark: number
  darkStamp: number
  lastHand: number
  lastTSec: number
  lastStrength: number
}

export interface MembraneEngine {
  ring: SharedValue<MembraneImpulse[]>
  clockSec: SharedValue<number>
  env: SharedValue<MembraneEnv>
  /** Enqueue one punch (JS thread; hops to the UI thread itself). */
  enqueue(handCode: number, v01: number, seed: number, feel: MembraneFeel): void
}

const effectCache = new Map<string, SkRuntimeEffect | null>()

/** Lazy, cached, throw-safe RuntimeEffect factory (Make throws jsi). */
export function compileMembraneEffect(source: string, label: string): SkRuntimeEffect | null {
  const cached = effectCache.get(source)
  if (cached !== undefined) return cached
  let effect: SkRuntimeEffect | null = null
  try {
    effect = Skia.RuntimeEffect.Make(source)
  } catch (err) {
    logger.warn('backdrop.shader.compile', 'membrane shader failed to compile', {
      label: safe(label),
      errorMessage: safe(err instanceof Error ? err.message : String(err)),
    })
  }
  effectCache.set(source, effect)
  return effect
}

export function useMembraneEngine(): MembraneEngine {
  const ring = useSharedValue<MembraneImpulse[]>([])
  const clockSec = useSharedValue(0)
  const lastExpirySec = useSharedValue(0)
  const env = useSharedValue<MembraneEnv>({
    churn: 0,
    churnStamp: 0,
    dark: 0,
    darkStamp: 0,
    lastHand: 2,
    lastTSec: -10,
    lastStrength: 0,
  })

  useFrameCallback((info) => {
    'worklet'
    // Asleep: everything expired — hold the clock so the uniforms (and
    // the drawn frame) freeze at exact baseline until the next punch.
    if (clockSec.value > lastExpirySec.value + SLEEP_GRACE_S) return
    const dtMs = info.timeSincePreviousFrame ?? 16
    clockSec.value += Math.min(dtMs / 1000, 0.1)
  })

  return useMemo<MembraneEngine>(() => {
    const push = (handCode: number, v01: number, seed: number, feel: MembraneFeel): void => {
      'worklet'
      const nowSec = clockSec.value
      const prev = env.value
      const boost = detectConvergence(
        prev.lastHand,
        prev.lastTSec,
        prev.lastStrength,
        handCode,
        nowSec,
        v01,
      )

      let impulse = spawnImpulse(handCode, v01, seed, nowSec)
      if (feel.surgeMul !== 1 || feel.lifeMul !== 1) {
        impulse = {
          ...impulse,
          amplitude: impulse.amplitude * feel.surgeMul,
          lifetimeSec: impulse.lifetimeSec * feel.lifeMul,
        }
      }
      let result = pushImpulse(ring.value, impulse, nowSec)
      let spilled = result.spilled
      if (boost > 0) {
        const center = convergenceImpulse(boost, seed * 31 + 7, nowSec)
        const again = pushImpulse(result.ring, center, nowSec)
        result = again
        spilled += again.spilled
      }

      ring.value = result.ring
      const dark = bumpEnv(
        prev.dark,
        prev.darkStamp,
        nowSec,
        DARKNESS_TAU_S,
        darknessGainOf(v01) + spilled * 0.03,
      )
      // The wake window covers whichever outlasts the other: the ring
      // or the blackout fade — sleep must never freeze a dimmed frame.
      const ringEnd = lastExpiry(result.ring)
      const darkEnd = nowSec + darknessWakeOf(dark)
      lastExpirySec.value = ringEnd > darkEnd ? ringEnd : darkEnd
      env.value = {
        churn: bumpEnv(
          prev.churn,
          prev.churnStamp,
          nowSec,
          CHURN_TAU_S,
          churnGainOf(v01) + spilled * 0.05,
        ),
        churnStamp: nowSec,
        dark,
        darkStamp: nowSec,
        lastHand: handCode,
        lastTSec: nowSec,
        lastStrength: v01,
      }
    }

    return {
      ring,
      clockSec,
      env,
      enqueue(handCode, v01, seed, feel) {
        runOnUI(push)(handCode, v01, seed, feel)
      },
    }
  }, [ring, clockSec, env, lastExpirySec])
}
