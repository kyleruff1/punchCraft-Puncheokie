/**
 * Worklet-safe mirror of the SESSION work clock (MVP v2, GH #305).
 *
 * The ring walk is moving onto the UI thread: `useFrameCallback` projects
 * the beat cursor per frame instead of riding the runner's ~150-340 ms JS
 * tick — the tick that made ring fires trail the click by a measured mean
 * 209 ms / p95 547 ms at 180 BPM. The projection needs `workElapsedMs` on
 * the UI thread, and this struct is how it gets there.
 *
 * ## Why NOT the transport anchor
 *
 * `SharedTransportAnchor` mirrors the METRONOME transport, which (today)
 * only runs on `metronome.enabled` workouts. The rings run on the SESSION
 * clock (`WorkoutSessionClock.workElapsedMs`) on every workout, and the
 * two must not be conflated even once every workout carries a click — the
 * session clock is the scoring/authority clock.
 *
 * ## The load-bearing semantic: accumulated-with-holes
 *
 * `workElapsedMs` is NOT `now - workStart`. `WorkoutSessionClock`
 * accumulates per-phase deltas (`advance()`), pauses accumulate nothing,
 * and `enterWork` seeds an overflow. So the worklet cannot project from a
 * start timestamp; it projects from the LAST PUBLISH:
 *
 *   workElapsedMs = workElapsedAtPublishMs +
 *                   (frameTimestampMs - publishFrameTimestampMs)   [running]
 *   workElapsedMs = workElapsedAtPublishMs                          [else]
 *
 * The publisher re-anchors at every discontinuity — work-entered (with
 * its overflow), paused, resumed, rest-entered — and NEVER per tick, so
 * the UI thread owns smoothness between anchors.
 *
 * ## Clock domain + atomicity
 *
 * Same contract as `SharedTransportAnchor`: `publishFrameTimestampMs` and
 * the worklet's `frameTimestampMs` must share a domain (the publisher
 * samples the same source Reanimated's frameInfo uses), and every update
 * assigns a NEW frozen struct — never field-wise mutation.
 *
 * Pure TypeScript — no Reanimated import; tests run in plain node.
 */

export interface SharedWorkClock {
  /** Round this clock is counting for; -1 before the first work phase. */
  roundIndex: number
  /** Session work-elapsed at the publish moment (carries enterWork overflow). */
  workElapsedAtPublishMs: number
  /** Publisher-domain timestamp of the publish; worklet frames must share it. */
  publishFrameTimestampMs: number
  /** True only during an unpaused work phase — projection is otherwise frozen. */
  running: boolean
}

/** Baseline before any round starts. */
export const SHARED_WORK_CLOCK_STOPPED: SharedWorkClock = Object.freeze({
  roundIndex: -1,
  workElapsedAtPublishMs: 0,
  publishFrameTimestampMs: 0,
  running: false,
})

/**
 * Project the current work-elapsed ms. Plain function; when called from a
 * real worklet the `'worklet'` directive lives at the call site.
 */
export function sharedWorkElapsedMs(clock: SharedWorkClock, frameTimestampMs: number): number {
  // The directive is LOAD-BEARING, not decoration: without it the Babel
  // workletizer leaves this as a JS-thread function, and the frame
  // callback's call becomes "[Worklets] Tried to synchronously call a
  // Remote Function on the UI Runtime" — an instant red screen on
  // device, invisible to jest (which runs everything on one thread).
  // Same placement as `sharedAnchorCurrentTick`, the proven pattern.
  'worklet'
  if (!clock.running) return clock.workElapsedAtPublishMs
  return clock.workElapsedAtPublishMs + (frameTimestampMs - clock.publishFrameTimestampMs)
}
