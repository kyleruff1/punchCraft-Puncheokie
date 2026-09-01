/**
 * Speakable-envelope audit.
 *
 * GH #305, fix #17. Speed Combos on-glass exposed a physics problem: at
 * 240 BPM a `1-2` block repeats every 525 ms while the clip that names it
 * needs ~1000-1400 ms to speak. The coach cannot call every rep, so the
 * repeat-thinning gate silently drops most of them and the athlete hears
 * bursts separated by long silences.
 *
 * Before writing a rule that auto-selects `announce-then-work` for blocks
 * that do not fit, we need to know HOW MANY do not fit. If it is a
 * handful, a derived rule handling exceptions is right. If it is half the
 * program, the voice character of the whole app is the real subject and
 * that is an editorial decision, not a runtime fallback.
 *
 * This measures every block of every sample workout and reports the
 * distribution. It authors nothing and changes no behaviour.
 *
 * Usage:
 *   node --import ./tools/analysis/wav-stub.mjs --import tsx \
 *        tools/analysis/speakable-envelope-audit.ts
 */

import { listSampleWorkouts } from '../../src/domain/workout/samples'
import { bpmForRecipe } from '../../src/domain/workout/cadence'
import { beatsToMs, maxBeatOffset } from '../../src/domain/workout/cadence'
import { formatCombo, type WorkoutBlock } from '../../src/domain/workout/WorkoutTokens'

/**
 * Milliseconds one spoken token needs. Matches
 * `PER_TOKEN_PHRASE_ESTIMATE_MS` in RhythmMap, deliberately: the envelope
 * rule should agree with the thinning gate that is already dropping these
 * calls, so the two share one notion of "how long the coach takes".
 */
const SPOKEN_TOKEN_MS = 500
/** Clearance between the clip's tail and the next call. */
const CLEARANCE_MS = 150

interface BlockVerdict {
  workout: string
  blockId: string
  notation: string
  bpm: number
  repeats: number
  spokenTokens: number
  strideMs: number
  clipMs: number
  needMs: number
  fits: boolean
  authored: string | undefined
}

/** Tokens that produce audio — coach tokens have no clip (doc §18.2). */
function spokenTokenCount(block: WorkoutBlock): number {
  return block.tokens.filter((t) => t.kind !== 'coach').length
}

function auditBlock(workout: string, block: WorkoutBlock, bpm: number): BlockVerdict {
  const comboSpanMs = beatsToMs(maxBeatOffset(block.tokens), bpm)
  const gapMs = beatsToMs(block.gapBeats, bpm)
  const strideMs = comboSpanMs + gapMs
  const spokenTokens = spokenTokenCount(block)
  const clipMs = spokenTokens * SPOKEN_TOKEN_MS
  const needMs = clipMs + CLEARANCE_MS
  const repeats = Math.max(1, block.repeat ?? 1)
  return {
    workout,
    blockId: block.id,
    notation: formatCombo(block.tokens),
    bpm,
    repeats,
    spokenTokens,
    strideMs,
    clipMs,
    needMs,
    // A block that never repeats is spoken once, so the stride is
    // irrelevant — it always fits.
    fits: repeats <= 1 || strideMs >= needMs,
    authored: block.voicePolicy,
  }
}

function main(): void {
  const verdicts: BlockVerdict[] = []
  for (const sample of listSampleWorkouts()) {
    const bpm = bpmForRecipe(sample.workout.recipe)
    for (const round of sample.workout.schedule) {
      for (const block of round.blocks) {
        verdicts.push(auditBlock(sample.key, block, bpm))
      }
    }
  }

  const repeating = verdicts.filter((v) => v.repeats > 1)
  const misfits = repeating.filter((v) => !v.fits)

  console.log('# Speakable-envelope audit\n')
  console.log(`Total blocks:            ${verdicts.length}`)
  console.log(`Repeating blocks:        ${repeating.length}`)
  console.log(
    `OUTSIDE the envelope:    ${misfits.length}` +
      ` (${((misfits.length / Math.max(1, repeating.length)) * 100).toFixed(0)}% of repeating)`,
  )
  console.log(`Already authored:        ${verdicts.filter((v) => v.authored).length}\n`)

  // Per-workout share — is this one fast workout or the whole program?
  console.log('## Misfit share per workout\n')
  console.log('| Workout | BPM | repeating | outside | share |')
  console.log('|---|---|---|---|---|')
  for (const sample of listSampleWorkouts()) {
    const mine = repeating.filter((v) => v.workout === sample.key)
    const bad = mine.filter((v) => !v.fits)
    const bpm = mine[0]?.bpm ?? bpmForRecipe(sample.workout.recipe)
    const share = mine.length === 0 ? 0 : (bad.length / mine.length) * 100
    console.log(
      `| ${sample.key} | ${bpm} | ${mine.length} | ${bad.length} | ${share.toFixed(0)}% |`,
    )
  }

  console.log('\n## Blocks outside the envelope\n')
  console.log('| Workout | Block | Notation | BPM | reps | stride | needs | short by |')
  console.log('|---|---|---|---|---|---|---|---|')
  for (const v of misfits) {
    console.log(
      `| ${v.workout} | ${v.blockId} | ${v.notation} | ${v.bpm} | ${v.repeats} | ` +
        `${v.strideMs.toFixed(0)}ms | ${v.needMs.toFixed(0)}ms | ` +
        `${(v.needMs - v.strideMs).toFixed(0)}ms |`,
    )
  }
}

const invokedDirectly = process.argv[1]?.endsWith('speakable-envelope-audit.ts')
if (invokedDirectly) main()
