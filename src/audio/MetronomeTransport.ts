/**
 * Muted metronome transport — the authoritative unwrapped tick clock
 * (M39-V2 Phase 1, Kyle blueprint 2026-08-30).
 *
 * ## The rule
 *
 * The muted metronome track (see `MetronomePlayer`) runs continuously
 * during work and remains the sole timing authority. Rings, avatar
 * frames, coach dispatch, and tracker acceptance windows all consume
 * the transport's absolute tick — none maintain independent elapsed-
 * time counters.
 *
 * ## Why a facade instead of listening to `expo-audio` position
 *
 * The native metronome loop's `currentTime` wraps every 1 s (loop
 * duration). Publishing a wrapped position would force every consumer
 * to reconstruct absolute time from `(loopCount, currentTime)` pairs.
 * The transport does that reconstruction ONCE and publishes an
 * unwrapped `absoluteTick`.
 *
 * Additionally: `expo-audio`'s status update fires every ~500 ms.
 * A visual dispatcher running at 60 FPS needs sub-16 ms precision.
 * Between status updates the transport interpolates by monotonic
 * elapsed × `ticksPerSecond` — the metronome loop stays the
 * "correctness anchor" (start / stop / drift correction) while the
 * monotonic clock provides the fine-grained interpolation.
 *
 * ## Anchoring
 *
 * `start(baseBpm)` samples `MonotonicClock.now()` and stamps
 * `anchorMonotonicMs`. `absoluteTick` at any later moment is
 * `anchorAbsoluteTick + (now - anchorMonotonicMs) × ticksPerSecond`.
 *
 * `pause()` freezes the tick — the anchor moves forward on `resume()`
 * so the tick continues from where it left off. Position is
 * preserved across pause boundaries.
 *
 * `stop()` resets the tick to 0 on the next `start()`. Every
 * `start()` increments `generation`, so any stale timeline compiled
 * against a prior run can be discarded at dispatch time (Kyle
 * blueprint §11: "stale schedule overlap").
 *
 * ## What this file does NOT own
 *
 * - **Playing the metronome audio.** That's `MetronomePlayer`. This
 *   transport is a pure logical clock — it can run whether or not
 *   the audio actually plays (audio can be muted via `volume: 0`
 *   per the current sample recipes).
 * - **The 50 ms `setInterval` runner tick.** Phase 5 replaces that
 *   with a `useFrameCallback` that reads `snapshot().absoluteTick`.
 *   Phase 1 leaves the runner untouched.
 */

import { logger, safe } from '@/diagnostics/logger'
import type { MonotonicClock } from '@/domain/time/MonotonicClock'
import { systemMonotonicClock } from '@/domain/time/MonotonicClock'
import { TRANSPORT_TICKS_PER_PULSE } from '@/domain/timing/TimingEngine'

export type MetronomeTransportState = 'stopped' | 'running' | 'paused'

export interface MetronomeTransportSnapshot {
  /**
   * Monotonically increasing counter. Incremented on every `start()`
   * — a stale timeline compiled under a prior generation can be
   * rejected by comparing its `generation` against this one.
   */
  generation: number
  state: MetronomeTransportState
  /**
   * Absolute unwrapped tick. Never wraps at loop boundaries. Grows
   * monotonically while the transport is `running`; frozen while
   * `paused`; resets to 0 on the next `start()`.
   */
  absoluteTick: number
  /**
   * `MonotonicClock.now()` at the moment `absoluteTick` was
   * computed. Consumers wanting sub-status-update precision
   * interpolate as `absoluteTick + (now - sampledAtMonotonicMs) ×
   * ticksPerSecond / 1000`.
   */
  sampledAtMonotonicMs: number
  /**
   * `baseBpm × TRANSPORT_TICKS_PER_PULSE / 60`. Zero while stopped.
   * At 60 BPM: 960 ticks/second (~1.04 ms/tick).
   */
  ticksPerSecond: number
  /** Master BPM the transport was started at. Zero while stopped. */
  baseBpm: number
}

export class MetronomeTransport {
  private readonly clock: MonotonicClock
  private generation = 0
  private state: MetronomeTransportState = 'stopped'
  private anchorMonotonicMs = 0
  private anchorAbsoluteTick = 0
  private ticksPerSecond = 0
  private baseBpm = 0

  constructor(clock?: MonotonicClock) {
    this.clock = clock ?? systemMonotonicClock()
  }

  /**
   * Start the transport at `baseBpm`. Increments the generation
   * counter so any pre-existing schedules keyed on the old
   * generation are invalid. Absolute tick resets to 0.
   *
   * Idempotent within a single generation: calling `start` twice
   * with the same BPM while already running re-anchors position at
   * 0 and bumps generation — this matches the "restart cleanly"
   * semantic the runner uses on a `resumed` transition.
   */
  start(baseBpm: number): void {
    if (!Number.isFinite(baseBpm) || baseBpm <= 0) {
      throw new Error(`MetronomeTransport.start: baseBpm must be positive, got ${baseBpm}`)
    }
    this.generation += 1
    this.baseBpm = baseBpm
    this.ticksPerSecond = (baseBpm * TRANSPORT_TICKS_PER_PULSE) / 60
    this.anchorMonotonicMs = this.clock.now()
    this.anchorAbsoluteTick = 0
    this.state = 'running'
    logger.info('puncheokie.transport', 'transport started', {
      generation: safe(this.generation),
      baseBpm: safe(baseBpm),
      ticksPerSecond: safe(this.ticksPerSecond),
    })
  }

  /**
   * Stop the transport. Position is discarded; the next `start()`
   * begins at absoluteTick 0. Used on `rest-entered` / `paused` (as
   * a hard stop, not a resumable pause) / `finishing` / `cancelled`.
   */
  stop(): void {
    if (this.state === 'stopped') return
    this.state = 'stopped'
    this.anchorAbsoluteTick = 0
    this.baseBpm = 0
    this.ticksPerSecond = 0
    logger.info('puncheokie.transport', 'transport stopped', {
      generation: safe(this.generation),
    })
  }

  /**
   * Pause the transport. Absolute tick freezes at the pause point;
   * `resume()` continues from there. Generation does NOT increment
   * — the same timeline stays valid across the pause.
   */
  pause(): void {
    if (this.state !== 'running') return
    this.anchorAbsoluteTick = this.absoluteTickAt(this.clock.now())
    this.state = 'paused'
  }

  /**
   * Resume from a paused position. Re-anchors monotonic time so
   * elapsed math continues from the pause point. Generation
   * unchanged.
   */
  resume(): void {
    if (this.state !== 'paused') return
    this.anchorMonotonicMs = this.clock.now()
    this.state = 'running'
  }

  /**
   * Immutable snapshot of the transport's current state. Callers
   * that need sub-status-update precision interpolate off
   * `sampledAtMonotonicMs` and `ticksPerSecond`.
   */
  snapshot(): MetronomeTransportSnapshot {
    const now = this.clock.now()
    return {
      generation: this.generation,
      state: this.state,
      absoluteTick: this.absoluteTickAt(now),
      sampledAtMonotonicMs: now,
      ticksPerSecond: this.ticksPerSecond,
      baseBpm: this.baseBpm,
    }
  }

  /**
   * Convenience — the absolute tick at `nowMs` (defaults to the
   * current monotonic time). Zero while `stopped`; frozen at the
   * pause point while `paused`.
   */
  currentTick(nowMs?: number): number {
    return this.absoluteTickAt(nowMs ?? this.clock.now())
  }

  /**
   * The absolute tick at an arbitrary monotonic timestamp. Kept
   * `readonly`-friendly so callers can extrapolate a scheduled
   * event's tick target from a known future monotonic moment.
   */
  private absoluteTickAt(nowMs: number): number {
    if (this.state !== 'running') return this.anchorAbsoluteTick
    const elapsedMs = nowMs - this.anchorMonotonicMs
    return this.anchorAbsoluteTick + (elapsedMs / 1_000) * this.ticksPerSecond
  }
}
