/**
 * The walkout announcement plan: which segments a workout gets and the
 * countdown arithmetic the first bell waits on. Jokes retired
 * 2026-08-30 (Kyle: "they are all pretty bad"). Round-count sentence
 * retired 2026-08-30 (Kyle: "extends the walkout too much without
 * actually describing anything helpful about the workout"). Plan is
 * now hello → program → send-off, with a plain sentence breath
 * between each.
 */

import { generateWorkout } from '@domain/workout/generateWorkout'
import { defaultRecipe, type WorkoutRecipe } from '@domain/workout/WorkoutRecipe'

import {
  INTRO_SEGMENT_GAP_MS,
  INTRO_TAIL_PAD_MS,
  planIntro,
} from '../introPlan'
import { INTRO_SEGMENTS, type IntroSegment } from '../voiceAssets/introManifest'
import { silenceFor } from '../voiceAssets/silenceManifest'

function fakeManifest(ids: string[], durationMs = 5_000): Record<string, IntroSegment> {
  return Object.fromEntries(ids.map((id) => [id, { id, module: 1, durationMs }]))
}

const FULL_FAKE = fakeManifest([
  'intro-hello',
  'intro-letsgo',
  ...['beginner', 'intermediate', 'advanced'].flatMap((tier) =>
    ['technical', 'steady', 'pressure', 'sprint'].map((c) => `intro-program-${tier}-${c}`),
  ),
])

function workoutFor(overrides: Partial<WorkoutRecipe> = {}) {
  return generateWorkout({ ...defaultRecipe(), ...overrides })
}

describe('planIntro', () => {
  it('sequences hello, program, then the send-off', () => {
    const workout = workoutFor({ tier: 'intermediate', cadenceProfile: 'steady' })
    const plan = planIntro(workout, FULL_FAKE)
    expect(plan.segments.map((s) => s.id)).toEqual([
      'intro-hello',
      'intro-program-intermediate-steady',
      'intro-letsgo',
    ])
  })

  it('opens on the hello and hands every following segment the plain sentence breath', () => {
    const plan = planIntro(workoutFor(), FULL_FAKE)
    const gaps = Object.fromEntries(plan.segments.map((s) => [s.id, s.gapBeforeMs]))
    expect(gaps['intro-hello']).toBe(0)
    for (const [id, gap] of Object.entries(gaps)) {
      if (id === 'intro-hello') continue
      expect(gap).toBe(INTRO_SEGMENT_GAP_MS)
    }
  })

  it('has a silence track for every gap the planner can emit', () => {
    // The walkout plays as a NATIVE playlist, so a pause without a silence
    // track silently vanishes from the speech (the missing-1700 bug, run 6).
    // The plan only ever emits the plain sentence gap.
    expect(silenceFor(INTRO_SEGMENT_GAP_MS)).toBeDefined()
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

  it('totals clips plus every planned pause plus the pre-bell beat', () => {
    const plan = planIntro(
      workoutFor(),
      fakeManifest(['intro-hello', 'intro-letsgo'], 4_000),
    )
    // Program segment is absent from this manifest, so the plan
    // shrinks to hello → (breath) → send-off.
    expect(plan.segments.map((s) => s.id)).toEqual(['intro-hello', 'intro-letsgo'])
    expect(plan.totalMs).toBe(
      4_000 + INTRO_SEGMENT_GAP_MS + 4_000 + INTRO_TAIL_PAD_MS,
    )
  })

  it('returns an empty plan when nothing is rendered — the default countdown stands', () => {
    const plan = planIntro(workoutFor(), {})
    expect(plan.segments).toHaveLength(0)
    expect(plan.totalMs).toBe(0)
  })

  it('announces every generated default workout from the SHIPPED manifests', () => {
    // The real manifest: whatever the generator emits must be announceable
    // and every duration is a measurement.
    const workout = workoutFor()
    const plan = planIntro(workout)
    expect(plan.segments.map((s) => s.id)).toEqual([
      'intro-hello',
      expect.stringMatching(/^intro-program-/),
      'intro-letsgo',
    ])
    expect(plan.totalMs).toBeGreaterThan(5_000)
    for (const segment of Object.values(INTRO_SEGMENTS)) {
      expect(segment.durationMs).toBeGreaterThan(500)
    }
  })

  it('has no round-count sentence — retired 2026-08-30', () => {
    // Regression guard: the "N rounds of four minutes each with rests"
    // clip added ~6 seconds without saying anything the athlete didn't
    // already pick. Even if the shipped manifest carries the wavs, the
    // planner must NOT compose them.
    const plan = planIntro(workoutFor(), FULL_FAKE)
    expect(plan.segments.some((s) => s.id.startsWith('intro-rounds-'))).toBe(false)
  })

  it('has no joke segments — jokes retired 2026-08-30', () => {
    // Regression guard: if someone accidentally reintroduces a joke path
    // (or the introManifest starts shipping joke-* ids again), this test
    // catches it.
    const plan = planIntro(workoutFor(), FULL_FAKE)
    expect(plan.segments.some((s) => s.id.startsWith('joke-'))).toBe(false)
  })
})
