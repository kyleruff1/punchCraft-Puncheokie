/**
 * The walkout announcement plan: which segments a workout gets, the
 * coach's comedic timing (double breath → joke → landing beat), and the
 * countdown arithmetic the first bell waits on.
 */

import { generateWorkout } from '@domain/workout/generateWorkout'
import { scoredRounds } from '@domain/workout/GeneratedWorkout'
import { defaultRecipe, type WorkoutRecipe } from '@domain/workout/WorkoutRecipe'

import {
  DOUBLE_BREATH_MS,
  INTRO_SEGMENT_GAP_MS,
  INTRO_TAIL_PAD_MS,
  JOKE_LANDING_MAX_MS,
  JOKE_LANDING_MIN_MS,
  jokeLandingMs,
  planIntro,
} from '../introPlan'
import { INTRO_SEGMENTS, type IntroSegment } from '../voiceAssets/introManifest'
import { silenceFor } from '../voiceAssets/silenceManifest'
import { LOBBY_JOKES, type LobbyJoke } from '../voiceAssets/jokeManifest'

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

const FAKE_JOKE: LobbyJoke = { id: 'joke-99', module: 1, durationMs: 8_000 }

function workoutFor(overrides: Partial<WorkoutRecipe> = {}) {
  return generateWorkout({ ...defaultRecipe(), ...overrides })
}

describe('planIntro', () => {
  it('sequences hello, round count, program, the joke, then the send-off', () => {
    const workout = workoutFor({ tier: 'intermediate', cadenceProfile: 'steady' })
    const rounds = scoredRounds(workout.schedule).length
    const plan = planIntro(workout, FULL_FAKE, FAKE_JOKE)
    expect(plan.segments.map((s) => s.id)).toEqual([
      'intro-hello',
      `intro-rounds-${rounds}`,
      'intro-program-intermediate-steady',
      'joke-99',
      'intro-letsgo',
    ])
  })

  it("plans the coach's timing: double breath before the joke, a beat after it", () => {
    const plan = planIntro(workoutFor(), FULL_FAKE, FAKE_JOKE)
    const gaps = Object.fromEntries(plan.segments.map((s) => [s.id, s.gapBeforeMs]))
    expect(gaps['joke-99']).toBe(DOUBLE_BREATH_MS)
    expect(gaps['intro-letsgo']).toBe(jokeLandingMs(FAKE_JOKE.durationMs))
    expect(gaps['intro-hello']).toBe(0)
    // Plain sentences keep the plain breath.
    expect(plan.segments[1]?.gapBeforeMs).toBe(INTRO_SEGMENT_GAP_MS)
  })

  it('has a silence track for every gap the planner can emit', () => {
    // The walkout plays as a NATIVE playlist, so a pause without a silence
    // track silently vanishes from the speech (the missing-1700 bug, run 6).
    const gaps = new Set<number>([DOUBLE_BREATH_MS, INTRO_SEGMENT_GAP_MS])
    for (let ms = 1_000; ms <= 20_000; ms += 50) gaps.add(jokeLandingMs(ms))
    for (const gap of gaps) {
      expect([gap, silenceFor(gap) !== undefined]).toEqual([gap, true])
    }
  })

  it('scales the landing beat with the joke length, inside the bounds', () => {
    // A longer setup earns a longer laugh — but the beat is never clipped
    // short and never becomes a dead stage.
    expect(jokeLandingMs(5_000)).toBeLessThan(jokeLandingMs(9_500))
    for (const joke of LOBBY_JOKES) {
      const beat = jokeLandingMs(joke.durationMs)
      expect(beat).toBeGreaterThanOrEqual(JOKE_LANDING_MIN_MS)
      expect(beat).toBeLessThanOrEqual(JOKE_LANDING_MAX_MS)
    }
    const longJoke: LobbyJoke = { id: 'joke-98', module: 1, durationMs: 60_000 }
    const plan = planIntro(workoutFor(), FULL_FAKE, longJoke)
    expect(plan.segments.at(-1)?.gapBeforeMs).toBe(JOKE_LANDING_MAX_MS)
  })

  it('falls back to the plain breath before the send-off when there is no joke', () => {
    const plan = planIntro(workoutFor(), FULL_FAKE, null)
    expect(plan.segments.some((s) => s.id.startsWith('joke-'))).toBe(false)
    expect(plan.segments.at(-1)?.id).toBe('intro-letsgo')
    expect(plan.segments.at(-1)?.gapBeforeMs).toBe(INTRO_SEGMENT_GAP_MS)
  })

  it('covers every tier x cadence the recipe screen can produce', () => {
    for (const tier of ['beginner', 'intermediate', 'advanced'] as const) {
      for (const cadenceProfile of ['technical', 'steady', 'pressure', 'sprint'] as const) {
        const plan = planIntro(workoutFor({ tier, cadenceProfile }), FULL_FAKE, FAKE_JOKE)
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
      FAKE_JOKE,
    )
    // Round-count and program segments are absent from this manifest, so the
    // plan shrinks to hello → (double breath) → joke → (beat) → send-off.
    expect(plan.segments.map((s) => s.id)).toEqual(['intro-hello', 'joke-99', 'intro-letsgo'])
    expect(plan.totalMs).toBe(
      4_000 +
        DOUBLE_BREATH_MS +
        8_000 +
        jokeLandingMs(8_000) +
        4_000 +
        INTRO_TAIL_PAD_MS,
    )
  })

  it('returns an empty plan when nothing is rendered — the default countdown stands', () => {
    const plan = planIntro(workoutFor(), {}, null)
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
    const plan = planIntro(bent, FULL_FAKE, FAKE_JOKE)
    expect(plan.segments.some((s) => s.id.startsWith('intro-rounds-'))).toBe(false)
    expect(plan.segments.map((s) => s.id)).toContain('intro-hello')
  })

  it('announces every generated default workout from the SHIPPED manifests', () => {
    // The real manifest + the real joke pool: whatever the generator emits
    // must be announceable, and every duration is a measurement.
    const workout = workoutFor()
    const plan = planIntro(workout)
    const rounds = scoredRounds(workout.schedule).length
    expect(plan.segments.map((s) => s.id)).toEqual([
      'intro-hello',
      `intro-rounds-${rounds}`,
      expect.stringMatching(/^intro-program-/),
      expect.stringMatching(/^joke-/),
      'intro-letsgo',
    ])
    expect(plan.totalMs).toBeGreaterThan(15_000)
    for (const segment of Object.values(INTRO_SEGMENTS)) {
      expect(segment.durationMs).toBeGreaterThan(500)
    }
    for (const joke of LOBBY_JOKES) {
      expect(joke.durationMs).toBeGreaterThan(2_000)
    }
  })
})
