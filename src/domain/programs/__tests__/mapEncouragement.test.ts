/**
 * M4: encouragement fills audited gaps without touching the map's rhythm.
 *
 * Kyle's constraint, held as a property: coach personality NEVER offsets
 * the rhythm map — every call, refire and tone keeps its exact compiled
 * time whether encouragement is on or off; the lines land only inside
 * voiced gaps longer than the grid, density-capped.
 */
import {
  compileRoundRhythmMap,
  ENCOURAGEMENT_GAP_MS,
  MAX_ENCOURAGEMENTS_PER_ROUND,
  MAX_POWER_ANNOUNCES_PER_ROUND,
  POWER_MIN_INTERVAL_MS,
} from '../RhythmMap'
import type { RoundTimeline } from '../CueTimeline'
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
    // Power call-outs share the kind but have their own placement rule —
    // they live INSIDE a slow window, not in the rotation's silence grid.
    const lines = map.events.filter(
      (e) => e.kind === 'encouragement' && !e.id.startsWith('power#'),
    )
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

describe('power mode on the rhythm map', () => {
  // A hand-built round: five reps of a 2-punch segment spaced 6s apart —
  // Kyle's "3.......4......." shape — followed by a dense 4-punch block.
  function slowRound(intervalMs: number, tokensPerCue = 2): RoundTimeline {
    const tokens = Array.from({ length: tokensPerCue }, (_, i) => ({
      kind: 'punch' as const,
      number: (i % 2 === 0 ? 1 : 2) as 1 | 2,
      beatOffset: i * 0.5,
    }))
    const cues = Array.from({ length: 5 }, (_, rep) => ({
      id: `slow-${rep}`,
      blockId: 'slow',
      tokens,
      previewAt: rep * intervalMs - 2_000,
      announceAt: rep * intervalMs - 750,
      scheduledStartMs: rep * intervalMs,
      windowEndMs: rep * intervalMs + 1_500,
      scoring: 'sequence' as const,
      repeatIndex: rep,
    }))
    return { roundIndex: 0, workDurationMs: 60_000, cues } as unknown as RoundTimeline
  }

  it('calls out power inside a slow 1-2 strike window, after it starts', () => {
    const map = compileRoundRhythmMap(slowRound(6_000), {
      cadence: 'steady',
      durationFor,
      encouragement: true,
    })
    const power = map.events.filter((e) => e.id.startsWith('power#'))
    expect(power).toHaveLength(1)
    expect(power[0]!.payload).toEqual({ asset: 'power-strikes' })
    // Inside the first inter-strike gap: after the first strike, before
    // the second.
    expect(power[0]!.atMs).toBeGreaterThan(0)
    expect(power[0]!.atMs).toBeLessThan(6_000)
    expect(map.events.filter((e) => e.id.startsWith('power#')).length).toBeLessThanOrEqual(
      MAX_POWER_ANNOUNCES_PER_ROUND,
    )
  })

  it('stays silent on a dense run of the same segment', () => {
    const map = compileRoundRhythmMap(slowRound(POWER_MIN_INTERVAL_MS - 1_000), {
      cadence: 'steady',
      durationFor,
      encouragement: true,
    })
    expect(map.events.filter((e) => e.id.startsWith('power#'))).toHaveLength(0)
  })

  it('never wraps longer combinations — power is a 1-2 strike mode', () => {
    const map = compileRoundRhythmMap(slowRound(6_000, 4), {
      cadence: 'steady',
      durationFor,
      encouragement: true,
    })
    expect(map.events.filter((e) => e.id.startsWith('power#'))).toHaveLength(0)
  })

  it('moves nothing else in the map — audio/visual sync is untouched', () => {
    const round = slowRound(6_000)
    const off = compileRoundRhythmMap(round, { cadence: 'steady', durationFor })
    const on = compileRoundRhythmMap(round, { cadence: 'steady', durationFor, encouragement: true })
    const times = (m: typeof off) =>
      m.events
        .filter((e) => e.kind !== 'encouragement')
        .map((e) => `${e.kind}:${e.id}@${e.atMs}`)
        .sort()
    expect(times(on)).toEqual(times(off))
  })
})
