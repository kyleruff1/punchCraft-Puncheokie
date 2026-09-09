/**
 * Deterministic time + MIDI capture for bridge tests: a FakeClock, a
 * due-time-ordered TimedFakeScheduler (advance(ms) fires every timer in
 * order against real millisecond arithmetic), and a TimedFakeMidi that
 * stamps each message with the fake clock. Extracted for the M40-17
 * harmonic-grid suite; brassArpEngine.test.ts keeps its original local
 * copies untouched (it IS the legacy byte-equal capture).
 */
import { NOTE_OFF, NOTE_ON, type MidiOutputBackend } from './midiBackend'
import type { RampScheduler } from './gestureToMidi'
import type { BridgeClock } from './server'

export class FakeClock implements BridgeClock {
  t = 0
  now(): number {
    return this.t
  }
}

interface FakeTimer {
  dueMs: number
  periodMs: number | null
  fn: () => void
}

export class TimedFakeScheduler implements RampScheduler {
  private nextId = 1
  private readonly timers = new Map<number, FakeTimer>()

  constructor(private readonly clock: FakeClock) {}

  setInterval(fn: () => void, ms: number): unknown {
    const id = this.nextId++
    this.timers.set(id, { dueMs: this.clock.t + ms, periodMs: ms, fn })
    return id
  }

  clearInterval(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++
    this.timers.set(id, { dueMs: this.clock.t + ms, periodMs: null, fn })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number)
  }

  /** Fire every timer due within the window, in due-time order. */
  advance(ms: number): void {
    const end = this.clock.t + ms
    for (;;) {
      let bestId: number | null = null
      let best: FakeTimer | null = null
      for (const [id, timer] of this.timers) {
        if (timer.dueMs > end) continue
        if (best === null || timer.dueMs < best.dueMs || (timer.dueMs === best.dueMs && id < bestId!)) {
          bestId = id
          best = timer
        }
      }
      if (best === null || bestId === null) break
      this.clock.t = Math.max(this.clock.t, best.dueMs)
      if (best.periodMs === null) this.timers.delete(bestId)
      else best.dueMs += best.periodMs
      best.fn()
    }
    this.clock.t = end
  }
}

/**
 * A scheduler whose timeouts fire ONLY when the test says so — the stall
 * simulator. `stallUntil(ms)` moves the clock past due times without
 * firing, then releases the earliest pending timer LATE, exactly how a
 * blocked event loop wakes up.
 */
export class ManualScheduler implements RampScheduler {
  private nextId = 1
  readonly pending = new Map<number, { dueMs: number; fn: () => void }>()

  constructor(private readonly clock: FakeClock) {}

  setInterval(fn: () => void, ms: number): unknown {
    return this.setTimeout(fn, ms) // engine never uses intervals
  }

  clearInterval(handle: unknown): void {
    this.pending.delete(handle as number)
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId++
    this.pending.set(id, { dueMs: this.clock.t + ms, fn })
    return id
  }

  clearTimeout(handle: unknown): void {
    this.pending.delete(handle as number)
  }

  /** Fire the earliest pending timer NOW (possibly long past due). */
  fireNext(): void {
    let bestId: number | null = null
    let best: { dueMs: number; fn: () => void } | null = null
    for (const [id, timer] of this.pending) {
      if (best === null || timer.dueMs < best.dueMs) {
        bestId = id
        best = timer
      }
    }
    if (bestId === null || best === null) return
    this.pending.delete(bestId)
    best.fn()
  }

  /** Advance the clock WITHOUT firing anything — the stall itself. */
  stallUntil(ms: number): void {
    this.clock.t = ms
  }

  /** Fire timers in due order while their due time ≤ the clock. */
  drainDue(): void {
    for (;;) {
      let bestId: number | null = null
      let best: { dueMs: number; fn: () => void } | null = null
      for (const [id, timer] of this.pending) {
        if (timer.dueMs > this.clock.t) continue
        if (best === null || timer.dueMs < best.dueMs) {
          bestId = id
          best = timer
        }
      }
      if (bestId === null || best === null) return
      this.pending.delete(bestId)
      best.fn()
    }
  }
}

export class TimedFakeMidi implements MidiOutputBackend {
  readonly portName = 'fake'
  readonly isReal = false
  readonly sent: Array<{ atMs: number; bytes: number[] }> = []
  allNotesOffCount = 0

  constructor(private readonly clock: FakeClock) {}

  send(bytes: readonly number[]): void {
    this.sent.push({ atMs: this.clock.t, bytes: [...bytes] })
  }

  allNotesOff(): void {
    this.allNotesOffCount += 1
  }

  close(): void {}

  onsAt(channel: number): Array<{ atMs: number; note: number; velocity: number }> {
    return this.sent
      .filter((m) => m.bytes[0] === (NOTE_ON | channel) && m.bytes[2]! > 0)
      .map((m) => ({ atMs: m.atMs, note: m.bytes[1]!, velocity: m.bytes[2]! }))
  }

  offsAt(channel: number): Array<{ atMs: number; note: number }> {
    return this.sent
      .filter(
        (m) =>
          m.bytes[0] === (NOTE_OFF | channel) ||
          (m.bytes[0] === (NOTE_ON | channel) && m.bytes[2] === 0),
      )
      .map((m) => ({ atMs: m.atMs, note: m.bytes[1]! }))
  }
}
