/**
 * Switch by Round — click-track edition (MVP v2 Part B, GH #305, Kyle 2026-08-31).
 *
 * Rewritten to the 4-slot bar format from `CLICK_MAPS['switch-by-round']` — the
 * plan's B2-MAPS table, verbatim. The walk is the product: coach voice is
 * capped at 'minimal' (bells, stance, final countdown survive; every
 * punch call belongs to the visuals), the metronome is ON and AUDIBLE,
 * and each round's rows sum exactly to its measure budget (the
 * denominator rule — see clickMaps.ts, self-checked in tests).
 *
 * Sections walk at 1x, 1.5x and 2x under the same BPM overlay; 8-slot
 * rows page as two chunks of 4. No count-scored blocks remain — pumps
 * are `1-1-1-1 xN`, never `1 x4N`, so every block rides the UI-thread
 * walk.
 */
import type { GeneratedWorkout } from '../GeneratedWorkout'
import type { ProgramRound } from '../WorkoutTokens'
import { parseCombo, punchTokens } from '../WorkoutTokens'
import { buildRoundSchedule } from '../roundSchedule'
import { defaultRecipe } from '../WorkoutRecipe'
import { GENERATOR_VERSION } from '../versions'
import { layBlocks, roundPunchCount } from './authoring'
import { CLICK_MAPS, clickSpecs } from './clickMaps'

const MAP = CLICK_MAPS['switch-by-round']!
const schedule = buildRoundSchedule(20)

const rounds: ProgramRound[] = MAP.rounds.map((round, index) => {
  const blocks = layBlocks(clickSpecs('sw', index, round), MAP.bpm)
  const isLast = index === MAP.rounds.length - 1
  return {
    id: `sw-r${index + 1}`,
    order: index + 1,
    kind: 'round',
    countsTowardGoal: true,
    theme: round.theme,
    workDurationMs: 240_000,
    restAfterMs: isLast ? 0 : 60_000,
    targetPunches: roundPunchCount(blocks),
    blocks,
  }
})

const totalGoal = rounds.reduce((sum, r) => sum + r.targetPunches, 0)

// Technique distribution COMPUTED from the map rather than hand-copied,
// so it cannot drift from what the rounds actually prescribe.
const tally: Record<string, number> = {}
for (const round of MAP.rounds) {
  for (const row of round.rows) {
    for (const t of punchTokens(parseCombo(row.motif))) {
      const key = `${t.number}${t.body ? 'b' : ''}`
      tally[key] = (tally[key] ?? 0) + row.reps
    }
  }
}
const tallyTotal = Object.values(tally).reduce((a, b) => a + b, 0)
const expectedTechniqueDistribution = Object.fromEntries(
  Object.entries(tally).map(([k, v]) => [k, Math.round((v / tallyTotal) * 100) / 100]),
)

export const switchByRound: GeneratedWorkout = {
  id: 'switch-by-round',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    totalPunchGoal: totalGoal,
    focus: 'balanced',
    defaultStance: 'orthodox',
    cadenceProfile: 'technical',
    stanceMode: 'switch-by-round',
    // MVP v2: the click IS the audio. Minimal caps the coach at bells +
    // stance + countdown; punch calls belong to the visuals.
    voiceMode: 'minimal',
    // W2 audible grid (Kyle 2026-09-04 "roll into the grid"): the click
    // is ON. Loops now exist at this tempo (metronomeAssets b85/b100
    // d1-d3); the runner swaps the subdivision per section so each rate
    // lands on the grid. coachTempo keeps division 1 so
    // bpmForRecipe === MAP.bpm — the visual node grid is byte-unchanged;
    // only which click WAV plays changes.
    coachTempo: { baseBpm: MAP.bpm, division: 1, swing: 0.5 },

    metronome: { enabled: true, volume: 0.6 },
    generatorVersion: GENERATOR_VERSION,
    seed: 'switch-by-round-2026-08-23',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution,
  estimatedActivePunchesPerMinute: Math.round(totalGoal / (schedule.activeSeconds / 60)),
  warnings: [],
}
