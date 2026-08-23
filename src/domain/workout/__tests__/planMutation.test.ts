/**
 * Plan mutation (M33-07).
 *
 * Three invariants carry this, and all three are about not taking something
 * away from the athlete:
 *
 * - a mutation may not touch a round that has started or finished;
 * - a disabled command may not reappear through an adaptation;
 * - the mutated plan must still validate.
 */
import {
  applyMutation,
  buildCatchUpBlock,
  buildEaseBlock,
  commandsUsedBy,
  respectsEnablement,
  type PlanMutation,
} from '../planMutation'
import { validateGeneratedWorkout } from '../GeneratedWorkout'
import { defaultRecipe } from '../WorkoutRecipe'
import { CADENCE_PROFILES } from '../cadence'
import { threeRoundFundamentals } from '../samples'
import type { GeneratedWorkout } from '../GeneratedWorkout'
import type { PunchNumber, WorkoutBlock } from '../WorkoutTokens'

const WORKOUT: GeneratedWorkout = threeRoundFundamentals
const BPM = CADENCE_PROFILES.steady.nominalBpm

const catchUp = (id = 'catch-1'): WorkoutBlock =>
  buildCatchUpBlock({
    id,
    startOffsetMs: 999_999, // relayout decides where it really goes
    durationMs: 20_000,
    targetPunches: 30,
    recipe: defaultRecipe(),
  })!

// ---------------------------------------------------------------------------

describe('only unstarted rounds may change', () => {
  it('copies earlier rounds through untouched', () => {
    const mutation: PlanMutation = {
      roundTargets: [1, 1, 1],
      insertBlocks: [{ roundIndex: 0, block: catchUp() }],
    }
    const result = applyMutation(WORKOUT, mutation, { fromRoundIndex: 2 })

    // Rounds 0 and 1 are identical objects, not merely equal — nothing
    // reached them at all.
    expect(result.schedule[0]).toBe(WORKOUT.schedule[0])
    expect(result.schedule[1]).toBe(WORKOUT.schedule[1])
  })

  it('applies to the round the boundary opens onto and beyond', () => {
    const mutation: PlanMutation = { roundTargets: [10, 20, 30] }
    const result = applyMutation(WORKOUT, mutation, { fromRoundIndex: 1 })
    expect(result.schedule[0]?.targetPunches).toBe(WORKOUT.schedule[0]?.targetPunches)
    expect(result.schedule[1]?.targetPunches).toBe(20)
    expect(result.schedule[2]?.targetPunches).toBe(30)
  })

  it('ignores an insertion aimed at a round that has already run', () => {
    const mutation: PlanMutation = {
      insertBlocks: [{ roundIndex: 0, block: catchUp() }],
    }
    const result = applyMutation(WORKOUT, mutation, { fromRoundIndex: 1 })
    expect(result.schedule[0]?.blocks).toHaveLength(WORKOUT.schedule[0]!.blocks.length)
  })
})

describe('purity', () => {
  it('never modifies the input workout', () => {
    // Goal-seeking runs against a plan the cue engine is already walking;
    // mutating in place would change the timeline underneath it.
    const before = JSON.stringify(WORKOUT)
    applyMutation(WORKOUT, {
      roundTargets: [1, 2, 3],
      insertBlocks: [{ roundIndex: 2, block: catchUp() }],
      lengthenBlocks: [{ blockId: WORKOUT.schedule[2]!.blocks[0]!.id, addMs: 5_000 }],
    }, { fromRoundIndex: 0 })
    expect(JSON.stringify(WORKOUT)).toBe(before)
  })

  it('returns the same round object when nothing changed for it', () => {
    const result = applyMutation(WORKOUT, {}, { fromRoundIndex: 0 })
    expect(result.schedule[0]).toBe(WORKOUT.schedule[0])
  })
})

describe('the mutated plan still validates (M31-01)', () => {
  it('validates after an insertion', () => {
    const result = applyMutation(
      WORKOUT,
      { insertBlocks: [{ roundIndex: 2, block: catchUp() }] },
      { fromRoundIndex: 2 },
    )
    expect(validateGeneratedWorkout(result)).toEqual([])
  })

  it('validates after a lengthening', () => {
    const target = WORKOUT.schedule[2]!.blocks[0]!.id
    const result = applyMutation(
      WORKOUT,
      { lengthenBlocks: [{ blockId: target, addMs: 3_000 }] },
      { fromRoundIndex: 2 },
    )
    expect(validateGeneratedWorkout(result)).toEqual([])
  })

  it('lays inserted blocks end to end without overlap', () => {
    // An overlapping insert would make expandTimeline emit overlapping
    // cues — the failure the M32-09 suite caught in the engine.
    const result = applyMutation(
      WORKOUT,
      { insertBlocks: [{ roundIndex: 2, block: catchUp() }] },
      { fromRoundIndex: 2 },
    )
    const blocks = result.schedule[2]!.blocks
    let cursor = 0
    for (const block of blocks) {
      expect(block.startOffsetMs).toBeGreaterThanOrEqual(cursor)
      cursor = block.startOffsetMs + block.durationMs
    }
  })

  it('keeps roundPunchTargets in step with the schedule', () => {
    const result = applyMutation(WORKOUT, { roundTargets: [5, 6, 7] }, { fromRoundIndex: 0 })
    expect(result.roundPunchTargets).toEqual([5, 6, 7])
  })
})

describe('behind adds volume, never speed (doc §17, §22)', () => {
  it('builds a count-scored block', () => {
    const block = catchUp()
    expect(block.kind).toBe('volume-burst')
    expect(block.targetPunches).toBe(30)
  })

  it('uses only punches the recipe enabled', () => {
    const recipe = { ...defaultRecipe(), enabledPunches: [3, 4] as PunchNumber[] }
    const block = buildCatchUpBlock({
      id: 'c',
      startOffsetMs: 0,
      durationMs: 10_000,
      targetPunches: 10,
      recipe,
    })!
    for (const token of block.tokens) {
      if (token.kind === 'punch') expect([3, 4]).toContain(token.number)
    }
  })

  it('builds nothing when no punch is enabled', () => {
    // No honest block exists, so none is invented.
    const recipe = { ...defaultRecipe(), enabledPunches: [] as PunchNumber[] }
    expect(
      buildCatchUpBlock({ id: 'c', startOffsetMs: 0, durationMs: 1, targetPunches: 1, recipe }),
    ).toBeNull()
  })

  it('does not raise the cadence of anything', () => {
    // A catch-up block carries its own gap; it never rewrites the pace of
    // the blocks around it.
    const before = WORKOUT.schedule[2]!.blocks.map((b) => b.gapBeats)
    const result = applyMutation(
      WORKOUT,
      { insertBlocks: [{ roundIndex: 2, block: catchUp() }] },
      { fromRoundIndex: 2 },
    )
    const after = result.schedule[2]!.blocks
      .filter((b) => !b.id.startsWith('catch-'))
      .map((b) => b.gapBeats)
    expect(after).toEqual(before)
  })
})

describe('ahead adds work that is not punches', () => {
  it('inserts defense and footwork the recipe allows', () => {
    const block = buildEaseBlock({ id: 'e', startOffsetMs: 0, recipe: defaultRecipe(), bpm: BPM })!
    expect(block.tokens.some((t) => t.kind === 'defense' || t.kind === 'footwork')).toBe(true)
    // Adding punches to someone already past their goal would move the
    // target they were given.
    expect(block.tokens.some((t) => t.kind === 'punch')).toBe(false)
  })

  it('falls back to active recovery when nothing is enabled', () => {
    const recipe = { ...defaultRecipe(), enabledDefense: [], enabledFootwork: [] }
    const block = buildEaseBlock({ id: 'e', startOffsetMs: 0, recipe, bpm: BPM })!
    expect(block.kind).toBe('active-recovery')
    expect(block.tokens).toEqual([])
  })
})

describe('a disabled command never reappears through an adaptation (doc §7, §15)', () => {
  it('accepts a mutation built from enabled commands', () => {
    const recipe = defaultRecipe()
    const mutation: PlanMutation = {
      insertBlocks: [
        { roundIndex: 2, block: buildEaseBlock({ id: 'e', startOffsetMs: 0, recipe, bpm: BPM })! },
      ],
    }
    expect(respectsEnablement(mutation, recipe)).toBe(true)
  })

  it('rejects a mutation using a switched-off defense command', () => {
    // This is the one way goal-seeking could quietly undo a choice made on
    // the recipe screen.
    const recipe = { ...defaultRecipe(), enabledDefense: [] }
    const mutation: PlanMutation = {
      insertBlocks: [
        {
          roundIndex: 2,
          block: {
            ...catchUp(),
            tokens: [{ kind: 'defense', command: 'slip', beatOffset: 0 }],
          },
        },
      ],
    }
    expect(respectsEnablement(mutation, recipe)).toBe(false)
  })

  it('rejects a mutation using a switched-off punch', () => {
    const recipe = { ...defaultRecipe(), enabledPunches: [1, 2] as PunchNumber[] }
    const mutation: PlanMutation = {
      insertBlocks: [
        {
          roundIndex: 2,
          block: {
            ...catchUp(),
            tokens: [{ kind: 'punch', number: 6, body: false, beatOffset: 0 }],
          },
        },
      ],
    }
    expect(respectsEnablement(mutation, recipe)).toBe(false)
  })

  it('never builds a block that violates its own recipe', () => {
    for (const enabledPunches of [[1], [2, 4], [1, 3, 5]] as PunchNumber[][]) {
      const recipe = { ...defaultRecipe(), enabledPunches }
      const block = buildCatchUpBlock({
        id: 'c',
        startOffsetMs: 0,
        durationMs: 10_000,
        targetPunches: 10,
        recipe,
      })!
      const mutation: PlanMutation = { insertBlocks: [{ roundIndex: 0, block }] }
      expect(respectsEnablement(mutation, recipe)).toBe(true)
    }
  })

  it('lists every command a mutation used', () => {
    const recipe = defaultRecipe()
    const mutation: PlanMutation = {
      insertBlocks: [
        { roundIndex: 2, block: buildEaseBlock({ id: 'e', startOffsetMs: 0, recipe, bpm: BPM })! },
      ],
    }
    const used = commandsUsedBy(mutation)
    expect(used.length).toBeGreaterThan(0)
    for (const entry of used) expect(entry).toMatch(/^(punch|defense|footwork|coach):/)
  })
})

describe('determinism (spec §13.6)', () => {
  it('produces a deep-equal result for the same inputs', () => {
    const mutation: PlanMutation = {
      roundTargets: [10, 20, 30],
      insertBlocks: [{ roundIndex: 2, block: catchUp() }],
    }
    const a = applyMutation(WORKOUT, mutation, { fromRoundIndex: 1 })
    const b = applyMutation(WORKOUT, mutation, { fromRoundIndex: 1 })
    expect(b).toEqual(a)
  })
})
