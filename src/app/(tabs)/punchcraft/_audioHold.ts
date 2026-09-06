/**
 * When punchCraft Live may free its audio stack (GH #356).
 *
 * The bug: live.tsx built its coach audio MOUNT-scoped, and a `(tabs)` screen
 * stays mounted after one visit. Measured on the tablet, leaving the screen
 * left 21 native AudioTracks resident for the rest of the session, and the
 * instrument's 30 stacked on top of them — 40 against a ceiling
 * `VoiceOutputExpo` documents at roughly 48, past which creating one more
 * fails and THE WHOLE APP GOES SILENT with nothing reported, because each
 * individual play still looks successful.
 *
 * The trap in fixing it: blur is not the same as finished. The workout runner
 * ticks from a plain `useEffect` with a 50 ms interval and is not focus-aware,
 * so a blurred screen keeps advancing the session, ringing the bell and
 * calling combinations. Releasing audio on blur alone would silence a workout
 * the athlete is *still doing* — they would keep punching to lit rings with no
 * coach, no click and no bell.
 *
 * So the rule is: hold the audio while the screen is focused OR a workout is
 * live; release only when both are false. Every exit from the screen lands in
 * a non-active phase (the Exit button runs `emergencyStop()` on a running
 * workout and navigates directly otherwise), so the common paths all release.
 *
 * Pure and exhaustively tested, deliberately: this is the one predicate that
 * decides whether a workout can go silent, and it is much easier to get right
 * in isolation than inside a 1,000-line screen.
 */
import type { SessionPhase } from '@domain/session/WorkoutSessionClock'

/**
 * Phases in which a workout owns the audio even with the screen blurred.
 *
 * `paused` counts: a pause is a held workout, not a finished one — the athlete
 * is coming back to it, and rebuilding the whole stack under them on resume
 * would cost the first call of the round.
 *
 * `idle` deliberately does NOT count. The lobby has nothing to lose but the
 * walkout, which is rebuilt on focus.
 */
const ACTIVE_PHASES: ReadonlySet<SessionPhase> = new Set<SessionPhase>([
  'countdown',
  'work',
  'rest',
  'paused',
])

export function isWorkoutActive(phase: SessionPhase): boolean {
  return ACTIVE_PHASES.has(phase)
}

/**
 * Whether live.tsx should be holding its native audio players right now.
 *
 * `false` is the ONLY state in which the screen frees them.
 */
export function shouldHoldAudio(input: { phase: SessionPhase; isFocused: boolean }): boolean {
  return input.isFocused || isWorkoutActive(input.phase)
}
