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
import type {
  MetronomeTransportPort,
  MetronomeTransportSnapshot,
  MetronomeTransportState,
} from '@/domain/coach/VoiceOutputPort'
import type { MonotonicClock } from '@/domain/time/MonotonicClock'
import { systemMonotonicClock } from '@/domain/time/MonotonicClock'
import { TRANSPORT_TICKS_PER_PULSE } from '@/domain/timing/TimingEngine'

// Re-export the shared types so callers already importing them from
// this module keep working. The domain module at
// `@domain/coach/VoiceOutputPort` is the single source of truth.
export type { MetronomeTransportSnapshot, MetronomeTransportState }

/**
 * Bounded-phase-correction thresholds (M39-V2 Phase W0-c). The
 * transport's tick is a JS-side estimate — it drifts against the
 * native audio backend the metronome loop actually plays from.
 * `correct()` accepts an observation from the audio layer (see
 * `AudioPositionObservation`) and either slews the anchor
 * gradually toward observation (small error) or hard re-anchors +
 * bumps generation (large error).
 *
 * Kyle's amended plan, principle #4 — never snap the visual clock
 * BACKWARDS to match a late status callback; when the observation
 * suggests the transport ran slower than JS estimated, hold at
 * the JS estimate and let the audio catch up.
 *
 * Constants exposed so tests can reference the exact thresholds
 * and callers can gate their observation cadence appropriately.
 */
export const PHASE_CORRECTION_LARGE_TICKS = 500 // ~520 ms at 60 BPM
export const PHASE_CORRECTION_MAX_STEP_TICKS = 20 // ~20 ms slew cap per observation

export interface AudioPositionObservation {
  /** Unwrapped absolute tick the audio backend was at when sampled. */
  observedAbsoluteTick: number
  /** MonotonicClock timestamp at which the observation was made. */
  observedAtMonotonicMs: number
  /**
   * The transport generation this observation belongs to. Consumers
   * MUST cache the transport's generation at subscribe time and
   * pass it verbatim — a stale generation means the transport
   * restarted between observation + delivery, and the observation
   * is discarded rather than corrupting the new run.
   */
  observedGeneration: number
}

/**
 * `snapshot()`:
 *   - `absoluteTick`: unwrapped, monotonic while `running`, frozen
 *     while `paused`, resets to 0 on the next `start()`.
 *   - `sampledAtMonotonicMs`: consumers wanting sub-status-update
 *     precision interpolate as `absoluteTick + (now -
 *     sampledAtMonotonicMs) × ticksPerSecond / 1000`.
 *   - `ticksPerSecond`: `baseBpm × TRANSPORT_TICKS_PER_PULSE / 60`
 *     (960 at 60 BPM). Zero while stopped.
 *   - `generation`: bumps on every `start()`; a stale timeline
 *     compiled against a prior generation can be discarded by
 *     comparing its recorded generation to this one.
 */
export class MetronomeTransport implements MetronomeTransportPort {
  private readonly clock: MonotonicClock
  private generation = 0
  private state: MetronomeTransportState = 'stopped'
  private anchorMonotonicMs = 0
  private anchorAbsoluteTick = 0
  private ticksPerSecond = 0
  private baseBpm = 0
  /**
   * Subscribers notified on every state transition (start / stop /
   * pause / resume). Used by the SharedTransportAnchor publisher
   * (W0-b-ii) to keep the Reanimated shared value in sync with the
   * transport. Notification is synchronous — the publisher writes
   * the new anchor before the transition call returns, so a
   * consumer that reads immediately after a transport call sees
   * consistent state.
   */
  private readonly subscribers = new Set<(snapshot: MetronomeTransportSnapshot) => void>()

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
    this.notify()
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
    this.notify()
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
    this.notify()
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
    this.notify()
  }

  /**
   * Absorb an audio-position observation and apply bounded phase
   * correction (M39-V2 Phase W0-c, Kyle amended plan 2026-08-30,
   * principle #4). The transport's JS-side tick estimate drifts
   * against the native audio backend; this method reconciles
   * them without letting the visual clock jump backwards.
   *
   * Behavior:
   *   - Dropped if `state !== 'running'` (paused/stopped: nothing
   *     to correct — the JS anchor is authoritative).
   *   - Dropped if `observedGeneration !== this.generation`
   *     (stale observation from a prior run).
   *   - Dropped if the observation is timestamped IN THE FUTURE
   *     (clock-source mismatch; better to no-op than corrupt).
   *   - Otherwise:
   *     - Project the observation forward from its own timestamp
   *       to `now` at the current `ticksPerSecond`.
   *     - Compute `error = observedTickNow - predictedTickNow`.
   *     - `|error| < PHASE_CORRECTION_LARGE_TICKS` (small):
   *       - `error > 0` (audio ahead of JS): shift `anchorAbsoluteTick`
   *         forward by `min(error, PHASE_CORRECTION_MAX_STEP_TICKS)`.
   *         No `notify()` — inside-generation smoothing is invisible
   *         to subscribers.
   *       - `error < 0` (JS ahead of audio): NO CORRECTION. Snapping
   *         backwards would flicker the visual clock; hold the
   *         estimate and let audio catch up.
   *     - `|error| >= PHASE_CORRECTION_LARGE_TICKS`: hard
   *       re-anchor — bump generation, seed the anchor at
   *       `observedTickNow`, notify subscribers so downstream
   *       score dispatch can re-arm.
   *
   * Not called by the transport itself — the caller (typically a
   * MetronomePlayer status listener) samples the audio position,
   * builds an `AudioPositionObservation`, and invokes this.
   */
  private heldCount = 0
  private heldWorstTicks = 0
  private lastHeldLogMs = 0

  correct(obs: AudioPositionObservation): void {
    if (this.state !== 'running') return
    if (obs.observedGeneration !== this.generation) return
    if (this.ticksPerSecond <= 0) return
    const now = this.clock.now()
    const observationAgeMs = now - obs.observedAtMonotonicMs
    if (observationAgeMs < 0) return // observation from the future — discard
    const predictedTickNow = this.absoluteTickAt(now)
    const observedTickNow =
      obs.observedAbsoluteTick + (observationAgeMs / 1_000) * this.ticksPerSecond
    const errorTicks = observedTickNow - predictedTickNow
    const errorAbs = Math.abs(errorTicks)

    if (errorAbs >= PHASE_CORRECTION_LARGE_TICKS) {
      // NEVER snap the visual clock backwards — the contract stated at
      // the top of this file, which this branch used to violate while
      // the small-error branch honoured it (GH #305). A large NEGATIVE
      // error means JS ran ahead of audio (typically a JS stall being
      // caught up); seeding the anchor at `observedTickNow` rewound the
      // clock ~250-380 ms, and the avatar worklet wraps elapsed time
      // modulo the beat, so every rewind re-entered the flip cycle at an
      // arbitrary phase — a spurious re-strike. ~Half of all storm
      // events carry negative error, so this halves the storm's visual
      // impact by construction. Hold instead, exactly as the small
      // branch does: no anchor change, no generation bump, no notify —
      // nothing observable moved. Audio catches up on its own.
      if (errorTicks < 0) {
        // SUMMARIZED, never per-observation: a broken observation source
        // can call correct() hundreds of times a second (measured: a
        // baseBpm/loop mismatch produced ~500 holds/sec), and logging
        // each one floods the JS thread into a red screen. One line a
        // second carries the same forensic signal.
        this.heldCount += 1
        if (this.heldWorstTicks > errorTicks) this.heldWorstTicks = errorTicks
        const now2 = this.clock.now()
        if (now2 - this.lastHeldLogMs >= 1_000) {
          logger.info('puncheokie.transport', 'transport held on backwards observations', {
            generation: safe(this.generation),
            held: safe(this.heldCount),
            worstErrorTicks: safe(this.heldWorstTicks),
          })
          this.lastHeldLogMs = now2
          this.heldCount = 0
          this.heldWorstTicks = 0
        }
        return
      }
      this.generation += 1
      this.anchorMonotonicMs = now
      this.anchorAbsoluteTick = observedTickNow
      logger.info('puncheokie.transport', 'transport re-anchored on audio observation', {
        generation: safe(this.generation),
        errorTicks: safe(errorTicks),
      })
      this.notify()
      return
    }

    // Small error, audio ahead of JS: slew forward, capped.
    // Small error, JS ahead of audio: hold — visual monotonicity wins.
    if (errorTicks > 0) {
      const step = Math.min(errorTicks, PHASE_CORRECTION_MAX_STEP_TICKS)
      this.anchorAbsoluteTick += step
    }
  }

  /**
   * Report an external audio-session disruption — a Bluetooth
   * route change, an iOS interruption, an Android app-background
   * pause, a native player restart — anything that leaves the
   * audio backend at a position the JS transport can no longer
   * trust (M39-V2 Phase W0-d, Kyle amended plan 2026-08-30,
   * principle #20).
   *
   * Behavior:
   *   - When `state !== 'running'`: no-op (nothing to invalidate).
   *   - Otherwise: preserve the CURRENT tick (workout position
   *     is unchanged from the athlete's perspective), bump
   *     generation (so any timeline compiled against the prior
   *     generation is rejected + re-armed by score dispatch),
   *     re-anchor the monotonic reference to `now`, and notify
   *     subscribers.
   *
   * The tick does NOT reset to 0 — that would be `stop()` →
   * `start()`. A disruption is a break in the AUDIO PIPELINE, not
   * a break in the athlete's workout: they're still throwing
   * punches; only the coach's schedule needs to be re-armed
   * because it may have missed events during the disruption
   * window.
   *
   * Callers (typically the runner reacting to expo-audio
   * interruption events, or the metronome player noticing a
   * playlist restart) supply a short `reason` string for the
   * diagnostic log.
   */
  notifyDisruption(reason: string): void {
    if (this.state !== 'running') return
    const now = this.clock.now()
    const currentTick = this.absoluteTickAt(now)
    this.generation += 1
    this.anchorMonotonicMs = now
    this.anchorAbsoluteTick = currentTick
    logger.info('puncheokie.transport', 'transport disrupted — generation bumped', {
      generation: safe(this.generation),
      reason: safe(reason),
      absoluteTick: safe(currentTick),
    })
    this.notify()
  }

  /**
   * Subscribe to state transitions (M39-V2 Phase W0-b-ii). The
   * callback fires synchronously on every `start` / `stop` /
   * `pause` / `resume` with a fresh snapshot; use it to keep a
   * derived value (e.g., the SharedTransportAnchor Reanimated
   * shared value) in sync with the transport. Returns an
   * unsubscribe function — call it on unmount to avoid leaking
   * the callback across component lifetimes.
   *
   * Subscribers are NOT called for the initial state — a consumer
   * that needs it should read `snapshot()` immediately after
   * subscribing. This matches the "publish-on-change" contract
   * and avoids a synchronous side-effect during subscribe.
   *
   * `notifyDisruption` also fires this callback (see above).
   */
  subscribe(cb: (snapshot: MetronomeTransportSnapshot) => void): () => void {
    this.subscribers.add(cb)
    return () => {
      this.subscribers.delete(cb)
    }
  }

  private notify(): void {
    if (this.subscribers.size === 0) return
    const snap = this.snapshot()
    for (const cb of this.subscribers) {
      try {
        cb(snap)
      } catch (error) {
        // Swallow: a rogue subscriber must not corrupt the
        // transport's own state or block other subscribers.
        logger.warn('puncheokie.transport', 'subscriber threw', {
          error: safe(String(error)),
        })
      }
    }
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
