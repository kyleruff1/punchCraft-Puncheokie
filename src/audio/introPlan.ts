/**
 * The walkout announcement plan — which segments this workout gets, in
 * what rhythm, and how long the pre-round countdown must stretch to fit.
 *
 * "Hello! Welcome to punch craft. I'm your coach, Jonathan punch craft.
 * Today, we're boxing six rounds of four minutes each… (double breath)
 * …joke… (beat) …Let's get started!"
 *
 * The joke is an EXTENSION OF THE INTRO — the coach sets up the workout,
 * takes a double breath, lands the joke, lets it sit, then sends the
 * athlete off. The pauses are part of the plan (per-segment
 * `gapBeforeMs`), because the whole point is the coach's timing — a flat
 * 350ms everywhere would read as a script, not a cornerman.
 *
 * The variation space stays finite by composition: whole-sentence clips,
 * one per setting axis (round count, tier x cadence), plus one random
 * joke from the 30-deep pool. The rhythm map is untouched: everything
 * here plays inside an EXTENDED countdown, and the session clock — not
 * the playback — decides when the bell rings. A segment missing from a
 * manifest (render gate rejected it) is skipped, and the countdown
 * shortens to match: durations are measured, never guessed.
 */

import {
  scoredRounds,
  type GeneratedWorkout,
} from '@domain/workout/GeneratedWorkout'
import { tierFor } from '@domain/workout/WorkoutRecipe'

import { INTRO_SEGMENTS, type IntroSegment } from './voiceAssets/introManifest'
import { pickLobbyJoke, type LobbyJoke } from './voiceAssets/jokeManifest'

/** Breath between plain sentences. */
export const INTRO_SEGMENT_GAP_MS = 350
/** The double breath before the joke — the setup hangs, then it drops. */
export const DOUBLE_BREATH_MS = 1_700
/** The beat after the punchline, before "Let's get started!". */
export const JOKE_LANDING_MS = 1_000
/** Quiet after "Let's get started!" before the bell — a beat, not a wall. */
export const INTRO_TAIL_PAD_MS = 900

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

/** The round-count sentence exists only for the standard 4-min/1-min shape. */
const STANDARD_WORK_MS = 240_000
const STANDARD_REST_MS = 60_000

export function planIntro(
  workout: GeneratedWorkout,
  manifest: Readonly<Record<string, IntroSegment>> = INTRO_SEGMENTS,
  joke: LobbyJoke | null = pickLobbyJoke() ?? null,
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

  const segments: PlannedIntroSegment[] = ids
    .map((id) => manifest[id])
    .filter((s): s is IntroSegment => s !== undefined)
    .map((s, index) => ({ ...s, gapBeforeMs: index === 0 ? 0 : INTRO_SEGMENT_GAP_MS }))

  if (joke) {
    segments.push({
      id: joke.id,
      module: joke.module,
      durationMs: joke.durationMs,
      gapBeforeMs: segments.length === 0 ? 0 : DOUBLE_BREATH_MS,
    })
  }

  const sendOff = manifest['intro-letsgo']
  if (sendOff) {
    segments.push({
      ...sendOff,
      gapBeforeMs:
        segments.length === 0 ? 0 : joke ? JOKE_LANDING_MS : INTRO_SEGMENT_GAP_MS,
    })
  }

  if (segments.length === 0) return { segments: [], totalMs: 0 }

  const totalMs =
    segments.reduce((sum, s) => sum + s.gapBeforeMs + s.durationMs, 0) +
    INTRO_TAIL_PAD_MS
  return { segments, totalMs }
}
