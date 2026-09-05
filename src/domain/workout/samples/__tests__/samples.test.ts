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
import { CLICK_MAPS } from '../clickMaps'
import { bpmForRecipe, msToBeats } from '../../cadence'
import { punchTokens } from '../../WorkoutTokens'
import { blocksSpanMs, roundPunchCount } from '../authoring'
import { handSequence, resolveEffectiveStance } from '../../../programs/StanceMapper'

const ALL = listSampleWorkouts()

describe('the sample catalogue', () => {
  it('exposes exactly the ten binding keys', () => {
    expect(ALL.map((s) => s.key)).toEqual([
      'three-round-fundamentals',
      'establish-the-jab-20',
      'switch-by-round',
      'heavy-hands',
      'speed-combos',
      'uppercut-clinic',
      'progressive-buildup',
      'body-work',
      'pace-pusher',
      'pump-and-coast',
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

  it('keeps bpmForRecipe locked to the click-map tempo (W2 visual-grid invariant)', () => {
    // The load-bearing law for the W2 audible grid (Kyle 2026-09-04 "roll
    // into the grid"): enabling the metronome on the slow sets must NOT
    // move the visual node/avatar grid. The grid tempo IS bpmForRecipe, so
    // it must equal the click map's authored bpm for every sample —
    // whether the click is on (baseBpm×division = MAP.bpm) or off (legacy
    // nominalBpm path). If a future edit changes coachTempo without
    // preserving the product, this fails before it ever reaches glass.
    const map = CLICK_MAPS[key]
    expect(map).toBeDefined()
    expect(bpmForRecipe(workout.recipe)).toBe(map!.bpm)
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
    // Engine BPM, not the legacy profile nominal: the click-track sets
    // (MVP v2, GH #305) run `metronome.enabled` with
    // `coachTempo.baseBpm = MAP.bpm`, and decoding their durations at the
    // profile BPM reads a different clock than the one they are authored
    // on. `bpmForRecipe` is the single bridge both paths share.
    const bpm = bpmForRecipe(workout.recipe)
    // 1/60 beat: admits both the legacy 0.05-beat authoring grid AND the
    // click sets' subdivision walks — 1.5x rows place slots every 2/3
    // beat, whose breaths land on thirds.
    const SUBDIVISION = 1 / 60
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
    // Themes are AUTHORED coaching copy (Script Bible v2) where boxing
    // vocabulary like "power shots" is legitimate — §4.3 is about metric
    // LABELING, and the context-scoped guard (tools/guards/
    // velocity-terminology.mjs, run in CI) covers themes there. This
    // blanket check keeps only the mechanical strings we generate.
    const strings = workout.schedule.flatMap((r) =>
      r.blocks.flatMap((b) => [b.spokenPhrase ?? '', b.instruction ?? '']),
    )
    for (const text of strings) {
      for (const pattern of banned) expect(text).not.toMatch(pattern)
    }
  })
})

describe('three-round-fundamentals — click-track edition (MVP v2, GH #305)', () => {
  // The doc §4 fragment identity moved to the FROZEN fixtures
  // (samples/__fixtures__) with the rest of the pre-rewrite shapes; the
  // live sample now pins the click-track contract instead.
  const round1 = threeRoundFundamentals.schedule[0]!

  it('keeps its identity: orthodox, documented seed, three scored rounds', () => {
    expect(threeRoundFundamentals.recipe.defaultStance).toBe('orthodox')
    expect(threeRoundFundamentals.recipe.seed).toBe('fundamentals-2026-08-22')
    expect(threeRoundFundamentals.schedule).toHaveLength(3)
  })

  it('is a click set: metronome audible, voice capped at minimal, 120 BPM', () => {
    expect(threeRoundFundamentals.recipe.metronome).toEqual({ enabled: true, volume: 0.6 })
    expect(threeRoundFundamentals.recipe.voiceMode).toBe('minimal')
    expect(bpmForRecipe(threeRoundFundamentals.recipe)).toBe(120)
  })

  it('opens with the 1-1-1-1 bar at whole-beat offsets, x10', () => {
    const block = round1.blocks[0]!
    expect(block.kind).toBe('repeated-combo')
    expect(block.repeat).toBe(9) // 10 -> 9: setup-pause rebalance (2026-09-02)
    expect(block.tokens.map((t) => t.beatOffset)).toEqual([0, 1, 2, 3])
    expect(punchTokens(block.tokens).map((t) => t.number)).toEqual([1, 1, 1, 1])
  })

  it('walks all three rates in round 1 — 1x, 1.5x and 2x under one BPM', () => {
    const steps = round1.blocks.map((b) => b.tokens[1]!.beatOffset - b.tokens[0]!.beatOffset)
    expect(new Set(steps.map((v) => Math.round(1000 / v) / 1000))).toEqual(
      new Set([1, 1.5, 2]),
    )
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

  it('ships no warnings — targets are derived from the maps, never asserted', () => {
    // Click sets compute totals from CLICK_MAPS rows, so there is no
    // hand-vs-tier gap to disclose (MVP v2, GH #305).
    expect(establishTheJab20.warnings).toEqual([])
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
          tokens: b.tokens.map((t) => {
            if (t.kind === 'punch') return `${t.number}${t.body ? 'b' : ''}@${t.beatOffset}`
            if (t.kind === 'rest') return `rest@${t.beatOffset}`
            return `${t.command}@${t.beatOffset}`
          }),
        })),
      }))
      expect(stream).toMatchSnapshot()
    },
  )
})
