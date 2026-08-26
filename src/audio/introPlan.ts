/**
 * The walkout announcement plan — which intro segments this workout gets,
 * and how long the pre-round countdown must stretch to fit them.
 *
 * "Hello! Welcome to punch craft. I'm your coach, Jonathan punch craft.
 * Today, we're boxing six rounds of four minutes each… Let's get started!"
 *
 * The variation space stays finite by composition: the intro is a sequence
 * of whole-sentence clips (one per setting axis — round count, tier x
 * cadence), never one clip per combination of settings. The rhythm map is
 * untouched: the intro plays inside an EXTENDED countdown, the first bell
 * still starts the work clock, and the session clock — not the intro
 * playback — decides when that bell rings. A segment missing from the
 * manifest (render gate rejected it) is skipped, and the countdown
 * shortens to match: durations here are measured, never guessed.
 */

import {
  scoredRounds,
  type GeneratedWorkout,
} from '@domain/workout/GeneratedWorkout'
import { tierFor } from '@domain/workout/WorkoutRecipe'

import { INTRO_SEGMENTS, type IntroSegment } from './voiceAssets/introManifest'

/** Breath between sentences; part of the planned total, so the bell waits. */
export const INTRO_SEGMENT_GAP_MS = 350
/** Quiet after "Let's get started!" before the bell — a beat, not a wall. */
export const INTRO_TAIL_PAD_MS = 900

export interface IntroPlan {
  segments: IntroSegment[]
  /** What the countdown must cover: clips + gaps + the pre-bell beat. */
  totalMs: number
}

/** The round-count sentence exists only for the standard 4-min/1-min shape. */
const STANDARD_WORK_MS = 240_000
const STANDARD_REST_MS = 60_000

export function planIntro(
  workout: GeneratedWorkout,
  manifest: Readonly<Record<string, IntroSegment>> = INTRO_SEGMENTS,
): IntroPlan {
  const ids: string[] = ['intro-hello']

  const scored = scoredRounds(workout.schedule)
  const standardShape =
    scored.length >= 2 &&
    scored.length <= 12 &&
    scored.every((r) => r.workDurationMs === STANDARD_WORK_MS) &&
    // The last round's rest never gets announced — or heard.
    scored.slice(0, -1).every((r) => r.restAfterMs === STANDARD_REST_MS)
  if (standardShape) ids.push(`intro-rounds-${scored.length}`)

  ids.push(`intro-program-${tierFor(workout.recipe)}-${workout.recipe.cadenceProfile}`)
  ids.push('intro-letsgo')

  const segments = ids
    .map((id) => manifest[id])
    .filter((s): s is IntroSegment => s !== undefined)
  if (segments.length === 0) return { segments: [], totalMs: 0 }

  const totalMs =
    segments.reduce((sum, s) => sum + s.durationMs, 0) +
    INTRO_SEGMENT_GAP_MS * (segments.length - 1) +
    INTRO_TAIL_PAD_MS
  return { segments, totalMs }
}
