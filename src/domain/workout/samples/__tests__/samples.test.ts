/**
 * Sample workouts (M31-05).
 *
 * These samples are downstream fixtures — M32-03, M32-08 and M32-09 all run
 * against them — so a structural defect here would surface as a confusing
 * failure three issues away. Everything the validator cannot see is
 * asserted directly.
 */

import {
  establishTheJab20,
  getSampleWorkout,
  listSampleWorkouts,
  switchByRound,
  threeRoundFundamentals,
  type SampleWorkoutKey,
} from '../index'
import { validateGeneratedWorkout } from '../../GeneratedWorkout'
import { buildRoundSchedule } from '../../roundSchedule'
import { CADENCE_PROFILES, msToBeats } from '../../cadence'
import { punchTokens, type WorkoutBlock } from '../../WorkoutTokens'
import { blocksSpanMs, roundPunchCount } from '../authoring'
import { handSequence, resolveEffectiveStance } from '../../../programs/StanceMapper'

const ALL = listSampleWorkouts()

describe('the sample catalogue', () => {
  it('exposes exactly the three binding keys', () => {
    expect(ALL.map((s) => s.key)).toEqual([
      'three-round-fundamentals',
      'establish-the-jab-20',
      'switch-by-round',
    ])
  })

  it('resolves each key to its workout', () => {
    for (const sample of ALL) {
      expect(getSampleWorkout(sample.key).workout.id).toBe(sample.key)
    }
  })

  it('gives every sample a name and description', () => {
    for (const sample of ALL) {
      expect(sample.name.trim().length).toBeGreaterThan(0)
      expect(sample.description.trim().length).toBeGreaterThan(0)
    }
  })
})

describe.each(ALL.map((s) => [s.key, s.workout] as const))('%s', (key, workout) => {
  it('passes validateGeneratedWorkout with zero errors', () => {
    expect(validateGeneratedWorkout(workout)).toEqual([])
  })

  it('has roundPunchTargets matching each round targetPunches', () => {
    const scored = workout.schedule.filter((r) => r.countsTowardGoal)
    expect(workout.roundPunchTargets).toEqual(scored.map((r) => r.targetPunches))
  })

  it('has a total goal equal to the sum of its round targets', () => {
    const sum = workout.roundPunchTargets.reduce((a, b) => a + b, 0)
    expect(workout.recipe.totalPunchGoal).toBe(sum)
  })

  it('derives every round target from its authored blocks', () => {
    // Target and content can never disagree, because the target IS the
    // content count rather than a separately-asserted number.
    for (const round of workout.schedule) {
      expect(round.targetPunches).toBe(roundPunchCount(round.blocks))
    }
  })

  it('fits every round of blocks inside its work interval', () => {
    for (const round of workout.schedule) {
      expect(blocksSpanMs(round.blocks)).toBeLessThanOrEqual(round.workDurationMs)
    }
  })

  it('lays blocks end to end without overlap', () => {
    for (const round of workout.schedule) {
      let cursor = 0
      for (const block of round.blocks) {
        expect(block.startOffsetMs).toBeGreaterThanOrEqual(cursor)
        cursor = block.startOffsetMs + block.durationMs
      }
    }
  })

  it('derives every duration from beats, not hand-typed milliseconds', () => {
    // The AC forbids millisecond literals. Converting each duration BACK to
    // beats is the direct check: an authored value lands on a clean beat
    // subdivision, whereas a typed millisecond figure essentially never
    // would. (Integrality is not the test — at 100 BPM a beat is exactly
    // 600ms, so beat-derived durations are legitimately whole numbers.)
    const bpm = CADENCE_PROFILES[workout.recipe.cadenceProfile].nominalBpm
    const SUBDIVISION = 0.05
    for (const round of workout.schedule) {
      for (const block of round.blocks) {
        const beats = msToBeats(block.durationMs, bpm)
        const remainder = Math.abs(beats / SUBDIVISION - Math.round(beats / SUBDIVISION))
        expect(remainder).toBeLessThan(1e-6)
      }
    }
  })

  it('gives every block a positive duration and ordered token offsets', () => {
    for (const round of workout.schedule) {
      for (const block of round.blocks) {
        expect(block.durationMs).toBeGreaterThan(0)
        let previous = -Infinity
        for (const token of block.tokens) {
          expect(token.beatOffset).toBeGreaterThanOrEqual(previous)
          previous = token.beatOffset
        }
      }
    }
  })

  it('keeps sample copy inside the approved metric vocabulary (spec §4.3)', () => {
    // The banned tokens are assembled from fragments so this file itself stays
    // clean under tools/guards/velocity-terminology.mjs — spelling them out
    // alongside the word the guard keys on would make it flag its own test.
    const banned = ['fo' + 'rce', 'ene' + 'rgy', 'po' + 'wer'].map(
      (word) => new RegExp('\\b' + word, 'i'),
    )
    const strings = workout.schedule.flatMap((r) =>
      r.blocks.flatMap((b) => [b.spokenPhrase ?? '', b.instruction ?? '', r.theme]),
    )
    for (const text of strings) {
      for (const pattern of banned) expect(text).not.toMatch(pattern)
    }
  })
})

describe('three-round-fundamentals reproduces the doc §4 fragment', () => {
  const round1 = threeRoundFundamentals.schedule[0]!

  it('is orthodox with the documented seed', () => {
    expect(threeRoundFundamentals.recipe.defaultStance).toBe('orthodox')
    expect(threeRoundFundamentals.recipe.seed).toBe('fundamentals-2026-08-22')
  })

  it('names round 1 "Jab and cross rhythm" and runs 3:00 work / 1:00 rest', () => {
    expect(round1.theme).toBe('Jab and cross rhythm')
    expect(round1.workDurationMs).toBe(180_000)
    expect(round1.restAfterMs).toBe(60_000)
  })

  it('opens with the 1-2 x3 repeated-combo at offsets 0 / 0.75', () => {
    const block = round1.blocks[0] as WorkoutBlock
    expect(block.kind).toBe('repeated-combo')
    expect(block.repeat).toBe(3)
    expect(block.tokens.map((t) => t.beatOffset)).toEqual([0, 0.75])
    expect(punchTokens(block.tokens).map((t) => t.number)).toEqual([1, 2])
    expect(block.spokenPhrase).toBe('One, two. Three times.')
  })

  it('follows with the slip to 2-3-2 defense-counter at offsets 0 / 1 / 1.75 / 2.5', () => {
    const block = round1.blocks[1] as WorkoutBlock
    expect(block.kind).toBe('defense-counter')
    expect(block.tokens.map((t) => t.beatOffset)).toEqual([0, 1, 1.75, 2.5])
    expect(block.tokens[0]?.kind).toBe('defense')
    expect(punchTokens(block.tokens).map((t) => t.number)).toEqual([2, 3, 2])
  })

  it('has three scored rounds', () => {
    expect(threeRoundFundamentals.schedule).toHaveLength(3)
    expect(threeRoundFundamentals.roundPunchTargets).toHaveLength(3)
  })
})

describe('establish-the-jab-20', () => {
  it('matches the buildRoundSchedule(20) round count', () => {
    expect(establishTheJab20.schedule).toHaveLength(buildRoundSchedule(20).scoredRoundCount)
  })

  it('opens at least 60% of its structured combinations with a jab (doc §15)', () => {
    // Counted over blocks that prescribe a sequence — volume-burst and
    // open-pressure motifs included, since those are what the athlete repeats.
    const structured = establishTheJab20.schedule
      .flatMap((r) => r.blocks)
      .filter((b) => punchTokens(b.tokens).length > 0)
    const jabLed = structured.filter((b) => punchTokens(b.tokens)[0]?.number === 1)
    expect(jabLed.length / structured.length).toBeGreaterThanOrEqual(0.6)
  })

  it('records the gap between the suggested tier goal and what it prescribes', () => {
    // The sample is hand-authored, so its prescribed total will not equal the
    // tier suggestion. Surfacing that in warnings is honest; silently
    // shipping a mismatched goal would not be.
    expect(establishTheJab20.warnings.length).toBeGreaterThan(0)
    expect(establishTheJab20.warnings[0]).toMatch(/Steady-tier/)
  })
})

describe('switch-by-round changes stance only at round boundaries (doc §11)', () => {
  it('gives every block within a round the same stance', () => {
    // The structural guarantee: if all blocks in a round share a stance,
    // a change cannot occur mid-combination.
    for (const round of switchByRound.schedule) {
      const stances = new Set(round.blocks.map((b) => b.stance))
      expect(stances.size).toBe(1)
    }
  })

  it('alternates the effective stance from round to round', () => {
    const effective = switchByRound.schedule.map((r) =>
      resolveEffectiveStance(r.blocks[0]!.stance, switchByRound.recipe.defaultStance),
    )
    expect(effective).toEqual(['orthodox', 'southpaw', 'orthodox', 'southpaw'])
  })

  it('declares switch-by-round on the recipe', () => {
    expect(switchByRound.recipe.stanceMode).toBe('switch-by-round')
  })

  it('inverts the hand sequence of the same combination between rounds', () => {
    // The same authored numbers produce opposite hands, which is what the
    // stance-change card has to communicate (M32-06).
    const orthodoxBlock = switchByRound.schedule[0]!.blocks[0]!
    const southpawBlock = switchByRound.schedule[1]!.blocks[0]!
    const orthodox = handSequence(orthodoxBlock.tokens, 'orthodox')
    const southpaw = handSequence(southpawBlock.tokens, 'southpaw')
    expect(southpaw).toEqual(orthodox.map((h) => (h === 'left' ? 'right' : 'left')))
  })
})

describe('token streams are stable fixtures', () => {
  it.each(ALL.map((s) => [s.key] as [SampleWorkoutKey]))(
    '%s token stream snapshot',
    (key) => {
      // Downstream suites depend on these exact streams; the snapshot makes
      // an accidental edit to a sample visible here rather than as a failure
      // in M32-09.
      const workout = getSampleWorkout(key).workout
      const stream = workout.schedule.map((round) => ({
        theme: round.theme,
        target: round.targetPunches,
        blocks: round.blocks.map((b) => ({
          id: b.id,
          kind: b.kind,
          stance: b.stance,
          repeat: b.repeat ?? null,
          targetPunches: b.targetPunches ?? null,
          tokens: b.tokens.map((t) =>
            t.kind === 'punch' ? `${t.number}${t.body ? 'b' : ''}@${t.beatOffset}` : `${t.command}@${t.beatOffset}`,
          ),
        })),
      }))
      expect(stream).toMatchSnapshot()
    },
  )
})
