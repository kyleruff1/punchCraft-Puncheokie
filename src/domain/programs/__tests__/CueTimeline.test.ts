// ENGINE-BEHAVIOR SUITE — pinned to the FROZEN pre-click-track samples
// (samples/__fixtures__), NOT the live library. The live sets were
// rewritten to the 4-slot click-track format (MVP v2, GH #305) and no
// longer exercise bursts / count scoring / defense-counters; these
// assertions encode engine semantics those shapes exist to test.
/**
 * Cue timeline expansion (M32-03).
 *
 * Expansion is where every timing bug in Puncheokie either gets caught or
 * gets shipped, so these tests lean on the real sample workouts (M31-05)
 * rather than on hand-built fixtures — the samples are what the live screen
 * will actually run.
 */
import {
  DEFAULT_ANNOUNCE_LEAD_MS,
  DEFAULT_GRACE_AFTER_MS,
  DEFAULT_GRACE_BEFORE_MS,
  DEFAULT_PREVIEW_LEAD_MS,
  allCues,
  expandTimeline,
  expectedPunchCount,
  type CueInstance,
} from '../CueTimeline'
import { CADENCE_PROFILES, beatsToMs } from '../../workout/cadence'
import { legacySwitchByRound as switchByRound, legacyThreeRoundFundamentals as threeRoundFundamentals } from '../../workout/samples/__fixtures__'
import type { GeneratedWorkout } from '../../workout/GeneratedWorkout'
import type { ProgramRound, WorkoutBlock, WorkoutToken } from '../../workout/WorkoutTokens'

const STEADY_BPM = CADENCE_PROFILES.steady.nominalBpm

// ---------------------------------------------------------------------------
// A minimal hand-built workout, for the cases the samples do not exercise.
// ---------------------------------------------------------------------------

function block(over: Partial<WorkoutBlock> = {}): WorkoutBlock {
  const tokens: WorkoutToken[] = [
    { kind: 'punch', number: 1, body: false, beatOffset: 0 },
    { kind: 'punch', number: 2, body: false, beatOffset: 1 },
  ]
  return {
    id: 'b1',
    kind: 'exact-combo',
    startOffsetMs: 0,
    durationMs: 1_200,
    stance: 'inherit',
    tokens,
    gapBeats: 1,
    ...over,
  }
}

function workoutWith(blocks: WorkoutBlock[], workDurationMs = 180_000): GeneratedWorkout {
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
  return {
    ...threeRoundFundamentals,
    id: 'test',
    schedule: [round],
    roundPunchTargets: [0],
  }
}

// ---------------------------------------------------------------------------

describe('determinism (spec §13.6)', () => {
  it('returns a deep-equal result for the same inputs', () => {
    const a = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)
    const b = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)
    expect(b).toEqual(a)
  })

  it('produces a different result for a different stance', () => {
    const orthodox = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)
    const southpaw = expandTimeline(threeRoundFundamentals, 'southpaw', STEADY_BPM)
    expect(southpaw).not.toEqual(orthodox)
  })

  it('scales with bpm', () => {
    const slow = expandTimeline(threeRoundFundamentals, 'orthodox', 85)
    const fast = expandTimeline(threeRoundFundamentals, 'orthodox', 140)
    const slowEnd = slow[0]!.cues[0]!.scheduledEndMs
    const fastEnd = fast[0]!.cues[0]!.scheduledEndMs
    expect(fastEnd).toBeLessThan(slowEnd)
  })
})

describe('structure over the real samples', () => {
  const timelines = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)

  it('produces one timeline per round, in order', () => {
    expect(timelines).toHaveLength(threeRoundFundamentals.schedule.length)
    expect(timelines.map((t) => t.roundIndex)).toEqual([0, 1, 2])
    timelines.forEach((t, i) => {
      expect(t.workDurationMs).toBe(threeRoundFundamentals.schedule[i]!.workDurationMs)
    })
  })

  it('sorts cues by scheduled start within each round', () => {
    for (const timeline of timelines) {
      const starts = timeline.cues.map((c) => c.scheduledStartMs)
      expect([...starts].sort((a, b) => a - b)).toEqual(starts)
    }
  })

  it('keeps every cue inside its round work interval', () => {
    for (const timeline of timelines) {
      for (const cue of timeline.cues) {
        expect(cue.windowStartMs).toBeGreaterThanOrEqual(0)
        expect(cue.windowEndMs).toBeLessThanOrEqual(timeline.workDurationMs)
        expect(cue.scheduledEndMs).toBeGreaterThanOrEqual(cue.scheduledStartMs)
      }
    }
  })

  it('produces expected punches to score', () => {
    expect(expectedPunchCount(timelines)).toBeGreaterThan(0)
  })

  it('expands volume-burst, open-pressure and active-recovery blocks as count-scored cues (#192, A12/#266)', () => {
    // These kinds run for a fixed window and are measured by tracker count
    // rather than by prescribing every punch (doc §14). `active-recovery`
    // joined the count-scored set in A12 (issue #266) so its motif pulses
    // across the whole reserved window instead of firing one dead cue.
    const countScored = allCues(timelines).filter((c) => c.scoring === 'count')
    expect(countScored.length).toBeGreaterThan(0)

    const kinds = threeRoundFundamentals.schedule
      .flatMap((r) => r.blocks)
      .filter((b) => countScored.some((c) => c.blockId === b.id))
      .map((b) => b.kind)
    expect(new Set(kinds)).toEqual(
      new Set(['volume-burst', 'open-pressure', 'active-recovery']),
    )
  })

  it('leaves nothing deferred in the shipped samples', () => {
    // The gap #192 existed to close: every authored block now produces a cue.
    expect(timelines.flatMap((t) => t.deferredBlockIds)).toEqual([])
  })
})

describe('repeat expansion (doc §14, D5)', () => {
  it('produces N instances with repeatIndex 0..N-1', () => {
    const timelines = expandTimeline(
      workoutWith([block({ kind: 'repeated-combo', repeat: 4 })]),
      'orthodox',
      STEADY_BPM,
    )
    const cues = timelines[0]!.cues
    expect(cues).toHaveLength(4)
    expect(cues.map((c) => c.repeatIndex)).toEqual([0, 1, 2, 3])
    expect(new Set(cues.map((c) => c.blockId))).toEqual(new Set(['b1']))
    expect(new Set(cues.map((c) => c.id)).size).toBe(4)
  })

  it('re-bases each repeat by the combo span plus the gap', () => {
    const cues = expandTimeline(
      workoutWith([block({ kind: 'repeated-combo', repeat: 3, gapBeats: 1 })]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues

    // Tokens span one beat; gap is one beat; so each repeat starts two beats
    // after the last.
    const stride = beatsToMs(2, STEADY_BPM)
    expect(cues.map((c) => c.scheduledStartMs)).toEqual([0, stride, stride * 2])
  })

  it('treats no repeat and repeat 1 identically', () => {
    const none = expandTimeline(workoutWith([block()]), 'orthodox', STEADY_BPM)[0]!.cues
    const one = expandTimeline(workoutWith([block({ repeat: 1 })]), 'orthodox', STEADY_BPM)[0]!.cues
    expect(one).toEqual(none)
  })

  it('never overlaps repeats of the same block', () => {
    const cues = expandTimeline(
      workoutWith([block({ kind: 'repeated-combo', repeat: 6 })]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i]!.scheduledStartMs).toBeGreaterThanOrEqual(cues[i - 1]!.scheduledEndMs)
    }
  })
})

describe('acceptance windows (doc §6, spec §18.2)', () => {
  it('applies the default graces either side', () => {
    const cue = expandTimeline(
      workoutWith([block({ startOffsetMs: 10_000 })]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues[0]!
    expect(cue.windowStartMs).toBe(cue.scheduledStartMs - DEFAULT_GRACE_BEFORE_MS)
    expect(cue.windowEndMs).toBe(cue.scheduledEndMs + DEFAULT_GRACE_AFTER_MS)
  })

  it('clamps the window start at the bell', () => {
    // A cue at t=0 cannot accept a punch thrown before the round began.
    const cue = expandTimeline(
      workoutWith([block({ startOffsetMs: 0 })]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues[0]!
    expect(cue.windowStartMs).toBe(0)
  })

  it('clamps the window end at the round end, so grace never spills into rest', () => {
    const workDurationMs = 5_000
    // Starts at 4.8s and spans a beat, so the cue ends after the bell and
    // the grace would run well past it if it were not clamped.
    const cue = expandTimeline(
      workoutWith([block({ startOffsetMs: 4_800 })], workDurationMs),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues[0]!
    expect(cue.scheduledEndMs + DEFAULT_GRACE_AFTER_MS).toBeGreaterThan(workDurationMs)
    expect(cue.windowEndMs).toBe(workDurationMs)
  })

  it('honours a per-block grace override', () => {
    const cue = expandTimeline(
      workoutWith([block({ startOffsetMs: 10_000, graceBeforeMs: 50, graceAfterMs: 900 })]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues[0]!
    expect(cue.windowStartMs).toBe(cue.scheduledStartMs - 50)
    expect(cue.windowEndMs).toBe(cue.scheduledEndMs + 900)
  })

  it('honours a global grace override', () => {
    const cue = expandTimeline(
      workoutWith([block({ startOffsetMs: 10_000 })]),
      'orthodox',
      STEADY_BPM,
      { graceBeforeMs: 0, graceAfterMs: 0 },
    )[0]!.cues[0]!
    expect(cue.windowStartMs).toBe(cue.scheduledStartMs)
    expect(cue.windowEndMs).toBe(cue.scheduledEndMs)
  })

  it('never lets any window escape [0, workDurationMs] across every sample', () => {
    for (const workout of [threeRoundFundamentals, switchByRound]) {
      for (const timeline of expandTimeline(workout, 'orthodox', STEADY_BPM)) {
        for (const cue of timeline.cues) {
          expect(cue.windowStartMs).toBeGreaterThanOrEqual(0)
          expect(cue.windowEndMs).toBeLessThanOrEqual(timeline.workDurationMs)
          expect(cue.windowEndMs).toBeGreaterThanOrEqual(cue.windowStartMs)
        }
      }
    }
  })
})

describe('lead times (doc §18.3)', () => {
  it('places preview and announce ahead of the cue', () => {
    const cue = expandTimeline(
      workoutWith([block({ startOffsetMs: 10_000 })]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues[0]!
    expect(cue.previewAt).toBe(10_000 - DEFAULT_PREVIEW_LEAD_MS)
    expect(cue.announceAt).toBe(10_000 - DEFAULT_ANNOUNCE_LEAD_MS)
    expect(cue.previewAt).toBeLessThan(cue.announceAt)
  })

  it('floors them at 0 rather than widening the window', () => {
    const cue = expandTimeline(
      workoutWith([block({ startOffsetMs: 100 })]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues[0]!
    expect(cue.previewAt).toBe(0)
    expect(cue.announceAt).toBe(0)
    // The window is unaffected by a short preview.
    expect(cue.windowStartMs).toBe(0)
  })

  it('accepts overrides', () => {
    const cue = expandTimeline(
      workoutWith([block({ startOffsetMs: 10_000 })]),
      'orthodox',
      STEADY_BPM,
      { leadTimes: { previewMs: 3_000, announceMs: 1_000 } },
    )[0]!.cues[0]!
    expect(cue.previewAt).toBe(7_000)
    expect(cue.announceAt).toBe(9_000)
  })
})

describe('expected punches and stance (#126, D2)', () => {
  const handsFor = (stance: 'orthodox' | 'southpaw'): Array<'left' | 'right'> =>
    expandTimeline(workoutWith([block()]), stance, STEADY_BPM)[0]!.cues[0]!.expectedPunches.map(
      (p) => p.hand,
    )

  it('maps 1-2 to left-right in orthodox and right-left in southpaw', () => {
    expect(handsFor('orthodox')).toEqual(['left', 'right'])
    expect(handsFor('southpaw')).toEqual(['right', 'left'])
  })

  it('inverts the default stance for a switch block', () => {
    const cue = expandTimeline(
      workoutWith([block({ stance: 'switch' })]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues[0]!
    expect(cue.expectedPunches.map((p) => p.hand)).toEqual(['right', 'left'])
  })

  it('carries the implied technique family of the cue, not an observation', () => {
    const tokens: WorkoutToken[] = [
      { kind: 'punch', number: 1, body: false, beatOffset: 0 },
      { kind: 'punch', number: 3, body: false, beatOffset: 1 },
      { kind: 'punch', number: 6, body: false, beatOffset: 2 },
    ]
    const cue = expandTimeline(workoutWith([block({ tokens })]), 'orthodox', STEADY_BPM)[0]!
      .cues[0]!
    expect(cue.expectedPunches.map((p) => p.type)).toEqual(['straight', 'hook', 'uppercut'])
  })

  it('indexes expected punches against the cue token array', () => {
    const tokens: WorkoutToken[] = [
      { kind: 'defense', command: 'slip', beatOffset: 0 },
      { kind: 'punch', number: 2, body: false, beatOffset: 1 },
      { kind: 'punch', number: 3, body: false, beatOffset: 2 },
    ]
    const cue = expandTimeline(workoutWith([block({ tokens })]), 'orthodox', STEADY_BPM)[0]!
      .cues[0]!
    expect(cue.expectedPunches.map((p) => p.tokenIndex)).toEqual([1, 2])
    for (const punch of cue.expectedPunches) {
      expect(cue.tokens[punch.tokenIndex]?.kind).toBe('punch')
    }
  })
})

describe('display-only tokens are never scored (D4, doc §21)', () => {
  it('lists defense, footwork and coach tokens as display-only', () => {
    const tokens: WorkoutToken[] = [
      { kind: 'defense', command: 'slip', beatOffset: 0 },
      { kind: 'punch', number: 2, body: false, beatOffset: 1 },
      { kind: 'footwork', command: 'pivot', beatOffset: 2 },
      { kind: 'coach', command: 'hands-up', beatOffset: 3 },
    ]
    const cue = expandTimeline(workoutWith([block({ tokens })]), 'orthodox', STEADY_BPM)[0]!
      .cues[0]!

    expect(cue.displayOnlyTokenIndexes).toEqual([0, 2, 3])
    expect(cue.expectedPunches).toHaveLength(1)
    expect(cue.tokens).toHaveLength(4)
  })

  it('partitions every token into exactly one of the two sets', () => {
    for (const cue of allCues(expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM))) {
      const scored = cue.expectedPunches.map((p) => p.tokenIndex)
      const shown = cue.displayOnlyTokenIndexes
      expect([...scored, ...shown].sort((a, b) => a - b)).toEqual(
        cue.tokens.map((_, i) => i),
      )
      expect(scored.filter((i) => shown.includes(i))).toEqual([])
    }
  })
})

describe('stance changes (doc §11)', () => {
  it('records no change when the whole round stays in the default stance', () => {
    const timelines = expandTimeline(threeRoundFundamentals, 'orthodox', STEADY_BPM)
    for (const timeline of timelines) expect(timeline.stanceChanges).toEqual([])
  })

  it('records a change per switch round in switch-by-round', () => {
    const timelines = expandTimeline(switchByRound, 'orthodox', STEADY_BPM)
    // Rounds 2 and 4 are 'switch'; each records one change at its first block.
    expect(timelines[0]!.stanceChanges).toEqual([])
    expect(timelines[1]!.stanceChanges).toEqual([{ atMs: 0, toStance: 'southpaw' }])
    expect(timelines[2]!.stanceChanges).toEqual([])
    expect(timelines[3]!.stanceChanges).toEqual([{ atMs: 0, toStance: 'southpaw' }])
  })

  it('only ever records a change at a block boundary', () => {
    for (const timeline of expandTimeline(switchByRound, 'orthodox', STEADY_BPM)) {
      const boundaries = new Set(
        switchByRound.schedule[timeline.roundIndex]!.blocks.map((b) => b.startOffsetMs),
      )
      for (const change of timeline.stanceChanges) {
        expect(boundaries.has(change.atMs)).toBe(true)
      }
    }
  })

  it('never changes stance inside a cue', () => {
    // Structural: a cue carries one resolved hand set, so a change cannot
    // occur part-way through one. This asserts the blocks a change falls on
    // never start mid-cue.
    for (const timeline of expandTimeline(switchByRound, 'orthodox', STEADY_BPM)) {
      for (const change of timeline.stanceChanges) {
        const straddling = timeline.cues.filter(
          (c: CueInstance) => c.scheduledStartMs < change.atMs && c.scheduledEndMs > change.atMs,
        )
        expect(straddling).toEqual([])
      }
    }
  })
})

describe('block ordering', () => {
  it('walks blocks in startOffsetMs order regardless of array order', () => {
    const out = expandTimeline(
      workoutWith([
        block({ id: 'late', startOffsetMs: 5_000 }),
        block({ id: 'early', startOffsetMs: 0 }),
      ]),
      'orthodox',
      STEADY_BPM,
    )[0]!
    expect(out.cues.map((c) => c.blockId)).toEqual(['early', 'late'])
  })
})
