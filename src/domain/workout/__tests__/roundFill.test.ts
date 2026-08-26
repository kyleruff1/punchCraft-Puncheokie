/**
 * D26 property suite: no seeded workout may produce a silent round.
 *
 * Coverage-to-the-bell and the silence ceiling are the two guarantees the
 * 2026-08-25 live instruments earned; they hold here for every seed, tier
 * and cadence sampled, so a regression fails CI rather than a bag session.
 */
import { compileRoundRhythmMap } from '../../programs/RhythmMap'
import { coverageAudit, silenceAudit } from '../../programs/mapValidation'
import { generateWorkout } from '../generateWorkout'
import { defaultRecipe, type WorkoutRecipe } from '../WorkoutRecipe'
import { scoredRounds } from '../GeneratedWorkout'
import { expandTimeline } from '../../programs/CueTimeline'
import { punchTokens } from '../WorkoutTokens'
import { CADENCE_PROFILES } from '../cadence'

const durationFor = (combination: string): number | undefined =>
  combination.includes('-') ? 1200 : undefined

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
const TIERS = ['beginner', 'intermediate', 'advanced'] as const

function make(over: Partial<WorkoutRecipe>): ReturnType<typeof generateWorkout> {
  return generateWorkout({ ...defaultRecipe(), ...over })
}

describe.each(SEEDS)('D26 fill properties (seed %s)', (seed) => {
  it.each(TIERS)('%s: every scored round is covered and never silent', (tier) => {
    const workout = make({ seed, tier, durationMinutes: 20 })
    const bpm = CADENCE_PROFILES[workout.recipe.cadenceProfile].nominalBpm
    const timeline = expandTimeline(workout, 'orthodox', bpm)

    for (const round of scoredRounds(workout.schedule)) {
      const coverage = coverageAudit(round.blocks, round.workDurationMs)
      expect(coverage.ok).toBe(true)

      const timelineRound = timeline.find((t) => t.workDurationMs === round.workDurationMs && t.roundIndex === workout.schedule.indexOf(round))
      if (!timelineRound) continue
      const map = compileRoundRhythmMap(timelineRound, {
        cadence: workout.recipe.cadenceProfile,
        durationFor,
      })
      const silence = silenceAudit(map)
      expect(silence.maxGapMs).toBeLessThanOrEqual(20_000)
    }
  })

  it('is deterministic per seed', () => {
    const a = make({ seed, durationMinutes: 20 })
    const b = make({ seed, durationMinutes: 20 })
    expect(a).toEqual(b)
  })

  it('beginner rounds never exceed the tier length band', () => {
    const workout = make({ seed, tier: 'beginner', durationMinutes: 20, maximumComboPunches: 4 })
    for (const round of scoredRounds(workout.schedule)) {
      for (const block of round.blocks) {
        expect(punchTokens(block.tokens).length).toBeLessThanOrEqual(4)
      }
    }
  })
})
