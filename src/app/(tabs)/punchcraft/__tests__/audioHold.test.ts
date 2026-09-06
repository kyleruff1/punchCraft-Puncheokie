/**
 * The audio-hold predicate (GH #356), over every phase and both focus states.
 *
 * There are only fourteen cases, so there is no excuse for sampling them. Two
 * opposite failures are possible and both are bad:
 *
 *   holding too long   → the leak this fixes comes back
 *   releasing too soon → a workout the athlete is still doing goes silent
 *
 * The second is far worse, so the table below is written out by hand rather
 * than generated from the same set the implementation uses — a generated
 * expectation would agree with a wrong implementation.
 */
import type { SessionPhase } from '@domain/session/WorkoutSessionClock'
import { isWorkoutActive, shouldHoldAudio } from '../_audioHold'

const ALL_PHASES: readonly SessionPhase[] = [
  'idle',
  'countdown',
  'work',
  'rest',
  'paused',
  'completed',
  'cancelled',
]

/** Hand-written from the design, NOT derived from the implementation's set. */
const ACTIVE: Readonly<Record<SessionPhase, boolean>> = {
  idle: false, // the lobby owns nothing but the walkout
  countdown: true, // the walkout is speaking into the bell
  work: true, // calls, click and rings
  rest: true, // the recovery script and the round warning
  paused: true, // a held workout is coming back
  completed: false,
  cancelled: false,
}

describe('isWorkoutActive', () => {
  it.each(ALL_PHASES)('%s', (phase) => {
    expect(isWorkoutActive(phase)).toBe(ACTIVE[phase])
  })

  it('covers the whole SessionPhase union', () => {
    // If a phase is ever added to WorkoutSessionClock, this list must grow
    // with it — otherwise the new phase silently defaults to "not active"
    // and a workout in it would lose its audio on blur.
    expect(ALL_PHASES).toHaveLength(7)
    expect(new Set(ALL_PHASES).size).toBe(7)
  })
})

describe('shouldHoldAudio', () => {
  it.each(ALL_PHASES)('a FOCUSED screen always holds, including %s', (phase) => {
    // Focus alone is sufficient. The screen is in front of the athlete; the
    // walkout and the first call must be warm.
    expect(shouldHoldAudio({ phase, isFocused: true })).toBe(true)
  })

  it.each(ALL_PHASES)('a BLURRED screen holds iff a workout is live: %s', (phase) => {
    expect(shouldHoldAudio({ phase, isFocused: false })).toBe(ACTIVE[phase])
  })

  it('releases in exactly three states, all of them blurred', () => {
    const releasing = ALL_PHASES.flatMap((phase) =>
      [true, false]
        .filter((isFocused) => !shouldHoldAudio({ phase, isFocused }))
        .map((isFocused) => `${phase}/${isFocused ? 'focused' : 'blurred'}`),
    )
    expect(releasing.sort()).toEqual([
      'cancelled/blurred',
      'completed/blurred',
      'idle/blurred',
    ])
  })

  it('never releases mid-workout, whatever the focus', () => {
    // The property that matters most: no combination of a live phase and any
    // focus value may free the audio. This is the assertion that would have
    // caught a naive blur-scoped release.
    for (const phase of ALL_PHASES) {
      if (!ACTIVE[phase]) continue
      for (const isFocused of [true, false]) {
        expect(shouldHoldAudio({ phase, isFocused })).toBe(true)
      }
    }
  })

  it('a workout that finishes while blurred becomes releasable', () => {
    // The transition the fix depends on: the athlete leaves mid-round, the
    // runner keeps going to the end, and the audio is freed at the moment the
    // session completes rather than lingering for the session.
    expect(shouldHoldAudio({ phase: 'work', isFocused: false })).toBe(true)
    expect(shouldHoldAudio({ phase: 'completed', isFocused: false })).toBe(false)
  })
})
