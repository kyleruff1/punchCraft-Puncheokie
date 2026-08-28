/**
 * Repeat thinning (Kyle: "end of this round with 10 seconds left,
 * overlapping audio"): a tightened phase can rep a combination faster
 * than its phrase clip plays. The compiler must not re-call a repeat
 * while the previous phrase is still sounding — the strike grid keeps
 * every rep; only the redundant re-announcement is dropped.
 */
import { compileRoundRhythmMap, REANNOUNCE_MIN_CLEAR_MS } from '../RhythmMap'
import { expandTimeline } from '../CueTimeline'
import { generateWorkout } from '../../workout/generateWorkout'
import { defaultRecipe } from '../../workout/WorkoutRecipe'

// Deliberately long clips force the congested regime everywhere, not just
// in the pressure tail.
const durationFor = (combination: string, cadence: string): number =>
  combination.split('-').length * (cadence === 'sprint' ? 500 : 700) + 300

interface CallPayloadLike {
  mode: string
  combination: string
  cadence: string
}

it('never re-calls a repeat while its phrase is still sounding', () => {
  for (const seed of ['thin-a', 'thin-b', 'thin-c']) {
    const workout = generateWorkout({
      ...defaultRecipe(),
      seed,
      cadenceProfile: 'pressure',
    })
    for (const round of expandTimeline(workout, 'orthodox', 100).filter(
      (r) => r.cues.length > 0,
    )) {
      const map = compileRoundRhythmMap(round, { cadence: 'pressure', durationFor })
      const calls = map.events
        .filter((e) => e.kind === 'call')
        .sort((a, b) => a.atMs - b.atMs)
      for (let i = 1; i < calls.length; i += 1) {
        const prev = calls[i - 1]!
        const cur = calls[i]!
        const p = prev.payload as CallPayloadLike
        const c = cur.payload as CallPayloadLike
        // The window resets across per-word calls and combination changes;
        // ceremony-anchored cues are exempt by design.
        if (p.mode !== 'phrase' || c.mode !== 'phrase') continue
        if (p.combination !== c.combination) continue
        if (round.cues.find((x) => x.id === cur.cueId)?.setupCallout) continue
        expect(cur.atMs).toBeGreaterThanOrEqual(
          prev.atMs + durationFor(p.combination, p.cadence) + REANNOUNCE_MIN_CLEAR_MS,
        )
      }
    }
  }
})

it('still calls every change of combination, however crowded', () => {
  // Thinning is for REPEATS only — a new combination is always announced,
  // even when it lands hot on the previous phrase's tail.
  for (const seed of ['thin-a', 'thin-b']) {
    const workout = generateWorkout({ ...defaultRecipe(), seed, cadenceProfile: 'pressure' })
    for (const round of expandTimeline(workout, 'orthodox', 100).filter(
      (r) => r.cues.length > 0,
    )) {
      const map = compileRoundRhythmMap(round, { cadence: 'pressure', durationFor })
      const calledCues = new Set(
        map.events.filter((e) => e.kind === 'call').map((e) => e.cueId),
      )
      let prevCombo: string | null = null
      for (const cue of round.cues) {
        const combo = cue.tokens.join('-')
        if (combo !== prevCombo) expect(calledCues.has(cue.id)).toBe(true)
        prevCombo = combo
      }
    }
  }
})
