/**
 * The walkout announcement plan — which segments this workout gets, in
 * what rhythm, and how long the pre-round countdown must stretch to fit.
 *
 * "Hello! Welcome to punch craft. I'm your coach, Jonathan punch craft.
 * <program-tier sentence> … Let's get started!"
 *
 * The pauses are part of the plan (per-segment `gapBeforeMs`), because
 * the whole point is the coach's timing — a flat 350ms everywhere would
 * read as a script, not a cornerman.
 *
 * The variation space stays finite by composition: whole-sentence clips,
 * one per setting axis (tier × cadence). The rhythm map is untouched:
 * everything here plays inside an EXTENDED countdown, and the session
 * clock — not the playback — decides when the bell rings. A segment
 * missing from a manifest (render gate rejected it) is skipped, and the
 * countdown shortens to match: durations are measured, never guessed.
 *
 * ## Trims
 *
 * - **Jokes removed 2026-08-30.** Kyle retired the joke pool ("they are
 *   all pretty bad, we don't need those and can save time testing"), so
 *   the double-breath / joke-landing pause logic went with the joke —
 *   plain intro-segment gaps carry the flow.
 * - **Round-count sentence removed 2026-08-30.** The "Today, we're boxing
 *   N rounds of four minutes each, with one minute of rest between
 *   rounds." clip added ~6 seconds without telling the athlete anything
 *   they didn't already know from the workout picker. The walkout now
 *   goes hello → program → send-off. The `intro-rounds-{2..12}` wavs
 *   remain on disk (archived); a follow-up prunes the manifest + render
 *   tool.
 */

import type { GeneratedWorkout } from '@domain/workout/GeneratedWorkout'
import { tierFor } from '@domain/workout/WorkoutRecipe'

import { INTRO_SEGMENTS, type IntroSegment } from './voiceAssets/introManifest'
import { findClickScript } from './voiceAssets/clickScriptManifest'

/** Breath between plain sentences. */
export const INTRO_SEGMENT_GAP_MS = 350
/** Quiet after "Let's get started!" before the bell — a beat, not a wall. */
export const INTRO_TAIL_PAD_MS = 900

/**
 * Slack added to the countdown CAP beyond the planned speech. The walkout
 * plays NATIVELY now (run 7 measured it landing exactly on plan), so the
 * only thing this covers is the completion pump being starved — in which
 * case the bell rings at the cap. Keep it tight: a starved pump costs at
 * most this much quiet after "Let's get started!", never 15s of dead air
 * (run 7's lesson — the old 15s slack was sized for JS playback stalls
 * that native playback made impossible).
 */
export const INTRO_COUNTDOWN_SLACK_MS = 1_500

export interface PlannedIntroSegment {
  id: string
  /** Metro module id for the clip. */
  module: number
  durationMs: number
  /** Silence before this segment starts (0 for the first). */
  gapBeforeMs: number
}

export interface IntroPlan {
  segments: PlannedIntroSegment[]
  /** What the countdown must cover: clips + planned pauses + the pre-bell beat. */
  totalMs: number
}

export function planIntro(
  workout: GeneratedWorkout,
  manifest: Readonly<Record<string, IntroSegment>> = INTRO_SEGMENTS,
): IntroPlan {
  const ids: string[] = ['intro-hello']

  ids.push(`intro-program-${tierFor(workout.recipe)}-${workout.recipe.cadenceProfile}`)

  const segments: PlannedIntroSegment[] = ids
    .map((id) => manifest[id])
    .filter((s): s is IntroSegment => s !== undefined)
    .map((s, index) => ({ ...s, gapBeforeMs: index === 0 ? 0 : INTRO_SEGMENT_GAP_MS }))

  // Script Bible v2 pre-bell opener (Kyle, 2026-09-01): on a click set the
  // round-1 section-1 lead-in plays INSIDE the walkout — program sentence,
  // then the opening combo call, then the send-off — so the bell releases
  // straight into punches. The runner's in-round scheduler skips s1 to
  // match. Workouts without click-script clips are untouched.
  const opener = findClickScript(`lead-in/${workout.id}/r1s1`)
  if (opener) {
    segments.push({
      id: opener.id,
      module: opener.module,
      durationMs: opener.durationMs,
      gapBeforeMs: segments.length === 0 ? 0 : INTRO_SEGMENT_GAP_MS,
    })
  }

  const sendOff = manifest['intro-letsgo']
  if (sendOff) {
    segments.push({
      ...sendOff,
      gapBeforeMs: segments.length === 0 ? 0 : INTRO_SEGMENT_GAP_MS,
    })
  }

  if (segments.length === 0) return { segments: [], totalMs: 0 }

  const totalMs =
    segments.reduce((sum, s) => sum + s.gapBeforeMs + s.durationMs, 0) +
    INTRO_TAIL_PAD_MS
  return { segments, totalMs }
}
