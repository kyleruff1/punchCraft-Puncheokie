/**
 * Simulated punch source (M32-01, doc §27 step 2).
 *
 * A first-class implementation of `PunchEventSource`, not a test mock: it
 * ships in dev builds and backs the live screen until M33-01 wires the real
 * trackers in. That is why it models the unpleasant parts of a radio link —
 * latency, jitter and dropped events — rather than delivering a clean
 * stream the live screen would never see in a gym.
 *
 * All time flows through the injected `MonotonicClock`, so a test can run a
 * whole script in microseconds and get the same delivery sequence every
 * run. Wall time appears only in `receivedWallTimeIso`, which is a
 * display/export field and never used for ordering (spec §3.2, §18.3).
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import type { PunchEventSource, PunchEventSourceCapability } from '@domain/punch/PunchEventSource'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'
import type { CancelScheduled, MonotonicClock } from '@domain/time/MonotonicClock'
import { SCRIPT_NOMINAL_BPM, SIM_SCRIPTS, scriptDurationMs, type ScriptStep, type SimScriptId } from './scripts'

export const SIM_DECODER_ID = 'simulated'
export const SIM_DECODER_VERSION = 'sim-1'

/** Gap before a looped script restarts, in beats at the nominal BPM. */
const LOOP_GAP_BEATS = 2

export interface SimOptions {
  clock: MonotonicClock
  script?: SimScriptId
  loop?: boolean
  /** Fixed delivery delay in ms. Default 0. */
  latencyMs?: number
  /** Uniform ±jitter added to `latencyMs`. Default 0. */
  jitterMs?: number
  /** Probability in [0, 1] that a scripted event is dropped. Default 0. */
  dropRate?: number
  /** Emit `velocityRaw` with `velocityUnit: 'tracker-unit'`. Default true. */
  velocity?: boolean
  /** Seeds the jitter/drop stream so a run is reproducible. */
  seed?: string
  /**
   * Wall-clock reader for `receivedWallTimeIso`. Display and export only —
   * never ordering (spec §3.2). Injectable so a test can pin it.
   */
  wallClockIso?: () => string
}

// ---------------------------------------------------------------------------
// Seeded PRNG — mulberry32 over a string hash.
//
// A seeded stream matters more than randomness quality here: "same seed,
// same delivered sequence" is what makes a dropped-event test assertable
// instead of flaky.
// ---------------------------------------------------------------------------

function hashSeed(seed: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------

export class SimulatedPunchSource implements PunchEventSource {
  readonly id = 'sim'
  readonly capability: PunchEventSourceCapability

  private readonly clock: MonotonicClock
  private readonly opts: Required<
    Pick<SimOptions, 'latencyMs' | 'jitterMs' | 'dropRate' | 'velocity' | 'loop'>
  >
  private readonly wallClockIso: () => string
  private readonly listeners = new Set<(event: TrackerPunchEvent) => void>()
  private readonly pending = new Set<CancelScheduled>()

  private random: () => number
  private readonly seed: string
  private started = false
  private sequence = 0
  private defaultScript?: SimScriptId

  constructor(options: SimOptions) {
    this.clock = options.clock
    this.seed = options.seed ?? 'sim-default'
    this.random = mulberry32(hashSeed(this.seed))
    this.defaultScript = options.script
    this.wallClockIso = options.wallClockIso ?? (() => new Date().toISOString())

    this.opts = {
      latencyMs: options.latencyMs ?? 0,
      jitterMs: options.jitterMs ?? 0,
      dropRate: options.dropRate ?? 0,
      velocity: options.velocity ?? true,
      loop: options.loop ?? false,
    }

    // The capability must describe what this source actually does. A source
    // configured without velocity emits no velocity fields, so it must not
    // advertise them (M32-02 resolves the scoring tier from exactly this).
    this.capability = {
      hand: true,
      timestamp: true,
      // The simulator could trivially report technique, but claiming a
      // capability the real hardware lacks (D12) would let the live stack be
      // built against a tier that evaporates at M33-01.
      punchType: 'none',
      velocity: this.opts.velocity,
    }
  }

  subscribe(listener: (event: TrackerPunchEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    if (this.defaultScript) this.playScript(this.defaultScript)
  }

  stop(): void {
    this.started = false
    for (const cancel of this.pending) cancel()
    this.pending.clear()
  }

  /** Reset the random stream so a repeated run reproduces the first one. */
  reseed(): void {
    this.random = mulberry32(hashSeed(this.seed))
  }

  /**
   * Schedule one pass of a script (or repeated passes when `loop` is set).
   *
   * `bpm` rescales the authored offsets, which are written at
   * `SCRIPT_NOMINAL_BPM`, so one script covers every cadence profile.
   */
  playScript(id: SimScriptId, bpm: number = SCRIPT_NOMINAL_BPM): void {
    if (!this.started) return
    const steps = SIM_SCRIPTS[id]
    const scale = SCRIPT_NOMINAL_BPM / bpm

    for (const step of steps) {
      this.scheduleStep(step, step.offsetMs * scale)
    }

    if (this.opts.loop) {
      const beatMs = (60_000 / SCRIPT_NOMINAL_BPM) * scale
      const nextPassAt = scriptDurationMs(steps) * scale + LOOP_GAP_BEATS * beatMs
      this.track(
        this.clock.schedule(nextPassAt, () => {
          this.playScript(id, bpm)
        }),
      )
    }
  }

  /**
   * Emit a single punch, as the SimControls tap pad does.
   *
   * Subject to latency and jitter, but never to `dropRate`: a tap is a
   * direct instruction from whoever is testing, and silently discarding it
   * would look like a bug in the screen rather than a configured condition.
   */
  emitTap(hand: 'left' | 'right'): void {
    if (!this.started) return
    this.scheduleStep({ hand, offsetMs: 0, velocityRaw: hand === 'left' ? 7 : 12 }, 0, {
      droppable: false,
    })
  }

  // -------------------------------------------------------------------------

  private scheduleStep(
    step: ScriptStep,
    baseOffsetMs: number,
    options: { droppable?: boolean } = {},
  ): void {
    const droppable = options.droppable ?? true

    // Draw in a fixed order — drop, then jitter — so a given seed always
    // produces the same delivered sequence regardless of timing. A tap skips
    // the drop draw entirely rather than drawing and ignoring the result, so
    // taps cannot shift the stream a scripted run depends on.
    const dropped =
      droppable && this.opts.dropRate > 0 && this.random() < this.opts.dropRate
    const jitter =
      this.opts.jitterMs > 0 ? (this.random() * 2 - 1) * this.opts.jitterMs : 0
    if (dropped) return

    const delay = Math.max(0, baseOffsetMs + this.opts.latencyMs + jitter)
    this.track(
      this.clock.schedule(delay, () => {
        this.deliver(step)
      }),
    )
  }

  private track(cancel: CancelScheduled): void {
    // Wrap so a fired callback stops holding a cancel handle forever.
    const wrapped: CancelScheduled = () => {
      cancel()
      this.pending.delete(wrapped)
    }
    this.pending.add(wrapped)
  }

  private deliver(step: ScriptStep): void {
    if (!this.started) return
    const event = this.buildEvent(step)
    for (const listener of this.listeners) listener(event)
  }

  private buildEvent(step: ScriptStep): TrackerPunchEvent {
    const n = this.sequence++
    // Stamped at delivery, not at scheduling, so the sequence is monotonic
    // in receivedMonotonicTimeMs even when jitter reorders the schedule.
    const receivedMonotonicTimeMs = this.clock.now()

    const event: TrackerPunchEvent = {
      id: `sim-evt-${n}`,
      sourceFrameId: `sim-frame-${n}`,
      deviceId: step.hand === 'left' ? 'sim-left' : 'sim-right',
      hand: step.hand,
      trackerTimestampMs: receivedMonotonicTimeMs,
      receivedMonotonicTimeMs,
      receivedWallTimeIso: this.wallClockIso(),
      recovered: false,
      decoderId: SIM_DECODER_ID,
      decoderVersion: SIM_DECODER_VERSION,
      velocityUnit: 'unknown',
      qualityFlags: [],
    }

    if (this.opts.velocity) {
      event.velocityRaw = step.velocityRaw ?? 8
      // Tracker units, never a physical unit (spec §4.3).
      event.velocityUnit = 'tracker-unit'
    }

    // Acceleration rides the same gate as velocity: both are raw tracker
    // readings from the same record. Emitted only when the script supplies
    // one, so the existing scripts keep their previous byte-for-byte shape
    // rather than gaining a fabricated axis.
    if (this.opts.velocity && step.accelerationRaw !== undefined) {
      event.accelerationRaw = step.accelerationRaw
    }

    // punchType is deliberately absent: the capability says 'none', and a
    // source that emitted it would let a consumer build on a tier the real
    // hardware cannot reach (D12).
    return event
  }
}
