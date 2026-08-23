/**
 * Monotonic clock port (spec §3.2, §18.3).
 *
 * Ordering and timers use monotonic time; wall time is for display and
 * export only. Everything that schedules — the simulated punch source, the
 * cue engine, the workout clock — takes its time through this port, so a
 * test can drive an entire session forward without a real timer and without
 * the suite taking as long as the workout.
 *
 * `schedule` is part of the contract rather than a separate concern because
 * a clock you can read but not schedule against still forces callers back
 * onto `setTimeout`, which is exactly what makes timing code untestable.
 *
 * NOTE: #111 (M20-05) owns the canonical `MonotonicClock`. This declaration
 * is structural and deliberately minimal so the two can be reconciled to a
 * single import when that lands.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

/** Cancels a scheduled callback. Calling it twice is safe. */
export type CancelScheduled = () => void

export interface MonotonicClock {
  /** Milliseconds from an arbitrary origin. Never decreases. */
  now(): number
  /**
   * Run `callback` after at least `delayMs`. A negative or zero delay runs
   * on the next tick, never synchronously — so a caller can always cancel.
   */
  schedule(delayMs: number, callback: () => void): CancelScheduled
}

/**
 * The real clock: `performance.now()` where available, falling back to
 * `Date.now()` where it is not.
 *
 * The fallback is not monotonic across a wall-clock adjustment, which is
 * precisely what this port exists to avoid — so it is a last resort, and
 * `performance.now` is present on every runtime this app targets.
 */
export function systemMonotonicClock(): MonotonicClock {
  const readNow =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? () => performance.now()
      : () => Date.now()

  return {
    now: readNow,
    schedule(delayMs, callback) {
      const handle = setTimeout(callback, Math.max(0, delayMs))
      return () => clearTimeout(handle)
    },
  }
}
