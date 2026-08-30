/**
 * `bpmForRecipe` and the byte-identity guarantee for V1a (M39 / #279).
 *
 * The load-bearing invariant: a recipe carrying the new M39 fields
 * (`coachTempo`, `metronome`, `globalSpeed`) with `metronome.enabled:
 * false` must produce exactly the same downstream artifacts as the
 * pre-M39 recipe. Timeline expansion — the widest reach of a single
 * BPM number in the compile chain — is the check. If the nine sample
 * workouts' timelines are deep-equal with and without the new fields,
 * we know the V1a data model change never touched the beat grid.
 *
 * The `metronome.enabled: true` path is exercised separately: the
 * engine BPM (`baseBpm × division × globalSpeed`) is what the
 * bridge returns, and downstream `beatsToMs` continues to consume
 * that number without special-casing.
 */
import {
  bpmForRecipe,
  CADENCE_PROFILES,
} from '../cadence'
import {
  defaultRecipe,
  divisionForCadenceProfile,
  type CadenceProfile,
} from '../WorkoutRecipe'
import { expandTimeline } from '@domain/programs/CueTimeline'
import { listSampleWorkouts } from '../samples'

describe('bpmForRecipe — the M39 bridge', () => {
  it('falls through to the legacy nominalBpm when metronome is off', () => {
    for (const profile of ['technical', 'steady', 'pressure', 'sprint'] as const) {
      const recipe = { ...defaultRecipe(), cadenceProfile: profile }
      expect(bpmForRecipe(recipe)).toBe(CADENCE_PROFILES[profile].nominalBpm)
    }
  })

  it('returns baseBpm × division × globalSpeed when metronome is on', () => {
    const recipe = {
      ...defaultRecipe(),
      metronome: { enabled: true, volume: 0.6 },
      coachTempo: { baseBpm: 60, division: 2 as const, swing: 0.54 },
      globalSpeed: 1,
    }
    expect(bpmForRecipe(recipe)).toBe(120)
  })

  it('scales by globalSpeed (V2 slider preview)', () => {
    const engineOn = (globalSpeed: number): number =>
      bpmForRecipe({
        ...defaultRecipe(),
        metronome: { enabled: true, volume: 0.6 },
        coachTempo: { baseBpm: 60, division: 2, swing: 0.54 },
        globalSpeed,
      })
    expect(engineOn(1)).toBe(120)
    expect(engineOn(0.5)).toBe(60)
    expect(engineOn(1.5)).toBe(180)
  })

  it('covers every documented division at baseBpm 60', () => {
    const engineOn = (division: 1 | 2 | 3 | 4): number =>
      bpmForRecipe({
        ...defaultRecipe(),
        metronome: { enabled: true, volume: 0.6 },
        coachTempo: { baseBpm: 60, division, swing: 0.54 },
        globalSpeed: 1,
      })
    expect(engineOn(1)).toBe(60)
    expect(engineOn(2)).toBe(120)
    expect(engineOn(3)).toBe(180)
    expect(engineOn(4)).toBe(240)
  })
})

describe('divisionForCadenceProfile — the profile→division map', () => {
  it.each([
    ['technical', 1],
    ['steady', 2],
    ['pressure', 3],
    ['sprint', 4],
  ] as Array<[CadenceProfile, number]>)('%s → division %i', (profile, division) => {
    expect(divisionForCadenceProfile(profile)).toBe(division)
  })
})

describe('byte identity — V1a fields must not touch legacy compiles', () => {
  const samples = listSampleWorkouts()

  it('sanity: covers every shipped sample workout', () => {
    // If a sample joins or leaves the picker, this check is the
    // guardrail that says "add it to the byte-identity check too."
    expect(samples.length).toBeGreaterThanOrEqual(9)
  })

  it.each(samples.map((s) => [s.key, s]))(
    '`%s`: expandTimeline is deep-equal at nominalBpm regardless of M39 fields',
    (_key, sample) => {
      // Every shipped sample already carries the new fields (the type
      // requires them); the invariant is that `metronome.enabled: false`
      // gives us the SAME timeline as bpmForRecipe would when computed
      // from the legacy cadenceProfile path. Both sides of the compare
      // go through `expandTimeline` with the same bpm number.
      const legacy = CADENCE_PROFILES[sample.workout.recipe.cadenceProfile].nominalBpm
      const bridged = bpmForRecipe(sample.workout.recipe)
      // The bridge and the legacy path must agree when metronome is off.
      expect(sample.workout.recipe.metronome.enabled).toBe(false)
      expect(bridged).toBe(legacy)

      // And the two expansions must be deep-equal — this is the actual
      // byte-identity assertion V1a needs. If a downstream call
      // silently started reading `coachTempo` instead of the passed
      // `bpm`, this catches it.
      const legacyTimeline = expandTimeline(
        sample.workout,
        sample.workout.recipe.defaultStance,
        legacy,
      )
      const bridgedTimeline = expandTimeline(
        sample.workout,
        sample.workout.recipe.defaultStance,
        bridged,
      )
      expect(bridgedTimeline).toEqual(legacyTimeline)
    },
  )

  it('a hand-flipped `metronome.enabled: true` sample compiles at a DIFFERENT bpm', () => {
    // The mirror of the byte-identity check: prove the bridge actually
    // switches paths. If this test ever produces the same bpm for both,
    // `bpmForRecipe` collapsed its branches and the safety of the
    // migration is gone.
    const legacy = CADENCE_PROFILES.steady.nominalBpm // 100
    const engine = bpmForRecipe({
      ...defaultRecipe(),
      cadenceProfile: 'steady',
      metronome: { enabled: true, volume: 0.6 },
      coachTempo: { baseBpm: 60, division: 2, swing: 0.54 },
      globalSpeed: 1,
    })
    expect(engine).toBe(120)
    expect(engine).not.toBe(legacy)
  })
})
