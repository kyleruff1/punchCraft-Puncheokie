/**
 * The backdrop bus — the app-side implementation of `BackdropImpulsePort`.
 *
 * Sits between the workout runner (JS thread, one call per decoded
 * punch) and whatever scene is currently subscribed (the Skia canvas's
 * UI-thread appender). Best-effort by contract: with no subscriber
 * (backdrop off) or while inactive (non-work phases) an impulse is
 * dropped silently, and a throwing sink is swallowed — a decorative
 * splash may vanish, the punch never does (D17).
 *
 * One bus is created per live-screen mount, so the rolling scaling
 * window inside it is naturally session-scoped.
 */
import type { BackdropImpulsePort, BackdropPunchImpulse } from '@domain/effects/BackdropImpulsePort'
import { HAND_LEFT, HAND_NEUTRAL, HAND_RIGHT } from '@domain/effects/membraneMath'
import { createImpulseScaler } from '@domain/effects/impulseScale'
import { logger, safe } from '@diagnostics/logger'

/** What a scene receives: worklet-friendly plain numbers only. */
export interface BackdropSinkImpulse {
  /** HAND_LEFT / HAND_RIGHT / HAND_NEUTRAL from the hydroPulse module. */
  handCode: number
  /** Normalized 0..1 intensity for this athlete, this session. */
  v01: number
  /** Deterministic variety source for the impulse's particles. */
  seed: number
}

export interface BackdropBus extends BackdropImpulsePort {
  subscribe(sink: (impulse: BackdropSinkImpulse) => void): () => void
  /** Gate impulses to the phases where punches are being thrown. */
  setActive(active: boolean): void
}

export function createBackdropBus(): BackdropBus {
  const sinks = new Set<(impulse: BackdropSinkImpulse) => void>()
  const scaler = createImpulseScaler()
  let active = false
  let counter = 0

  return {
    impulse(punch: BackdropPunchImpulse): void {
      if (!active || sinks.size === 0) return
      counter += 1
      const message: BackdropSinkImpulse = {
        handCode:
          punch.hand === 'left' ? HAND_LEFT : punch.hand === 'right' ? HAND_RIGHT : HAND_NEUTRAL,
        v01: scaler.scale(punch.hand, punch.velocityRaw),
        seed: counter,
      }
      for (const sink of sinks) {
        try {
          sink(message)
        } catch (error) {
          // Decorative layer: log and carry on, never surface upward.
          logger.warn('backdrop.sink.threw', 'backdrop sink threw; impulse dropped', {
            error: safe(String(error)),
          })
        }
      }
    },
    subscribe(sink) {
      sinks.add(sink)
      return () => {
        sinks.delete(sink)
      }
    },
    setActive(next) {
      active = next
    },
  }
}
