/**
 * Coast sections (D23).
 *
 * A coast establishes a back-and-forth between two shots and lets the athlete
 * hold it for a stated time. The coach says it once — "coast for half a
 * minute" — and then stops calling, because the rhythm is understood rather
 * than guessed. That is what makes it different from the beeped repetitions
 * D22 retired: silence after a coast means "keep the pattern", where a tone
 * meant "something is expected and you work out what".
 *
 * This module is the single source of truth for how long a coast may run and
 * how that length is spoken. Both matter together: the spoken phrase is a
 * pre-rendered clip, so a duration nothing can say is a duration the coach
 * cannot announce. The generator therefore chooses from this table rather than
 * picking an arbitrary number of seconds.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import type { VoiceAssetId } from '../coach/VoiceOutputPort'

export interface CoastDuration {
  /** The clip that announces it. */
  assetId: Extract<VoiceAssetId, `coast-${string}`>
  seconds: number
  /**
   * What the coach actually says. Seconds for the short ones, plain language
   * for the round ones — "half a minute" is what a person in a gym says, and
   * "coast for sixty" is what a stopwatch says.
   */
  spoken: string
}

/**
 * Every coast length the coach can announce, shortest first.
 *
 * Deliberately few. Each is a rendered clip, and a coast is a texture in a
 * round rather than a dial — offering fifteen lengths would multiply the
 * corpus to make a distinction nobody hears.
 */
export const COAST_DURATIONS: readonly CoastDuration[] = [
  { assetId: 'coast-15', seconds: 15, spoken: 'Coast for fifteen seconds.' },
  { assetId: 'coast-30', seconds: 30, spoken: 'Coast for half a minute.' },
  { assetId: 'coast-45', seconds: 45, spoken: 'Coast for forty-five seconds.' },
  { assetId: 'coast-60', seconds: 60, spoken: 'Coast for a minute.' },
]

/**
 * The announceable coast nearest a wanted length.
 *
 * Rounds to the closest rather than the longest-that-fits: a 40-second gap is
 * better filled by a 45-second coast that runs a little into the next block's
 * slack than by a 30-second one that leaves ten seconds of silence. Ties go to
 * the shorter, which cannot overrun.
 */
export function coastFor(wantedSeconds: number): CoastDuration {
  let best = COAST_DURATIONS[0] as CoastDuration
  for (const candidate of COAST_DURATIONS) {
    const closer =
      Math.abs(candidate.seconds - wantedSeconds) < Math.abs(best.seconds - wantedSeconds)
    if (closer) best = candidate
  }
  return best
}

/** Look a coast up by the clip that announces it. */
export function coastByAssetId(assetId: string): CoastDuration | undefined {
  return COAST_DURATIONS.find((d) => d.assetId === assetId)
}
