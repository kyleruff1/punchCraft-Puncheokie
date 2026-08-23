/**
 * TrackerPunchEventSource — the real FightCamp v1 stream behind the
 * `PunchEventSource` port (M33-01, doc §27 step 6).
 *
 * `SimulatedPunchSource` proved the live stack; this is the production
 * implementation of the same contract, so swapping one for the other
 * changes no consumer code. The port stays exactly as M32-01 wrote it —
 * synchronous `start()` / `stop()`, `subscribe()` returning an
 * unsubscribe — and this class does the async work behind that shape.
 *
 * ## Why this lives in `src/protocol/` and not `src/ble/`
 *
 * It implements a **domain** port and therefore imports from
 * `src/domain/**`. `src/ble/` is the transport layer and does not depend on
 * the domain (see the header of `BleManagerFacade.ts`), so putting it there
 * would invert the dependency direction (spec §15.1). `src/protocol/` is
 * already the layer that turns transport frames into `TrackerPunchEvent`s —
 * this class is the subscription-shaped face of `PunchStream`, which lives
 * right next to it.
 *
 * ## What this source can honestly claim (D12)
 *
 * FightCamp v1 gives the hand (from the connection slot), a tracker
 * timestamp, and a tracker-reported velocity in tracker units. Its type byte
 * carries no device-portable meaning — H12 refuted that on hardware, and the
 * decoder maps every value to `'unknown'` — so `punchType` is `'none'` and
 * `resolveCapabilityTier` settles at `hand-timestamp`, NOT
 * `hand-broad-type`. #187 was written before D12 and still says
 * `hand-broad-type`; D12 supersedes it.
 *
 * ## Hand comes from the slot, never from the payload (H11)
 *
 * Each connected tracker gets its own `startPunchStream` with an explicit
 * `hand`. The stamped hand is re-applied here on the way out, so the
 * guarantee holds at this boundary regardless of what any decoder puts in
 * the field.
 *
 * ## Persistence
 *
 * There is deliberately no persistence hook here. Every raw frame is written
 * by the transport before it reaches any subscriber
 * (`BleManagerFacade.setFrameSink`, CLAUDE.md §1, §11.9, §12.4). Adding a
 * second path would double-write and could reorder.
 *
 * ## Writes
 *
 * None beyond `adapter.buildInitializationPlan`, which `PunchStream` already
 * executes. This class issues no GATT operation of its own (CLAUDE.md §4,
 * §12.1).
 *
 * Pure TypeScript. No RN / Expo / SQLite / BLE-library imports.
 */

import type { BleManagerFacade, UnsubscribeFn } from '@ble/BleManagerFacade'
import type { ConnectionStatus } from '@ble/bleTypes'
import type { TrackerPunchEvent } from '@domain/punch/PunchEvent'
import type { PunchEventSource, PunchEventSourceCapability } from '@domain/punch/PunchEventSource'
import { resolveCapabilityTier, type ResolvedCapability } from '@domain/workout/capabilityTier'
import { deviceSensitive, logger, safe } from '@diagnostics/logger'

import {
  startPunchStream as startPunchStreamImpl,
  type PunchStreamController,
  type PunchStreamOptions,
} from './PunchStream'
import type { TrackerProtocolAdapter } from './TrackerProtocolAdapter'

export type TrackerSourceHand = 'left' | 'right'

export interface TrackerSlotBinding {
  deviceId: string
}

/**
 * Seam for tests: the default is the real `startPunchStream`. Injecting a
 * fake is what lets the whole class be exercised on Windows with no
 * Bluetooth hardware and no BLE library loaded.
 */
export type StartPunchStreamFn = (
  options: PunchStreamOptions,
) => Promise<PunchStreamController>

export interface TrackerPunchEventSourceOptions {
  facade: BleManagerFacade
  adapter: TrackerProtocolAdapter
  /** Slot → device, from `useTrackerStore`. An absent slot is simply not streamed. */
  slots: { left?: TrackerSlotBinding; right?: TrackerSlotBinding }
  /**
   * What the decoder behind `adapter` can actually report. Defaults to the
   * FightCamp v1 contract; a decoder that could genuinely classify technique
   * would pass its own rather than have a tier hardcoded here.
   */
  capability?: PunchEventSourceCapability
  startStream?: StartPunchStreamFn
}

/**
 * What the FightCamp v1 decoder emits on every punch: the slot's hand, a
 * tracker timestamp, and a tracker-reported velocity in tracker units —
 * and no technique, per D12.
 */
export const FIGHTCAMP_V1_SOURCE_CAPABILITY: PunchEventSourceCapability = {
  hand: true,
  timestamp: true,
  punchType: 'none',
  velocity: true,
}

/**
 * How many observed events back `observedCapability()`.
 *
 * Bounded on purpose: the tier question is answered by the first handful of
 * punches, and an unbounded array would grow for the length of a workout to
 * tell us nothing new.
 */
export const CAPABILITY_SAMPLE_SIZE = 20

interface SlotRuntime {
  hand: TrackerSourceHand
  deviceId: string
  controller: PunchStreamController | null
  /** Bumped on every arm/disarm so a late `startPunchStream` resolve is discarded. */
  generation: number
  armed: boolean
  unwatch: UnsubscribeFn | null
}

export class TrackerPunchEventSource implements PunchEventSource {
  readonly id = 'tracker'
  readonly capability: PunchEventSourceCapability

  private readonly facade: BleManagerFacade
  private readonly adapter: TrackerProtocolAdapter
  private readonly startStream: StartPunchStreamFn
  private readonly listeners = new Set<(event: TrackerPunchEvent) => void>()
  private readonly runtimes: SlotRuntime[] = []
  private readonly sample: TrackerPunchEvent[] = []

  private started = false

  constructor(options: TrackerPunchEventSourceOptions) {
    this.facade = options.facade
    this.adapter = options.adapter
    this.capability = options.capability ?? FIGHTCAMP_V1_SOURCE_CAPABILITY
    this.startStream = options.startStream ?? startPunchStreamImpl

    for (const hand of ['left', 'right'] as const) {
      const slot = options.slots[hand]
      if (!slot) continue
      this.runtimes.push({
        hand,
        deviceId: slot.deviceId,
        controller: null,
        generation: 0,
        armed: false,
        unwatch: null,
      })
    }
  }

  /** Slots this source will stream, in L-then-R order. */
  get hands(): readonly TrackerSourceHand[] {
    return this.runtimes.map((r) => r.hand)
  }

  subscribe(listener: (event: TrackerPunchEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Idempotent, like the simulator's. One `startPunchStream` per assigned
   * slot; left and right are separate GATT connections and share nothing.
   */
  start(): void {
    if (this.started) return
    this.started = true

    for (const runtime of this.runtimes) {
      this.watchConnection(runtime)
      this.arm(runtime)
    }

    logger.info('puncheokie.tracker-source.start', 'tracker punch source armed', {
      adapterId: safe(this.adapter.id),
      adapterVersion: safe(this.adapter.version),
      slots: safe(this.runtimes.length),
    })
  }

  /** Stops delivery and tears down every stream, including any still starting. */
  stop(): void {
    if (!this.started) return
    this.started = false

    for (const runtime of this.runtimes) {
      this.disarm(runtime)
      if (runtime.unwatch) {
        try {
          runtime.unwatch()
        } catch {
          // Idempotent; swallow.
        }
        runtime.unwatch = null
      }
    }
  }

  /**
   * The tier resolved from traffic that actually arrived (#187 AC).
   *
   * `capability` above is the declaration a consumer reads; this is the
   * check against reality. On FightCamp v1 the two agree at
   * `hand-timestamp`. Before the first punch it resolves to `hand-only`,
   * because an empty sample tells you nothing (spec §4.2).
   */
  observedCapability(): ResolvedCapability {
    return resolveCapabilityTier({ observedEvents: this.sample })
  }

  // -------------------------------------------------------------------------

  private arm(runtime: SlotRuntime): void {
    if (!this.started || runtime.armed) return
    const generation = ++runtime.generation
    runtime.armed = true

    this.startStream({
      facade: this.facade,
      deviceId: runtime.deviceId,
      adapter: this.adapter,
      hand: runtime.hand,
      onEvent: (event) => {
        this.deliver(runtime, generation, event)
      },
    })
      .then((controller) => {
        // stop() or a drop fired while the init plan was in flight.
        if (!this.started || generation !== runtime.generation) {
          void controller.stop()
          return
        }
        runtime.controller = controller
      })
      .catch((err: unknown) => {
        if (generation === runtime.generation) runtime.armed = false
        logger.error('puncheokie.tracker-source.start.error', 'startPunchStream threw', {
          hand: safe(runtime.hand),
          deviceId: deviceSensitive(runtime.deviceId),
          errorMessage: safe(err instanceof Error ? err.message : String(err)),
        })
      })
  }

  private disarm(runtime: SlotRuntime): void {
    runtime.generation += 1
    runtime.armed = false
    const controller = runtime.controller
    runtime.controller = null
    if (controller) void controller.stop()
  }

  /**
   * Re-arm a slot that comes back (§19.3, #110).
   *
   * A tracker dropping mid-workout loses its GATT subscription; the session
   * itself keeps running, so when the slot returns to ready the stream is
   * rebuilt rather than the workout restarted. The degraded warning in
   * between is the screen's job — this class does not own UI state.
   */
  private watchConnection(runtime: SlotRuntime): void {
    try {
      runtime.unwatch = this.facade.onConnectionChange(
        runtime.deviceId,
        (status: ConnectionStatus) => {
          if (!this.started) return
          const live = status.state === 'ready' || status.state === 'streaming'
          if (!live) {
            if (runtime.armed) this.disarm(runtime)
            return
          }
          if (!runtime.armed) this.arm(runtime)
        },
      )
    } catch (err) {
      logger.warn('puncheokie.tracker-source.watch.error', 'onConnectionChange threw', {
        hand: safe(runtime.hand),
        deviceId: deviceSensitive(runtime.deviceId),
        errorMessage: safe(err instanceof Error ? err.message : String(err)),
      })
    }
  }

  private deliver(
    runtime: SlotRuntime,
    generation: number,
    event: TrackerPunchEvent,
  ): void {
    if (!this.started || generation !== runtime.generation) return

    // Hand is a property of the connection slot, not of the bytes (H11).
    // PunchStream already stamps it before the decoder runs; re-applying it
    // here makes the guarantee hold at this boundary too.
    const stamped: TrackerPunchEvent =
      event.hand === runtime.hand ? event : { ...event, hand: runtime.hand }

    if (this.sample.length < CAPABILITY_SAMPLE_SIZE) this.sample.push(stamped)

    for (const listener of this.listeners) listener(stamped)
  }
}
