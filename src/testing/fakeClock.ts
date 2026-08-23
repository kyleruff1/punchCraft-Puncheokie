/**
 * Deterministic `MonotonicClock` for tests.
 *
 * Time only moves when a test moves it. `advance(ms)` fires every callback
 * whose due time falls inside the interval, **in due-time order**, and each
 * callback observes `now()` equal to its own due time rather than the end of
 * the interval — so a callback that schedules another callback lands at the
 * right place instead of being pushed to the end of the jump.
 *
 * Not a jest mock: the sim, the cue engine and the workout clock all take a
 * `MonotonicClock`, so one shared fake keeps their suites consistent.
 */
import type { CancelScheduled, MonotonicClock } from '@domain/time/MonotonicClock'

interface Scheduled {
  id: number
  dueAtMs: number
  callback: () => void
}

export interface FakeClock extends MonotonicClock {
  /** Move time forward, firing everything that comes due. */
  advance(ms: number): void
  /** Jump straight to an absolute time. Must not move backwards. */
  advanceTo(timeMs: number): void
  /** Callbacks still waiting. */
  pendingCount(): number
}

export function createFakeClock(startMs = 0): FakeClock {
  let current = startMs
  let nextId = 0
  let scheduled: Scheduled[] = []

  function fire(untilMs: number): void {
    // Re-scan each pass: a callback may schedule more work inside the same
    // window, and that work must still run in due-time order.
    for (;;) {
      const due = scheduled
        .filter((s) => s.dueAtMs <= untilMs)
        .sort((a, b) => a.dueAtMs - b.dueAtMs || a.id - b.id)
      const next = due[0]
      if (!next) break
      scheduled = scheduled.filter((s) => s.id !== next.id)
      current = next.dueAtMs
      next.callback()
    }
    current = untilMs
  }

  return {
    now: () => current,

    schedule(delayMs: number, callback: () => void): CancelScheduled {
      const id = nextId++
      scheduled.push({ id, dueAtMs: current + Math.max(0, delayMs), callback })
      return () => {
        scheduled = scheduled.filter((s) => s.id !== id)
      }
    },

    advance(ms: number): void {
      if (ms < 0) throw new Error('FakeClock cannot move backwards')
      fire(current + ms)
    },

    advanceTo(timeMs: number): void {
      if (timeMs < current) throw new Error('FakeClock cannot move backwards')
      fire(timeMs)
    },

    pendingCount: () => scheduled.length,
  }
}
