/**
 * M4: encouragement fills audited gaps without touching the map's rhythm.
 *
 * Kyle's constraint, held as a property: coach personality NEVER offsets
 * the rhythm map — every call, refire and tone keeps its exact compiled
 * time whether encouragement is on or off; the lines land only inside
 * voiced gaps longer than the grid, density-capped.
 */
import { compileRoundRhythmMap, ENCOURAGEMENT_GAP_MS, MAX_ENCOURAGEMENTS_PER_ROUND } from '../RhythmMap'
import { silenceAudit } from '../mapValidation'
import { expandTimeline } from '../CueTimeline'
import { generateWorkout } from '../../workout/generateWorkout'
import { defaultRecipe } from '../../workout/WorkoutRecipe'
import { threeRoundFundamentals } from '../../workout/samples/threeRoundFundamentals'

const durationFor = (combination: string): number | undefined =>
  combination.includes('-') ? 1200 : undefined

describe('encouragement on the rhythm map', () => {
  const round = expandTimeline(threeRoundFundamentals, 'orthodox', 100)[0]!

  it('never moves a call, refire or tone', () => {
    const off = compileRoundRhythmMap(round, { cadence: 'steady', durationFor })
    const on = compileRoundRhythmMap(round, { cadence: 'steady', durationFor, encouragement: true })
    const times = (m: typeof off) =>
      m.events
        .filter((e) => e.kind !== 'encouragement')
        .map((e) => `${e.kind}:${e.id}@${e.atMs}`)
        .sort()
    expect(times(on)).toEqual(times(off))
  })

  it('lands only in voiced gaps longer than the grid, density-capped', () => {
    const map = compileRoundRhythmMap(round, { cadence: 'steady', durationFor, encouragement: true })
    const lines = map.events.filter((e) => e.kind === 'encouragement')
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.length).toBeLessThanOrEqual(MAX_ENCOURAGEMENTS_PER_ROUND)

    const calls = map.events
      .filter((e) => e.kind === 'call' || e.kind === 'refire')
      .map((e) => e.atMs)
    for (const line of lines) {
      // Comfortably clear of every call — inside the silence, never on it.
      const nearest = Math.min(...calls.map((t) => Math.abs(t - line.atMs)))
      expect(nearest).toBeGreaterThan(2_000)
    }
  })

  it('tightens the silence audit on a D26-filled generated round', () => {
    const workout = generateWorkout({ ...defaultRecipe(), seed: 'm4-encourage' })
    const timeline = expandTimeline(workout, 'orthodox', 100)
    const scored = timeline.find((r) => r.cues.length > 0)!
    const on = compileRoundRhythmMap(scored, { cadence: 'steady', durationFor, encouragement: true })
    expect(silenceAudit(on, ENCOURAGEMENT_GAP_MS + 6_000).ok).toBe(true)
  })

  it('per-cue cadence names the block band in the payload', () => {
    const workout = generateWorkout({ ...defaultRecipe(), seed: 'm4-cadence' })
    const timeline = expandTimeline(workout, 'orthodox', 100)
    const scored = timeline.find((r) => r.cues.some((c) => c.cadence !== undefined))!
    const map = compileRoundRhythmMap(scored, { cadence: 'steady', durationFor })
    const banded = map.events.filter(
      (e) =>
        (e.kind === 'call' || e.kind === 'refire') &&
        e.payload !== null &&
        'cadence' in e.payload &&
        e.payload.cadence !== 'steady',
    )
    expect(banded.length).toBeGreaterThan(0)
  })
})
