/**
 * Fake clock + tick scripter for the M32-09 cue suites.
 *
 * Deviation from the issue's Interfaces block, recorded deliberately: the
 * deterministic `MonotonicClock` already exists at `@testing/fakeClock` and
 * is shared with the simulation and workout-clock suites, so `makeFakeClock`
 * re-exports it rather than adding a second implementation that could drift.
 * What this file really adds is the **tick scripter** — the part that makes a
 * granularity property testable at all.
 *
 * The scripter keeps two clocks deliberately separate:
 *
 *   - `workElapsedMs`, the only time base the engine schedules against, and
 *   - the monotonic clock, which the engine only ever *stamps* into
 *     `*ActualMs` fields.
 *
 * Driving them independently is what lets "work clock frozen, wall clock
 * running" be expressed, and what lets the same work-clock journey be
 * replayed at 10ms, 200ms and one-giant-tick granularity.
 *
 * Pure TypeScript; no timers, no `Date.now()` (spec §15.1, §18.3).
 */

import { CueEngine, DEFAULT_LEAD_TIMES } from '../../CueEngine'
import { createFakeClock, type FakeClock } from '@testing/fakeClock'
import type { CueEngineLeadTimes } from '../../CueEngine'
import type { CueEvent, CueStatus } from '../../CueState'
import type { RoundTimeline } from '../../CueTimeline'

/** The binding name from the issue's Interfaces block. */
export function makeFakeClock(startMs = 0): FakeClock {
  return createFakeClock(startMs)
}

/** Every `CueEvent` except `token-due`, which carries no status/timestamps. */
export type LifecycleEvent = Exclude<CueEvent, { type: 'token-due' }>

export function isLifecycle(event: CueEvent): event is LifecycleEvent {
  return event.type !== 'token-due'
}

export interface RoundRun {
  engine: CueEngine
  clock: FakeClock
  events: CueEvent[]
  /** Work-elapsed time the scripter has reached. */
  atMs: () => number
  /** Advance the work clock (and the monotonic clock with it) to `toMs`. */
  driveTo: (toMs: number, stepMs?: number) => void
}

export interface RunOptions {
  roundIndex?: number
  stepMs?: number
  leadTimes?: CueEngineLeadTimes
  /** Called once work has been entered, before any tick. */
  onStart?: (run: RoundRun) => void
}

/**
 * Build an engine over `timeline`, enter work, and hand back a scripter.
 *
 * Nothing is ticked until `driveTo` is called, so a test can install
 * matches or pause the session before the first tick.
 */
export function startRound(timeline: RoundTimeline[], opts: RunOptions = {}): RoundRun {
  const clock = createFakeClock()
  const engine = new CueEngine(timeline, {
    leadTimes: opts.leadTimes ?? DEFAULT_LEAD_TIMES,
    clock,
  })
  const events: CueEvent[] = []
  engine.subscribe((e) => events.push(e))
  engine.onSessionPhase({
    type: 'work-entered',
    roundIndex: opts.roundIndex ?? 0,
    nowMs: clock.now(),
  })

  let at = 0
  const defaultStep = opts.stepMs ?? 50

  const run: RoundRun = {
    engine,
    clock,
    events,
    atMs: () => at,
    driveTo(toMs: number, stepMs: number = defaultStep): void {
      while (at < toMs) {
        const next = Math.min(toMs, at + stepMs)
        clock.advance(next - at)
        at = next
        engine.tick(at)
      }
    },
  }

  opts.onStart?.(run)
  return run
}

/**
 * Run a whole round at one tick granularity and return the raw material a
 * property test compares: the event stream and the per-cue outcomes.
 */
export function runWholeRound(
  timeline: RoundTimeline[],
  roundIndex: number,
  stepMs: number,
): RoundRun {
  const run = startRound(timeline, { roundIndex, stepMs })
  const round = timeline[roundIndex]
  if (round) {
    run.driveTo(round.workDurationMs, stepMs)
    // A final tick exactly on the bell, so the last window closes even when
    // `stepMs` does not divide the round evenly.
    run.engine.tick(round.workDurationMs)
  }
  return run
}

/** `type` per event — the shape a determinism comparison hashes. */
export function eventDigest(events: readonly CueEvent[]): string[] {
  return events.map((e) =>
    e.type === 'token-due'
      ? `${e.type}|${e.cue.id}|${e.tokenIndex}|${e.workElapsedMs}`
      : `${e.type}|${e.cue.id}|${e.status}|${e.workElapsedMs}`,
  )
}

/** Per-cue counts of each event type — granularity-independent by design. */
export function eventCountsByCue(events: readonly CueEvent[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const event of events) {
    const key =
      event.type === 'token-due'
        ? `${event.cue.id}|token-due|${event.tokenIndex}`
        : `${event.cue.id}|${event.type}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** `results()` reduced to comparable strings. */
export function resultDigest(engine: CueEngine): string[] {
  return engine
    .results()
    .map((r) => `${r.cue.id}|${r.outcome}|${r.matchedCount}/${r.expectedCount}`)
}

/** Statuses a cue can no longer leave, mirrored here for readability. */
export const TERMINAL: ReadonlySet<CueStatus> = new Set<CueStatus>([
  'completed',
  'expired',
  'gap',
  'cancelled',
])
