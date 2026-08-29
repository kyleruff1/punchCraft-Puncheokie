/**
 * Exhaustive CueEngine lifecycle (M32-09, #186).
 *
 * `CueEngine.test.ts` (M32-04) is the smoke walk: one cue, one path, one
 * assertion per rule. This suite is the regression net M33-02 (matching),
 * M33-05 (pacing) and M34-03 (voice) will lean on, so it goes after the
 * cases a smoke walk cannot reach:
 *
 *   - **tick granularity.** The same work-clock journey driven at 10ms, 50ms,
 *     200ms and one single giant tick must produce the same lifecycle per cue
 *     and the same `results()`. A dropped frame is the ordinary case on a
 *     tablet, not the exotic one.
 *   - **replay determinism.** Spec §13.6 makes a stored session recalculable
 *     only if the same tick sequence yields the same event stream twice.
 *   - **suspension at every stage**, not just mid-accepting.
 *   - **seeded random timelines**, which is what found the window-clamp and
 *     overlap defects this suite now pins.
 *
 * Everything is driven by scripted `tick()` values on a fake clock, so every
 * assertion states exactly where on the work clock it stands, and the
 * monotonic clock is advanced independently — that separation is what makes
 * "work clock frozen, wall clock running" testable at all.
 *
 * Pure domain: no React, Expo, SQLite or BLE imports, no `Date.now()`, no
 * real timers (spec §15.1, §21.1).
 */

import { CueEngine, DEFAULT_LEAD_TIMES } from '../CueEngine'
import { expandTimeline, type CueInstance, type RoundTimeline } from '../CueTimeline'
import { TERMINAL_STATUSES, type CueEvent, type CueStatus } from '../CueState'
import {
  eventCountsByCue,
  eventDigest,
  isLifecycle,
  makeFakeClock,
  resultDigest,
  runWholeRound,
  startRound,
} from './helpers/fakeClock'
import { generateCase, generateTickSchedule } from './helpers/timelineGen'
import { CADENCE_PROFILES } from '../../workout/cadence'
import {
  bodyWork,
  establishTheJab20,
  heavyHands,
  pacePusher,
  progressiveBuildup,
  speedCombos,
  switchByRound,
  threeRoundFundamentals,
  uppercutClinic,
} from '../../workout/samples'
import type { GeneratedWorkout } from '../../workout/GeneratedWorkout'
import type { ProgramRound, WorkoutBlock, WorkoutToken } from '../../workout/WorkoutTokens'

const STEADY_BPM = CADENCE_PROFILES.steady.nominalBpm

const SAMPLES: ReadonlyArray<readonly [string, GeneratedWorkout]> = [
  ['three-round-fundamentals', threeRoundFundamentals],
  ['establish-the-jab-20', establishTheJab20],
  ['switch-by-round', switchByRound],
  ['heavy-hands', heavyHands],
  ['speed-combos', speedCombos],
  ['uppercut-clinic', uppercutClinic],
  ['progressive-buildup', progressiveBuildup],
  ['body-work', bodyWork],
  ['pace-pusher', pacePusher],
]

/** 85 is below two samples' authoring cadence, which is the crowded case. */
const BPMS: readonly number[] = [85, 100, 120, 140]

// ---------------------------------------------------------------------------
// One hand-built cue whose landmarks are stated in full, so the stage-by-stage
// cases can name the instant they mean.
//
//   previewAt 8_500 · announceAt 9_250 · windowStart 9_800
//   scheduledStart 10_000 · scheduledEnd 10_600 · windowEnd 10_950
// ---------------------------------------------------------------------------

const PREVIEW_AT = 10_000 - DEFAULT_LEAD_TIMES.previewMs
const ANNOUNCE_AT = 10_000 - DEFAULT_LEAD_TIMES.announceMs

function block(over: Partial<WorkoutBlock> = {}): WorkoutBlock {
  const tokens: WorkoutToken[] = [
    { kind: 'punch', number: 1, body: false, beatOffset: 0 },
    { kind: 'punch', number: 2, body: false, beatOffset: 1 },
  ]
  return {
    id: 'b1',
    kind: 'exact-combo',
    startOffsetMs: 10_000,
    durationMs: 1_200,
    stance: 'inherit',
    tokens,
    gapBeats: 1,
    ...over,
  }
}

function timelineFor(blocks: WorkoutBlock[], workDurationMs = 180_000): RoundTimeline[] {
  const round: ProgramRound = {
    id: 'r1',
    order: 1,
    kind: 'round',
    countsTowardGoal: true,
    theme: 'Test',
    workDurationMs,
    restAfterMs: 60_000,
    targetPunches: 0,
    blocks,
  }
  const workout: GeneratedWorkout = {
    ...threeRoundFundamentals,
    id: 'test',
    schedule: [round],
    roundPunchTargets: [0],
  }
  return expandTimeline(workout, 'orthodox', STEADY_BPM)
}

/** Statuses seen on emitted events, in order, dropping `token-due`. */
function statusTrail(events: readonly CueEvent[], cueId?: string): CueStatus[] {
  return events
    .filter(isLifecycle)
    .filter((e) => cueId === undefined || e.cue.id === cueId)
    .map((e) => e.status)
}

function typesFor(events: readonly CueEvent[], cueId?: string): Array<CueEvent['type']> {
  return events
    .filter((e) => cueId === undefined || e.cue.id === cueId)
    .map((e) => e.type)
}

// ---------------------------------------------------------------------------

describe('case 8 — walks every §20 transition once for a fully matched exact-combo cue', () => {
  it('walks every §20 transition once for a fully matched exact-combo cue', () => {
    const timeline = timelineFor([block()])
    const cue = timeline[0]!.cues[0]!
    const run = startRound(timeline, { stepMs: 10 })

    // queued — nothing has previewed yet.
    expect(run.engine.snapshot().status).toBe<CueStatus>('queued')
    run.driveTo(PREVIEW_AT - 10)
    expect(run.engine.snapshot().status).toBe<CueStatus>('queued')
    expect(run.events).toHaveLength(0)

    // previewing
    run.driveTo(PREVIEW_AT)
    expect(run.engine.snapshot().status).toBe<CueStatus>('previewing')

    // announcing
    run.driveTo(ANNOUNCE_AT)
    expect(run.engine.snapshot().status).toBe<CueStatus>('announcing')

    // active — the ready tone lands inside `announcing`, before the bell.
    run.driveTo(cue.scheduledStartMs)
    expect(run.engine.snapshot().status).toBe<CueStatus>('active')

    // accepting
    run.driveTo(cue.scheduledEndMs)
    expect(run.engine.snapshot().status).toBe<CueStatus>('accepting')

    run.engine.notifyMatch(cue.id, 0, 10_020)
    run.engine.notifyMatch(cue.id, 1, 10_640)

    // completed, then gap.
    run.driveTo(cue.windowEndMs)
    expect(run.engine.results()[0]!.outcome).toBe('completed')
    expect(run.engine.snapshot().status).toBe<CueStatus>('gap')

    // Each transition happened exactly once, in doc §18.3 order.
    expect(typesFor(run.events).filter((t) => t !== 'token-due')).toEqual([
      'cue-previewing',
      'cue-announcing',
      'cue-window-opened',
      'cue-ready',
      'cue-active',
      'cue-window-closed',
      'cue-completed',
    ])
    expect(statusTrail(run.events)).toEqual([
      'previewing',
      'announcing',
      'announcing',
      'announcing',
      'active',
      'accepting',
      'completed',
    ])
  })

  it('reaches every non-terminal §20 status exactly once, in order', () => {
    const timeline = timelineFor([block()])
    const run = startRound(timeline, { stepMs: 10 })
    const seen: CueStatus[] = []
    let previous: CueStatus | undefined
    for (let t = 0; t <= 12_000; t += 10) {
      run.driveTo(t, 10)
      const status = run.engine.snapshot().status
      if (status !== previous) {
        seen.push(status)
        previous = status
      }
    }
    expect(seen).toEqual<CueStatus[]>([
      'queued',
      'previewing',
      'announcing',
      'active',
      'accepting',
      'gap',
    ])
  })
})

describe('case 9 — accepting expires with partial counts at windowCloseMs when 2 of 3 punches matched', () => {
  it('accepting expires with partial counts at windowCloseMs when 2 of 3 punches matched', () => {
    const tokens: WorkoutToken[] = [
      { kind: 'punch', number: 1, body: false, beatOffset: 0 },
      { kind: 'punch', number: 2, body: false, beatOffset: 1 },
      { kind: 'punch', number: 3, body: false, beatOffset: 2 },
    ]
    const timeline = timelineFor([block({ tokens })])
    const cue = timeline[0]!.cues[0]!
    const run = startRound(timeline, { stepMs: 10 })

    run.driveTo(cue.scheduledEndMs)
    run.engine.notifyMatch(cue.id, 0, 10_020)
    run.engine.notifyMatch(cue.id, 1, 10_620)

    // One tick short of the close: still accepting, nothing settled.
    run.driveTo(cue.windowEndMs - 10)
    expect(run.engine.snapshot().status).toBe<CueStatus>('accepting')
    expect(run.engine.results()).toEqual([])

    run.driveTo(cue.windowEndMs)
    const closed = run.events.filter(isLifecycle).find((e) => e.type === 'cue-window-closed')!
    expect(closed.workElapsedMs).toBe(cue.windowEndMs)
    expect(closed.timestamps.windowCloseMs).toBe(cue.windowEndMs)

    const result = run.engine.results()[0]!
    expect(result.outcome).toBe('expired')
    expect(result.matchedCount).toBe(2)
    expect(result.expectedCount).toBe(3)
    // Partial completion is not failure (doc §21): the outcome records what
    // landed and nothing is emitted to mark it a miss.
    expect(typesFor(run.events)).not.toContain('cue-cancelled')
  })

  it.each([0, 1, 2, 3])('expires or completes on exactly the matched count %i of 3', (matched) => {
    const tokens: WorkoutToken[] = [
      { kind: 'punch', number: 1, body: false, beatOffset: 0 },
      { kind: 'punch', number: 2, body: false, beatOffset: 1 },
      { kind: 'punch', number: 3, body: false, beatOffset: 2 },
    ]
    const timeline = timelineFor([block({ tokens })])
    const cue = timeline[0]!.cues[0]!
    const run = startRound(timeline, { stepMs: 25 })
    run.driveTo(cue.scheduledStartMs)
    for (let i = 0; i < matched; i++) run.engine.notifyMatch(cue.id, i, 10_000 + i * 600)
    run.driveTo(cue.windowEndMs + 100)

    const result = run.engine.results()[0]!
    expect(result.matchedCount).toBe(matched)
    expect(result.outcome).toBe(matched === 3 ? 'completed' : 'expired')
  })
})

describe('case 10 — gap follows completed and expired until the next previewAt — status name is gap, never recovery', () => {
  it.each(['completed', 'expired'] as const)('after a %s cue', (outcome) => {
    const timeline = timelineFor([
      block({ id: 'a', startOffsetMs: 10_000 }),
      block({ id: 'b', startOffsetMs: 30_000 }),
    ])
    const first = timeline[0]!.cues[0]!
    const second = timeline[0]!.cues[1]!
    const run = startRound(timeline, { stepMs: 25 })

    run.driveTo(first.scheduledStartMs)
    if (outcome === 'completed') {
      run.engine.notifyMatch(first.id, 0, 10_000)
      run.engine.notifyMatch(first.id, 1, 10_600)
    }
    run.driveTo(first.windowEndMs)
    expect(run.engine.results()[0]!.outcome).toBe(outcome)

    // Held all the way to the next cue's preview.
    for (const t of [first.windowEndMs, 15_000, 20_000, second.previewAt - 25]) {
      run.driveTo(t)
      expect(run.engine.snapshot().status).toBe<CueStatus>('gap')
      expect(run.engine.snapshot().current!.id).toBe('a#0')
      expect(run.engine.snapshot().next!.id).toBe('b#0')
    }

    run.driveTo(second.previewAt)
    expect(run.engine.snapshot().status).toBe<CueStatus>('previewing')
    expect(run.engine.snapshot().current!.id).toBe('b#0')
  })

  it("never names a status 'recovery' (spec §19.3 reserves it for BLE)", () => {
    // One word meaning two things in a live screen's telemetry is how
    // incidents get misread (D5).
    for (const [, workout] of SAMPLES) {
      const timeline = expandTimeline(workout, 'orthodox', STEADY_BPM)
      const run = runWholeRound(timeline, 0, 200)
      const statuses = new Set(statusTrail(run.events))
      expect([...statuses].filter((s) => String(s).includes('recover'))).toEqual([])
      // The settling event still carries the outcome as its status — `gap`
      // is what the cue holds *afterwards*, which is a read-model state and
      // so is asserted through `snapshot()`.
      expect([...statuses].some((s) => s === 'completed' || s === 'expired')).toBe(true)
      expect(run.engine.snapshot().status).toBe<CueStatus>('gap')
    }
  })

  it('keeps the outcome on the result even though the status becomes gap', () => {
    const timeline = timelineFor([block()])
    const run = runWholeRound(timeline, 0, 50)
    expect(run.engine.snapshot().status).toBe<CueStatus>('gap')
    expect(run.engine.results()[0]!.outcome).toBe('expired')
    expect(TERMINAL_STATUSES.has('gap')).toBe(true)
  })
})

describe('case 11 — paused mid-active suspends and resumed restores prior status with a suspension record', () => {
  const STAGES: ReadonlyArray<readonly [string, number, CueStatus, boolean]> = [
    // label, work-elapsed instant, expected status there, is it suspendable
    ['queued', 5_000, 'queued', false],
    ['previewing', PREVIEW_AT + 100, 'previewing', false],
    ['announcing', ANNOUNCE_AT + 100, 'announcing', true],
    ['active', 10_100, 'active', true],
    ['accepting', 10_700, 'accepting', true],
  ]

  it.each(STAGES)('pausing at %s restores the same status', (_label, at, expected, suspendable) => {
    const timeline = timelineFor([block()])
    const run = startRound(timeline, { stepMs: 25 })
    run.driveTo(at)
    expect(run.engine.snapshot().status).toBe(expected)

    run.clock.advance(120)
    const pausedAt = run.clock.now()
    run.engine.onSessionPhase({ type: 'paused', nowMs: pausedAt })
    expect(run.engine.snapshot().status).toBe<CueStatus>(suspendable ? 'suspended' : expected)

    // The work clock is frozen, so a stray tick must change nothing.
    const before = run.events.length
    run.engine.tick(at + 30_000)
    expect(run.events).toHaveLength(before)

    run.clock.advance(9_000)
    const resumedAt = run.clock.now()
    run.engine.onSessionPhase({ type: 'resumed', nowMs: resumedAt })
    expect(run.engine.snapshot().status).toBe(expected)

    const suspended = run.events.filter(isLifecycle).filter((e) => e.type === 'cue-suspended')
    const resumed = run.events.filter(isLifecycle).filter((e) => e.type === 'cue-resumed')
    expect(suspended).toHaveLength(suspendable ? 1 : 0)
    expect(resumed).toHaveLength(suspendable ? 1 : 0)

    if (suspendable) {
      const spans = suspended[0]!.timestamps.suspensions
      expect(spans).toHaveLength(1)
      expect(spans[0]!.atMs).toBe(pausedAt)
      // Monotonic, not work-elapsed: a work-elapsed span would be zero,
      // because the work clock is frozen for exactly this interval.
      expect(spans[0]!.resumedAtMs).toBe(resumedAt)
      expect(spans[0]!.resumedAtMs! - spans[0]!.atMs).toBe(9_000)
    }
  })

  it('pairs every suspension exactly once across repeated pause cycles', () => {
    const timeline = timelineFor([block({ kind: 'repeated-combo', repeat: 4 })])
    const run = startRound(timeline, { stepMs: 25 })
    let cycles = 0

    for (let t = 10_000; t <= 16_000; t += 500) {
      run.driveTo(t)
      run.clock.advance(10)
      run.engine.onSessionPhase({ type: 'paused', nowMs: run.clock.now() })
      run.clock.advance(1_000)
      run.engine.onSessionPhase({ type: 'resumed', nowMs: run.clock.now() })
      cycles++
    }
    run.driveTo(30_000)

    expect(cycles).toBeGreaterThan(1)
    for (const result of run.engine.results()) {
      for (const span of result.timestamps.suspensions) {
        expect(typeof span.atMs).toBe('number')
        // Every record closes, exactly once, and never before it opened.
        expect(span.resumedAtMs).toBeDefined()
        expect(span.resumedAtMs!).toBeGreaterThan(span.atMs)
      }
      // Spans never interleave.
      const spans = result.timestamps.suspensions
      for (let i = 1; i < spans.length; i++) {
        expect(spans[i]!.atMs).toBeGreaterThanOrEqual(spans[i - 1]!.resumedAtMs!)
      }
    }
  })

  it('stays suspended until both the pause and a tracker fault clear', () => {
    const timeline = timelineFor([block()])
    const run = startRound(timeline, { stepMs: 25 })
    run.driveTo(10_700)

    run.engine.onSessionPhase({ type: 'paused', nowMs: run.clock.now() })
    run.engine.notifyTrackerFault(true)
    run.engine.onSessionPhase({ type: 'resumed', nowMs: run.clock.now() })
    expect(run.engine.snapshot().status).toBe<CueStatus>('suspended')

    // Still exactly one open span — a second suspend must not stack.
    const spans = run.events.filter(isLifecycle).find((e) => e.type === 'cue-suspended')!
      .timestamps.suspensions
    expect(spans).toHaveLength(1)

    run.engine.notifyTrackerFault(false)
    expect(run.engine.snapshot().status).toBe<CueStatus>('accepting')
    expect(spans[0]!.resumedAtMs).toBeDefined()
  })
})

describe('case 12 — pause while queued or in gap emits no cue-suspended', () => {
  it.each([
    ['queued, before any preview', 5_000],
    ['queued, mid-round with nothing in flight', 100],
  ])('%s', (_label, at) => {
    const run = startRound(timelineFor([block()]), { stepMs: 25 })
    run.driveTo(at)
    run.engine.onSessionPhase({ type: 'paused', nowMs: run.clock.now() })
    run.engine.onSessionPhase({ type: 'resumed', nowMs: run.clock.now() })
    expect(typesFor(run.events)).not.toContain('cue-suspended')
    expect(typesFor(run.events)).not.toContain('cue-resumed')
  })

  it('emits nothing when paused in the gap after a cue has settled', () => {
    const timeline = timelineFor([
      block({ id: 'a', startOffsetMs: 10_000 }),
      block({ id: 'b', startOffsetMs: 40_000 }),
    ])
    const run = startRound(timeline, { stepMs: 25 })
    run.driveTo(12_000)
    expect(run.engine.snapshot().status).toBe<CueStatus>('gap')

    const before = run.events.length
    run.engine.onSessionPhase({ type: 'paused', nowMs: run.clock.now() })
    run.clock.advance(5_000)
    run.engine.onSessionPhase({ type: 'resumed', nowMs: run.clock.now() })
    expect(run.events).toHaveLength(before)
    expect(run.engine.snapshot().status).toBe<CueStatus>('gap')
    // A terminal cue never acquires a suspension record.
    expect(run.engine.results()[0]!.timestamps.suspensions).toEqual([])
  })
})

describe('case 13 — rest-entered cancels every remaining cue exactly once and a repeated rest-entered emits nothing', () => {
  it('cancels every remaining cue exactly once', () => {
    const timeline = timelineFor([block({ kind: 'repeated-combo', repeat: 5 })])
    const run = startRound(timeline, { stepMs: 25 })
    run.driveTo(10_500)

    const settledBefore = run.engine.results().length
    run.engine.onSessionPhase({ type: 'rest-entered', nowMs: run.clock.now() })

    const cancels = typesFor(run.events).filter((t) => t === 'cue-cancelled')
    expect(cancels).toHaveLength(timeline[0]!.cues.length - settledBefore)
    // Nothing lingers into rest (doc §25).
    expect(run.engine.results()).toHaveLength(timeline[0]!.cues.length)
    for (const result of run.engine.results()) {
      expect(TERMINAL_STATUSES.has(result.outcome === 'cancelled' ? 'cancelled' : 'gap')).toBe(true)
    }

    // A repeated phase event emits nothing at all.
    const after = run.events.length
    run.engine.onSessionPhase({ type: 'rest-entered', nowMs: run.clock.now() })
    run.engine.onSessionPhase({ type: 'rest-entered', nowMs: run.clock.now() })
    expect(run.events).toHaveLength(after)
  })

  it.each([
    ['queued', 0],
    ['previewing', PREVIEW_AT + 50],
    ['announcing', ANNOUNCE_AT + 50],
    ['active', 10_100],
    ['accepting', 10_700],
  ])('cancels a cue caught in %s exactly once', (_label, at) => {
    const run = startRound(timelineFor([block()]), { stepMs: 25 })
    run.driveTo(at)
    run.engine.onSessionPhase({ type: 'rest-entered', nowMs: run.clock.now() })
    expect(typesFor(run.events).filter((t) => t === 'cue-cancelled')).toHaveLength(1)
    expect(run.engine.results()[0]!.outcome).toBe('cancelled')
    // `cancelled` is where it stops — it does not fall through to `gap`.
    expect(statusTrail(run.events).at(-1)).toBe<CueStatus>('cancelled')
  })

  it('leaves an already-settled cue alone', () => {
    const run = startRound(timelineFor([block()]), { stepMs: 25 })
    run.driveTo(12_000)
    run.engine.onSessionPhase({ type: 'rest-entered', nowMs: run.clock.now() })
    expect(typesFor(run.events)).not.toContain('cue-cancelled')
    expect(run.engine.results()[0]!.outcome).toBe('expired')
  })
})

describe('case 14 — cancelled and finishing behave like rest-entered for remaining cues', () => {
  it.each(['rest-entered', 'finishing', 'cancelled'] as const)(
    '%s produces an identical event stream',
    (phase) => {
      const digestFor = (p: 'rest-entered' | 'finishing' | 'cancelled'): string[] => {
        const run = startRound(timelineFor([block({ kind: 'repeated-combo', repeat: 5 })]), {
          stepMs: 25,
        })
        run.driveTo(10_500)
        run.engine.onSessionPhase({ type: p, nowMs: run.clock.now() })
        return eventDigest(run.events)
      }
      expect(digestFor(phase)).toEqual(digestFor('rest-entered'))
    },
  )

  it('cancels once even when the three arrive back to back', () => {
    const timeline = timelineFor([block({ kind: 'repeated-combo', repeat: 5 })])
    const run = startRound(timeline, { stepMs: 25 })
    run.driveTo(10_500)
    run.engine.onSessionPhase({ type: 'finishing', nowMs: run.clock.now() })
    run.engine.onSessionPhase({ type: 'cancelled', nowMs: run.clock.now() })
    run.engine.onSessionPhase({ type: 'rest-entered', nowMs: run.clock.now() })
    const cancels = typesFor(run.events).filter((t) => t === 'cue-cancelled')
    expect(new Set(cancels).size).toBe(1)
    expect(cancels.length).toBeLessThanOrEqual(timeline[0]!.cues.length)
  })

  it('cancels a suspended cue rather than stranding it', () => {
    const run = startRound(timelineFor([block()]), { stepMs: 25 })
    run.driveTo(10_100)
    run.engine.onSessionPhase({ type: 'paused', nowMs: run.clock.now() })
    expect(run.engine.snapshot().status).toBe<CueStatus>('suspended')
    run.engine.onSessionPhase({ type: 'cancelled', nowMs: run.clock.now() })
    expect(run.engine.results()[0]!.outcome).toBe('cancelled')
  })
})

describe('case 15 — timestamps are complete: scheduled at load, actuals at emission, trackerEventTimesMs appended per notifyMatch', () => {
  it('carries the full doc §20 set on every lifecycle event', () => {
    const timeline = timelineFor([block()])
    const cue = timeline[0]!.cues[0]!
    const run = startRound(timeline, { stepMs: 10 })
    run.driveTo(10_050)
    run.engine.notifyMatch(cue.id, 0, 10_031)
    run.engine.notifyMatch(cue.id, 1, 10_642)
    run.driveTo(12_000)

    for (const event of run.events.filter(isLifecycle)) {
      // Scheduled values are fixed at load and equal the timeline's.
      expect(event.timestamps.previewScheduledMs).toBe(cue.previewAt)
      expect(event.timestamps.voiceScheduledMs).toBe(cue.announceAt)
      expect(event.timestamps.executionScheduledMs).toBe(cue.scheduledStartMs)
      expect(event.timestamps.windowCloseMs).toBe(cue.windowEndMs)
      expect(typeof event.nowMs).toBe('number')
      expect(typeof event.workElapsedMs).toBe('number')
    }

    const final = run.engine.results()[0]!.timestamps
    expect(final.previewActualMs).toBeDefined()
    expect(final.voiceActualMs).toBeDefined()
    expect(final.executionActualMs).toBeDefined()
    expect(final.completedAtMs).toBeDefined()
    expect(final.trackerEventTimesMs).toEqual([10_031, 10_642])
  })

  it('stamps actuals in lifecycle order, from the monotonic clock', () => {
    // preview ≤ voice ≤ execution ≤ completion, per cue, for every cue in
    // every sample round: the ordering a replay depends on (spec §13.6).
    for (const [name, workout] of SAMPLES) {
      for (const bpm of BPMS) {
        const timeline = expandTimeline(workout, 'orthodox', bpm)
        for (let roundIndex = 0; roundIndex < timeline.length; roundIndex++) {
          const run = runWholeRound(timeline, roundIndex, 50)
          for (const result of run.engine.results()) {
            const t = result.timestamps
            const label = `${name}/${bpm}bpm/r${roundIndex}/${result.cue.id}`
            if (t.previewActualMs !== undefined && t.voiceActualMs !== undefined) {
              expect({ label, ok: t.previewActualMs <= t.voiceActualMs }).toEqual({
                label,
                ok: true,
              })
            }
            if (t.voiceActualMs !== undefined && t.executionActualMs !== undefined) {
              expect({ label, ok: t.voiceActualMs <= t.executionActualMs }).toEqual({
                label,
                ok: true,
              })
            }
            if (t.executionActualMs !== undefined && t.completedAtMs !== undefined) {
              expect({ label, ok: t.executionActualMs <= t.completedAtMs }).toEqual({
                label,
                ok: true,
              })
            }
          }
        }
      }
    }
  })

  it('appends one tracker time per notifyMatch, in call order, and ignores unknown ids', () => {
    const timeline = timelineFor([block({ kind: 'repeated-combo', repeat: 2 })])
    const [first, second] = timeline[0]!.cues as [CueInstance, CueInstance]
    const run = startRound(timeline, { stepMs: 25 })
    run.driveTo(10_050)

    run.engine.notifyMatch(first.id, 0, 10_010)
    run.engine.notifyMatch(first.id, 1, 10_620)
    // A duplicate expectation index still records the tracker time — the
    // matched set dedupes, the event log does not.
    run.engine.notifyMatch(first.id, 1, 10_640)
    expect(() => run.engine.notifyMatch('no-such-cue', 0, 1)).not.toThrow()
    run.engine.notifyMatch(second.id, 0, 11_300)

    run.driveTo(30_000)
    const results = run.engine.results()
    expect(results[0]!.timestamps.trackerEventTimesMs).toEqual([10_010, 10_620, 10_640])
    expect(results[0]!.matchedCount).toBe(2)
    expect(results[1]!.timestamps.trackerEventTimesMs).toEqual([11_300])
  })

  it('leaves actuals undefined for a stage a cue never reached', () => {
    const run = startRound(timelineFor([block()]), { stepMs: 25 })
    run.driveTo(PREVIEW_AT + 50)
    run.engine.onSessionPhase({ type: 'rest-entered', nowMs: run.clock.now() })
    const t = run.engine.results()[0]!.timestamps
    expect(t.previewActualMs).toBeDefined()
    expect(t.voiceActualMs).toBeUndefined()
    expect(t.executionActualMs).toBeUndefined()
  })
})

describe('case 16 — frozen workElapsedMs with advancing clock.nowMs produces zero transitions', () => {
  it.each([0, PREVIEW_AT + 50, 10_100, 10_700])('with the work clock held at %i', (at) => {
    const run = startRound(timelineFor([block()]), { stepMs: 25 })
    run.driveTo(at)
    const before = run.events.length
    const status = run.engine.snapshot().status

    // Sixty seconds of wall time, no work time at all.
    for (let i = 0; i < 200; i++) {
      run.clock.advance(300)
      run.engine.tick(at)
    }
    expect(run.events).toHaveLength(before)
    expect(run.engine.snapshot().status).toBe(status)
  })

  it('ignores a backwards tick rather than ending the round', () => {
    const run = startRound(timelineFor([block()]), { stepMs: 25 })
    run.driveTo(10_100)
    const before = eventDigest(run.events)
    for (const t of [0, 1_000, 9_999, -5_000]) {
      run.clock.advance(100)
      expect(() => run.engine.tick(t)).not.toThrow()
    }
    expect(eventDigest(run.events)).toEqual(before)
    expect(run.engine.snapshot().status).toBe<CueStatus>('active')
  })
})

// ---------------------------------------------------------------------------
// Case 17 and the properties around it.
// ---------------------------------------------------------------------------

const PROPERTY_SEEDS = 200

describe('case 17 — property: over 200 seeded random timelines and tick schedules, emitted events are monotonic in workElapsedMs and every window lies in [0, workDurationMs]', () => {
  it('holds for every seed', () => {
    const failures: string[] = []

    for (let seed = 1; seed <= PROPERTY_SEEDS; seed++) {
      const generated = generateCase(seed)
      const timelines = generated.timelines
      const roundIndex = seed % timelines.length

      // Window bounds first: the engine asserts these at load, so a
      // violation would surface as a constructor throw rather than a
      // property failure.
      const round = timelines[roundIndex]!
      for (const cue of round.cues) {
        if (
          cue.windowStartMs < 0 ||
          cue.windowEndMs > round.workDurationMs ||
          cue.windowEndMs < cue.windowStartMs
        ) {
          failures.push(
            `seed ${seed}: ${cue.id} window [${cue.windowStartMs}, ${cue.windowEndMs}] ` +
              `outside [0, ${round.workDurationMs}]`,
          )
        }
      }

      const clock = makeFakeClock()
      let engine: CueEngine
      try {
        engine = new CueEngine(timelines, { leadTimes: DEFAULT_LEAD_TIMES, clock })
      } catch (error) {
        failures.push(`seed ${seed}: construction threw — ${(error as Error).message}`)
        continue
      }

      const events: CueEvent[] = []
      engine.subscribe((e) => events.push(e))
      engine.onSessionPhase({ type: 'work-entered', roundIndex, nowMs: clock.now() })

      const ticks = generateTickSchedule(seed, round.workDurationMs)
      let last = 0
      try {
        for (const tick of ticks) {
          clock.advance(Math.max(1, tick - last))
          last = tick
          engine.tick(tick)
        }
      } catch (error) {
        failures.push(`seed ${seed}: tick threw — ${(error as Error).message}`)
        continue
      }

      let previousWork = -Infinity
      let previousNow = -Infinity
      for (const event of events) {
        if (event.workElapsedMs < previousWork) {
          failures.push(
            `seed ${seed}: ${event.type} on ${event.cue.id} went back to ` +
              `${event.workElapsedMs} from ${previousWork}`,
          )
          break
        }
        if (event.nowMs < previousNow) {
          failures.push(`seed ${seed}: ${event.type} nowMs went backwards`)
          break
        }
        previousWork = event.workElapsedMs
        previousNow = event.nowMs
      }
    }

    // Every failure line names its seed; re-run one with
    // `generateCase(seed)` / `generateTickSchedule(seed, workDurationMs)`.
    expect(failures).toEqual([])
  })

  it('is reproducible: the same seed regenerates a deep-equal timeline', () => {
    for (const seed of [1, 7, 42, 199]) {
      expect(generateCase(seed).timelines).toEqual(generateCase(seed).timelines)
      const { timelines } = generateCase(seed)
      expect(generateTickSchedule(seed, timelines[0]!.workDurationMs)).toEqual(
        generateTickSchedule(seed, timelines[0]!.workDurationMs),
      )
    }
  })
})

describe('property — replaying a tick sequence twice yields an identical event stream', () => {
  it('holds for every sample round at every cadence', () => {
    // Determinism is what makes a stored session recalculable (spec §13.6).
    for (const [name, workout] of SAMPLES) {
      for (const bpm of BPMS) {
        const timeline = expandTimeline(workout, 'orthodox', bpm)
        for (let roundIndex = 0; roundIndex < timeline.length; roundIndex++) {
          const a = runWholeRound(timeline, roundIndex, 50)
          const b = runWholeRound(timeline, roundIndex, 50)
          const label = `${name}/${bpm}bpm/r${roundIndex}`
          expect({ label, digest: eventDigest(b.events) }).toEqual({
            label,
            digest: eventDigest(a.events),
          })
          expect({ label, results: resultDigest(b.engine) }).toEqual({
            label,
            results: resultDigest(a.engine),
          })
        }
      }
    }
  })

  it('holds for seeded timelines driven by their seeded tick schedule', () => {
    const replay = (seed: number): { events: string[]; results: string[] } => {
      const { timelines } = generateCase(seed)
      const roundIndex = seed % timelines.length
      const round = timelines[roundIndex]!
      const clock = makeFakeClock()
      const engine = new CueEngine(timelines, { leadTimes: DEFAULT_LEAD_TIMES, clock })
      const events: CueEvent[] = []
      engine.subscribe((e) => events.push(e))
      engine.onSessionPhase({ type: 'work-entered', roundIndex, nowMs: clock.now() })
      let last = 0
      for (const tick of generateTickSchedule(seed, round.workDurationMs)) {
        clock.advance(Math.max(1, tick - last))
        last = tick
        engine.tick(tick)
      }
      return { events: eventDigest(events), results: resultDigest(engine) }
    }

    for (let seed = 1; seed <= 40; seed++) {
      expect({ seed, ...replay(seed) }).toEqual({ seed, ...replay(seed) })
    }
  })
})

describe('property — tick granularity does not change the outcome', () => {
  const GRANULARITIES = [10, 50, 200, 10_000_000] as const

  it('gives every cue the same lifecycle and the same results at 10ms, 50ms, 200ms and one giant tick', () => {
    // A dropped frame is ordinary on a tablet. Event *order* may differ —
    // one giant tick opens a window before the preview it precedes — but the
    // set of lifecycle events each cue receives, and every outcome, must not.
    const failures: string[] = []

    for (const [name, workout] of SAMPLES) {
      for (const bpm of BPMS) {
        const timeline = expandTimeline(workout, 'orthodox', bpm)
        for (let roundIndex = 0; roundIndex < timeline.length; roundIndex++) {
          const base = runWholeRound(timeline, roundIndex, GRANULARITIES[0])
          const baseCounts = eventCountsByCue(base.events)
          const baseResults = resultDigest(base.engine)

          for (const stepMs of GRANULARITIES.slice(1)) {
            const other = runWholeRound(timeline, roundIndex, stepMs)
            const label = `${name}/${bpm}bpm/r${roundIndex}/${stepMs}ms`

            const counts = eventCountsByCue(other.events)
            for (const key of new Set([...counts.keys(), ...baseCounts.keys()])) {
              if (counts.get(key) !== baseCounts.get(key)) {
                failures.push(
                  `${label}: ${key} fired ${counts.get(key) ?? 0} times, ` +
                    `${baseCounts.get(key) ?? 0} at 10ms`,
                )
              }
            }
            const results = resultDigest(other.engine)
            if (JSON.stringify(results) !== JSON.stringify(baseResults)) {
              failures.push(`${label}: results differ from 10ms`)
            }
          }
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('holds for 60 seeded random timelines', () => {
    const failures: string[] = []
    for (let seed = 1; seed <= 60; seed++) {
      const { timelines } = generateCase(seed)
      const roundIndex = seed % timelines.length
      const base = runWholeRound(timelines, roundIndex, 10)
      const baseCounts = eventCountsByCue(base.events)
      const baseResults = resultDigest(base.engine)

      for (const stepMs of [50, 200, 10_000_000]) {
        const other = runWholeRound(timelines, roundIndex, stepMs)
        const counts = eventCountsByCue(other.events)
        for (const key of new Set([...counts.keys(), ...baseCounts.keys()])) {
          if (counts.get(key) !== baseCounts.get(key)) {
            failures.push(
              `seed ${seed} @ ${stepMs}ms: ${key} fired ${counts.get(key) ?? 0}, ` +
                `${baseCounts.get(key) ?? 0} at 10ms`,
            )
          }
        }
        if (JSON.stringify(resultDigest(other.engine)) !== JSON.stringify(baseResults)) {
          failures.push(`seed ${seed} @ ${stepMs}ms: results differ from 10ms`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})

describe('property — token-due fires exactly once per token per cue instance', () => {
  it('across a repeated-combo block', () => {
    for (const repeat of [1, 2, 5]) {
      const timeline = timelineFor([block({ kind: 'repeated-combo', repeat })])
      const run = runWholeRound(timeline, 0, 25)
      const due = run.events.filter((e) => e.type === 'token-due')
      expect(due).toHaveLength(repeat * 2)

      for (const cue of timeline[0]!.cues) {
        const forCue = due.filter((e) => e.cue.id === cue.id)
        expect(forCue.map((e) => (e.type === 'token-due' ? e.tokenIndex : -1))).toEqual([0, 1])
      }
    }
  })

  it('across a whole sample round at every cadence and granularity', () => {
    const failures: string[] = []
    for (const [name, workout] of SAMPLES) {
      for (const bpm of BPMS) {
        const timeline = expandTimeline(workout, 'orthodox', bpm)
        for (const stepMs of [25, 250]) {
          const run = runWholeRound(timeline, 0, stepMs)
          const seen = new Map<string, number>()
          for (const event of run.events) {
            if (event.type !== 'token-due') continue
            const key = `${event.cue.id}|${event.tokenIndex}`
            seen.set(key, (seen.get(key) ?? 0) + 1)
            // Never before its own offset.
            const offset = event.cue.tokenOffsetsMs[event.tokenIndex]!
            if (event.workElapsedMs < event.cue.scheduledStartMs + offset) {
              failures.push(`${name}/${bpm}/${stepMs}ms: ${key} fired early`)
            }
          }
          for (const [key, count] of seen) {
            if (count !== 1) failures.push(`${name}/${bpm}/${stepMs}ms: ${key} fired ${count}x`)
          }
        }
      }
    }
    expect(failures).toEqual([])
  })
})

describe('property — a full sample runs end to end with nothing left in flight', () => {
  it.each(SAMPLES)('%s, every round, work-entered through rest-entered', (name, workout) => {
    for (const bpm of BPMS) {
      const timeline = expandTimeline(workout, 'orthodox', bpm)
      const clock = makeFakeClock()
      const engine = new CueEngine(timeline, { leadTimes: DEFAULT_LEAD_TIMES, clock })
      const events: CueEvent[] = []
      engine.subscribe((e) => events.push(e))

      for (const round of timeline) {
        engine.onSessionPhase({
          type: 'work-entered',
          roundIndex: round.roundIndex,
          nowMs: clock.now(),
        })
        for (let t = 0; t <= round.workDurationMs; t += 50) {
          clock.advance(50)
          engine.tick(t)
        }
        engine.tick(round.workDurationMs)

        const label = `${name}/${bpm}bpm/r${round.roundIndex}`
        // Every cue in the round reached a terminal status before rest.
        expect({ label, settled: engine.results().length }).toEqual({
          label,
          settled: round.cues.length,
        })

        engine.onSessionPhase({ type: 'rest-entered', nowMs: clock.now() })
        expect({ label, settled: engine.results().length }).toEqual({
          label,
          settled: round.cues.length,
        })
        for (const result of engine.results()) {
          expect(['completed', 'expired', 'cancelled']).toContain(result.outcome)
          expect(result.matchedCount).toBeLessThanOrEqual(result.expectedCount)
        }
        // Rest between rounds is session-owned; the engine only needs the
        // monotonic clock to keep moving across the boundary.
        clock.advance(60_000)
      }

      // Every cue of every round produced a lifecycle, and none was left
      // mid-flight when the next round loaded.
      const cueIds = new Set(timeline.flatMap((r) => r.cues.map((c) => c.id)))
      const settledIds = new Set(
        events.filter(isLifecycle).filter((e) => TERMINAL_STATUSES.has(e.status)).map((e) => e.cue.id),
      )
      expect({ bpm, missing: [...cueIds].filter((id) => !settledIds.has(id)) }).toEqual({
        bpm,
        missing: [],
      })
    }
  })

  it('never runs two cues at once, at any cadence or granularity', () => {
    // `tick()` asserts this internally; driving every sample past it is the
    // only way to exercise the assertion over real geometry.
    for (const [, workout] of SAMPLES) {
      for (const bpm of BPMS) {
        const timeline = expandTimeline(workout, 'orthodox', bpm)
        for (let roundIndex = 0; roundIndex < timeline.length; roundIndex++) {
          for (const stepMs of [10, 50, 200, 1_000]) {
            expect(() => runWholeRound(timeline, roundIndex, stepMs)).not.toThrow()
          }
        }
      }
    }
    expect(SAMPLES).toHaveLength(9)
  })
})

describe('an overlapping timeline degrades instead of ending the round', () => {
  /**
   * `expandTimeline` truncates a window at the next cue's start, so this
   * geometry cannot come out of expansion — but a hand-built timeline or a
   * future generator could produce it, and `tick()` used to throw when it
   * did, which would kill a live round rather than a test.
   */
  function overlapping(): RoundTimeline[] {
    const timeline = timelineFor([
      block({ id: 'a', startOffsetMs: 10_000 }),
      block({ id: 'b', startOffsetMs: 10_900 }),
    ])
    const [first, second] = timeline[0]!.cues as [CueInstance, CueInstance]
    expect(first.windowEndMs).toBe(second.scheduledStartMs)
    // Push the first window 500ms past the second cue's start.
    first.windowEndMs = second.scheduledStartMs + 500
    return timeline
  }

  it('ends the earlier cue when the next one starts being called', () => {
    const timeline = overlapping()
    const [first, second] = timeline[0]!.cues as [CueInstance, CueInstance]
    const run = startRound(timeline, { stepMs: 25 })

    expect(() => run.driveTo(second.scheduledStartMs)).not.toThrow()

    const settled = run.engine.results()
    expect(settled).toHaveLength(1)
    expect(settled[0]!.cue.id).toBe(first.id)
    // Closed at the later cue's start, not at its own inflated window end.
    const closed = run.events
      .filter(isLifecycle)
      .find((e) => e.type === 'cue-window-closed' && e.cue.id === first.id)!
    expect(closed.workElapsedMs).toBe(second.scheduledStartMs)
    expect(run.engine.snapshot().current!.id).toBe(second.id)
  })

  it('still reaches the same outcome at every tick granularity', () => {
    const base = runWholeRound(overlapping(), 0, 10)
    for (const stepMs of [50, 200, 10_000_000]) {
      const other = runWholeRound(overlapping(), 0, stepMs)
      expect({ stepMs, results: resultDigest(other.engine) }).toEqual({
        stepMs,
        results: resultDigest(base.engine),
      })
    }
  })
})

describe('the read model stays consistent with the lifecycle', () => {
  it('never reports a remainingMs below zero', () => {
    const timeline = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)
    const run = startRound(timeline, { stepMs: 25 })
    for (let t = 0; t <= 40_000; t += 250) {
      run.driveTo(t, 250)
      const snapshot = run.engine.snapshot()
      expect(snapshot.remainingMs).toBeGreaterThanOrEqual(0)
      if (snapshot.current && snapshot.next) {
        expect(snapshot.next.id).not.toBe(snapshot.current.id)
      }
    }
  })

  it('stops emitting to an unsubscribed listener without disturbing the others', () => {
    const timeline = timelineFor([block()])
    const clock = makeFakeClock()
    const engine = new CueEngine(timeline, { leadTimes: DEFAULT_LEAD_TIMES, clock })
    const kept: CueEvent[] = []
    const dropped: CueEvent[] = []
    engine.subscribe((e) => kept.push(e))
    const off = engine.subscribe((e) => dropped.push(e))
    engine.onSessionPhase({ type: 'work-entered', roundIndex: 0, nowMs: 0 })

    engine.tick(10_000)
    const droppedAt = dropped.length
    off()
    engine.tick(13_000)

    expect(dropped).toHaveLength(droppedAt)
    expect(kept.length).toBeGreaterThan(droppedAt)
  })
})
