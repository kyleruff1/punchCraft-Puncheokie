/**
 * The walkout announcement plan: which segments a workout gets, and the
 * countdown arithmetic the first bell waits on.
 */

import { generateWorkout } from '@domain/workout/generateWorkout'
import { scoredRounds } from '@domain/workout/GeneratedWorkout'
import { defaultRecipe, type WorkoutRecipe } from '@domain/workout/WorkoutRecipe'

import {
  INTRO_SEGMENT_GAP_MS,
  INTRO_TAIL_PAD_MS,
  planIntro,
} from '../introPlan'
import { INTRO_SEGMENTS, type IntroSegment } from '../voiceAssets/introManifest'

function fakeManifest(ids: string[], durationMs = 5_000): Record<string, IntroSegment> {
  return Object.fromEntries(ids.map((id) => [id, { id, module: 1, durationMs }]))
}

const FULL_FAKE = fakeManifest([
  'intro-hello',
  'intro-letsgo',
  ...Array.from({ length: 11 }, (_, i) => `intro-rounds-${i + 2}`),
  ...['beginner', 'intermediate', 'advanced'].flatMap((tier) =>
    ['technical', 'steady', 'pressure', 'sprint'].map((c) => `intro-program-${tier}-${c}`),
  ),
])

function workoutFor(overrides: Partial<WorkoutRecipe> = {}) {
  return generateWorkout({ ...defaultRecipe(), ...overrides })
}

describe('planIntro', () => {
  it('announces hello, the round count, the program, and the send-off — in order', () => {
    const workout = workoutFor({ tier: 'intermediate', cadenceProfile: 'steady' })
    const rounds = scoredRounds(workout.schedule).length
    const plan = planIntro(workout, FULL_FAKE)
    expect(plan.segments.map((s) => s.id)).toEqual([
      'intro-hello',
      `intro-rounds-${rounds}`,
      'intro-program-intermediate-steady',
      'intro-letsgo',
    ])
  })

  it('covers every tier x cadence the recipe screen can produce', () => {
    for (const tier of ['beginner', 'intermediate', 'advanced'] as const) {
      for (const cadenceProfile of ['technical', 'steady', 'pressure', 'sprint'] as const) {
        const plan = planIntro(workoutFor({ tier, cadenceProfile }), FULL_FAKE)
        expect(plan.segments.map((s) => s.id)).toContain(
          `intro-program-${tier}-${cadenceProfile}`,
        )
      }
    }
  })

  it('totals clip lengths plus gaps plus the pre-bell beat', () => {
    const plan = planIntro(workoutFor(), fakeManifest(['intro-hello', 'intro-letsgo'], 4_000))
    // Round-count and program segments are absent from this manifest, so the
    // plan gracefully shrinks to the two bookends — and the total with it.
    expect(plan.segments).toHaveLength(2)
    expect(plan.totalMs).toBe(4_000 + 4_000 + INTRO_SEGMENT_GAP_MS + INTRO_TAIL_PAD_MS)
  })

  it('returns an empty plan when nothing is rendered — the default countdown stands', () => {
    const plan = planIntro(workoutFor(), {})
    expect(plan.segments).toHaveLength(0)
    expect(plan.totalMs).toBe(0)
  })

  it('skips the round-count sentence for a non-standard round shape', () => {
    const workout = workoutFor()
    const bent = {
      ...workout,
      schedule: workout.schedule.map((r) =>
        r.countsTowardGoal ? { ...r, workDurationMs: 180_000 } : r,
      ),
    }
    const plan = planIntro(bent, FULL_FAKE)
    expect(plan.segments.some((s) => s.id.startsWith('intro-rounds-'))).toBe(false)
    expect(plan.segments.map((s) => s.id)).toContain('intro-hello')
  })

  it('finds a rendered segment in the SHIPPED manifest for every generated default workout', () => {
    // The real manifest: whatever the generator emits must be announceable.
    const workout = workoutFor()
    const plan = planIntro(workout)
    const rounds = scoredRounds(workout.schedule).length
    expect(plan.segments.map((s) => s.id)).toEqual([
      'intro-hello',
      `intro-rounds-${rounds}`,
      expect.stringMatching(/^intro-program-/),
      'intro-letsgo',
    ])
    expect(plan.totalMs).toBeGreaterThan(10_000)
    // Every shipped duration is a real measurement, not a placeholder.
    for (const segment of Object.values(INTRO_SEGMENTS)) {
      expect(segment.durationMs).toBeGreaterThan(500)
    }
  })
})
