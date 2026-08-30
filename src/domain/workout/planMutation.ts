/**
 * Plan mutation (M33-07, doc §22).
 *
 * Goal-seeking's hands. `PacingEngine` decides *whether* to act; this
 * decides *what the plan becomes*, and it does so as a pure function so the
 * result can be validated, persisted and replayed.
 *
 * ## The rule that governs everything here
 *
 * **A mutation may only touch rounds that have not started.** The athlete
 * is mid-combination somewhere; rewriting the round they are in would
 * change the cues under their hands, and rewriting a round already finished
 * would retroactively edit a result they were already shown. Both are
 * refused structurally: `applyMutation` takes `fromRoundIndex` and copies
 * every earlier round through untouched.
 *
 * ## Behind and ahead are not symmetric
 *
 * Behind, the plan adds **volume** — count-scored blocks the athlete can
 * fill at their own rate (doc §14) — rather than speeding the cues up.
 * Doc §22 and §25 are explicit that a catch-up must never push cadence past
 * its ceiling, because cues that outrun intelligibility make the workout
 * unusable in pursuit of a number.
 *
 * Ahead, the plan adds **defense, footwork or recovery** — work that is not
 * punches. Adding more punches to someone already ahead of their goal would
 * be moving the target they were given.
 *
 * Either way, an inserted token can only use commands the recipe enabled.
 * A disabled command must not reappear indirectly through an adaptation
 * (doc §7, §15) — that is the one way this could quietly violate a choice
 * the athlete made on the recipe screen.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports, and no
 * `Date.now()` (spec §15.1, §18.3).
 */

import { beatsToMs } from './cadence'
import type { GeneratedWorkout } from './GeneratedWorkout'
import type { WorkoutRecipe } from './WorkoutRecipe'
import type { ProgramRound, WorkoutBlock, WorkoutToken } from './WorkoutTokens'

export interface BlockInsertion {
  roundIndex: number
  block: WorkoutBlock
}

export interface BlockLengthening {
  blockId: string
  addMs: number
}

export interface PlanMutation {
  /** Reallocated targets, one per round in the full schedule. */
  roundTargets?: number[]
  insertBlocks?: BlockInsertion[]
  lengthenBlocks?: BlockLengthening[]
}

export interface ApplyMutationOptions {
  /**
   * The first round that may be changed. Everything before it is copied
   * through byte-identical — see the header note.
   */
  fromRoundIndex: number
}

/**
 * Apply a mutation, returning a new workout.
 *
 * The input is never modified: goal-seeking runs mid-session against a plan
 * the cue engine is already walking, and mutating it in place would change
 * the timeline underneath the engine rather than through it.
 */
export function applyMutation(
  workout: GeneratedWorkout,
  mutation: PlanMutation,
  options: ApplyMutationOptions,
): GeneratedWorkout {
  const { fromRoundIndex } = options

  const schedule: ProgramRound[] = workout.schedule.map((round, roundIndex) => {
    // Already started or finished: untouchable.
    if (roundIndex < fromRoundIndex) return round

    let blocks = round.blocks

    const lengthenings = (mutation.lengthenBlocks ?? []).filter((l) =>
      blocks.some((b) => b.id === l.blockId),
    )
    if (lengthenings.length > 0) {
      blocks = blocks.map((block) => {
        const extra = lengthenings.find((l) => l.blockId === block.id)
        if (!extra) return block
        return { ...block, durationMs: block.durationMs + Math.max(0, extra.addMs) }
      })
      blocks = relayout(blocks)
    }

    const insertions = (mutation.insertBlocks ?? []).filter((i) => i.roundIndex === roundIndex)
    if (insertions.length > 0) {
      blocks = relayout([...blocks, ...insertions.map((i) => i.block)])
    }

    const targetPunches = mutation.roundTargets?.[roundIndex] ?? round.targetPunches

    return blocks === round.blocks && targetPunches === round.targetPunches
      ? round
      : { ...round, blocks, targetPunches }
  })

  const roundPunchTargets = schedule
    .filter((r) => r.countsTowardGoal)
    .map((r) => r.targetPunches)

  return { ...workout, schedule, roundPunchTargets }
}

/**
 * Re-lay blocks end to end after an insertion or a lengthening.
 *
 * Without this, an inserted block would overlap whatever followed it, and
 * `expandTimeline` would emit overlapping cues — the exact failure the
 * M32-09 suite caught in the engine.
 */
function relayout(blocks: readonly WorkoutBlock[]): WorkoutBlock[] {
  // A3 (#258): drop tail-pad blocks before re-laying. Samples now pad
  // their rounds up to the bell with a synthetic volume-burst carrying
  // a `#pad` id suffix; a mutation that inserts more work into an
  // already-full round would otherwise overrun. Dropping the pad here
  // is acceptable: mutation is an adjust action that expects the round
  // to reshape itself, and the free-work fallback still handles any
  // remaining tail.
  const withoutPad = blocks.filter((b) => !b.id.endsWith('#pad'))
  const ordered = [...withoutPad].sort((a, b) => a.startOffsetMs - b.startOffsetMs)
  let cursor = 0
  return ordered.map((block) => {
    const laid = { ...block, startOffsetMs: cursor }
    cursor += block.durationMs
    return laid
  })
}

// ---------------------------------------------------------------------------
// Block authoring for the two directions
// ---------------------------------------------------------------------------

/**
 * A count-scored block to add when the athlete is behind.
 *
 * Volume, never speed: the athlete fills it at whatever rate they can
 * manage, and the cues do not have to get faster to accommodate a bigger
 * number (doc §17, §22).
 *
 * Takes no cadence: token offsets are beat-relative and the duration is
 * supplied by the caller, so there is nothing here for a BPM to size.
 */
export function buildCatchUpBlock(args: {
  id: string
  startOffsetMs: number
  durationMs: number
  targetPunches: number
  recipe: WorkoutRecipe
}): WorkoutBlock | null {
  const enabled = args.recipe.enabledPunches
  // Nothing enabled: no honest block can be built, so none is.
  if (enabled.length === 0) return null

  // The simplest pattern the recipe permits. A catch-up block is not the
  // place to introduce a combination the athlete has not been shown.
  const lead = enabled.includes(1) ? 1 : enabled[0]!
  const rear = enabled.includes(2) ? 2 : (enabled.find((n) => n % 2 === 0) ?? lead)

  const tokens: WorkoutToken[] = [
    { kind: 'punch', number: lead, body: false, beatOffset: 0 },
    { kind: 'punch', number: rear, body: false, beatOffset: 0.7 },
  ]

  return {
    id: args.id,
    kind: 'volume-burst',
    startOffsetMs: args.startOffsetMs,
    durationMs: args.durationMs,
    stance: 'inherit',
    tokens,
    gapBeats: 1,
    targetPunches: args.targetPunches,
    spokenPhrase: 'Volume. Keep them going.',
    instruction: 'Work at your own rate.',
  }
}

/**
 * A non-punch block to add when the athlete is comfortably ahead.
 *
 * Adding punches to someone already past their goal would move the target
 * they were given, so this adds work that is not punches — and only from
 * commands the recipe enabled (doc §7, §15).
 */
export function buildEaseBlock(args: {
  id: string
  startOffsetMs: number
  recipe: WorkoutRecipe
  bpm: number
}): WorkoutBlock | null {
  const { recipe } = args
  const tokens: WorkoutToken[] = []

  const defense = recipe.enabledDefense[0]
  const footwork = recipe.enabledFootwork[0]

  if (defense) tokens.push({ kind: 'defense', command: defense, beatOffset: 0 })
  if (footwork) tokens.push({ kind: 'footwork', command: footwork, beatOffset: defense ? 1 : 0 })

  // Neither enabled: fall back to an active-recovery gap rather than
  // inventing a command the athlete switched off.
  const kind: WorkoutBlock['kind'] = tokens.length > 0 ? 'footwork-exit' : 'active-recovery'
  const spanBeats = tokens.length > 0 ? 2 : 4

  return {
    id: args.id,
    kind,
    startOffsetMs: args.startOffsetMs,
    durationMs: beatsToMs(spanBeats + 2, args.bpm),
    stance: 'inherit',
    tokens,
    gapBeats: 2,
    instruction: tokens.length > 0 ? 'Move. Reset your feet.' : 'Breathe. Stay loose.',
  }
}

/**
 * Every command an insertion used, so a caller can prove nothing disabled
 * crept in. Used by the tests and worth keeping exported — this is the
 * invariant most likely to be broken by a later change.
 */
export function commandsUsedBy(mutation: PlanMutation): string[] {
  const used = new Set<string>()
  for (const insertion of mutation.insertBlocks ?? []) {
    for (const token of insertion.block.tokens) {
      if (token.kind === 'punch') used.add(`punch:${token.number}`)
      else used.add(`${token.kind}:${token.command}`)
    }
  }
  return [...used].sort()
}

/** True when every command in the mutation is permitted by the recipe. */
export function respectsEnablement(mutation: PlanMutation, recipe: WorkoutRecipe): boolean {
  for (const insertion of mutation.insertBlocks ?? []) {
    for (const token of insertion.block.tokens) {
      if (token.kind === 'punch' && !recipe.enabledPunches.includes(token.number)) return false
      if (token.kind === 'defense' && !recipe.enabledDefense.includes(token.command)) return false
      if (token.kind === 'footwork' && !recipe.enabledFootwork.includes(token.command)) return false
      if (token.kind === 'coach' && !recipe.enabledCoachCalls.includes(token.command)) return false
    }
  }
  return true
}
