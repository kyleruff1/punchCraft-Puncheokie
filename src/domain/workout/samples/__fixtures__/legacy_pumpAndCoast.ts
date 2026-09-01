/**
 * Pump &amp; Coast — a sample recipe exercising the M39-V2 Phase 4b
 * additions.
 *
 * Two shapes get a dedicated demo here for the first time:
 *
 *   1. `sustained-strike` blocks — one canonical punch pumped for a
 *      fixed window, with the coach saying ONE "Pump the [punch]" at
 *      cue start and staying silent through the block interior. The
 *      Phase 4b render batch produces `sustainedClipFor` per (token,
 *      vocabulary), so any strike token 1..6b can drive one of these.
 *   2. Coasting `active-recovery` blocks with rendered intros +
 *      check-ins — the AR blocks that shipped V1c were silent-body
 *      (see the coasting-design scout, Aug 30 2026). This sample is
 *      what proves the coasting corpus on-glass; the runtime picks
 *      an intro from `coastIntrosFor('active-recovery')` and one
 *      check-in per authored slot.
 *
 * Kept short (three rounds) so it's a demo, not a workout. Rounds
 * are 3:00 each so the interior sustained-strike blocks have room to
 * breathe without the round budget forcing them small.
 */
import { CADENCE_PROFILES } from '../../cadence'
import type { GeneratedWorkout } from '../../GeneratedWorkout'
import type { ProgramRound } from '../../WorkoutTokens'
import { buildRoundSchedule } from '../../roundSchedule'
import { suggestGoal } from '../../punchGoals'
import { defaultRecipe } from '../../WorkoutRecipe'
import { GENERATOR_VERSION } from '../../versions'
import {
  layBlocks,
  padBlocksToRound,
  roundPunchCount,
  withSustainedStrike,
  type BlockSpec,
} from '../authoring'

const BPM = CADENCE_PROFILES.steady.nominalBpm
const ROUND_MS = 240_000
const schedule = buildRoundSchedule(20)

/**
 * Round shape (per round):
 *   1. warm-up combo (repeated-combo, familiar 1-2)
 *   2. sustained-strike pump (30 s of the round's featured punch)
 *   3. active-recovery (15 s, now voiced by the Phase 4b coast corpus)
 *   4. volume-burst tail via padBlocksToRound
 *
 * Featured strike rotates by round: jab / cross / lead hook.
 */
const ROUND_SPECS: Array<{ theme: string; specs: BlockSpec[] }> = [
  {
    theme: 'Pump the jab',
    specs: [
      { id: 'pc1-b1', kind: 'repeated-combo', notation: '1-2', offsets: [0, 0.65], gapBeats: 1.4, repeat: 8, spokenPhrase: 'Jab, cross.' },
      withSustainedStrike({ id: 'pc1-b2', token: '1', durationBeats: 30, gapBeats: 1 }),
      { id: 'pc1-b3', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 15, targetPunches: 5, instruction: 'Breathe.' },
    ],
  },
  {
    theme: 'Pump the cross',
    specs: [
      { id: 'pc2-b1', kind: 'repeated-combo', notation: '1-2-3', offsets: [0, 0.65, 1.35], gapBeats: 1.4, repeat: 6, spokenPhrase: 'Jab, cross, hook.' },
      withSustainedStrike({ id: 'pc2-b2', token: '2', durationBeats: 30, gapBeats: 1 }),
      { id: 'pc2-b3', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 15, targetPunches: 5, instruction: 'Reset.' },
    ],
  },
  {
    theme: 'Pump the body hook',
    specs: [
      { id: 'pc3-b1', kind: 'repeated-combo', notation: '1-2-3b', offsets: [0, 0.65, 1.35], gapBeats: 1.4, repeat: 6, spokenPhrase: 'One, two, body hook.' },
      withSustainedStrike({ id: 'pc3-b2', token: '3B', durationBeats: 30, gapBeats: 1 }),
      { id: 'pc3-b3', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 15, targetPunches: 5, instruction: 'Light. Breathe.' },
    ],
  },
  {
    theme: 'Pump the lead uppercut',
    specs: [
      { id: 'pc4-b1', kind: 'repeated-combo', notation: '1-2-5', offsets: [0, 0.65, 1.35], gapBeats: 1.4, repeat: 6, spokenPhrase: 'One, two, lead upper.' },
      withSustainedStrike({ id: 'pc4-b2', token: '5', durationBeats: 30, gapBeats: 1 }),
      { id: 'pc4-b3', kind: 'active-recovery', notation: '1', offsets: [0], gapBeats: 3, durationBeats: 15, targetPunches: 5, instruction: 'Reset. Ready to switch.' },
    ],
  },
]

const rounds: ProgramRound[] = ROUND_SPECS.map((spec, index) => {
  const blocks = padBlocksToRound(layBlocks(spec.specs, BPM), BPM, ROUND_MS)
  const isLast = index === ROUND_SPECS.length - 1
  return {
    id: `pc-r${index + 1}`,
    order: index + 1,
    kind: 'round',
    countsTowardGoal: true,
    theme: spec.theme,
    workDurationMs: ROUND_MS,
    restAfterMs: isLast ? 0 : 60_000,
    targetPunches: roundPunchCount(blocks),
    blocks,
  }
})

const totalGoal = rounds.reduce((sum, r) => sum + r.targetPunches, 0)

export const pumpAndCoast: GeneratedWorkout = {
  id: 'pump-and-coast',
  recipe: {
    ...defaultRecipe(),
    durationMinutes: 20,
    totalPunchGoal: totalGoal,
    focus: 'balanced',
    bias: 'balanced',
    defaultStance: 'orthodox',
    cadenceProfile: 'steady',
    generatorVersion: GENERATOR_VERSION,
    seed: 'pump-and-coast-2026-08-30',
  },
  schedule: rounds,
  roundPunchTargets: rounds.map((r) => r.targetPunches),
  expectedTechniqueDistribution: {
    '1': 0.55,
    '2': 0.2,
    '3': 0.15,
    '3b': 0.1,
  },
  estimatedActivePunchesPerMinute: Math.round(totalGoal / (schedule.activeSeconds / 60)),
  warnings: [
    `Suggested Steady-tier goal for 20 minutes is ${suggestGoal(20, 'steady', 'balanced')}; this Phase 4b demo prescribes ${totalGoal} and exercises sustained-strike + coast intros.`,
  ],
}
