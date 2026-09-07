/**
 * Every click map the app can run — the hand-authored `CLICK_MAPS` plus the
 * composed quick catalogue, resolved to the identical shape.
 *
 * This is the view the gates must iterate. Before it existed,
 * `clickCallFit.test.ts`, `gen-workout-scripts.ts` (whose `--corpus` output
 * IS the render list) and `fit-round-openers.mjs` walked only the literal
 * maps — so a motif introduced by a composed workout would never be
 * fit-checked and never rendered, and the round would go on glass with a
 * silent call. Import from here, never from `CLICK_MAPS` directly, when the
 * question is "what does the app play?".
 */
import { CLICK_MAPS, type ClickMap } from './clickMaps'
import { QUICK_CLICK_MAPS } from './quickWorkouts'

export function allClickMaps(): Record<string, ClickMap> {
  for (const key of Object.keys(QUICK_CLICK_MAPS)) {
    if (key in CLICK_MAPS) {
      throw new Error(`quick workout '${key}' collides with a hand-authored click map`)
    }
  }
  return { ...CLICK_MAPS, ...QUICK_CLICK_MAPS }
}
