/**
 * Pace Pusher — click-track edition (MVP v2 Part B, GH #305, Kyle 2026-08-31).
 *
 * Rewritten to the 4-slot bar format from `CLICK_MAPS['pace-pusher']` — the
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

const MAP = CLICK_MAPS['pace-pusher']!
const schedule = buildRoundSchedule(20)

const rounds: ProgramRound[] = MAP.rounds.map((round, index) => {
  const blocks = layBlocks(clickSpecs('pp', index, round), MAP.bpm)
  const isLast = index === MAP.rounds.length - 1
  return {
    id: `pp-r${index + 1}`,
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

export const pacePusher: GeneratedWorkout = {
  id: 'pace-pusher',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    totalPunchGoal: totalGoal,
    focus: 'balanced',
    bias: 'balanced',
    defaultStance: 'orthodox',
    cadenceProfile: 'pressure',
    // MVP v2: the click IS the audio. Minimal caps the coach at bells +
    // stance + countdown; punch calls belong to the visuals.
    voiceMode: 'minimal',
    // Loop-asset contract (metronomeAssets.ts): every wav is 1000ms = one
    // 60-BPM base pulse; TEMPO SCALES BY DIVISION, never baseBpm. Getting
    // this wrong told the transport 180 BPM against a 1s loop — a
    // permanent ~3s error observed ~500x/sec (the red-screen flood).
    coachTempo: { baseBpm: 60, division: 3, swing: 0.5 },

    metronome: { enabled: true, volume: 0.6 },
    generatorVersion: GENERATOR_VERSION,
    seed: 'pace-pusher-2026-08-29',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution,
  estimatedActivePunchesPerMinute: Math.round(totalGoal / (schedule.activeSeconds / 60)),
  warnings: [],
}
