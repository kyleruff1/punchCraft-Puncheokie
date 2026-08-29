/**
 * The membrane engine — the tiny stateful half of the reversible
 * backdrop.
 *
 * All physics is closed form in domain (membraneMath): the only state
 * here is the bounded impulse ring and the reaction envelopes. Time
 * comes from Skia's own clock (never paused — a custom paused clock
 * raced its frame callback on fresh mounts and froze frames mid-wave).
 * Visual rest is a CLAMP instead: the scene caps the time it renders
 * with at `lastExpirySec`, the instant everything is sub-visible, so
 * the drawn frame beyond that point is the exact, pristine baseline —
 * and a new punch simply moves the cap forward.
 */
import { useMemo } from 'react'
import { Skia, useClock, type SkRuntimeEffect } from '@shopify/react-native-skia'
import { runOnUI, useSharedValue, type SharedValue } from 'react-native-reanimated'

import {
  CHURN_TAU_S,
  DEBRIS_CAP,
  DEBRIS_TAU_S,
  DUST_TAU_S,
  IMPACT_TAU_S,
  VEIL_TAU_S,
  bumpEnv,
  convergenceImpulse,
  detectConvergence,
  lastExpiry,
  pushImpulse,
  rateOf,
  registerPunchGains,
  spawnImpulse,
  veilWakeOf,
  type MembraneImpulse,
} from '@domain/effects/membraneMath'
import { logger, safe } from '@diagnostics/logger'

/** Spawn-time preset multipliers (uniform knobs travel via tuning). */
export interface MembraneFeel {
  surgeMul: number
  lifeMul: number
  /** Pummel Sensitivity: scales the veil charges only. */
  sensitivityMul: number
}

export interface MembraneEnv {
  impact: number
  impactStamp: number
  churn: number
  churnStamp: number
  /** The Pummel Veil's staged charges — see registerPunchGains. */
  dust: number
  dustStamp: number
  debris: number
  debrisStamp: number
  veil: number
  veilStamp: number
  lastHand: number
  lastTSec: number
  lastStrength: number
}

export interface MembraneEngine {
  ring: SharedValue<MembraneImpulse[]>
  /** Skia's clock, milliseconds — never paused. */
  clockMs: SharedValue<number>
  /** The instant (seconds) everything decays sub-visible — the render cap. */
  lastExpirySec: SharedValue<number>
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
  const clockMs = useClock()
  const lastExpirySec = useSharedValue(0)
  const env = useSharedValue<MembraneEnv>({
    impact: 0,
    impactStamp: 0,
    churn: 0,
    churnStamp: 0,
    dust: 0,
    dustStamp: 0,
    debris: 0,
    debrisStamp: 0,
    veil: 0,
    veilStamp: 0,
    lastHand: 2,
    lastTSec: -10,
    lastStrength: 0,
  })

  return useMemo<MembraneEngine>(() => {
    const push = (handCode: number, v01: number, seed: number, feel: MembraneFeel): void => {
      'worklet'
      const nowSec = clockMs.value / 1000
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
      // Velocity and rate stay distinct: gains read the ring's actual
      // trailing punch rate, so a flurry — not one haymaker — is what
      // feeds the veil.
      const gains = registerPunchGains(v01, rateOf(result.ring, nowSec), feel.sensitivityMul)
      const dust = bumpEnv(prev.dust, prev.dustStamp, nowSec, DUST_TAU_S, gains.dust)
      const debris = bumpEnv(
        prev.debris,
        prev.debrisStamp,
        nowSec,
        DEBRIS_TAU_S,
        gains.debris + spilled * 0.02,
        DEBRIS_CAP,
      )
      const veilCharge = bumpEnv(prev.veil, prev.veilStamp, nowSec, VEIL_TAU_S, gains.veil)
      // The render cap covers whichever outlasts the others: the ring
      // or the veil fades — the clamp must never freeze a dimmed frame.
      const ringEnd = lastExpiry(result.ring)
      const veilEnd = nowSec + veilWakeOf(dust, debris, veilCharge)
      lastExpirySec.value = ringEnd > veilEnd ? ringEnd : veilEnd
      env.value = {
        impact: bumpEnv(prev.impact, prev.impactStamp, nowSec, IMPACT_TAU_S, gains.impact),
        impactStamp: nowSec,
        churn: bumpEnv(
          prev.churn,
          prev.churnStamp,
          nowSec,
          CHURN_TAU_S,
          gains.churn + spilled * 0.05,
        ),
        churnStamp: nowSec,
        dust,
        dustStamp: nowSec,
        debris,
        debrisStamp: nowSec,
        veil: veilCharge,
        veilStamp: nowSec,
        lastHand: handCode,
        lastTSec: nowSec,
        lastStrength: v01,
      }
    }

    return {
      ring,
      clockMs,
      lastExpirySec,
      env,
      enqueue(handCode, v01, seed, feel) {
        runOnUI(push)(handCode, v01, seed, feel)
      },
    }
  }, [ring, clockMs, env, lastExpirySec])
}
