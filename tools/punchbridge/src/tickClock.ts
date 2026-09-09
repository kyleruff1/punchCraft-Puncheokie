/**
 * The bridge's rhythmic grid (brass-cube-design "Activity controls speed"):
 * a drift-corrected boundary clock on the shared 60 BPM foundation. The
 * brass engine commits staged harmonic state ONLY when a boundary fires,
 * so rate/layer/chord/rotation changes land on the grid, never mid-step.
 *
 * All timing flows through the injected RampScheduler + BridgeClock, so a
 * fake scheduler drives the whole engine deterministically in tests (R4).
 */
import type { RampScheduler } from './gestureToMidi'
import type { BridgeClock } from './server'

export class TickClock {
  private currentStepMs = 0
  private nextDueMs = 0
  private tickIndex = 0
  private pending: unknown | null = null
  private isRunning = false

  constructor(
    private readonly scheduler: RampScheduler,
    private readonly clock: BridgeClock,
    private readonly onBoundary: (tickIndex: number) => void,
  ) {}

  /** Fires boundary 0 SYNCHRONOUSLY, then schedules ahead. */
  start(stepMs: number): void {
    if (this.isRunning) return
    this.isRunning = true
    this.currentStepMs = stepMs
    this.tickIndex = 0
    this.nextDueMs = this.clock.now()
    this.fire()
  }

  /**
   * Takes effect on the very NEXT interval — `fire` reads the step length
   * AFTER the boundary callback returns, so a rate change issued inside a
   * boundary (the only place the engine calls this) commits exactly ON
   * boundaries, never rescheduling the in-flight step.
   */
  setStepMs(stepMs: number): void {
    this.currentStepMs = stepMs
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

  get stepMs(): number {
    return this.currentStepMs
  }

  private readonly fire = (): void => {
    this.pending = null
    this.onBoundary(this.tickIndex)
    this.tickIndex += 1
    // Drift-corrected: the due time accumulates ideal step lengths; each
    // delay is measured from the REAL clock so scheduler jitter never
    // compounds. currentStepMs is read here, after onBoundary returned.
    this.nextDueMs += this.currentStepMs
    if (!this.isRunning) return
    this.pending = this.scheduler.setTimeout(
      this.fire,
      Math.max(0, this.nextDueMs - this.clock.now()),
    )
  }
}
