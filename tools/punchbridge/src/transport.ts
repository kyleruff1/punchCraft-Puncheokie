/**
 * The ONE transport driver (harmonic-field-v2 review amendment 1 +
 * second-pass am. 3): a drift-corrected wakeup loop over the injected
 * RampScheduler/BridgeClock (TickClock's proven pattern) that reports the
 * ABSOLUTE tick position it has reached. 80 ticks is a boundary LATTICE,
 * not a timer promise — consumers derive crossed boundaries from each
 * {previousTick, currentTick} observation via crossedBoundaryIndices, so a
 * stalled scheduler yields one observation spanning many lattice ticks and
 * loses nothing silently; what to do with the backlog (coalesce commits,
 * skip stale steps) is the ENGINE's missed-boundary policy.
 *
 * Due times are computed absolutely from the epoch every firing (never
 * accumulated), so float error cannot drift the grid.
 */
import {
  msForTicks,
  ticksForMs,
  TRANSPORT_GCD_TICKS,
} from '../../../src/domain/instrument/transportGrid'
import type { RampScheduler } from './gestureToMidi'
import type { BridgeClock } from './server'

export interface TransportObservation {
  /** The last tick previously observed (-1 before the first firing). */
  previousTick: number
  /** The lattice tick this firing reached (multiples of the GCD). */
  currentTick: number
  /** How late the wakeup ran vs the tick's ideal wall time (≥ 0). */
  latenessMs: number
}

export class Transport {
  private isRunning = false
  private pending: unknown | null = null
  private epochMs = 0
  private lastTick = -1
  private targetTick = 0

  constructor(
    private readonly scheduler: RampScheduler,
    private readonly clock: BridgeClock,
    private readonly onObservation: (obs: TransportObservation) => void,
  ) {}

  /** Fires the (-1 → 0) observation SYNCHRONOUSLY: first punch = downbeat. */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.epochMs = this.clock.now()
    this.lastTick = -1
    this.targetTick = 0
    this.fire()
  }

  stop(): void {
    if (this.pending !== null) {
      this.scheduler.clearTimeout(this.pending)
      this.pending = null
    }
    this.isRunning = false
  }

  get running(): boolean {
    return this.isRunning
  }

  private readonly fire = (): void => {
    this.pending = null
    const elapsedMs = this.clock.now() - this.epochMs
    // Lateness vs the tick this wakeup was SCHEDULED to reach — the
    // honest stall measure (a late wakeup that happens to land on a
    // lattice time is still late).
    const latenessMs = Math.max(0, elapsedMs - msForTicks(this.targetTick))
    // The lattice tick actually reached: at least the scheduled target
    // (a fake-clock exact firing), further along after a stall.
    const reached = Math.max(
      this.targetTick,
      Math.floor(ticksForMs(elapsedMs) / TRANSPORT_GCD_TICKS) * TRANSPORT_GCD_TICKS,
    )
    const previous = this.lastTick
    this.lastTick = reached
    this.onObservation({
      previousTick: previous,
      currentTick: reached,
      latenessMs,
    })
    if (!this.isRunning) return
    this.targetTick = reached + TRANSPORT_GCD_TICKS
    // Absolute due time from the epoch — no accumulated float drift.
    const dueMs = this.epochMs + msForTicks(this.targetTick)
    this.pending = this.scheduler.setTimeout(this.fire, Math.max(0, dueMs - this.clock.now()))
  }
}
