/**
 * validateGeneratedWorkout — one fixture per violation class (M31-01).
 *
 * The validator gates hand-authored samples (M31-05) and generator output
 * (M35-03), so its contract is that it reports *everything* wrong in one
 * pass and never throws. A validator that stopped at the first error would
 * make fixing a generated workout an iterative guessing game.
 */

import {
  scoredRounds,
  validateGeneratedWorkout,
  type GeneratedWorkout,
} from '../GeneratedWorkout'
import { parseCombo, type ProgramRound, type WorkoutBlock } from '../WorkoutTokens'
import type { WorkoutRecipe } from '../WorkoutRecipe'

const recipe: WorkoutRecipe = {
  durationMinutes: 20,
  totalPunchGoal: 1000,
  focus: 'balanced',
  defaultStance: 'orthodox',
  stanceMode: 'fixed',
  bias: 'balanced',
  adaptationMode: 'fixed',
  enabledPunches: [1, 2, 3, 4, 5, 6],
  bodyShotPercent: 18,
  enabledDefense: ['slip', 'roll'],
  enabledFootwork: ['pivot', 'reset'],
  enabledCoachCalls: ['breathe'],
  maximumComboPunches: 5,
  defenseFrequency: 'light',
  footworkFrequency: 'light',
  cadenceProfile: 'steady',
  comboComplexity: 3,
  cueRhythmProfile: 'even',
  velocityZoneEmphasis: null,
  metricAnnouncementFrequency: 'round',
  visualLeadTimeMs: 1500,
  commandVocabularyStyle: 'numbers',
  extrasPolicy: 'neutral',
  voiceMode: 'standard',
  voiceVocabulary: 'numbers',
  generatorVersion: 'test-1',
  seed: 'seed-1',
}

const block = (over: Partial<WorkoutBlock> = {}): WorkoutBlock => ({
  id: 'b1',
  kind: 'exact-combo',
  startOffsetMs: 0,
  durationMs: 5_000,
  stance: 'inherit',
  tokens: parseCombo('1-2-3'),
  gapBeats: 2,
  ...over,
})

const round = (over: Partial<ProgramRound> = {}): ProgramRound => ({
  id: 'r1',
  order: 1,
  kind: 'round',
  countsTowardGoal: true,
  theme: 'Establish the jab',
  workDurationMs: 180_000,
  restAfterMs: 60_000,
  targetPunches: 200,
  blocks: [block()],
  ...over,
})

const workout = (over: Partial<GeneratedWorkout> = {}): GeneratedWorkout => ({
  id: 'w1',
  recipe,
  schedule: [round()],
  roundPunchTargets: [200],
  expectedTechniqueDistribution: { '1': 0.43, '2': 0.25 },
  estimatedActivePunchesPerMinute: 67,
  warnings: [],
  ...over,
})

const codes = (w: GeneratedWorkout): string[] => validateGeneratedWorkout(w).map((e) => e.code)

describe('validateGeneratedWorkout', () => {
  it('accepts a well-formed workout', () => {
    expect(validateGeneratedWorkout(workout())).toEqual([])
  })

  it('accepts the three-round shape with warm-up and cooldown excluded from goals', () => {
    const w = workout({
      schedule: [
        round({ id: 'w', order: 0, kind: 'warm-up', countsTowardGoal: false, targetPunches: 0, workDurationMs: 120_000 }),
        round({ id: 'r1', order: 1 }),
        round({ id: 'r2', order: 2 }),
        round({ id: 'c', order: 3, kind: 'cooldown', countsTowardGoal: false, targetPunches: 0, workDurationMs: 60_000 }),
      ],
      roundPunchTargets: [200, 200],
    })
    expect(validateGeneratedWorkout(w)).toEqual([])
    expect(scoredRounds(w.schedule).map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it('never throws — it returns violations', () => {
    const wrecked = workout({ schedule: [], roundPunchTargets: [1, 2, 3] })
    expect(() => validateGeneratedWorkout(wrecked)).not.toThrow()
    expect(validateGeneratedWorkout(wrecked).length).toBeGreaterThan(0)
  })

  it('reports EVERY violation in one pass, not just the first', () => {
    const w = workout({
      schedule: [
        round({ order: 5 }),
        round({ id: 'r2', order: 1, kind: 'warm-up', countsTowardGoal: true }),
      ],
      roundPunchTargets: [],
    })
    const found = codes(w)
    expect(found).toEqual(
      expect.arrayContaining(['rounds-not-ordered', 'counts-toward-goal-mismatch', 'round-targets-length-mismatch']),
    )
    expect(found.length).toBeGreaterThanOrEqual(3)
  })

  it('flags a block that overruns its round work interval', () => {
    const w = workout({
      schedule: [round({ blocks: [block({ startOffsetMs: 179_000, durationMs: 5_000 })] })],
    })
    expect(codes(w)).toContain('block-overruns-round')
  })

  it('flags rounds that are out of order', () => {
    const w = workout({
      schedule: [round({ order: 3 }), round({ id: 'r2', order: 1 })],
      roundPunchTargets: [200, 200],
    })
    expect(codes(w)).toContain('rounds-not-ordered')
  })

  it.each([
    ['warm-up', true],
    ['cooldown', true],
    ['round', false],
  ] as const)('flags countsTowardGoal=%p being wrong for kind %s', (kind, counts) => {
    const w = workout({
      schedule: [round({ kind, countsTowardGoal: counts })],
      roundPunchTargets: counts ? [200] : [],
    })
    expect(codes(w)).toContain('counts-toward-goal-mismatch')
  })

  it('flags roundPunchTargets whose length does not match the scored-round count', () => {
    const w = workout({ roundPunchTargets: [200, 200] })
    expect(codes(w)).toContain('round-targets-length-mismatch')
  })

  it('flags decreasing beat offsets within a block', () => {
    const w = workout({
      schedule: [
        round({
          blocks: [
            block({
              tokens: [
                { kind: 'punch', number: 1, body: false, beatOffset: 0 },
                { kind: 'punch', number: 2, body: false, beatOffset: 3 },
                { kind: 'punch', number: 3, body: false, beatOffset: 1 },
              ],
            }),
          ],
        }),
      ],
    })
    expect(codes(w)).toContain('token-offsets-not-ordered')
  })

  it('flags repeat on a block kind other than repeated-combo', () => {
    const w = workout({ schedule: [round({ blocks: [block({ kind: 'exact-combo', repeat: 4 })] })] })
    expect(codes(w)).toContain('repeat-on-wrong-block-kind')
  })

  it('allows repeat on repeated-combo', () => {
    const w = workout({ schedule: [round({ blocks: [block({ kind: 'repeated-combo', repeat: 4 })] })] })
    expect(codes(w)).not.toContain('repeat-on-wrong-block-kind')
  })

  it.each([
    ['negative start', { startOffsetMs: -1 }, 'block-negative-start'],
    ['zero duration', { durationMs: 0 }, 'block-nonpositive-duration'],
    ['negative gap', { gapBeats: -1 }, 'negative-gap'],
  ])('flags %s', (_label, over, code) => {
    const w = workout({ schedule: [round({ blocks: [block(over)] })] })
    expect(codes(w)).toContain(code)
  })

  it('flags an empty schedule', () => {
    expect(codes(workout({ schedule: [], roundPunchTargets: [] }))).toContain('empty-schedule')
  })

  it('gives each error a path pointing at the offending value', () => {
    const w = workout({ schedule: [round({ blocks: [block({ startOffsetMs: 179_000 })] })] })
    const err = validateGeneratedWorkout(w).find((e) => e.code === 'block-overruns-round')
    expect(err?.path).toBe('schedule[0].blocks[0]')
  })
})
