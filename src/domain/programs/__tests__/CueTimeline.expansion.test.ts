// ENGINE-BEHAVIOR SUITE — pinned to the FROZEN pre-click-track samples
// (samples/__fixtures__), NOT the live library. The live sets were
// rewritten to the 4-slot click-track format (MVP v2, GH #305) and no
// longer exercise bursts / count scoring / defense-counters; these
// assertions encode engine semantics those shapes exist to test.
/**
 * Exhaustive cue-timeline expansion (M32-09, #186).
 *
 * `CueTimeline.test.ts` (M32-03) walks expansion once per rule with one
 * hand-built cue. This suite is the adversarial layer over it: every rule is
 * re-asserted across the **whole matrix** the app can actually produce —
 * three sample workouts, both stances, all four cadence nominals, and a
 * spread of grace overrides — because that is where the interesting failures
 * live. Two rules only break outside the single-cue case:
 *
 *   - acceptance windows overlap once `graceAfterMs` exceeds the gap to the
 *     next cue, which needs two cues to see; and
 *   - block `startOffsetMs` is authored in milliseconds at one cadence while
 *     everything inside a block derives from beats, so re-expanding a sample
 *     below its authoring BPM stretches combos into the following block.
 *
 * Structure and invariants only — never tuned values. M36-03 will change the
 * grace and lead constants and must not break this suite.
 *
 * Pure domain: no React, Expo, SQLite or BLE imports, no `Date.now()`
 * (spec §15.1, §21.1).
 */

import {
  DEFAULT_GRACE_AFTER_MS,
  DEFAULT_GRACE_BEFORE_MS,
  allCues,
  expandTimeline,
  type CueInstance,
  type RoundTimeline,
} from '../CueTimeline'
import { generateCase } from './helpers/timelineGen'
import { CADENCE_PROFILES, beatsToMs } from '../../workout/cadence'
import { legacyBodyWork as bodyWork, legacyEstablishTheJab20 as establishTheJab20, legacyHeavyHands as heavyHands, legacyPacePusher as pacePusher, legacyProgressiveBuildup as progressiveBuildup, legacySpeedCombos as speedCombos, legacySwitchByRound as switchByRound, legacyThreeRoundFundamentals as threeRoundFundamentals, legacyUppercutClinic as uppercutClinic } from '../../workout/samples/__fixtures__'
import { resolveHand } from '../StanceMapper'
import type { GeneratedWorkout } from '../../workout/GeneratedWorkout'
import type {
  ProgramRound,
  Stance,
  WorkoutBlock,
  WorkoutToken,
} from '../../workout/WorkoutTokens'

// ---------------------------------------------------------------------------
// The matrix.
// ---------------------------------------------------------------------------

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

const STANCES: readonly Stance[] = ['orthodox', 'southpaw']

/** The four cadence nominals (doc §17), which is what a profile selects. */
const BPMS: readonly number[] = [
  CADENCE_PROFILES.technical.nominalBpm,
  CADENCE_PROFILES.steady.nominalBpm,
  CADENCE_PROFILES.pressure.nominalBpm,
  CADENCE_PROFILES.sprint.nominalBpm,
]

/** Deliberately spans zero, the current defaults, and absurdly generous. */
const GRACES: readonly number[] = [0, 100, 200, 350, 750, 1_500, 5_000]

const STEADY_BPM = CADENCE_PROFILES.steady.nominalBpm

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
  return { ...threeRoundFundamentals, id: 'test', schedule: [round], roundPunchTargets: [0] }
}

/** Every (sample, stance, bpm) expansion, as one flat list. */
function everyExpansion(): Array<{
  label: string
  workout: GeneratedWorkout
  stance: Stance
  bpm: number
  timelines: RoundTimeline[]
}> {
  const out = []
  for (const [name, workout] of SAMPLES) {
    for (const stance of STANCES) {
      for (const bpm of BPMS) {
        out.push({
          label: `${name}/${stance}/${bpm}bpm`,
          workout,
          stance,
          bpm,
          timelines: expandTimeline(workout, stance, bpm),
        })
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------

describe('case 1 — expands Three-Round Fundamentals into ordered non-overlapping CueInstances', () => {
  it('expands Three-Round Fundamentals into ordered non-overlapping CueInstances', () => {
    // At its own authoring cadence, which is the contract `layBlocks` gives:
    // `blockDurationMs` already includes the trailing gap, so blocks laid end
    // to end cannot collide.
    for (const stance of STANCES) {
      const timelines = expandTimeline(threeRoundFundamentals, stance, STEADY_BPM)
      expect(timelines).toHaveLength(threeRoundFundamentals.schedule.length)

      for (const timeline of timelines) {
        const cues = timeline.cues
        expect(cues.length).toBeGreaterThan(0)
        expect(new Set(cues.map((c) => c.id)).size).toBe(cues.length)

        for (let i = 0; i < cues.length; i++) {
          const cue = cues[i] as CueInstance
          expect(cue.scheduledEndMs).toBeGreaterThanOrEqual(cue.scheduledStartMs)
          if (i === 0) continue
          const previous = cues[i - 1] as CueInstance
          expect(cue.scheduledStartMs).toBeGreaterThanOrEqual(previous.scheduledStartMs)
          expect(cue.scheduledStartMs).toBeGreaterThanOrEqual(previous.scheduledEndMs)
        }
      }
    }
  })

  it('keeps cues ordered at every cadence, even where a re-tempo crowds the blocks', () => {
    // Below the authoring BPM the combos stretch and blocks *do* collide,
    // because `startOffsetMs` is authored in milliseconds while token
    // offsets are in beats. Ordering must survive that; execution spans do
    // not, and the engine is what absorbs it.
    for (const { label, timelines } of everyExpansion()) {
      for (const timeline of timelines) {
        const starts = timeline.cues.map((c) => c.scheduledStartMs)
        expect({ label, starts: [...starts].sort((a, b) => a - b) }).toEqual({ label, starts })
      }
    }
  })

  it('never lets a cue keep accepting once the next cue starts', () => {
    // The invariant the engine's "one cue in flight" model (doc §20) rests
    // on, and the reason a punch is creditable to exactly one cue (§28.2).
    const violations: string[] = []
    for (const [name, workout] of SAMPLES) {
      for (const stance of STANCES) {
        for (const bpm of BPMS) {
          for (const grace of GRACES) {
            const timelines = expandTimeline(workout, stance, bpm, {
              graceBeforeMs: grace,
              graceAfterMs: grace,
            })
            for (const timeline of timelines) {
              for (let i = 1; i < timeline.cues.length; i++) {
                const previous = timeline.cues[i - 1] as CueInstance
                const cue = timeline.cues[i] as CueInstance
                if (previous.windowEndMs > cue.scheduledStartMs) {
                  violations.push(
                    `${name}/${stance}/${bpm}/${grace}: ${previous.id} accepts to ` +
                      `${previous.windowEndMs} but ${cue.id} starts at ${cue.scheduledStartMs}`,
                  )
                }
              }
            }
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('truncates a window at the next cue rather than at the grace', () => {
    // Two cues 300ms apart with a 900ms after-grace: the first window has to
    // stop at the second's start, not 900ms past its own end.
    const timelines = expandTimeline(
      workoutWith([
        block({ id: 'a', startOffsetMs: 10_000, graceAfterMs: 900 }),
        block({ id: 'b', startOffsetMs: 10_900 }),
      ]),
      'orthodox',
      STEADY_BPM,
    )
    const [first, second] = timelines[0]!.cues as [CueInstance, CueInstance]
    expect(first.scheduledEndMs + 900).toBeGreaterThan(second.scheduledStartMs)
    expect(first.windowEndMs).toBe(second.scheduledStartMs)
    // The last cue in a round keeps its full grace.
    expect(second.windowEndMs).toBe(second.scheduledEndMs + DEFAULT_GRACE_AFTER_MS)
  })
})

describe('case 2 — repeat 3 yields repeatIndex 0..2 re-based by combo duration plus gapBeats', () => {
  it.each(BPMS)('at %i bpm', (bpm) => {
    for (const gapBeats of [0, 0.5, 1, 2]) {
      const cues = expandTimeline(
        workoutWith([block({ kind: 'repeated-combo', repeat: 3, gapBeats })]),
        'orthodox',
        bpm,
      )[0]!.cues

      expect(cues.map((c) => c.repeatIndex)).toEqual([0, 1, 2])
      expect(new Set(cues.map((c) => c.blockId))).toEqual(new Set(['b1']))
      expect(new Set(cues.map((c) => c.id)).size).toBe(3)

      // Tokens span one beat; the stride is that plus the gap.
      const stride = beatsToMs(1 + gapBeats, bpm)
      expect(cues.map((c) => c.scheduledStartMs)).toEqual([0, stride, stride * 2])
      // Every instance carries the same combination.
      for (const cue of cues) {
        expect(cue.tokens).toEqual(cues[0]!.tokens)
        expect(cue.expectedPunches).toEqual(cues[0]!.expectedPunches)
      }
    }
  })

  it('scales the stride inversely with cadence', () => {
    const strideAt = (bpm: number): number => {
      const cues = expandTimeline(
        workoutWith([block({ kind: 'repeated-combo', repeat: 2 })]),
        'orthodox',
        bpm,
      )[0]!.cues
      return cues[1]!.scheduledStartMs - cues[0]!.scheduledStartMs
    }
    const strides = BPMS.map(strideAt)
    for (let i = 1; i < strides.length; i++) {
      expect(strides[i]!).toBeLessThan(strides[i - 1]!)
    }
  })
})

describe('case 3 — clamps windowStartMs to 0 when graceBefore precedes the bell', () => {
  it.each(GRACES)('with a %ims before-grace', (grace) => {
    for (const startOffsetMs of [0, 50, grace, grace + 1, grace + 5_000]) {
      const cue = expandTimeline(
        workoutWith([block({ startOffsetMs })]),
        'orthodox',
        STEADY_BPM,
        { graceBeforeMs: grace, graceAfterMs: grace },
      )[0]!.cues[0]!

      // Floored, never widened: the formula is max(0, start − graceBefore).
      expect(cue.windowStartMs).toBe(Math.max(0, cue.scheduledStartMs - grace))
      expect(cue.windowStartMs).toBeGreaterThanOrEqual(0)
      // A punch thrown before the bell can never be accepted.
      expect(cue.windowStartMs).toBeLessThanOrEqual(cue.scheduledStartMs)
    }
  })

  it('floors preview and announce at the bell without widening the window', () => {
    const cue = expandTimeline(
      workoutWith([block({ startOffsetMs: 0 })]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues[0]!
    expect(cue.previewAt).toBe(0)
    expect(cue.announceAt).toBe(0)
    expect(cue.windowStartMs).toBe(0)
  })
})

describe('case 4 — clamps windowEndMs to workDurationMs when graceAfter outlives the round', () => {
  it.each(GRACES)('with a %ims after-grace', (grace) => {
    const workDurationMs = 6_000
    for (const startOffsetMs of [0, 3_000, 5_000, 5_900]) {
      const cue = expandTimeline(
        workoutWith([block({ startOffsetMs })], workDurationMs),
        'orthodox',
        STEADY_BPM,
        { graceBeforeMs: grace, graceAfterMs: grace },
      )[0]!.cues[0]!

      expect(cue.windowEndMs).toBe(Math.min(workDurationMs, cue.scheduledEndMs + grace))
      expect(cue.windowEndMs).toBeLessThanOrEqual(workDurationMs)
      expect(cue.windowEndMs).toBeGreaterThanOrEqual(cue.windowStartMs)
    }
  })

  it('property: no window escapes [0, workDurationMs] over the whole matrix', () => {
    // Spec §18.2 / D5. This is the timeline half of the engine's load-time
    // assertion: an event in rest or pause must never be acceptable.
    const violations: string[] = []
    for (const [name, workout] of SAMPLES) {
      for (const stance of STANCES) {
        for (const bpm of BPMS) {
          for (const grace of GRACES) {
            const timelines = expandTimeline(workout, stance, bpm, {
              graceBeforeMs: grace,
              graceAfterMs: grace,
            })
            for (const timeline of timelines) {
              for (const cue of timeline.cues) {
                if (
                  cue.windowStartMs < 0 ||
                  cue.windowEndMs > timeline.workDurationMs ||
                  cue.windowEndMs < cue.windowStartMs
                ) {
                  violations.push(
                    `${name}/${stance}/${bpm}bpm/grace ${grace}: ${cue.id} window ` +
                      `[${cue.windowStartMs}, ${cue.windowEndMs}] against ` +
                      `[0, ${timeline.workDurationMs}]`,
                  )
                }
              }
            }
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('property: the same holds for 200 seeded random timelines', () => {
    const violations: string[] = []
    for (let seed = 1; seed <= 200; seed++) {
      const { timelines } = generateCase(seed)
      for (const timeline of timelines) {
        for (const cue of timeline.cues) {
          if (
            cue.windowStartMs < 0 ||
            cue.windowEndMs > timeline.workDurationMs ||
            cue.windowEndMs < cue.windowStartMs
          ) {
            violations.push(
              `seed ${seed}: ${cue.id} window [${cue.windowStartMs}, ${cue.windowEndMs}] ` +
                `against [0, ${timeline.workDurationMs}]`,
            )
          }
        }
      }
    }
    // Re-run a listed failure with generateCase(seed).
    expect(violations).toEqual([])
  })
})

describe('case 5 — display-only defense, footwork, and coach tokens are unscored and listed in displayOnlyTokenIndexes', () => {
  it('excludes every non-punch kind from expectedPunches', () => {
    const tokens: WorkoutToken[] = [
      { kind: 'defense', command: 'slip', beatOffset: 0 },
      { kind: 'punch', number: 2, body: false, beatOffset: 1 },
      { kind: 'footwork', command: 'pivot', beatOffset: 2 },
      { kind: 'coach', command: 'hands-up', beatOffset: 3 },
      { kind: 'punch', number: 3, body: true, beatOffset: 4 },
    ]
    for (const stance of STANCES) {
      for (const bpm of BPMS) {
        const cue = expandTimeline(workoutWith([block({ tokens })]), stance, bpm)[0]!.cues[0]!
        expect(cue.displayOnlyTokenIndexes).toEqual([0, 2, 3])
        expect(cue.expectedPunches.map((p) => p.tokenIndex)).toEqual([1, 4])
        // Shown, and timed: a display-only token still consumes a beat.
        expect(cue.tokenOffsetsMs).toHaveLength(5)
      }
    }
  })

  it('partitions every token exactly once across every sample expansion', () => {
    for (const { label, timelines } of everyExpansion()) {
      for (const cue of allCues(timelines)) {
        const scored = cue.expectedPunches.map((p) => p.tokenIndex)
        const shown = cue.displayOnlyTokenIndexes
        expect({ label, id: cue.id, all: [...scored, ...shown].sort((a, b) => a - b) }).toEqual({
          label,
          id: cue.id,
          all: cue.tokens.map((_, i) => i),
        })
        expect(scored.filter((i) => shown.includes(i))).toEqual([])
        // A punch token is display-only ONLY in a count-scored burst, where
        // it is the pattern to repeat rather than a command to answer once
        // (doc §14). In a sequence cue every punch must be an expectation.
        if (cue.scoring === 'sequence') {
          for (const index of shown) expect(cue.tokens[index]!.kind).not.toBe('punch')
        } else {
          expect(scored).toEqual([])
        }
      }
    }
  })

  it('leaves a display-only cue with nothing to miss', () => {
    // Completion counts expected punches only (D4), so a cue made entirely
    // of coach tokens has an expected count of zero.
    const tokens: WorkoutToken[] = [
      { kind: 'coach', command: 'breathe', beatOffset: 0 },
      { kind: 'footwork', command: 'reset', beatOffset: 1 },
    ]
    const cue = expandTimeline(workoutWith([block({ tokens })]), 'orthodox', STEADY_BPM)[0]!
      .cues[0]!
    expect(cue.expectedPunches).toEqual([])
    expect(cue.displayOnlyTokenIndexes).toEqual([0, 1])
  })
})

describe('case 6 — southpaw flips expectedPunches hands; switch block inverts the default stance', () => {
  it('inverts every hand between the two stances, for every number', () => {
    const tokens: WorkoutToken[] = ([1, 2, 3, 4, 5, 6] as const).map((number, i) => ({
      kind: 'punch' as const,
      number,
      body: false,
      beatOffset: i,
    }))
    const handsFor = (stance: Stance): Array<'left' | 'right'> =>
      expandTimeline(workoutWith([block({ tokens })]), stance, STEADY_BPM)[0]!
        .cues[0]!.expectedPunches.map((p) => p.hand)

    const orthodox = handsFor('orthodox')
    const southpaw = handsFor('southpaw')
    expect(orthodox).toEqual(['left', 'right', 'left', 'right', 'left', 'right'])
    expect(southpaw).toEqual(orthodox.map((h) => (h === 'left' ? 'right' : 'left')))
  })

  it.each(STANCES)("a 'switch' block inverts a %s athlete's default", (stance) => {
    const forced = (blockStance: 'inherit' | 'switch' | Stance): Array<'left' | 'right'> =>
      expandTimeline(workoutWith([block({ stance: blockStance })]), stance, STEADY_BPM)[0]!
        .cues[0]!.expectedPunches.map((p) => p.hand)

    const inherited = forced('inherit')
    expect(forced('switch')).toEqual(inherited.map((h) => (h === 'left' ? 'right' : 'left')))
    // Absolute values ignore the default entirely (D2).
    expect(forced('orthodox')).toEqual(['left', 'right'])
    expect(forced('southpaw')).toEqual(['right', 'left'])
  })

  it('agrees with StanceMapper for every cue in every sample expansion', () => {
    // The hand sequence is the entirety of what the tracker can verify
    // (H12, D12), so expansion must not re-derive it differently.
    for (const { label, workout, stance, timelines } of everyExpansion()) {
      const blocksById = new Map(
        workout.schedule.flatMap((r) => r.blocks).map((b) => [b.id, b] as const),
      )
      for (const timeline of timelines) {
        for (const cue of timeline.cues) {
          const source = blocksById.get(cue.blockId)!
          const effective =
            source.stance === 'inherit'
              ? stance
              : source.stance === 'switch'
                ? stance === 'orthodox'
                  ? 'southpaw'
                  : 'orthodox'
                : source.stance
          for (const punch of cue.expectedPunches) {
            const token = cue.tokens[punch.tokenIndex]!
            if (token.kind !== 'punch') throw new Error('unreachable')
            expect({ label, id: cue.id, hand: punch.hand }).toEqual({
              label,
              id: cue.id,
              hand: resolveHand(token.number, effective),
            })
          }
        }
      }
    }
  })
})

describe('case 7 — stance changes land only at block boundaries', () => {
  it('records every change on a block start, never mid-cue, across the matrix', () => {
    for (const { label, workout, timelines } of everyExpansion()) {
      for (const timeline of timelines) {
        const round = workout.schedule[timeline.roundIndex]!
        const boundaries = new Set(round.blocks.map((b) => b.startOffsetMs))

        for (const change of timeline.stanceChanges) {
          expect({ label, atMs: change.atMs, onBoundary: boundaries.has(change.atMs) }).toEqual({
            label,
            atMs: change.atMs,
            onBoundary: true,
          })
          const straddling = timeline.cues.filter(
            (c) => c.scheduledStartMs < change.atMs && c.scheduledEndMs > change.atMs,
          )
          expect({ label, straddling: straddling.map((c) => c.id) }).toEqual({
            label,
            straddling: [],
          })
        }
        // Ascending, and never two changes at the same instant.
        const times = timeline.stanceChanges.map((c) => c.atMs)
        expect([...times].sort((a, b) => a - b)).toEqual(times)
        expect(new Set(times).size).toBe(times.length)
      }
    }
  })

  it('never records a change to the stance already in effect', () => {
    for (const { label, timelines } of everyExpansion()) {
      for (const timeline of timelines) {
        for (let i = 1; i < timeline.stanceChanges.length; i++) {
          expect({ label, to: timeline.stanceChanges[i]!.toStance }).not.toEqual({
            label,
            to: timeline.stanceChanges[i - 1]!.toStance,
          })
        }
      }
    }
  })

  it('flips direction with the athlete default for switch-by-round', () => {
    // A switch block is "the opposite of the default", not "the other one
    // from orthodox" (D2), so a southpaw athlete's switch rounds go
    // orthodox.
    const orthodox = expandTimeline(switchByRound, 'orthodox', STEADY_BPM)
    const southpaw = expandTimeline(switchByRound, 'southpaw', STEADY_BPM)
    expect(orthodox.map((t) => t.stanceChanges.map((c) => c.toStance))).toEqual([
      [],
      ['southpaw'],
      [],
      ['southpaw'],
    ])
    expect(southpaw.map((t) => t.stanceChanges.map((c) => c.toStance))).toEqual([
      [],
      ['orthodox'],
      [],
      ['orthodox'],
    ])
  })
})

describe('the graces stay structural, not tuned (M36-03 must not break this)', () => {
  it('derives the window from the graces rather than from a literal', () => {
    for (const grace of GRACES) {
      const cue = expandTimeline(
        workoutWith([block({ startOffsetMs: 20_000 })]),
        'orthodox',
        STEADY_BPM,
        { graceBeforeMs: grace, graceAfterMs: grace },
      )[0]!.cues[0]!
      expect(cue.scheduledStartMs - cue.windowStartMs).toBe(grace)
      expect(cue.windowEndMs - cue.scheduledEndMs).toBe(grace)
    }
  })

  it('lets a block override the defaults in both directions', () => {
    const cue = expandTimeline(
      workoutWith([
        block({ startOffsetMs: 20_000, graceBeforeMs: 0, graceAfterMs: 1 }),
      ]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues[0]!
    expect(cue.windowStartMs).toBe(cue.scheduledStartMs)
    expect(cue.windowEndMs).toBe(cue.scheduledEndMs + 1)
    expect(DEFAULT_GRACE_BEFORE_MS).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// M39-V1c: block.voicePolicy threads through expansion to every cue
// instance the block produces. The runtime (CueAnnouncer) consumes the
// policy per-cue; the timeline just carries it faithfully.
// ---------------------------------------------------------------------------

describe('voicePolicy threads from block to every produced cue', () => {
  it('absent voicePolicy leaves cues with an undefined field (pre-M39 default)', () => {
    const cues = expandTimeline(
      workoutWith([block({ repeat: 3 })]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues
    for (const c of cues) expect(c.voicePolicy).toBeUndefined()
  })

  it('propagates announce-then-work to every rep of the block', () => {
    const cues = expandTimeline(
      workoutWith([
        block({
          id: 'sprint-block',
          repeat: 4,
          voicePolicy: 'announce-then-work',
        }),
      ]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues
    expect(cues).toHaveLength(4)
    for (const c of cues) expect(c.voicePolicy).toBe('announce-then-work')
  })

  it('per-block, so mixed blocks in one round carry their own policies', () => {
    const cues = expandTimeline(
      workoutWith([
        block({ id: 'per-punch-block', startOffsetMs: 0, repeat: 2 }),
        block({
          id: 'announce-block',
          startOffsetMs: 10_000,
          repeat: 2,
          voicePolicy: 'announce-then-work',
        }),
      ]),
      'orthodox',
      STEADY_BPM,
    )[0]!.cues
    const perPunch = cues.filter((c) => c.blockId === 'per-punch-block')
    const announce = cues.filter((c) => c.blockId === 'announce-block')
    expect(perPunch).toHaveLength(2)
    expect(announce).toHaveLength(2)
    for (const c of perPunch) expect(c.voicePolicy).toBeUndefined()
    for (const c of announce) expect(c.voicePolicy).toBe('announce-then-work')
  })
})
