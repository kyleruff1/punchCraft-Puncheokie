/**
 * Authoring helpers for hand-written sample workouts (M31-05).
 *
 * Samples must not contain hand-typed millisecond literals: every block and
 * round duration derives from beats through M31-02, so a sample authored at
 * one cadence stays correct if its profile changes. These helpers are what
 * make that practical — without them each block would need three
 * hand-computed numbers that could silently drift from its tokens.
 *
 * Pure TypeScript — no React, Expo, SQLite or BLE imports (spec §15.1).
 */

import { beatsToMs, blockDurationMs } from '../cadence'
import { parseCombo, type BlockKind, type BlockStance, type WorkoutBlock, type WorkoutToken } from '../WorkoutTokens'

export interface BlockSpec {
  id: string
  kind: BlockKind
  /** Combo notation, e.g. `'1-2b-3'`. Parsed via `parseCombo` (D10). */
  notation: string
  /**
   * Musical beat offsets, one per token, replacing `parseCombo`'s
   * placeholder 0,1,2,… sequence. Omit for evenly-spaced tokens.
   */
  offsets?: number[]
  /** Trailing gap before the next block, in beats (D5). */
  gapBeats: number
  /** Repetitions. Only valid on `repeated-combo` (validator enforces this). */
  repeat?: number
  stance?: BlockStance
  spokenPhrase?: string
  instruction?: string
  /**
   * For `volume-burst` / `open-pressure`, where output is measured by count
   * rather than enumerated tokens — doc §14 calls these essential for high
   * punch-count targets.
   */
  targetPunches?: number
  targetVelocityZone?: 1 | 2 | 3 | 4
  /**
   * Explicit block length in beats, overriding the token-derived duration.
   *
   * Needed by `volume-burst` and `open-pressure`, which run for a fixed
   * window and are measured by tracker count rather than by prescribing
   * every punch (doc §14). Their token list is a motif to repeat, not an
   * enumeration, so its last beat offset says nothing about how long the
   * block runs.
   */
  durationBeats?: number
}

/** Apply authored musical offsets over the parser's placeholder sequence. */
function withOffsets(tokens: WorkoutToken[], offsets?: number[]): WorkoutToken[] {
  if (!offsets) return tokens
  if (offsets.length !== tokens.length) {
    throw new Error(
      `offsets length ${offsets.length} does not match token count ${tokens.length}`,
    )
  }
  return tokens.map((token, i) => ({ ...token, beatOffset: offsets[i] as number }))
}

/**
 * Lay a list of block specs end to end from the start of a round.
 *
 * Each block's `startOffsetMs` is the running total of everything before it.
 * Because `blockDurationMs` already includes the trailing `gapBeats`, blocks
 * laid this way never overlap.
 */
export function layBlocks(specs: readonly BlockSpec[], bpm: number): WorkoutBlock[] {
  const blocks: WorkoutBlock[] = []
  let cursorMs = 0

  for (const spec of specs) {
    const tokens = withOffsets(parseCombo(spec.notation), spec.offsets)
    const repeat = spec.repeat ?? 1
    const durationMs =
      spec.durationBeats !== undefined
        ? beatsToMs(spec.durationBeats, bpm)
        : blockDurationMs(tokens, spec.gapBeats, bpm) * repeat

    const block: WorkoutBlock = {
      id: spec.id,
      kind: spec.kind,
      startOffsetMs: cursorMs,
      durationMs,
      stance: spec.stance ?? 'inherit',
      tokens,
      gapBeats: spec.gapBeats,
    }
    if (spec.repeat !== undefined) block.repeat = spec.repeat
    if (spec.targetPunches !== undefined) block.targetPunches = spec.targetPunches
    if (spec.targetVelocityZone !== undefined) block.targetVelocityZone = spec.targetVelocityZone
    if (spec.spokenPhrase !== undefined) block.spokenPhrase = spec.spokenPhrase
    if (spec.instruction !== undefined) block.instruction = spec.instruction

    blocks.push(block)
    cursorMs += durationMs
  }

  return blocks
}

/**
 * Punches a block contributes to a round target.
 *
 * Enumerated punch tokens times the repeat count, unless the block declares
 * `targetPunches` — volume-burst and open-pressure blocks measure output by
 * tracker count rather than by prescribing every punch (doc §14), so their
 * declared target is authoritative.
 */
export function blockPunchCount(block: WorkoutBlock): number {
  if (block.targetPunches !== undefined) return block.targetPunches
  const enumerated = block.tokens.filter((t) => t.kind === 'punch').length
  return enumerated * (block.repeat ?? 1)
}

/** Total punches a round's blocks prescribe. */
export function roundPunchCount(blocks: readonly WorkoutBlock[]): number {
  return blocks.reduce((sum, b) => sum + blockPunchCount(b), 0)
}

/** Milliseconds consumed by a laid-out block list. */
export function blocksSpanMs(blocks: readonly WorkoutBlock[]): number {
  if (blocks.length === 0) return 0
  const last = blocks[blocks.length - 1] as WorkoutBlock
  return last.startOffsetMs + last.durationMs
}

/** Convenience re-export so samples never import cadence directly. */
export { beatsToMs }
